import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { Check, ChevronDown, ChevronRight, Info, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { CompetitionSettings, DoubleCheckRegionScope, DoubleCheckRound, LiveResultsMode, LocaleCode, NametTagLogoMode, NametTagQrMode, PaperFormat, ScorecardCheckMode, SecondRoundMode } from '../types/settings';
import type { GenerationScope, DocumentSelection } from '../lib/generationScope';
import { LANGUAGES } from '../i18n/index';
import { resolveDefaultPrimaryLanguage, secondaryLanguageRow, isCanadianLanguage } from '../lib/languageSelector';
import { parseDoubleCheckOverrides } from '../lib/parseDoubleCheckOverrides';
import { isChampionship } from '../lib/championship';
import Tooltip from '../components/Tooltip';
import {
  readCompetition, readCustomEvents, readDetection, readHasGroups, readIsCustom,
  readFileName, readScope, readSettings, writeFileName, writeSettings,
} from '../lib/flowState';
import { stageSplitSkipsRound2 } from '../lib/generationScope';
import { mergesRounds } from '../lib/pdfJobs';
import { readPresetSettings, presetLogoUrl } from '../presets';
import { SCC_DEFAULT_LOGO } from '../assets/scc-logo';
import Header from '../components/Header';
import WarningBanner from '../components/WarningBanner';
import OtsNotice from '../components/OtsNotice';
import CustomEventEditor from '../components/CustomEventEditor';
import { fetchCompetitionInfo, fetchWcaLiveId, fetchWcaLivePersonIds } from '../auth/wca';
import { useAuth } from '../auth/useAuth';
import ui from '../styles/ui.module.css';
import s from './SettingsPage.module.css';

// Where each ranking rule lands when it is ticked. 50 is the world top the regulation names;
// 1 is the national/continental record holder, who a world-50 threshold misses in a small region.
const DC_WORLD_TOP_DEFAULT = 50;
const DC_REGION_TOP_DEFAULT = 1;

/**
 * `CompetitionSettings` minus the four values the flow owns. Derived with Omit so a new
 * field is a type error here until it is given an initial value.
 */
type SettingsDraft = Omit<
  CompetitionSettings,
  'competitionId' | 'competitionName' | 'generationScope' | 'isCustomCompetition'
>;

/**
 * Seeds the form from a stored blob. `wcaLiveId` normalises back to `''`: `handleSubmit`
 * writes `null` for an empty one, and `null` would make the input uncontrolled.
 */
function restorableSettings(previous: CompetitionSettings | null): Partial<SettingsDraft> {
  if (!previous) return {};
  const rest: Partial<CompetitionSettings> = { ...previous };
  delete rest.competitionId;
  delete rest.competitionName;
  delete rest.generationScope;
  delete rest.isCustomCompetition;
  // Older blobs carry `false` and no control is left to undo that.
  delete rest.scrambleDoubleCheck;
  return { ...rest, wcaLiveId: rest.wcaLiveId ?? '' };
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { token } = useAuth();

  const { id: competitionId, name: competitionName } = readCompetition();
  // Custom (non-WCA) competition: no WCIF, no WCA Live, events defined on /custom.
  const isCustom = readIsCustom();
  // Set on the scope step. No groups yet means scorecard counts read 0, so warn.
  const noGroups = !readHasGroups();

  // Scorecards-only (scope ≠ everything) hides everything not about scorecards.
  const generationScope: GenerationScope = readScope();
  const everything = generationScope.mode === 'everything';
  const docs = (generationScope as { documents?: DocumentSelection }).documents;
  const showScorecards = docs?.scorecards !== false;
  const showNametags   = docs?.nametags   !== false;
  const { showSecondRoundMode, multiStage, detectedStations } = readDetection();

  // Primary follows the interface language; secondary starts at None so single-language
  // users have nothing to clear.
  const defaultPrimary = resolveDefaultPrimaryLanguage(
    i18n.resolvedLanguage ?? i18n.language,
    LANGUAGES,
  );

  // A preset seeds initial values only; nothing is locked, and `{}` means plain defaults.
  const preset = readPresetSettings();

  // Spread over the defaults rather than replacing them, so a field added since the blob was
  // written still gets its initial value. /scope drops the blob when the preset changes.
  const previous = readSettings();

  // Exactly the mutable half of CompetitionSettings, so `handleSubmit` is a spread plus the
  // four flow-owned values and a new setting cannot be forgotten there.
  const [draft, setDraft] = useState<SettingsDraft>(() => ({
    language: preset.language ?? defaultPrimary,
    secondaryLanguage: preset.secondaryLanguage ?? null,
    paperFormat: preset.paperFormat ?? 'LETTER',
    secondRoundMode: preset.secondRoundMode ?? 'prefilled',
    logoDataUrl: presetLogoUrl(preset.logo),
    useDefaultLogo: preset.useDefaultLogo ?? isCanadianLanguage(i18n.resolvedLanguage ?? i18n.language),
    scorecardCompNameWithLogo: false,
    // Overwritten on mount by the competition's own setting, unless modeTouched.
    liveResultsMode: 'wca-live',
    wcaLiveId: '',
    wcaLivePersonIds: null,
    hideWcaLiveId: preset.hideWcaLiveId ?? false,
    nametagLogoMode: preset.nametagLogoMode ?? 'with-name',
    nametagQrMode: preset.nametagQrMode ?? 'back-only',
    nametagLayout: preset.nametagLayout ?? 'vertical',
    scorecardCheckMode: preset.scorecardCheckMode ?? 'per-group-card',
    splitPdfsByStage: false,
    mergeScorecardRounds: preset.mergeScorecardRounds ?? false,
    scorecardsA6: false,
    otsBlanks: false,
    staffNametags: true,
    finalStationNumbers: true,
    stationsPerStage: null,
    // Regulation 11i binds every competition, so there is no switch: "off" is both ranking
    // rules unticked with no round or CSV rule. A whole round is only worth double-checking
    // at a championship, whose finals 11i1f singles out.
    scrambleDoubleCheck: true,
    scrambleDoubleCheckRounds: isChampionship(competitionName) ? ['finals'] : [],
    scrambleDoubleCheckOverrides: {},
    scrambleDoubleCheckWorldTop: DC_WORLD_TOP_DEFAULT,
    scrambleDoubleCheckRegionTop: preset.scrambleDoubleCheckRegionTop ?? null,
    scrambleDoubleCheckRegionScope: 'national',
    customEvents: [],
    ...restorableSettings(previous),
    // Its only control is hidden on a single-stage competition, so a restored `true` would be stuck.
    ...(multiStage ? {} : { splitPdfsByStage: false }),
    // A custom competition's events live in their own key, which /custom may have changed
    // since this blob was written. A WCA competition's live only in the blob.
    ...(isCustom ? { customEvents: readCustomEvents() } : {}),
  }));

  const patch = (fields: Partial<SettingsDraft>) => setDraft(d => ({ ...d, ...fields }));

  const {
    language, secondaryLanguage, paperFormat, secondRoundMode, logoDataUrl, useDefaultLogo,
    scorecardCompNameWithLogo,
    liveResultsMode, wcaLiveId, hideWcaLiveId, nametagLogoMode, nametagQrMode, nametagLayout,
    scorecardCheckMode, customEvents, splitPdfsByStage, scrambleDoubleCheckRounds,
    scrambleDoubleCheckOverrides, scrambleDoubleCheckWorldTop, scrambleDoubleCheckRegionTop,
    scrambleDoubleCheckRegionScope, otsBlanks, staffNametags, finalStationNumbers, stationsPerStage, scorecardsA6,
  } = draft;
  const merged = mergesRounds(draft);

  // Not part of the draft, but stored so a restored upload isn't nameless.
  const [logoName, setLogoName] = useState<string | null>(() => readFileName('logo') ?? preset.logo ?? null);
  const [wcaLiveFetchStatus, setWcaLiveFetchStatus] = useState<'loading' | 'found' | 'not-found'>('loading');
  // A restored or hand-picked choice beats the WCA record, which may not be updated yet.
  const [modeTouched, setModeTouched] = useState(previous?.liveResultsMode !== undefined);
  // Same rule for the OTS blanks: a restored choice beats the detected flag.
  const otsTouched = previous?.otsBlanks !== undefined;
  const [onTheSpot, setOnTheSpot] = useState(false);
  // A restored custom event behind a collapsed section reads as lost.
  const [advancedOpen, setAdvancedOpen] = useState(
    customEvents.length > 0 || Object.keys(scrambleDoubleCheckOverrides).length > 0,
  );
  const [dcOverridesName, setDcOverridesName] = useState<string | null>(() => readFileName('dcOverrides'));
  const [saveError, setSaveError] = useState<'settings.storage_full' | 'settings.save_failed' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dcFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Custom competitions are unofficial - they run on neither live-results system.
    if (!competitionId || isCustom) return;
    (async () => {
      const { scoretakingSoftware: scoretaking, onTheSpot: ots } =
        await fetchCompetitionInfo(competitionId, token?.access_token);
      setOnTheSpot(ots);
      if (ots && !otsTouched) patch({ otsBlanks: true });
      // ILR builds its URLs from ids already in hand; nothing to look up on WCA Live.
      if (scoretaking === 'internal' && !modeTouched) {
        patch({ liveResultsMode: 'ilr' });
        return;
      }
      const id = await fetchWcaLiveId(competitionId);
      if (!id) {
        setWcaLiveFetchStatus('not-found');
        return;
      }
      // Only fill an empty field: a restored or hand-typed id is the organizer's.
      setDraft(d => (d.wcaLiveId ? d : { ...d, wcaLiveId: id }));
      setWcaLiveFetchStatus('found');
      patch({ wcaLivePersonIds: await fetchWcaLivePersonIds(id) });
    })();
  // competitionId is stable (from sessionStorage), no deps needed beyond mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!competitionId) {
    navigate('/competitions', { replace: true });
    return null;
  }

  // Driven by the shared LANGUAGES registry, so adding a language needs no strings here.
  // Both rows share fixed columns; the column under the primary becomes the "None" tile,
  // so nothing ever shifts.
  function handlePrimaryLanguageChange(code: LocaleCode) {
    // One language must never appear on both sides.
    patch({ language: code, ...(secondaryLanguage === code ? { secondaryLanguage: null } : {}) });
  }

  // Monogram badge + native label, in the spirit of an event-icon selector.
  const renderLangTile = (o: { key: string; badge: string; label: string; selected: boolean; onClick: () => void }) => (
    <button
      key={o.key}
      type="button"
      onClick={o.onClick}
      aria-pressed={o.selected}
      className={`${s.langTile} ${o.selected ? s.langTileActive : ''}`}
    >
      <span className={`${s.langBadge} ${o.selected ? s.langBadgeActive : ''}`}>{o.badge}</span>
      <span className={s.langTileLabel}>{o.label}</span>
    </button>
  );

  const PAPER_OPTIONS: { value: PaperFormat; label: string; description: string }[] = [
    { value: 'A4', label: t('settings.paper.a4'), description: t('settings.paper.a4_desc') },
    { value: 'LETTER', label: t('settings.paper.letter'), description: t('settings.paper.letter_desc') },
  ];

  const ROUND_MODE_OPTIONS: { value: SecondRoundMode; label: string; description: string }[] = [
    { value: 'prefilled', label: t('settings.subsequent_rounds.prefilled'), description: t('settings.subsequent_rounds.prefilled_desc') },
    { value: 'blanks', label: t('settings.subsequent_rounds.blanks'), description: t('settings.subsequent_rounds.blanks_desc') },
  ];

  const DOUBLE_CHECK_ROUND_OPTIONS: { value: DoubleCheckRound; label: string }[] = [
    { value: 'firstRound',   label: t('settings.double_check.round_first') },
    { value: 'intermediate', label: t('settings.double_check.round_second') },
    { value: 'semis',        label: t('settings.double_check.round_semis') },
    { value: 'finals',       label: t('settings.double_check.round_finals') },
  ];

  const DOUBLE_CHECK_REGION_OPTIONS: { value: DoubleCheckRegionScope; label: string }[] = [
    { value: 'national',    label: t('settings.double_check.ranking_scope_national') },
    { value: 'continental', label: t('settings.double_check.ranking_scope_continental') },
  ];

  const dcOverrideCount = Object.keys(scrambleDoubleCheckOverrides).length;

  function handleLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoName(file.name);
    const reader = new FileReader();
    reader.onload = () => patch({ logoDataUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  function handleRemoveLogo() {
    patch({ logoDataUrl: null });
    setLogoName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function toggleDoubleCheckRound(round: DoubleCheckRound) {
    setDraft(d => ({
      ...d,
      scrambleDoubleCheckRounds: d.scrambleDoubleCheckRounds.includes(round)
        ? d.scrambleDoubleCheckRounds.filter(r => r !== round)
        : [...d.scrambleDoubleCheckRounds, round],
    }));
  }

  // Off when the threshold is null. Ticking restores the default, not the last value.
  function toggleDcRankingRule(key: 'scrambleDoubleCheckWorldTop' | 'scrambleDoubleCheckRegionTop') {
    const fallback = key === 'scrambleDoubleCheckWorldTop' ? DC_WORLD_TOP_DEFAULT : DC_REGION_TOP_DEFAULT;
    setDraft(d => ({ ...d, [key]: d[key] === null ? fallback : null }));
  }

  // Digits only. An emptied box holds 0 (matching nobody) while typing and snaps back to the
  // default on blur, so it can never be saved blank.
  function setDcRankingTop(
    key: 'scrambleDoubleCheckWorldTop' | 'scrambleDoubleCheckRegionTop',
    raw: string,
  ) {
    patch({ [key]: Number(raw.replace(/\D/g, '').slice(0, 5)) });
  }

  function normalizeDcRankingTop(key: 'scrambleDoubleCheckWorldTop' | 'scrambleDoubleCheckRegionTop') {
    const fallback = key === 'scrambleDoubleCheckWorldTop' ? DC_WORLD_TOP_DEFAULT : DC_REGION_TOP_DEFAULT;
    setDraft(d => (d[key] === 0 ? { ...d, [key]: fallback } : d));
  }

  function handleDcOverridesChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDcOverridesName(file.name);
    const reader = new FileReader();
    reader.onload = () => patch({ scrambleDoubleCheckOverrides: parseDoubleCheckOverrides(reader.result as string) });
    reader.readAsText(file);
  }

  function handleRemoveDcOverrides() {
    patch({ scrambleDoubleCheckOverrides: {} });
    setDcOverridesName(null);
    if (dcFileInputRef.current) dcFileInputRef.current.value = '';
  }

  function handleSubmit() {
    try {
      writeSettings({
        ...draft,
        competitionId,
        competitionName,
        generationScope,
        isCustomCompetition: isCustom,
        customEvents: draft.customEvents.filter(e => e.name.trim()),
        // Unofficial: no live results, no double-checking, no "WCA Live:" line.
        liveResultsMode: isCustom ? 'wca-live' : draft.liveResultsMode,
        wcaLiveId: isCustom ? null : (draft.wcaLiveId?.trim() || null),
        wcaLivePersonIds: isCustom ? null : draft.wcaLivePersonIds,
        hideWcaLiveId: isCustom ? true : draft.hideWcaLiveId,
        otsBlanks: !isCustom && draft.otsBlanks,
        scrambleDoubleCheck: !isCustom,
      });
      writeFileName('logo', logoName);
      writeFileName('dcOverrides', dcOverridesName);
    } catch (e) {
      setSaveError(e instanceof DOMException && e.name === 'QuotaExceededError' ? 'settings.storage_full' : 'settings.save_failed');
      return;
    }
    navigate('/generate');
  }

  const liveModeOptions: { value: LiveResultsMode; label: string; description: string }[] = [
    { value: 'wca-live', label: t('settings.wca_live.mode_wca_live'), description: t('settings.wca_live.mode_wca_live_desc') },
    { value: 'ilr',      label: t('settings.wca_live.mode_ilr'),      description: t('settings.wca_live.mode_ilr_desc') },
  ];

  const logoModeOptions: { value: NametTagLogoMode; label: string; description: string }[] = [
    { value: 'hidden',    label: t('settings.nametag.logo_hidden'),    description: t('settings.nametag.logo_hidden_desc') },
    { value: 'with-name', label: t('settings.nametag.logo_with_name'), description: t('settings.nametag.logo_with_name_desc') },
    { value: 'logo-only', label: t('settings.nametag.logo_only'),      description: t('settings.nametag.logo_only_desc') },
  ];

  const qrModeOptions: { value: NametTagQrMode; label: string; description: string }[] = [
    { value: 'back-only',  label: t('settings.nametag.qr_back_only'),  description: t('settings.nametag.qr_back_only_desc') },
    { value: 'both-sides', label: t('settings.nametag.qr_both_sides'), description: t('settings.nametag.qr_both_sides_desc') },
  ];

  const checkModeOptions: { value: ScorecardCheckMode; label: string; description: string }[] = [
    { value: 'per-group-card', label: t('settings.check_mode.per_group'),      description: t('settings.check_mode.per_group_desc') },
    { value: 'per-round-card', label: t('settings.check_mode.per_round'),      description: t('settings.check_mode.per_round_desc') },
    { value: 'none',           label: t('settings.check_mode.none'),           description: t('settings.check_mode.none_desc') },
  ];


  return (
    <div className={ui.page}>
      <Header showBack onBack={() => navigate(isCustom ? '/custom' : '/scope')} showSignOut />

      <main id="main" className={`${ui.main} ${s.main}`}>
        <div className={ui.compBadge}>{competitionName}</div>
        <h1 className={`${ui.pageTitle} ${s.heading}`}>{t('settings.heading')}</h1>

        {noGroups && <WarningBanner>{t('warnings.no_groups')}</WarningBanner>}
        {onTheSpot && <OtsNotice />}

        {/* The settings sections flow into two balanced columns on a laptop. Advanced sits
            below them at full width: expanded it is longer than everything else combined,
            and it would leave one column trailing off the bottom of the page. */}
        <div className={s.columns}>
        <section className={s.section}>
          <h3 className={ui.sectionHeading}>{t('settings.language.title')}</h3>

          <div className={ui.groupLabel}>{t('settings.language.primary_title')}</div>
          <div className={s.langRow}>
            {LANGUAGES.map((opt) => renderLangTile({
              key: opt.code,
              badge: opt.code.toUpperCase(),
              label: opt.label,
              selected: language === opt.code,
              onClick: () => handlePrimaryLanguageChange(opt.code),
            }))}
          </div>

          <div className={s.langCaptionSpaced}>{t('settings.language.secondary_title')}</div>
          <div className={s.langRow}>
            {secondaryLanguageRow(LANGUAGES, language, secondaryLanguage).map((tile, i) => {
              // The column under the selected primary is the "None" tile.
              const lang = LANGUAGES[i];
              return renderLangTile(tile.value === null
                ? {
                    key: 'none',
                    badge: '-',
                    label: t('settings.language.secondary_none'),
                    selected: tile.selected,
                    onClick: () => patch({ secondaryLanguage: null }),
                  }
                : {
                    key: lang.code,
                    badge: lang.code.toUpperCase(),
                    label: lang.label,
                    selected: tile.selected,
                    onClick: () => patch({ secondaryLanguage: tile.value }),
                  });
            })}
          </div>
        </section>

        <section className={s.section}>
          <fieldset className={ui.optionGroup}>
            <legend className={ui.groupLegend}>{t('settings.paper.title')}</legend>
            {PAPER_OPTIONS.map((opt) => (
              <label key={opt.value} className={`${ui.optionCard} ${paperFormat === opt.value ? ui.optionCardActive : ''}`}>
                <input
                  type="radio"
                  name="paper"
                  value={opt.value}
                  checked={paperFormat === opt.value}
                  onChange={() => patch({ paperFormat: opt.value })}
                  className={ui.radio}
                />
                <div>
                  <div className={ui.optionLabel}>{opt.label}</div>
                  <div className={ui.optionDesc}>{opt.description}</div>
                </div>
              </label>
            ))}
          </fieldset>
          {showScorecards && (
            <label className={`${ui.toggleCard} ${s.a6Toggle} ${scorecardsA6 ? ui.toggleCardActive : ''}`}>
              <input
                type="checkbox"
                checked={scorecardsA6}
                onChange={e => patch({ scorecardsA6: e.target.checked })}
                className={ui.radio}
              />
              <div>
                <div className={ui.optionLabel}>{t('settings.paper.a6_label')}</div>
                <div className={ui.optionDesc}>{t('settings.paper.a6_desc')}</div>
              </div>
            </label>
          )}
          {showScorecards && scorecardsA6 && (
            <div className={s.warningWrap}>
              <WarningBanner tone="info">
                {t('settings.paper.a6_info', { format: paperFormat === 'A4' ? t('settings.paper.a4') : t('settings.paper.letter') })}
              </WarningBanner>
            </div>
          )}
        </section>

        {showScorecards && showSecondRoundMode && (
        <section className={s.section}>
          <fieldset className={ui.optionGroup}>
            <legend className={ui.groupLegend}>{t('settings.subsequent_rounds.title')}</legend>
            {ROUND_MODE_OPTIONS.map((opt) => (
              <label key={opt.value} className={`${ui.optionCard} ${secondRoundMode === opt.value ? ui.optionCardActive : ''}`}>
                <input
                  type="radio"
                  name="roundMode"
                  value={opt.value}
                  checked={secondRoundMode === opt.value}
                  onChange={() => patch({ secondRoundMode: opt.value })}
                  className={ui.radio}
                />
                <div>
                  <div className={ui.optionLabel}>{opt.label}</div>
                  <div className={ui.optionDesc}>{opt.description}</div>
                </div>
              </label>
            ))}
          </fieldset>
        </section>
        )}

        {showScorecards && !isCustom && (
        <section className={s.section}>
          <fieldset className={ui.optionGroup}>
            <legend className={ui.groupLegend}>{t('settings.check_mode.title')}</legend>
            <p className={ui.hint}>{t('settings.check_mode.hint')}</p>
            {checkModeOptions.map(opt => (
              <label key={opt.value} className={`${ui.optionCard} ${scorecardCheckMode === opt.value ? ui.optionCardActive : ''}`}>
                <input
                  type="radio"
                  name="checkMode"
                  value={opt.value}
                  checked={scorecardCheckMode === opt.value}
                  onChange={() => patch({ scorecardCheckMode: opt.value })}
                  className={ui.radio}
                />
                <div>
                  <div className={ui.optionLabel}>{opt.label}</div>
                  <div className={ui.optionDesc}>{opt.description}</div>
                </div>
              </label>
            ))}
          </fieldset>
        </section>
        )}

        {(showScorecards || showNametags) && !isCustom && (
        <section className={s.section}>
          <h3 className={ui.sectionHeading}>{t('settings.wca_live.system_title')}</h3>
          {/* Only the name tag QR codes read the system and the id. The scorecard checkbox
              below is about the printed "WCA Live:" line, which exists in either system. */}
          {showNametags && (<>
          <p className={ui.hint}>{t('settings.wca_live.system_hint')}</p>
          <fieldset className={ui.optionGroup} aria-label={t('settings.wca_live.system_title')}>
            {liveModeOptions.map(opt => (
              <label key={opt.value} className={`${ui.optionCard} ${liveResultsMode === opt.value ? ui.optionCardActive : ''}`}>
                <input
                  type="radio"
                  name="liveResultsMode"
                  value={opt.value}
                  checked={liveResultsMode === opt.value}
                  onChange={() => { setModeTouched(true); patch({ liveResultsMode: opt.value }); }}
                  className={ui.radio}
                />
                <div>
                  <div className={ui.optionLabel}>{opt.label}</div>
                  <div className={ui.optionDesc}>{opt.description}</div>
                </div>
              </label>
            ))}
          </fieldset>

          {/* ILR needs no id: its URLs are built from the WCA competition id we already have. */}
          {liveResultsMode === 'wca-live' && (<>
          <h3 className={`${ui.sectionHeading} ${s.sectionTitleSpaced}`}>
            {t('settings.wca_live.title')}{' '}
            <span className={s.optional}>({t('settings.wca_live.optional_note')})</span>
            {wcaLiveFetchStatus === 'loading' && (
              <span className={s.wcaLiveLoading}> {t('settings.wca_live.fetching')}</span>
            )}
            {wcaLiveFetchStatus === 'found' && (
              <span className={s.wcaLiveFound}>
                <Check size={14} strokeWidth={2.5} /> {t('settings.wca_live.auto_detected')}
              </span>
            )}
          </h3>
          {wcaLiveFetchStatus === 'not-found' && (
            <p className={`${ui.hint} ${s.hintWarning}`}>{t('settings.wca_live.not_found')}</p>
          )}
          {wcaLiveFetchStatus !== 'not-found' && (
            <p className={ui.hint}>{t('settings.wca_live.hint')}</p>
          )}
          <input
            id="wca-live-id"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={wcaLiveId ?? ''}
            onChange={e => patch({ wcaLiveId: e.target.value.replace(/\D/g, '') })}
            placeholder={t('settings.wca_live.placeholder')}
            className={ui.textInput}
            aria-label={t('settings.wca_live.title')}
          />
          </>)}
          </>)}
          {showScorecards && (
          <label className={`${ui.toggleCard} ${s.checkboxCard} ${hideWcaLiveId ? ui.toggleCardActive : ''}`}>
            <input
              type="checkbox"
              checked={hideWcaLiveId}
              onChange={e => patch({ hideWcaLiveId: e.target.checked })}
              className={ui.radio}
            />
            <div>
              <div className={ui.optionLabel}>{t('settings.wca_live.hide_label')}</div>
              <div className={ui.optionDesc}>{t('settings.wca_live.hide_desc')}</div>
            </div>
          </label>
          )}
        </section>
        )}

        <section className={s.section}>
          <h3 className={ui.sectionHeading}>
            {t('settings.logo.title')}{' '}
            <span className={s.optional}>({t('settings.logo.optional_note')})</span>
          </h3>
          <p className={ui.hint}>{t('settings.logo.hint')}</p>

          {logoDataUrl ? (
            <>
            <div className={s.logoPreview}>
              <img src={logoDataUrl} alt="Logo preview" className={s.logoImg} />
              <div className={s.logoMeta}>
                <span className={s.logoName}>{logoName}</span>
                <button className={s.removeBtn} onClick={handleRemoveLogo}>{t('common.remove')}</button>
              </div>
            </div>
            {showScorecards && (
            <label className={`${ui.toggleCard} ${s.checkboxCard} ${scorecardCompNameWithLogo ? ui.toggleCardActive : ''}`}>
              <input
                type="checkbox"
                checked={scorecardCompNameWithLogo}
                onChange={e => patch({ scorecardCompNameWithLogo: e.target.checked })}
                className={ui.radio}
              />
              <div>
                <div className={ui.optionLabel}>{t('settings.logo.show_comp_name_label')}</div>
                <div className={ui.optionDesc}>{t('settings.logo.show_comp_name_desc')}</div>
              </div>
            </label>
            )}
            </>
          ) : (
            <>
              <button className={ui.dropzone} onClick={() => fileInputRef.current?.click()}>
                {t('common.choose_file')}
              </button>

              <label className={`${s.logoPreviewChoice} ${useDefaultLogo ? ui.toggleCardActive : ''}`}>
                <input
                  type="checkbox"
                  checked={useDefaultLogo}
                  onChange={e => patch({ useDefaultLogo: e.target.checked })}
                  className={ui.radio}
                />
                <img src={SCC_DEFAULT_LOGO} alt="Speedcubing Canada logo" className={s.logoImg} />
                <div className={s.logoMeta}>
                  <span className={ui.optionLabel}>{t('settings.logo.default_title')}</span>
                  <span className={ui.optionDesc}>{t('settings.logo.default_desc')}</span>
                  <span className={`${ui.hint} ${s.hintFlush}`}>{t('settings.logo.use_default_hint')}</span>
                </div>
              </label>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleLogoChange}
          />
        </section>

        {showNametags && (
        <section className={s.section}>
          <h3 className={ui.sectionHeading}>{t('settings.nametag.title')}</h3>

          {(logoDataUrl || useDefaultLogo) && (
            <div className={s.nametagGroup}>
              <fieldset className={ui.optionGroup}>
                <legend className={ui.groupLabel}>{t('settings.nametag.logo_on_nametags')}</legend>
                {logoModeOptions.map(opt => (
                  <label key={opt.value} className={`${ui.optionCard} ${nametagLogoMode === opt.value ? ui.optionCardActive : ''}`}>
                    <input
                      type="radio"
                      name="logoMode"
                      value={opt.value}
                      checked={nametagLogoMode === opt.value}
                      onChange={() => patch({ nametagLogoMode: opt.value })}
                      className={ui.radio}
                    />
                    <div>
                      <div className={ui.optionLabel}>{opt.label}</div>
                      <div className={ui.optionDesc}>{opt.description}</div>
                    </div>
                  </label>
                ))}
              </fieldset>
            </div>
          )}

          <fieldset className={ui.optionGroup}>
            <legend className={ui.groupLabel}>{t('settings.nametag.qr_codes')}</legend>
            {qrModeOptions.map(opt => (
              <label key={opt.value} className={`${ui.optionCard} ${nametagQrMode === opt.value ? ui.optionCardActive : ''}`}>
                <input
                  type="radio"
                  name="qrMode"
                  value={opt.value}
                  checked={nametagQrMode === opt.value}
                  onChange={() => patch({ nametagQrMode: opt.value })}
                  className={ui.radio}
                />
                <div>
                  <div className={ui.optionLabel}>{opt.label}</div>
                  <div className={ui.optionDesc}>{opt.description}</div>
                </div>
              </label>
            ))}
          </fieldset>

          <div className={s.subheading}>
            {t('settings.nametag.layout')}
          </div>
          <div className={ui.segmentedControl} role="group" aria-label={t('settings.nametag.layout')}>
            <button
              type="button"
              onClick={() => patch({ nametagLayout: 'vertical' })}
              aria-pressed={nametagLayout === 'vertical'}
              className={ui.segment}
            >
              <RectangleVertical size={16} strokeWidth={2} aria-hidden="true" />
              {t('settings.nametag.layout_vertical')}
            </button>
            <button
              type="button"
              onClick={() => patch({ nametagLayout: 'horizontal' })}
              aria-pressed={nametagLayout === 'horizontal'}
              className={ui.segment}
            >
              <RectangleHorizontal size={16} strokeWidth={2} aria-hidden="true" />
              {t('settings.nametag.layout_horizontal')}
            </button>
          </div>

          <label className={`${ui.toggleCard} ${s.checkboxCard} ${staffNametags ? ui.toggleCardActive : ''}`}>
            <input
              type="checkbox"
              checked={staffNametags}
              onChange={e => patch({ staffNametags: e.target.checked })}
              className={ui.radio}
            />
            <div>
              <div className={ui.optionLabel}>{t('settings.nametag.staff_label')}</div>
              <div className={ui.optionDesc}>{t('settings.nametag.staff_desc')}</div>
            </div>
          </label>
        </section>
        )}

        {!isCustom && (
        <section className={s.section}>
          <h3 className={ui.sectionHeading}>{t('settings.ots.title')}</h3>
          <label className={`${ui.toggleCard} ${s.checkboxCard} ${otsBlanks ? ui.toggleCardActive : ''}`}>
            <input
              type="checkbox"
              checked={otsBlanks}
              onChange={e => patch({ otsBlanks: e.target.checked })}
              className={ui.radio}
            />
            <div>
              <div className={ui.optionLabel}>{t('settings.ots.label')}</div>
              <div className={ui.optionDesc}>{t('settings.ots.desc')}</div>
            </div>
          </label>
        </section>
        )}
        </div>

        {showScorecards && !isCustom && (
        <section className={`${s.section} ${s.advancedSection}`}>
          <button className={s.advancedToggle} onClick={() => setAdvancedOpen(o => !o)} aria-expanded={advancedOpen}>
            <span className={s.advancedToggleArrow}>
              {advancedOpen ? <ChevronDown size={16} strokeWidth={2.5} /> : <ChevronRight size={16} strokeWidth={2.5} />}
            </span>
            {t('settings.advanced.toggle')}
          </button>

          {advancedOpen && (
            <div className={s.advancedBody}>
              <section className={s.section}>
              <h3 className={ui.sectionHeading}>{t('settings.double_check.title')}</h3>
              <p className={ui.hint}>{t('settings.double_check.hint')}</p>

              <div className={s.subheadingFirst}>
                {t('settings.double_check.ranking_title')}
                <Tooltip label={t('settings.double_check.ranking_tooltip')}>
                  <span
                    tabIndex={0}
                    aria-label={t('settings.double_check.ranking_tooltip')}
                    className={s.infoIcon}
                  >
                    <Info size={14} strokeWidth={2} aria-hidden="true" />
                  </span>
                </Tooltip>
              </div>
              <p className={ui.hint}>{t('settings.double_check.ranking_hint')}</p>

              <div className={ui.optionGroup}>
                <div className={`${ui.toggleCard} ${s.rankingCard} ${scrambleDoubleCheckWorldTop !== null ? ui.toggleCardActive : ''}`}>
                  <label className={s.rankingRule}>
                    <input
                      type="checkbox"
                      checked={scrambleDoubleCheckWorldTop !== null}
                      onChange={() => toggleDcRankingRule('scrambleDoubleCheckWorldTop')}
                      className={ui.radio}
                    />
                    <span className={ui.optionLabel}>{t('settings.double_check.ranking_world')}</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={scrambleDoubleCheckWorldTop ?? ''}
                    disabled={scrambleDoubleCheckWorldTop === null}
                    aria-label={t('settings.double_check.ranking_world')}
                    onChange={e => setDcRankingTop('scrambleDoubleCheckWorldTop', e.target.value)}
                    onBlur={() => normalizeDcRankingTop('scrambleDoubleCheckWorldTop')}
                    className={`${ui.textInput} ${s.rankingInput}`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <div className={`${ui.toggleCard} ${s.rankingCard} ${scrambleDoubleCheckRegionTop !== null ? ui.toggleCardActive : ''}`}>
                  <label className={s.rankingRule}>
                    <input
                      type="checkbox"
                      checked={scrambleDoubleCheckRegionTop !== null}
                      onChange={() => toggleDcRankingRule('scrambleDoubleCheckRegionTop')}
                      className={ui.radio}
                    />
                    <span className={ui.optionLabel}>{t('settings.double_check.ranking_region')}</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={scrambleDoubleCheckRegionTop ?? ''}
                    disabled={scrambleDoubleCheckRegionTop === null}
                    aria-label={t('settings.double_check.ranking_region')}
                    onChange={e => setDcRankingTop('scrambleDoubleCheckRegionTop', e.target.value)}
                    onBlur={() => normalizeDcRankingTop('scrambleDoubleCheckRegionTop')}
                    className={`${ui.textInput} ${s.rankingInput}`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>

              {scrambleDoubleCheckRegionTop !== null && (
                <div className={`${ui.segmentedControl} ${s.segmentedSpaced}`} role="group" aria-label={t('settings.double_check.ranking_region')}>
                  {DOUBLE_CHECK_REGION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => patch({ scrambleDoubleCheckRegionScope: opt.value })}
                      aria-pressed={scrambleDoubleCheckRegionScope === opt.value}
                      className={ui.segment}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              <fieldset className={`${ui.optionGroup} ${s.roundsGroup}`}>
                <legend className={ui.groupLabel}>{t('settings.double_check.rounds_title')}</legend>
                {DOUBLE_CHECK_ROUND_OPTIONS.map(opt => (
                  <label key={opt.value} className={`${ui.optionCard} ${scrambleDoubleCheckRounds.includes(opt.value) ? ui.optionCardActive : ''}`}>
                    <input
                      type="checkbox"
                      checked={scrambleDoubleCheckRounds.includes(opt.value)}
                      onChange={() => toggleDoubleCheckRound(opt.value)}
                      className={ui.radio}
                    />
                    <div>
                      <div className={ui.optionLabel}>{opt.label}</div>
                    </div>
                  </label>
                ))}
              </fieldset>

              <div className={s.subheading}>
                {t('settings.double_check.overrides_title')}
              </div>
              <p className={ui.hint}>{t('settings.double_check.overrides_hint')}</p>
              {dcOverrideCount > 0 ? (
                <div className={s.logoPreview}>
                  <div className={s.logoMeta}>
                    <span className={s.logoName}>{dcOverridesName}</span>
                    <span className={ui.optionDesc}>{t('settings.double_check.overrides_count', { count: dcOverrideCount })}</span>
                    <button className={s.removeBtn} onClick={handleRemoveDcOverrides}>{t('common.remove')}</button>
                  </div>
                </div>
              ) : (
                <button className={ui.dropzone} onClick={() => dcFileInputRef.current?.click()}>
                  {t('common.choose_file')}
                </button>
              )}
              <input
                ref={dcFileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                hidden
                onChange={handleDcOverridesChange}
              />

              </section>

              <section className={s.section}>
                <h3 className={ui.sectionHeading}>{t('settings.advanced.final_stations_title')}</h3>
                <p className={ui.hint}>
                  {detectedStations != null
                    ? t('settings.advanced.final_stations_detected', { count: detectedStations })
                    : t('settings.advanced.final_stations_hint')}
                </p>
                <div className={`${ui.toggleCard} ${s.rankingCard} ${finalStationNumbers ? ui.toggleCardActive : ''}`}>
                  <label className={s.rankingRule}>
                    <input
                      type="checkbox"
                      checked={finalStationNumbers}
                      onChange={e => patch({ finalStationNumbers: e.target.checked })}
                      className={ui.radio}
                    />
                    <span className={ui.optionLabel}>{t('settings.advanced.final_stations_label')}</span>
                  </label>
                  {/* Empty = the detected count. */}
                  <input
                    type="text"
                    inputMode="numeric"
                    value={stationsPerStage ?? ''}
                    placeholder={detectedStations != null ? String(detectedStations) : ''}
                    disabled={!finalStationNumbers}
                    aria-label={t('settings.advanced.final_stations_count')}
                    onChange={e => patch({ stationsPerStage: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || null })}
                    className={`${ui.textInput} ${s.rankingInput}`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </section>

              {multiStage && (
                <section className={s.section}>
                  <h3 className={ui.sectionHeading}>
                    {t('settings.advanced.stage_split_title')}
                  </h3>
                  <label className={`${ui.toggleCard} ${splitPdfsByStage ? ui.toggleCardActive : ''}`}>
                    <input
                      type="checkbox"
                      checked={splitPdfsByStage}
                      onChange={e => patch({ splitPdfsByStage: e.target.checked })}
                      className={ui.radio}
                    />
                    <div>
                      <div className={ui.optionLabel}>{t('settings.advanced.stage_split_label')}</div>
                      <div className={ui.optionDesc}>{t('settings.advanced.stage_split_desc')}</div>
                    </div>
                  </label>
                  {stageSplitSkipsRound2(draft, showSecondRoundMode) && (
                    <div className={s.warningWrap}>
                      <WarningBanner>{t('warnings.stage_split_prefilled')}</WarningBanner>
                    </div>
                  )}
                </section>
              )}

              <section className={s.section}>
                <h3 className={ui.sectionHeading}>
                  {t('settings.advanced.merge_rounds_title')}
                </h3>
                <label className={`${ui.toggleCard} ${merged ? ui.toggleCardActive : ''}`}>
                  <input
                    type="checkbox"
                    checked={merged}
                    disabled={splitPdfsByStage}
                    onChange={e => patch({ mergeScorecardRounds: e.target.checked })}
                    className={ui.radio}
                  />
                  <div>
                    <div className={ui.optionLabel}>{t('settings.advanced.merge_rounds_label')}</div>
                    <div className={ui.optionDesc}>
                      {t(splitPdfsByStage ? 'settings.advanced.merge_rounds_stage_split' : 'settings.advanced.merge_rounds_desc')}
                    </div>
                  </div>
                </label>
              </section>

              {everything && (
                <section className={s.section}>
                  <h3 className={ui.sectionHeading}>
                    {t('settings.advanced.custom_events_title')}{' '}
                    <span className={s.optional}>({t('settings.advanced.custom_events_optional')})</span>
                  </h3>
                  <p className={ui.hint}>{t('settings.advanced.custom_events_hint')}</p>

                  <CustomEventEditor events={customEvents} onChange={events => patch({ customEvents: events })} />
                </section>
              )}
            </div>
          )}
        </section>
        )}

        <div className={ui.stickyFooter}>
          {saveError && <div role="alert"><WarningBanner>{t(saveError)}</WarningBanner></div>}
          <button className={ui.btnCta} onClick={handleSubmit}>
            {t('settings.generate_button')}
          </button>
        </div>
      </main>
    </div>
  );
}
