import { describe, it, expect } from 'vitest';
import { estimateTotalPages } from './pageEstimate';
import { buildPdfJobs } from './pdfJobs';
import type { ParsedWCIF, ScorecardData, ScorecardEntry, FirstTimerEntry, NametTagEntry } from './wcif-parser';
import type { ScheduleDay } from './scheduleRows';
import type { CompetitionSettings, CustomEvent } from '../types/settings';

function sc(): ScorecardEntry {
  return {
    kind: 'scorecard', timeslot: 'a01', eventId: '333', eventName: '333',
    roundLabel: 'Round 1', roundNum: 1, group: 'Group 1 of 1',
    name: '', wcaId: '', liveId: '', gender: 'm', cutoff: '', limit: '',
    format: 'avg5', isCumulative: false,
  };
}
const scards = (n: number): ScorecardData[] => Array.from({ length: n }, sc);

// The page count is derived from the job list, which the generate page builds anyway.
const est = (parsed: ParsedWCIF, settings: CompetitionSettings) =>
  estimateTotalPages(parsed, settings, buildPdfJobs(parsed, settings));
// Only the array length matters for these two.
const tags = (n: number) => Array.from({ length: n }, () => ({})) as unknown as NametTagEntry[];
const days = (n: number) => Array.from({ length: n }, () => ({})) as unknown as ScheduleDay[];

function ft(eventIds: string[] = ['333']): FirstTimerEntry {
  return { name: 'A', gender: 'm', countryIso2: 'CA', eventIds: eventIds as FirstTimerEntry['eventIds'] };
}

function mkParsed(over: Partial<ParsedWCIF> = {}): ParsedWCIF {
  return {
    firstRound: [], intermediate: [], semis: [], finals: [],
    nametags: [], firstTimers: [], extras: [], scheduleDays: [], checkingDays: [],
    groupOverview: [],
    laterRoundsWithAssignments: [], hasGroups: true, stageCount: 1, stations: null,
    ...over,
  };
}

function mkSettings(over: Partial<CompetitionSettings> = {}): CompetitionSettings {
  return {
    competitionId: 'Test2026', competitionName: 'Test 2026',
    language: 'en', secondaryLanguage: null, paperFormat: 'LETTER',
    secondRoundMode: 'blanks', logoDataUrl: null, useDefaultLogo: true,
    wcaLiveId: null, wcaLivePersonIds: null, hideWcaLiveId: false,
    nametagLogoMode: 'with-name', nametagQrMode: 'back-only', nametagLayout: 'vertical',
    customEvents: [], scorecardCheckMode: 'per-group-card',
    scrambleDoubleCheck: false, scrambleDoubleCheckRounds: [], scrambleDoubleCheckOverrides: {},
    generationScope: { mode: 'everything', documents: { scorecards: true, scheduleTracker: true, nametags: true, roundChecklist: false, firstTimerSlips: false, groupOverview: false } },
    ...over,
  } as CompetitionSettings;
}

const customEvent = (name: string): CustomEvent =>
  ({ name, format: 'avg5', cutoff: '', limit: '', iconDataUrl: null }) as unknown as CustomEvent;

describe('estimateTotalPages', () => {
  it('returns 0 for an empty selection', () => {
    expect(est(mkParsed(), mkSettings())).toBe(0);
  });

  it('paginates scorecards at four per page (rounds up)', () => {
    expect(est(mkParsed({ firstRound: scards(5) }), mkSettings())).toBe(2);
    expect(est(mkParsed({ firstRound: scards(8) }), mkSettings())).toBe(2);
    expect(est(mkParsed({ firstRound: scards(1) }), mkSettings())).toBe(1);
  });

  it('sums each scorecard round independently', () => {
    // firstRound 4 → 1 page, finals 8 → 2 pages
    expect(est(mkParsed({ firstRound: scards(4), finals: scards(8) }), mkSettings())).toBe(3);
  });

  it('paginates name tags at four per page', () => {
    expect(est(mkParsed({ nametags: tags(9) }), mkSettings())).toBe(3);
  });

  it('counts the schedule tracker as one page', () => {
    expect(est(mkParsed({ scheduleDays: days(2) }), mkSettings())).toBe(1);
  });

  it('counts the Round Checklist as one page', () => {
    const parsed = mkParsed({ checkingDays: [{ dayLabel: 'Day 1', rows: [] }] });
    expect(est(parsed, mkSettings())).toBe(1);
  });

  // Selection happens upstream: filterParsedByScope empties checkingDays when the
  // Round Checklist is not selected, so the estimator has nothing left to gate on.
  it('counts no page when checkingDays is empty, whatever the cover-card mode', () => {
    const parsed = mkParsed({ checkingDays: [] });
    for (const mode of ['per-group-card', 'per-round-card', 'none'] as const) {
      expect(est(parsed, mkSettings({ scorecardCheckMode: mode }))).toBe(0);
    }
  });

  it('counts the page independently of the cover-card mode', () => {
    const parsed = mkParsed({ checkingDays: [{ dayLabel: 'Day 1', rows: [] }] });
    for (const mode of ['per-group-card', 'per-round-card', 'none'] as const) {
      expect(est(parsed, mkSettings({ scorecardCheckMode: mode }))).toBe(1);
    }
  });

  it('counts one page per named custom event', () => {
    const settings = mkSettings({ customEvents: [customEvent('Mirror'), customEvent('Skewb Relay'), customEvent('  ')] });
    expect(est(mkParsed(), settings)).toBe(2);
  });

  it('counts ceil(n/4) pages for a custom event with CSV competitors', () => {
    const withCompetitors: CustomEvent = {
      ...customEvent('Kilominx'),
      competitors: Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, wcaId: '' })),
    };
    // Kilominx 5 competitors → 2 pages, Mirror blank → 1 page
    const settings = mkSettings({ customEvents: [withCompetitors, customEvent('Mirror')] });
    expect(est(mkParsed(), settings)).toBe(3);
  });

  it('greedily packs first-timer slips by height', () => {
    // A single-event slip is 7 lines (7×13) + intro (20) + inter-slip gap (31) = 142pt;
    // five fit a LETTER page (718pt content), the sixth spills to a second page.
    expect(est(mkParsed({ firstTimers: Array.from({ length: 5 }, () => ft()) }), mkSettings())).toBe(1);
    expect(est(mkParsed({ firstTimers: Array.from({ length: 6 }, () => ft()) }), mkSettings())).toBe(2);
  });

  it('adds page counts across document types', () => {
    const parsed = mkParsed({ firstRound: scards(8), nametags: tags(4), scheduleDays: days(1) });
    // scorecards 2 + nametags 1 + schedule 1
    expect(est(parsed, mkSettings())).toBe(4);
  });
});

describe('estimateTotalPages with A6 scorecards', () => {
  it('counts one page per card, and a single blank page per custom event', () => {
    const custom = { name: 'X', format: 'avg5', cutoff: '', limit: '', iconDataUrl: null } as CustomEvent;
    expect(est(mkParsed({ firstRound: scards(5) }), mkSettings({ scorecardsA6: true, customEvents: [custom] })))
      .toBe(5 + 1);
  });
});
