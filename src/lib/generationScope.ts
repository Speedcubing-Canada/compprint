import type { ParsedWCIF, ScorecardData } from './wcif-parser';
import { finalizeEntries, realEntries } from './wcif-parser';
import type { CompetitionSettings } from '../types/settings';

export interface DocumentSelection {
  scorecards: boolean;
  scheduleTracker: boolean;
  nametags: boolean;
  // The Round Checklist (parser field `checkingDays`). Opt-in: it tracks the whole
  // competition's data flow rather than a pile of scorecards, so most users don't want it.
  roundChecklist: boolean;
  firstTimerSlips: boolean;
  // Who competes, scrambles, runs and judges in each group. Opt-in: only useful once the
  // WCIF has groups, and most organizers print it separately from the scorecard pile.
  groupOverview: boolean;
  // The WCA competition PDF's events table and daily schedule, posted around the venue. Opt-in.
  venueSchedule: boolean;
}

// What the user chose to generate.
export type GenerationScope =
  | { mode: 'everything'; documents: DocumentSelection }
  | { mode: 'latest'; documents: DocumentSelection }
  | { mode: 'selected'; rounds: RoundRef[]; documents: DocumentSelection };

export interface RoundRef {
  eventId: string;
  roundNum: number;
}

export const SCORECARD_BUCKETS = ['firstRound', 'intermediate', 'semis', 'finals'] as const;

// Every distinct (eventId, roundNum) that produces scorecards, in bucket → encounter order.
// Drives the per-event+round checklist shown for the "select" scope.
export function availableRounds(parsed: ParsedWCIF): RoundRef[] {
  const seen = new Set<string>();
  const out: RoundRef[] = [];
  for (const bucket of SCORECARD_BUCKETS) {
    for (const e of parsed[bucket]) {
      if (e.kind === 'cover' && e.eventId === '') continue;
      const key = `${e.eventId}-${e.roundNum}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ eventId: e.eventId, roundNum: e.roundNum });
    }
  }
  return out;
}

// The highest round number among rounds that have real assignments (the "latest round").
export function latestAssignedRound(parsed: ParsedWCIF): number {
  return parsed.laterRoundsWithAssignments.reduce((m, r) => Math.max(m, r.roundNum), 0);
}

// True when the intermediate bucket holds a Round 2 that has NOT been assigned (so it is
// rendered prefilled/blank, and the `secondRoundMode` choice actually matters). An assigned
// Round 2 is named and appears in `laterRoundsWithAssignments`; an unassigned one does not.
export function hasUnassignedIntermediate(parsed: ParsedWCIF): boolean {
  const assigned = new Set(
    parsed.laterRoundsWithAssignments.map(r => `${r.eventId}-${r.roundNum}`),
  );
  return parsed.intermediate.some(
    e => e.eventId !== '' && !assigned.has(`${e.eventId}-${e.roundNum}`),
  );
}

/**
 * True when the per-stage split is on but Round 2 will still ship as one PDF. Prefilled Round 2
 * deals the Round 1 qualifiers onto a generic group label, and who ends up on which stage is not
 * known until Round 1 is over, so those cards carry no stage to split on. Not a mistake, but the
 * one unsplit file in an otherwise per-stage set needs explaining.
 *
 * `hasPrefillableRound2` is `hasUnassignedIntermediate` on the generate page and the stored
 * `showSecondRoundMode` detection on the settings page, which has no parse of its own.
 */
export function stageSplitSkipsRound2(
  settings: Pick<CompetitionSettings, 'splitPdfsByStage' | 'secondRoundMode'>,
  hasPrefillableRound2: boolean,
): boolean {
  return settings.splitPdfsByStage
    && settings.secondRoundMode === 'prefilled'
    && hasPrefillableRound2;
}

// Produce a ParsedWCIF restricted to the chosen scope.
// Round filtering (latest/selected) applies to scorecard buckets only.
// Document flags control which artifact types survive, regardless of mode.
export function filterParsedByScope(parsed: ParsedWCIF, scope: GenerationScope): ParsedWCIF {
  let result = parsed;
  if (scope.mode !== 'everything') {
    // Structural, not ScorecardData: the same predicate filters group-overview entries.
    let keep: (e: { eventId: string; roundNum: number }) => boolean;
    if (scope.mode === 'latest') {
      const latest = latestAssignedRound(parsed);
      keep = (e) => e.roundNum === latest;
    } else {
      const set = new Set(scope.rounds.map((r) => `${r.eventId}-${r.roundNum}`));
      keep = (e) => set.has(`${e.eventId}-${e.roundNum}`);
    }
    const filterBucket = (entries: ScorecardData[]) =>
      finalizeEntries(realEntries(entries).filter(keep));
    result = {
      ...parsed,
      firstRound: filterBucket(parsed.firstRound),
      intermediate: filterBucket(parsed.intermediate),
      semis: filterBucket(parsed.semis),
      finals: filterBucket(parsed.finals),
      extras: [],
      groupOverview: parsed.groupOverview.filter(keep),
    };
  }

  const { documents } = scope;
  return {
    ...result,
    firstRound:   documents.scorecards      ? result.firstRound   : [],
    intermediate: documents.scorecards      ? result.intermediate : [],
    semis:        documents.scorecards      ? result.semis        : [],
    finals:       documents.scorecards      ? result.finals       : [],
    extras:       documents.scorecards      ? result.extras       : [],
    nametags:     documents.nametags        ? result.nametags     : [],
    scheduleDays: documents.scheduleTracker ? result.scheduleDays : [],
    // The Round Checklist is its own artefact, not a variant of the cover card, so it is
    // selected independently of the scorecards.
    checkingDays: documents.roundChecklist ? result.checkingDays : [],
    firstTimers:  documents.firstTimerSlips ? result.firstTimers  : [],
    groupOverview: documents.groupOverview  ? result.groupOverview : [],
    venueSchedule: documents.venueSchedule ? result.venueSchedule : null,
  };
}
