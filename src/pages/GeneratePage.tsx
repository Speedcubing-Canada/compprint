import { useState, useEffect, useRef, useMemo } from 'react';
import { Download, XCircle } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getCachedWcif } from '../lib/wcifCache';
import { useParsedCompetition } from '../lib/useParsedCompetition';
import type { CompetitionSettings } from '../types/settings';
import { parseWCIF, emptyParsedWcif } from '../lib/wcif-parser';
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

export default function GeneratePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Offered here, not on /settings: only the built job list knows whether a file is past the cap.
  const [splitLarge, setSplitLarge] = useState(false);
  const stored = readSettings();
  const settings: CompetitionSettings | null = stored && { ...stored, splitLargePdfs: splitLarge };

  // Custom competitions have no WCIF; only settings.customEvents drive the PDFs.
  const custom = settings?.isCustomCompetition === true;
  const load = useParsedCompetition(settings && !custom ? settings.competitionId : null, (wcif) => parseWCIF(wcif, settings!));
  const [customParsed] = useState(emptyParsedWcif);
  const parsed = custom ? customParsed : load.parsed;
  const [building, setBuilding] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [buildPercent, setBuildPercent] = useState(0);
  // A failed render keeps the page usable: the competition is still loaded, so Download stays.
  const [renderError, setRenderError] = useState<string | null>(null);
  const error = load.error ?? renderError;
  const workerRef = useRef<Worker | null>(null);

  // Memoised on stable string keys: `settings` is re-parsed from sessionStorage every
  // render, so it is never referentially equal to itself.
  const settingsKey = JSON.stringify(settings);
  const scopeKey = JSON.stringify(settings?.generationScope ?? { mode: 'everything' });
  const scope = useMemo<GenerationScope>(() => JSON.parse(scopeKey) as GenerationScope, [scopeKey]);

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

  // navigate() during render is ignored, which left a blank page.
  if (!settings) return <Navigate to="/competitions" replace />;

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
    if (building || !effectiveParsed || pdfCount === 0) return;

    workerRef.current?.terminate();
    const worker = new Worker(
      new URL('../pdf/scorecardWorker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    setBuilding(true);
    setProgressMsg('');
    setRenderError(null);
    setBuildPercent(0);

    const uiLang = (i18n.language?.slice(0, 2) ?? 'en') as 'en' | 'fr' | 'es' | 'pt';
    const fail = (message: string) => {
      analytics.send(analytics.buildErrorEvent(settings!.competitionId, 'render', message));
      setRenderError(message);
      setBuilding(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = (e) => fail(`Worker error: ${e.message}`);

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setBuildPercent(msg.percent);
        setProgressMsg(msg.message);
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
        setBuilding(false);
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
        fail(msg.message);
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

        {(load.status === 'fetching' || load.status === 'parsing') && (
          <StatsSkeleton label={load.status === 'fetching' ? t('generate.fetching') : t('generate.parsing')} />
        )}
        {error && (
          <StatusBox icon={<XCircle size={28} strokeWidth={2} color="var(--danger)" />} text={error} isError />
        )}
        {building && (
          <div className={s.progressBox}>
            <div className={s.progressHeader}>
              <span className={s.progressLabel}>{progressMsg || t('generate.rendering')}</span>
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

        {parsed && (
          <>
            {!building && parsed.hasGroups === false && (
              <WarningBanner>{t('warnings.no_groups')}</WarningBanner>
            )}
            {!building && settings.otsBlanks && <OtsNotice />}

            {!building && effectiveParsed
              && stageSplitSkipsRound2(settings, hasUnassignedIntermediate(effectiveParsed)) && (
              <WarningBanner>{t('warnings.stage_split_prefilled')}</WarningBanner>
            )}

            {!building
              && hasOversizedPdf(jobs.filter(j => j.kind === 'scorecards' && j.mergedRounds), settings.scorecardsA6) && (
              <WarningBanner>{t('warnings.merge_rounds_large')}</WarningBanner>
            )}

            {!building && (splitLarge || hasOversizedPdf(jobs, settings.scorecardsA6)) && (
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

            {!building && (
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
              disabled={building || pdfCount === 0}
            >
              {!building && <Download size={18} aria-hidden />}
              {building ? t('generate.building_button') : t('generate.download_button')}
            </button>
            {!building && pdfCount > 0 && (
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
