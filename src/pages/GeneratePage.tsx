import { useState, useEffect, useRef, useMemo } from 'react';
import { Download, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { fetchErrorKey, fetchWcif } from '../auth/wca';
import { getCachedWcif, setCachedWcif } from '../lib/wcifCache';
import type { CompetitionSettings } from '../types/settings';
import { parseWCIF, emptyParsedWcif, type ParsedWCIF } from '../lib/wcif-parser';
import { filterParsedByScope, hasUnassignedIntermediate, stageSplitSkipsRound2, type GenerationScope } from '../lib/generationScope';
import { estimateTotalPages } from '../lib/pageEstimate';
import { customEventCardCount } from '../lib/customScorecards';
import { buildPdfJobs, downloadTarget, hasOversizedPdf } from '../lib/pdfJobs';
import { MAX_PAGES_PER_SCORECARD_PDF } from '../pdf/layoutConstants';
import * as analytics from '../lib/analytics';
import { readPresetId } from '../presets';
import type { WorkerRequest, WorkerResponse } from '../pdf/scorecardWorker';
import Header from '../components/Header';
import WarningBanner from '../components/WarningBanner';
import OtsNotice from '../components/OtsNotice';
import Skeleton from '../components/Skeleton';
import PrintGuide from '../components/PrintGuide';
import { readSettings } from '../lib/flowState';
import i18n from '../i18n/index';
import ui from '../styles/ui.module.css';
import s from './GeneratePage.module.css';

type Status = 'idle' | 'fetching' | 'parsing' | 'ready' | 'building' | 'error';

export default function GeneratePage() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const navigate = useNavigate();

  // Offered here, not on /settings: only the built job list knows whether a file is past the cap.
  const [splitLarge, setSplitLarge] = useState(false);
  const stored = readSettings();
  const settings: CompetitionSettings | null = stored && { ...stored, splitLargePdfs: splitLarge };

  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [buildPercent, setBuildPercent] = useState(0);
  const [parsed, setParsed] = useState<ParsedWCIF | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Memoised on stable string keys: `settings` is re-parsed from sessionStorage every
  // render, so it is never referentially equal to itself.
  const settingsKey = JSON.stringify(settings);
  const scopeKey = JSON.stringify(settings?.generationScope ?? { mode: 'everything' });
  const scope = useMemo<GenerationScope>(() => JSON.parse(scopeKey) as GenerationScope, [scopeKey]);

  useEffect(() => {
    if (!settings || !token) return;
    let cancelled = false;

    async function run() {
      // Custom competitions have no WCIF; only settings.customEvents drive the PDFs.
      if (settings!.isCustomCompetition) {
        setParsed(emptyParsedWcif());
        setStatus('ready');
        return;
      }

      setStatus('fetching');
      // React state is stale in this closure, so the error event needs its own step.
      let stage: analytics.ErrorStage = 'fetch';
      try {
        const wcif = getCachedWcif(settings!.competitionId)
          ?? await fetchWcif(settings!.competitionId, token!.access_token);
        if (cancelled) return;
        setCachedWcif(settings!.competitionId, wcif);

        setStatus('parsing');
        stage = 'parse';
        const result = parseWCIF(wcif, settings!);
        if (cancelled) return;

        setParsed(result);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        analytics.send(analytics.buildErrorEvent(settings!.competitionId, stage, e));
        const key = fetchErrorKey(e);
        setStatusMsg(key ? t(key) : String(e));
        setStatus('error');
      }
    }

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  const effectiveParsed = useMemo(
    () => (parsed ? filterParsedByScope(parsed, scope) : null),
    [parsed, scope],
  );

  // The list the worker renders from. Above the redirect so the hook order never changes.
  const jobs = useMemo(
    () => (effectiveParsed && settings ? buildPdfJobs(effectiveParsed, settings) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveParsed, settingsKey],
  );
  const totalPages = useMemo(
    () => (effectiveParsed && settings ? estimateTotalPages(effectiveParsed, settings, jobs) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveParsed, jobs, settingsKey],
  );

  if (!settings) {
    navigate('/competitions', { replace: true });
    return null;
  }

  const allEntries = effectiveParsed
    ? [...effectiveParsed.firstRound, ...effectiveParsed.intermediate, ...effectiveParsed.semis, ...effectiveParsed.finals]
    : [];
  const customCardCount = (settings.customEvents ?? [])
    .filter(c => c.name.trim())
    .reduce((n, c) => n + customEventCardCount(c, settings.scorecardsA6), 0);
  const scorecardCount = allEntries.filter(e => e.kind === 'scorecard').length + customCardCount;
  const coverCount     = allEntries.filter(e => e.kind === 'cover' && e.eventId).length;
  const pdfCount       = jobs.length;
  const filename       = downloadTarget(jobs, settings.competitionId).filename;

  function handleDownload() {
    if (status === 'building' || !effectiveParsed || pdfCount === 0) return;

    workerRef.current?.terminate();
    const worker = new Worker(
      new URL('../pdf/scorecardWorker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    setStatus('building');
    setStatusMsg('');
    setBuildPercent(0);

    const uiLang = (i18n.language?.slice(0, 2) ?? 'en') as 'en' | 'fr' | 'es' | 'pt';

    worker.onerror = (e) => {
      analytics.send(analytics.buildErrorEvent(settings!.competitionId, 'render', e.message));
      setStatusMsg(`Worker error: ${e.message}`);
      setStatus('error');
      worker.terminate();
      workerRef.current = null;
    };

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setBuildPercent(msg.percent);
        setStatusMsg(msg.message);
      } else if (msg.type === 'done') {
        // The worker decided zip-vs-bare-PDF, and hands over a Blob: a WC-sized archive
        // must never be copied through the heap on this side either.
        const url  = URL.createObjectURL(msg.blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = msg.filename;
        a.click();
        // Revoked on the next tick: a synchronous revoke can cancel a large download.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        worker.terminate();
        workerRef.current = null;
        setStatus('ready');
        // After the download, so a beacon failure cannot cost anyone their PDFs. `parsed`
        // sizes the competition; the counts below describe only this download.
        analytics.send(analytics.buildGenerateEvent({
          parsed: parsed!,
          wcif: getCachedWcif(settings!.competitionId) ?? null,
          settings: settings!,
          uiLanguage: uiLang,
          presetId: readPresetId(),
          output: analytics.buildOutput(jobs, totalPages, scorecardCount, coverCount),
        }));
      } else {
        analytics.send(analytics.buildErrorEvent(settings!.competitionId, 'render', msg.message));
        setStatusMsg(msg.message);
        setStatus('error');
        worker.terminate();
        workerRef.current = null;
      }
    };

    const req: WorkerRequest = { parsed: effectiveParsed, settings: settings!, uiLanguage: uiLang };
    worker.postMessage(req);
  }

  return (
    <div className={ui.page}>
      <Header showBack onBack={() => navigate('/settings')} showSignOut />

      <main id="main" className={`${ui.main} ${s.main}`}>
        <div className={ui.compBadge}>{settings.competitionName}</div>
        <h1 className={`${ui.pageTitle} ${s.pageTitle}`}>{t('generate.title')}</h1>

        {(status === 'fetching' || status === 'parsing') && (
          <StatsSkeleton label={status === 'fetching' ? t('generate.fetching') : t('generate.parsing')} />
        )}
        {status === 'error'    && (
          <StatusBox icon={<XCircle size={28} strokeWidth={2} color="var(--danger)" />} text={statusMsg} isError />
        )}
        {status === 'building' && (
          <div className={s.progressBox}>
            <div className={s.progressHeader}>
              <span className={s.progressLabel}>{statusMsg || t('generate.rendering')}</span>
              <span className={s.progressPct}>{buildPercent}%</span>
            </div>
            <div
              className={s.progressTrack}
              role="progressbar"
              aria-valuenow={buildPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('generate.rendering')}
            >
              <div className={s.progressFill} style={{ transform: `scaleX(${buildPercent / 100})` }} />
            </div>
          </div>
        )}

        {(status === 'ready' || status === 'building') && (
          <>
            {status === 'ready' && parsed?.hasGroups === false && (
              <WarningBanner>{t('warnings.no_groups')}</WarningBanner>
            )}
            {status === 'ready' && settings?.otsBlanks && <OtsNotice />}

            {status === 'ready' && settings && effectiveParsed
              && stageSplitSkipsRound2(settings, hasUnassignedIntermediate(effectiveParsed)) && (
              <WarningBanner>{t('warnings.stage_split_prefilled')}</WarningBanner>
            )}

            {status === 'ready'
              && hasOversizedPdf(jobs.filter(j => j.kind === 'scorecards' && j.mergedRounds), settings.scorecardsA6) && (
              <WarningBanner>{t('warnings.merge_rounds_large')}</WarningBanner>
            )}

            {status === 'ready' && (splitLarge || hasOversizedPdf(jobs, settings.scorecardsA6)) && (
              <label className={`${ui.toggleCard} ${s.splitToggle} ${splitLarge ? ui.toggleCardActive : ''}`}>
                <input
                  type="checkbox"
                  checked={splitLarge}
                  onChange={e => setSplitLarge(e.target.checked)}
                  className={ui.radio}
                />
                <div>
                  <div className={ui.optionLabel}>{t('generate.split_large.label')}</div>
                  <div className={ui.optionDesc}>
                    {t('generate.split_large.desc', { pages: MAX_PAGES_PER_SCORECARD_PDF })}
                  </div>
                </div>
              </label>
            )}

            {status === 'ready' && (
              <div className={s.stats}>
                <Stat label={t('generate.stats.scorecards')} value={scorecardCount} />
                <Stat label={t('generate.stats.cover_cards')} value={coverCount} />
                <Stat label={t('generate.stats.pdfs')} value={pdfCount} />
                <Stat label={t('generate.stats.total_pages')} value={totalPages} />
                <Stat label={t('generate.stats.paper')} value={settings.scorecardsA6 ? `${settings.paperFormat} + A6` : settings.paperFormat} />
              </div>
            )}

            {/* The filename sits under the button, not inside it: a long competition id used
                to force the label down to 12px to fit. */}
            <button
              className={ui.btnPrimary}
              onClick={handleDownload}
              disabled={status === 'building' || pdfCount === 0}
            >
              {status !== 'building' && <Download size={18} aria-hidden />}
              {status === 'building' ? t('generate.building_button') : t('generate.download_button')}
            </button>
            {status === 'ready' && pdfCount > 0 && (
              <p className={s.downloadFilename}>{filename}</p>
            )}

            <PrintGuide jobs={jobs} a6={settings.scorecardsA6} />
          </>
        )}
      </main>
    </div>
  );
}

function StatusBox({ icon, text, isError = false }: { icon: React.ReactNode; text: string; isError?: boolean }) {
  return (
    <div className={`${ui.statusBox} ${isError ? ui.statusError : ''}`}>
      {icon}
      <span className={isError ? ui.errorText : s.statusText}>{text}</span>
    </div>
  );
}

/** Mirrors the stats grid and download button, so the layout doesn't shift on arrival. */
function StatsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      <div className={s.stats}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={s.stat}>
            <Skeleton className={s.statValueSkeleton} />
            <Skeleton className={s.statLabelSkeleton} />
          </div>
        ))}
      </div>
      <Skeleton height={56} radius="var(--radius-md)" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={s.stat}>
      <div className={s.statValue}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}
