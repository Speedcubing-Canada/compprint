import { useState, useEffect, useMemo } from 'react';
import { Check, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { fetchErrorKey, fetchWcif } from '../auth/wca';
import { getCachedWcif, setCachedWcif } from '../lib/wcifCache';
import * as analytics from '../lib/analytics';
import { parseWCIF, type ParsedWCIF } from '../lib/wcif-parser';
import {
  availableRounds, latestAssignedRound, filterParsedByScope, hasUnassignedIntermediate,
  type GenerationScope, type DocumentSelection,
} from '../lib/generationScope';
import type { CompetitionSettings, LocaleCode } from '../types/settings';
import { clearSettings, readCompetition, readStoredScope, writeHasGroups, writeScope } from '../lib/flowState';
import { PRESETS, readPresetId, writePresetSettings, writePresetId, type Preset } from '../presets';
import Header from '../components/Header';
import Skeleton from '../components/Skeleton';
import ui from '../styles/ui.module.css';
import s from './RoundScopePage.module.css';

type Status = 'loading' | 'ready' | 'error';

const keyOf = (eventId: string, roundNum: number) => `${eventId}|${roundNum}`;

// Mid-competition, only scorecards are usually wanted: the rest printed before day 1.
const baseDocuments = (isMidComp: boolean): DocumentSelection => ({
  scorecards: true,
  scheduleTracker: !isMidComp,
  nametags: !isMidComp,
  // Opt-in either way: most delegates don't need them.
  roundChecklist: false,
  firstTimerSlips: false,
  groupOverview: false,
});

export default function RoundScopePage() {
  const { t, i18n } = useTranslation();
  const { token } = useAuth();
  const navigate = useNavigate();

  const { id: competitionId, name: competitionName } = readCompetition();

  const [status, setStatus] = useState<Status>('loading');
  const [statusMsg, setStatusMsg] = useState('');
  const [parsed, setParsed] = useState<ParsedWCIF | null>(null);
  const [isMidComp, setIsMidComp] = useState(false);

  // What this step wrote last time, seeding every choice below so going back discards
  // nothing. Read once: after mount the React state is the truth.
  const [restored] = useState(readStoredScope);

  // Round-scope state (mid-competition only)
  const [scopeMode, setScopeMode] = useState<'everything' | 'latest' | 'selected'>(
    restored?.mode ?? 'latest',
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string> | null>(
    restored?.mode === 'selected'
      ? new Set(restored.rounds.map(r => keyOf(r.eventId, r.roundNum)))
      : null,
  );

  // Pre-competition defaults, overridden once the data says otherwise.
  const [docScorecards, setDocScorecards] = useState(restored?.documents.scorecards ?? true);
  const [docSchedule, setDocSchedule]     = useState(restored?.documents.scheduleTracker ?? true);
  const [docNametags, setDocNametags]     = useState(restored?.documents.nametags ?? true);
  // Opt-in either way: most delegates don't need it.
  const [docRoundChecklist, setDocRoundChecklist] = useState(restored?.documents.roundChecklist ?? false);
  const [docFirstTimers, setDocFirstTimers] = useState(restored?.documents.firstTimerSlips ?? false);
  const [docGroupOverview, setDocGroupOverview] = useState(restored?.documents.groupOverview ?? false);

  // `null` means Default. A preset seeds the options below and the /settings step; nothing
  // is locked.
  const [presetId, setPresetId] = useState<string | null>(restored ? readPresetId() : null);

  useEffect(() => {
    if (!competitionId || !token) return;
    let cancelled = false;

    async function run() {
      // The first fetch and parse of a competition happen here, so this is where they fail.
      let stage: analytics.ErrorStage = 'fetch';
      try {
        const wcif = getCachedWcif(competitionId) ?? await fetchWcif(competitionId, token!.access_token);
        if (cancelled) return;
        setCachedWcif(competitionId, wcif);
        stage = 'parse';

        const uiLang = (i18n.language?.slice(0, 2) ?? 'en') as LocaleCode;
        const detectionSettings: CompetitionSettings = {
          competitionId, competitionName,
          language: uiLang, secondaryLanguage: null,
          paperFormat: 'LETTER', secondRoundMode: 'blanks',
          logoDataUrl: null, useDefaultLogo: true, scorecardCompNameWithLogo: false,
          liveResultsMode: 'wca-live', wcaLiveId: null, wcaLivePersonIds: null, hideWcaLiveId: false,
          nametagLogoMode: 'with-name', nametagQrMode: 'back-only', nametagLayout: 'vertical',
          customEvents: [],
          // Detection-only parse; the real mode is chosen later on /settings.
          scorecardCheckMode: 'per-group-card', splitPdfsByStage: false, otsBlanks: false, scorecardsA6: false,
          finalStationNumbers: true, stationsPerStage: null,
          scrambleDoubleCheck: false, scrambleDoubleCheckRounds: [], scrambleDoubleCheckOverrides: {},
          scrambleDoubleCheckWorldTop: null, scrambleDoubleCheckRegionTop: null,
          scrambleDoubleCheckRegionScope: 'national',
          generationScope: { mode: 'everything', documents: { scorecards: true, scheduleTracker: true, nametags: true, roundChecklist: false, firstTimerSlips: false, groupOverview: false } },
          isCustomCompetition: false,
        };
        const result = parseWCIF(wcif, detectionSettings);
        if (cancelled) return;

        // So the Settings page can warn without re-fetching the WCIF.
        writeHasGroups(result.hasGroups);

        const midComp = result.laterRoundsWithAssignments.length > 0;
        setIsMidComp(midComp);

        // Defaults only: a restored selection outranks them.
        if (midComp && !restored) {
          // Mid-competition default: scorecards only
          setDocSchedule(false);
          setDocNametags(false);
        }

        setParsed(result);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          analytics.send(analytics.buildErrorEvent(competitionId, stage, e));
          const key = fetchErrorKey(e);
          setStatusMsg(key ? t(key) : String(e));
          setStatus('error');
        }
      }
    }

    run();
    return () => { cancelled = true; };
  // competitionId/token are stable for the lifetime of this page
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roundOptions = useMemo(() => {
    if (!parsed) return [] as { key: string; label: string }[];
    const labels = new Map<string, string>();
    for (const bucket of [parsed.firstRound, parsed.intermediate, parsed.semis, parsed.finals]) {
      for (const e of bucket) {
        if (e.kind === 'cover' && !e.eventId) continue;
        const k = keyOf(e.eventId, e.roundNum);
        if (!labels.has(k)) labels.set(k, `${e.eventName} - ${e.roundLabel}`);
      }
    }
    return availableRounds(parsed).map(r => ({
      key: keyOf(r.eventId, r.roundNum),
      label: labels.get(keyOf(r.eventId, r.roundNum)) ?? keyOf(r.eventId, r.roundNum),
    }));
  }, [parsed]);

  const defaultSelected = useMemo(() => {
    if (!parsed) return new Set<string>();
    const latest = latestAssignedRound(parsed);
    return new Set(
      availableRounds(parsed)
        .filter(r => r.roundNum === latest)
        .map(r => keyOf(r.eventId, r.roundNum)),
    );
  }, [parsed]);
  const effectiveSelected = selectedKeys ?? defaultSelected;

  // Re-seeded from the base defaults, so switching presets never accumulates the last one's.
  function applyPreset(preset: Preset | null) {
    setPresetId(preset?.id ?? null);
    const docs = { ...baseDocuments(isMidComp), ...(preset?.documents ?? {}) };
    setDocScorecards(docs.scorecards);
    setDocSchedule(docs.scheduleTracker);
    setDocNametags(docs.nametags);
    setDocRoundChecklist(docs.roundChecklist);
    setDocFirstTimers(docs.firstTimerSlips);
    setDocGroupOverview(docs.groupOverview);
  }

  function toggleRound(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev ?? defaultSelected);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleContinue() {
    if (!parsed) return;

    const documents: DocumentSelection = {
      scorecards: docScorecards,
      scheduleTracker: docSchedule,
      nametags: docNametags,
      roundChecklist: docRoundChecklist,
      firstTimerSlips: docFirstTimers,
      groupOverview: docGroupOverview,
    };

    const scope: GenerationScope = isMidComp
      ? (scopeMode === 'selected'
          ? {
              mode: 'selected',
              rounds: [...effectiveSelected].map(k => {
                const [eventId, r] = k.split('|');
                return { eventId, roundNum: Number(r) };
              }),
              documents,
            }
          : { mode: scopeMode, documents })
      : { mode: 'everything', documents };

    const showSecondRoundMode = hasUnassignedIntermediate(filterParsedByScope(parsed, scope));
    writeScope(scope, {
      showSecondRoundMode, multiStage: parsed.stageCount > 1, detectedStations: parsed.stations?.count ?? null,
    });
    // /settings prefers a previous submission to any seed, so the old one has to go.
    if (presetId !== readPresetId()) clearSettings();
    // Always write or clear, so switching presets leaves nothing of the previous one.
    writePresetSettings(PRESETS.find(p => p.id === presetId)?.settings ?? null);
    writePresetId(presetId);
    navigate('/settings');
  }

  const noDocsSelected =
    !docScorecards && !docSchedule && !docNametags && !docRoundChecklist && !docFirstTimers
    && !docGroupOverview;
  const noRoundsSelected = isMidComp && scopeMode === 'selected' && effectiveSelected.size === 0;
  // A greyed-out button with nothing saying why is a dead end; the reason is shown next to it.
  const blockedReason = noDocsSelected
    ? t('scope.needs_document')
    : noRoundsSelected ? t('scope.needs_round') : null;

  const docOptions: { key: keyof DocumentSelection; label: string; checked: boolean; set: (v: boolean) => void }[] = [
    { key: 'scorecards',      label: t('scope.doc_scorecards'),  checked: docScorecards,  set: setDocScorecards },
    { key: 'scheduleTracker', label: t('scope.doc_schedule'),    checked: docSchedule,    set: setDocSchedule },
    { key: 'nametags',        label: t('scope.doc_nametags'),    checked: docNametags,    set: setDocNametags },
    { key: 'roundChecklist',  label: t('scope.doc_round_checklist'), checked: docRoundChecklist, set: setDocRoundChecklist },
    { key: 'groupOverview',   label: t('scope.doc_group_overview'), checked: docGroupOverview, set: setDocGroupOverview },
    { key: 'firstTimerSlips', label: t('scope.doc_first_timers'),checked: docFirstTimers, set: setDocFirstTimers },
  ];

  return (
    <div className={ui.page}>
      <Header showBack onBack={() => navigate('/competitions')} showSignOut />

      <main id="main" className={`${ui.main} ${s.main}`}>
        <div className={ui.compBadge}>{competitionName}</div>
        <h1 className={`${ui.pageTitle} ${s.pageTitle}`}>{t('scope.heading')}</h1>

        {status === 'loading' && (
          <div role="status" aria-label={t('scope.checking')}>
            <Skeleton width="55%" height={14} style={{ marginBottom: 20 }} />
            <div className={s.columns}>
              {Array.from({ length: 2 }).map((_, col) => (
                <div key={col}>
                  <Skeleton width={140} height={15} style={{ marginBottom: 12 }} />
                  <div className={ui.optionGroup}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} height={62} radius="var(--radius-md)" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className={`${ui.statusBox} ${ui.statusError}`}>
            <XCircle size={28} strokeWidth={2} color="var(--danger)" />
            <span className={ui.errorText}>{statusMsg}</span>
          </div>
        )}

        {status === 'ready' && (
          <>
            <p className={s.intro}>{isMidComp ? t('scope.intro') : t('scope.intro_pre')}</p>

            {PRESETS.length > 0 && (
              <section className={s.presetSection}>
                <h3 className={ui.sectionHeading}>{t('scope.presets_title')}</h3>
                <p className={ui.sectionHint}>{t('scope.presets_hint')}</p>
                <fieldset className={s.presetGrid}>
                  {[null, ...PRESETS].map(preset => {
                    const selected = presetId === (preset?.id ?? null);
                    const sub = preset ? preset.region : t('scope.preset_default_desc');
                    return (
                      <label
                        key={preset?.id ?? 'default'}
                        className={`${s.presetTile} ${selected ? s.presetTileActive : ''}`}
                      >
                        <input
                          type="radio"
                          name="preset"
                          checked={selected}
                          onChange={() => applyPreset(preset)}
                          className={s.presetInput}
                        />
                        <span className={s.presetName}>{preset?.name ?? t('scope.preset_default')}</span>
                        {sub && <span className={s.presetRegion}>{sub}</span>}
                        {selected && (
                          <span className={s.presetCheck} aria-hidden="true">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        )}
                      </label>
                    );
                  })}
                </fieldset>
              </section>
            )}

            {/* Two grid children, so rounds and documents sit side by side rather than
                stacking; the rounds column only exists mid-competition. */}
            <div className={s.columns}>
              {isMidComp && (
                <section>
                  <fieldset className={ui.optionGroup}>
                    <legend className={ui.groupLegend}>{t('scope.rounds_heading')}</legend>
                    {(['latest', 'everything', 'selected'] as const).map(mode => (
                      <label key={mode} className={`${ui.optionCard} ${scopeMode === mode ? ui.optionCardActive : ''}`}>
                        <input
                          type="radio"
                          name="scope"
                          checked={scopeMode === mode}
                          onChange={() => setScopeMode(mode)}
                          className={ui.radio}
                        />
                        <div>
                          <div className={ui.optionLabel}>{t(`scope.${mode}.label`)}</div>
                          <div className={ui.optionDesc}>{t(`scope.${mode}.desc`)}</div>
                        </div>
                      </label>
                    ))}
                  </fieldset>

                  {scopeMode === 'selected' && (
                    <div className={`${ui.optionGroup} ${s.roundList}`}>
                      {roundOptions.map(o => (
                        <label key={o.key} className={`${ui.optionCard} ${effectiveSelected.has(o.key) ? ui.optionCardActive : ''}`}>
                          <input
                            type="checkbox"
                            checked={effectiveSelected.has(o.key)}
                            onChange={() => toggleRound(o.key)}
                            className={ui.radio}
                          />
                          <div className={ui.optionLabel}>{o.label}</div>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section>
                <fieldset className={ui.optionGroup}>
                  <legend className={ui.groupLegend}>{t('scope.docs_title')}</legend>
                  {docOptions.map(o => (
                    <label key={o.key} className={`${ui.optionCard} ${o.checked ? ui.optionCardActive : ''}`}>
                      <input
                        type="checkbox"
                        checked={o.checked}
                        onChange={e => o.set(e.target.checked)}
                        className={ui.radio}
                      />
                      <div className={ui.optionLabel}>{o.label}</div>
                    </label>
                  ))}
                </fieldset>
              </section>
            </div>

            <div className={s.continueRow}>
              {blockedReason && (
                <p className={s.blockedReason} role="status">{blockedReason}</p>
              )}
              <button
                className={ui.btnCta}
                onClick={handleContinue}
                disabled={blockedReason !== null}
              >
                {t('scope.continue')}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
