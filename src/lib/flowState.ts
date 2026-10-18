import type { CompetitionSettings, CustomEvent } from '../types/settings';
import type { GenerationScope } from './generationScope';

/**
 * Everything that crosses a wizard page boundary. The steps are separate routes with no
 * shared React state, so sessionStorage is the handoff.
 *
 * Reads never throw: a half-written blob must not white-screen the wizard.
 *
 * Auth keys and preset settings stay out; they have their own lifecycle and validation.
 */

const KEYS = {
  competitionId: 'selected_competition_id',
  competitionName: 'selected_competition_name',
  hasGroups: 'competition_has_groups',
  scope: 'generation_scope',
  detection: 'generation_detection',
  settings: 'competition_settings',
  isCustom: 'custom_competition',
  customEvents: 'custom_competition_events',
} as const;

const FILE_NAME_KEYS = {
  logo: 'logo_file_name',
  dcOverrides: 'dc_overrides_file_name',
} as const;

export type UploadKind = keyof typeof FILE_NAME_KEYS;

export interface ScopeDetection {
  showSecondRoundMode: boolean;
  // Whether any round runs across 2+ stages. Gates the per-stage PDF split on /settings,
  // which has no WCIF of its own.
  multiStage: boolean;
  // Station count read from the WCIF, shown as the default of the finals station override.
  detectedStations?: number | null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readCompetition(): { id: string; name: string } {
  return {
    id: sessionStorage.getItem(KEYS.competitionId) ?? '',
    name: sessionStorage.getItem(KEYS.competitionName) ?? '',
  };
}

export function writeCompetition(id: string, name: string): void {
  sessionStorage.setItem(KEYS.competitionId, id);
  sessionStorage.setItem(KEYS.competitionName, name);
}

/** Unset (scope step bypassed) reads as true, so the settings warning needs a positive absence. */
export function readHasGroups(): boolean {
  return sessionStorage.getItem(KEYS.hasGroups) !== 'false';
}

export function writeHasGroups(hasGroups: boolean): void {
  sessionStorage.setItem(KEYS.hasGroups, String(hasGroups));
}

export const DEFAULT_SCOPE: GenerationScope = {
  mode: 'everything',
  documents: {
    scorecards: true,
    scheduleTracker: true,
    nametags: true,
    roundChecklist: false,
    groupOverview: false,
    firstTimerSlips: false,
  },
};

export function readScope(): GenerationScope {
  return readStoredScope() ?? DEFAULT_SCOPE;
}

/** `null` means the scope step hasn't run: apply defaults rather than restore. */
export function readStoredScope(): GenerationScope | null {
  const scope = readJson<GenerationScope | null>(KEYS.scope, null);
  // A blob without `documents` is too old to restore from.
  return scope?.documents ? scope : null;
}

export function writeScope(scope: GenerationScope, detection: ScopeDetection): void {
  sessionStorage.setItem(KEYS.scope, JSON.stringify(scope));
  sessionStorage.setItem(KEYS.detection, JSON.stringify(detection));
}

/** Absent detection means the scope step was bypassed: show the Round 2 choice. */
export function readDetection(): ScopeDetection {
  const raw = readJson<Partial<ScopeDetection> | null>(KEYS.detection, null);
  return {
    showSecondRoundMode: raw?.showSecondRoundMode !== false,
    // Opposite default: without the scope parse the stage count is unknown, and offering a
    // per-stage split we cannot honour is worse than not offering it.
    multiStage: raw?.multiStage === true,
    detectedStations: raw?.detectedStations ?? null,
  };
}

export function readIsCustom(): boolean {
  return sessionStorage.getItem(KEYS.isCustom) === 'true';
}

export function readCustomEvents(): CustomEvent[] {
  return readJson<CustomEvent[]>(KEYS.customEvents, []);
}

export function writeCustom(events: CustomEvent[]): void {
  sessionStorage.setItem(KEYS.isCustom, 'true');
  sessionStorage.setItem(KEYS.customEvents, JSON.stringify(events));
}

export function clearCustom(): void {
  sessionStorage.removeItem(KEYS.isCustom);
  sessionStorage.removeItem(KEYS.customEvents);
}

export function writeSettings(settings: CompetitionSettings): void {
  sessionStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

/** Untyped on purpose: an older build may have written it. `readSettings` migrates first. */
export function readStoredSettings(): Record<string, unknown> | null {
  return readJson<Record<string, unknown> | null>(KEYS.settings, null);
}

/** Backfills every field added since a blob may have been written, so nothing renders `undefined`. */
export function readSettings(): CompetitionSettings | null {
  const s = readStoredSettings();
  if (!s) return null;
  if (s.language === 'bilingual-fr') { s.language = 'fr'; s.secondaryLanguage = 'en'; }
  else if (s.language === 'bilingual-en') { s.language = 'en'; s.secondaryLanguage = 'fr'; }
  else if (s.secondaryLanguage === undefined) { s.secondaryLanguage = null; }
  if (s.generationScope === undefined) s.generationScope = { mode: 'everything' };
  const gs = s.generationScope as Record<string, unknown>;
  if (gs.documents === undefined) gs.documents = {
    scorecards: true, scheduleTracker: true, nametags: true,
    roundChecklist: false, firstTimerSlips: false, groupOverview: false,
  };
  const gsDocs = gs.documents as Record<string, unknown>;
  if (gsDocs.roundChecklist === undefined) gsDocs.roundChecklist = false;
  if (gsDocs.groupOverview === undefined) gsDocs.groupOverview = false;
  if (s.hideWcaLiveId === undefined) s.hideWcaLiveId = false;
  if (s.splitPdfsByStage === undefined) s.splitPdfsByStage = false;
  if (s.otsBlanks === undefined) s.otsBlanks = false;
  if (s.staffNametags === undefined) s.staffNametags = true;
  if (s.finalStationNumbers === undefined) s.finalStationNumbers = true;
  if (s.stationsPerStage === undefined) s.stationsPerStage = null;
  if (s.liveResultsMode === undefined) s.liveResultsMode = 'wca-live';
  if (s.isCustomCompetition === undefined) s.isCustomCompetition = false;
  if (s.scorecardCheckMode === undefined) s.scorecardCheckMode = 'per-group-card';
  if (s.scorecardCheckMode === 'checking-sheet') s.scorecardCheckMode = 'none';
  // Backfilled to the live defaults, not to "off": the same blob must not mean two things.
  if (s.scrambleDoubleCheckWorldTop === undefined) s.scrambleDoubleCheckWorldTop = 50;
  if (s.scrambleDoubleCheckRegionTop === undefined) s.scrambleDoubleCheckRegionTop = null;
  if (s.scrambleDoubleCheckRegionScope === undefined) s.scrambleDoubleCheckRegionScope = 'national';
  return s as unknown as CompetitionSettings;
}

/** A label beside the preview only, so it has no place in `CompetitionSettings`. */
export function readFileName(kind: UploadKind): string | null {
  return sessionStorage.getItem(FILE_NAME_KEYS[kind]);
}

export function writeFileName(kind: UploadKind, name: string | null): void {
  if (name) sessionStorage.setItem(FILE_NAME_KEYS[kind], name);
  else sessionStorage.removeItem(FILE_NAME_KEYS[kind]);
}

/** On a competition switch, so back-navigation can't hand A's scope and settings to B. */
export function clearDownstream(): void {
  for (const key of [KEYS.scope, KEYS.detection, KEYS.hasGroups]) sessionStorage.removeItem(key);
  clearSettings();
}

/** Reseed the settings step: a preset changed, and its seeds must not lose to stale input. */
export function clearSettings(): void {
  sessionStorage.removeItem(KEYS.settings);
  for (const key of Object.values(FILE_NAME_KEYS)) sessionStorage.removeItem(key);
}

