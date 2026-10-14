import type { GenerationScope } from '../lib/generationScope';

// Mirrored by `LANGUAGES` in src/i18n/index.ts and `LOCALES` in src/lib/i18n.ts.
// Keep all three in sync.
export type LocaleCode = 'en' | 'fr' | 'es' | 'pt';

export type PaperFormat = 'A4' | 'LETTER';

export type SecondRoundMode = 'prefilled' | 'blanks';

export type NametTagQrMode = 'back-only' | 'both-sides';

export type NametTagLogoMode = 'hidden' | 'with-name' | 'logo-only';

export type NametTagLayout = 'vertical' | 'horizontal';

// Decides the name tag QR target. 'wca-live' needs wcaLiveId + the person id map;
// 'ilr' (integrated live results on the WCA site) needs neither.
export type LiveResultsMode = 'wca-live' | 'ilr';

// Cover cards only; the Round Checklist is a separate document chosen in DocumentSelection.
// 'per-round-card' is per event+round, and per stage when a round spans stages.
export type ScorecardCheckMode =
  | 'per-group-card' | 'per-round-card' | 'none';

// Maps 1:1 onto the parser's buckets.
export type DoubleCheckRound = 'firstRound' | 'intermediate' | 'semis' | 'finals';
// WCA ID -> event IDs always double-checked for that competitor.
export type ScrambleDoubleCheckOverrides = Record<string, string[]>;
export type DoubleCheckRegionScope = 'continental' | 'national';

// bo3 renders with the mo3 layout (same 3 rows, as WCIF format '3' does); bo2/bo1 take
// no cutoff.
export type CustomEventFormat = 'avg5' | 'mo3' | 'bo3' | 'bo2' | 'bo1';

// wcaId is '' for newcomers.
export interface CustomCompetitor {
  name: string;
  wcaId: string;
}

export interface CustomEvent {
  name: string;
  iconDataUrl: string | null;
  format: CustomEventFormat;
  cutoff: string;  // "" = none, otherwise "M:SS" - triggers bo2-avg5 / bo1-mo3
  limit: string;   // "" = none, otherwise "M:SS"
  roundLabel?: string;
  // When set, one named card per competitor padded to a full page, instead of 4 blanks.
  competitors?: CustomCompetitor[];
}

export interface CompetitionSettings {
  competitionId: string;
  competitionName: string;
  language: LocaleCode;
  // When set, scorecard headers and cutoff lines print both languages and name-tag role
  // badges use this one. `null` = single-language output.
  secondaryLanguage: LocaleCode | null;
  paperFormat: PaperFormat;
  // One scorecard per A6 page, in plain sorted order. Every other document keeps `paperFormat`.
  scorecardsA6: boolean;
  // Chosen on /generate, only offered when a file would pass the page cap. Absent = merged.
  splitLargePdfs?: boolean;
  secondRoundMode: SecondRoundMode;
  logoDataUrl: string | null;
  // The bundled Speedcubing Canada logo when no custom logo is uploaded.
  useDefaultLogo: boolean;
  // Prints the comp name above the competitor's on scorecards, for custom logos without it.
  scorecardCompNameWithLogo: boolean;
  // Detected from `scoretaking_software` ('internal' => ilr), overridable on the settings page.
  liveResultsMode: LiveResultsMode;
  // 'wca-live' only; ILR needs neither.
  wcaLiveId: string | null;
  wcaLivePersonIds: Record<number, string> | null;
  hideWcaLiveId: boolean;
  nametagLogoMode: NametTagLogoMode;
  nametagQrMode: NametTagQrMode;
  nametagLayout: NametTagLayout;
  customEvents: CustomEvent[];
  scorecardCheckMode: ScorecardCheckMode;
  // Adds a second scrambler-signature column to scorecards whose round is in
  // `scrambleDoubleCheckRounds` or whose competitor+event is in the overrides.
  scrambleDoubleCheck: boolean;
  scrambleDoubleCheckRounds: DoubleCheckRound[];
  scrambleDoubleCheckOverrides: ScrambleDoubleCheckOverrides;
  // Ranking rules (regulation 11i), matched against the WCIF personal bests. `null` switches
  // a rule off. OR'd with the round and override rules across every round, so a top-ranked
  // competitor always gets the column.
  scrambleDoubleCheckWorldTop: number | null;
  scrambleDoubleCheckRegionTop: number | null;
  scrambleDoubleCheckRegionScope: DoubleCheckRegionScope;
  // One scorecard PDF per stage instead of one per round, for printing each stage on its own
  // paper colour. Only splits rounds where every card knows its stage and 2+ stages ran.
  splitPdfsByStage: boolean;
  // One page each of blank name tags, first-timer slips and scorecards for people registered
  // on the day. Seeded from the competition's `on_the_spot_registration` flag.
  otsBlanks: boolean;
  // Station numbers on a one-group final's blanks, only when its field fits the stations.
  finalStationNumbers: boolean;
  // Overrides the station count read from the WCIF. `null` = detected.
  stationsPerStage: number | null;
  generationScope: GenerationScope;
  // No WCIF is fetched, only customEvents render, and every WCA Live field is forced off.
  isCustomCompetition: boolean;
}
