import { describe, it, expect } from 'vitest';
import { availableRounds, filterParsedByScope, latestAssignedRound, hasUnassignedIntermediate, stageSplitSkipsRound2 } from './generationScope';
import type { ParsedWCIF, ScorecardData, ScorecardEntry, CoverEntry } from './wcif-parser';

function sc(eventId: string, roundNum: number, name = ''): ScorecardEntry {
  return {
    kind: 'scorecard', timeslot: 'a01', eventId, eventName: eventId,
    roundLabel: `Round ${roundNum}`, roundNum, group: `Group 1 of 1`,
    name, wcaId: '', liveId: '', gender: 'm', cutoff: '', limit: '',
    format: 'avg5', isCumulative: false,
  };
}
function cover(eventId: string, roundNum: number): CoverEntry {
  return {
    kind: 'cover', timeslot: 'a01', eventId, eventName: eventId,
    roundLabel: `Round ${roundNum}`, roundNum, group: 'Group 1 of 1', numScorecards: 1, numGroups: 1,
  };
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

const realScs = (entries: ScorecardData[]) =>
  entries.filter((e): e is ScorecardEntry => e.kind === 'scorecard' && e.eventId !== '');

describe('availableRounds', () => {
  it('lists unique event+round across all scorecard buckets', () => {
    const parsed = mkParsed({
      firstRound: [sc('333', 1, 'A'), cover('333', 1), sc('222', 1, 'B')],
      intermediate: [sc('333', 2, 'A')],
      finals: [sc('222', 2)],
    });
    expect(availableRounds(parsed)).toEqual([
      { eventId: '333', roundNum: 1 },
      { eventId: '222', roundNum: 1 },
      { eventId: '333', roundNum: 2 },
      { eventId: '222', roundNum: 2 },
    ]);
  });

  it('ignores empty padding covers', () => {
    const padding: CoverEntry = {
      kind: 'cover', timeslot: 'ZZZ', eventId: '', eventName: '',
      roundLabel: '', roundNum: 0, group: '', numScorecards: 0, numGroups: 0,
    };
    const parsed = mkParsed({ firstRound: [sc('333', 1, 'A'), padding] });
    expect(availableRounds(parsed)).toEqual([{ eventId: '333', roundNum: 1 }]);
  });
});

describe('latestAssignedRound', () => {
  it('returns the highest assigned round number', () => {
    expect(latestAssignedRound(mkParsed({
      laterRoundsWithAssignments: [{ eventId: '333', roundNum: 2 }, { eventId: '222', roundNum: 3 }],
    }))).toBe(3);
  });
  it('returns 0 when nothing is assigned', () => {
    expect(latestAssignedRound(mkParsed())).toBe(0);
  });
});

describe('hasUnassignedIntermediate', () => {
  it('true for a pre-competition parse (Round 2 prefilled/blank, nothing assigned)', () => {
    expect(hasUnassignedIntermediate(mkParsed({
      intermediate: [sc('333', 2), cover('333', 2)],
      laterRoundsWithAssignments: [],
    }))).toBe(true);
  });

  it('false when every intermediate round is assigned (named)', () => {
    expect(hasUnassignedIntermediate(mkParsed({
      intermediate: [sc('333', 2, 'A'), cover('333', 2)],
      laterRoundsWithAssignments: [{ eventId: '333', roundNum: 2 }],
    }))).toBe(false);
  });

  it('true in a mixed case where one event\'s Round 2 is still unassigned', () => {
    expect(hasUnassignedIntermediate(mkParsed({
      intermediate: [sc('333', 2, 'A'), sc('222', 2)],
      laterRoundsWithAssignments: [{ eventId: '333', roundNum: 2 }],
    }))).toBe(true);
  });

  it('false when there is no intermediate bucket at all', () => {
    expect(hasUnassignedIntermediate(mkParsed())).toBe(false);
  });
});

describe('filterParsedByScope', () => {
  const allDocs = {
    scorecards: true, scheduleTracker: true, nametags: true,
    roundChecklist: true, firstTimerSlips: true, groupOverview: true,
  };
  const base = mkParsed({
    firstRound: [sc('333', 1, 'A'), sc('333', 1, 'B')],
    intermediate: [sc('333', 2, 'A'), cover('333', 2)],
    finals: [sc('333', 3)],
    nametags: [{ name: 'x' } as never],
    firstTimers: [{ name: 'y' } as never],
    extras: [sc('333', 1)],
    scheduleDays: [{ dayLabel: 'Day 1', stages: [] }],
    checkingDays: [{ dayLabel: 'Day 1', rows: [] }],
    groupOverview: [
      { eventId: '333', roundNum: 1 },
      { eventId: '333', roundNum: 2 },
    ] as never,
    laterRoundsWithAssignments: [{ eventId: '333', roundNum: 2 }],
  });

  it('everything with all docs → returns equivalent data', () => {
    const out = filterParsedByScope(base, { mode: 'everything', documents: allDocs });
    expect(out).toEqual(base);
  });

  it('everything with nametags:false → clears nametags', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: { ...allDocs, nametags: false },
    });
    expect(out.nametags).toHaveLength(0);
    expect(out.scheduleDays).toHaveLength(1);
  });

  it('everything with scheduleTracker:false → clears scheduleDays', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: { ...allDocs, scheduleTracker: false },
    });
    expect(out.scheduleDays).toHaveLength(0);
  });

  it('roundChecklist:false → clears checkingDays', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: { ...allDocs, roundChecklist: false },
    });
    expect(out.checkingDays).toHaveLength(0);
  });

  it('roundChecklist:true → keeps checkingDays', () => {
    const out = filterParsedByScope(base, { mode: 'everything', documents: allDocs });
    expect(out.checkingDays).toHaveLength(1);
  });

  // The Round Checklist is its own document, not part of the scorecards selection, so
  // deselecting the scorecards must leave it alone.
  it('scorecards:false → keeps checkingDays (the checklist is independent)', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: { ...allDocs, scorecards: false },
    });
    expect(out.firstRound).toHaveLength(0);
    expect(out.checkingDays).toHaveLength(1);
  });

  it('roundChecklist:true with scorecards:false → the checklist is the only output', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: {
        scorecards: false, scheduleTracker: false, nametags: false,
        roundChecklist: true, firstTimerSlips: false, groupOverview: false,
      },
    });
    expect(out.checkingDays).toHaveLength(1);
    expect(out.scheduleDays).toHaveLength(0);
    expect(out.nametags).toHaveLength(0);
    expect(out.firstTimers).toHaveLength(0);
    expect(out.firstRound).toHaveLength(0);
  });

  it('everything with firstTimerSlips:false → clears firstTimers', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: { ...allDocs, firstTimerSlips: false },
    });
    expect(out.firstTimers).toHaveLength(0);
  });

  it('everything with scorecards:false → clears all scorecard buckets and extras', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: { ...allDocs, scorecards: false },
    });
    expect(out.firstRound).toHaveLength(0);
    expect(out.intermediate).toHaveLength(0);
    expect(out.finals).toHaveLength(0);
    expect(out.extras).toHaveLength(0);
    expect(out.nametags).toHaveLength(1);
  });

  it('latest + all docs → keeps only latest assigned round, keeps nametags/schedule', () => {
    const out = filterParsedByScope(base, { mode: 'latest', documents: allDocs });
    expect(realScs(out.firstRound)).toHaveLength(0);
    expect(realScs(out.intermediate).map(s => s.name).sort()).toEqual(['A']);
    expect(realScs(out.finals)).toHaveLength(0);
    expect(out.extras).toHaveLength(0);
    expect(out.nametags).toHaveLength(1);
    expect(out.scheduleDays).toHaveLength(1);
    expect(out.firstTimers).toHaveLength(1);
  });

  it('latest + nametags:false → keeps latest round scorecards, clears nametags', () => {
    const out = filterParsedByScope(base, {
      mode: 'latest',
      documents: { ...allDocs, nametags: false },
    });
    expect(realScs(out.intermediate)).toHaveLength(1);
    expect(out.nametags).toHaveLength(0);
    expect(out.scheduleDays).toHaveLength(1);
  });

  it('groupOverview:false → clears the group overview, keeps everything else', () => {
    const out = filterParsedByScope(base, {
      mode: 'everything',
      documents: { ...allDocs, groupOverview: false },
    });
    expect(out.groupOverview).toHaveLength(0);
    expect(out.checkingDays).toHaveLength(1);
  });

  // The round filter reaches the overview too: a mid-competition "round 2 only" run should
  // not reprint day one's groups alongside the round it was asked for.
  it('latest → the group overview keeps only the latest assigned round', () => {
    const out = filterParsedByScope(base, { mode: 'latest', documents: allDocs });
    expect(out.groupOverview.map(e => e.roundNum)).toEqual([2]);
  });

  it('selected → the group overview keeps only the chosen rounds', () => {
    const out = filterParsedByScope(base, {
      mode: 'selected',
      rounds: [{ eventId: '333', roundNum: 1 }],
      documents: allDocs,
    });
    expect(out.groupOverview.map(e => e.roundNum)).toEqual([1]);
  });

  it('latest + only schedule → clears scorecards but keeps schedule', () => {
    const out = filterParsedByScope(base, {
      mode: 'latest',
      documents: { scorecards: false, scheduleTracker: true, nametags: false, roundChecklist: false, firstTimerSlips: false, groupOverview: false },
    });
    expect(out.firstRound).toHaveLength(0);
    expect(out.intermediate).toHaveLength(0);
    expect(out.scheduleDays).toHaveLength(1);
  });

  it('selected + all docs → keeps only the chosen event+round pairs', () => {
    const out = filterParsedByScope(base, {
      mode: 'selected',
      rounds: [{ eventId: '333', roundNum: 1 }, { eventId: '333', roundNum: 3 }],
      documents: allDocs,
    });
    expect(realScs(out.firstRound).map(s => s.name).sort()).toEqual(['A', 'B']);
    expect(realScs(out.intermediate)).toHaveLength(0);
    expect(realScs(out.finals)).toHaveLength(1);
    expect(out.nametags).toHaveLength(1);
  });

  it('pads each non-empty kept bucket to a multiple of 4', () => {
    const out = filterParsedByScope(base, {
      mode: 'selected',
      rounds: [{ eventId: '333', roundNum: 1 }],
      documents: allDocs,
    });
    expect(out.firstRound.length % 4).toBe(0);
    expect(out.firstRound.length).toBeGreaterThan(0);
  });
});

// Prefilled round 2 deals the round-1 qualifiers before stages are known, so it alone cannot be
// cut by stage. The organizer is told, because one unsplit file in a per-stage set looks wrong.
describe('stageSplitSkipsRound2', () => {
  const s = (splitPdfsByStage: boolean, secondRoundMode: 'prefilled' | 'blanks') =>
    ({ splitPdfsByStage, secondRoundMode });

  it('warns only when the split is on, round 2 is prefilled, and one exists', () => {
    expect(stageSplitSkipsRound2(s(true, 'prefilled'), true)).toBe(true);
  });

  it('stays quiet without the split', () => {
    expect(stageSplitSkipsRound2(s(false, 'prefilled'), true)).toBe(false);
  });

  it('stays quiet when round 2 prints blanks, which do carry a stage', () => {
    expect(stageSplitSkipsRound2(s(true, 'blanks'), true)).toBe(false);
  });

  it('stays quiet when there is no prefillable round 2 to skip', () => {
    expect(stageSplitSkipsRound2(s(true, 'prefilled'), false)).toBe(false);
  });
});
