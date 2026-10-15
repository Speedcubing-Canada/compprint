import { describe, it, expect, beforeEach } from 'vitest';
import { subStageLabel, parseWCIF } from './wcif-parser';
import { hasUnassignedIntermediate } from './generationScope';
import type { ScorecardEntry, CoverEntry, ScorecardData, NametTagEntry } from './wcif-parser';
import type {
  WCIF, Event, Round, RoundFormat, Activity, ChildActivity,
  Room, Person, EventId, PersonalBest, Assignment, ParticipationSource,
} from '../types/wcif';
import type { CompetitionSettings } from '../types/settings';

let _id = 0;
const uid = () => ++_id;
beforeEach(() => { _id = 0; });

const BASE: CompetitionSettings = {
  competitionId: 'TC2024', competitionName: 'Test Comp 2024',
  language: 'en', secondaryLanguage: null, paperFormat: 'A4', secondRoundMode: 'blanks',
  logoDataUrl: null, useDefaultLogo: false, scorecardCompNameWithLogo: false, liveResultsMode: 'wca-live',
  wcaLiveId: null, wcaLivePersonIds: null,
  hideWcaLiveId: false, nametagLogoMode: 'hidden', nametagQrMode: 'back-only', nametagLayout: 'vertical',
  splitPdfsByStage: false, mergeScorecardRounds: false, otsBlanks: false, scorecardsA6: false,
  finalStationNumbers: true, stationsPerStage: null,
  customEvents: [], scorecardCheckMode: 'per-group-card',
  scrambleDoubleCheck: false, scrambleDoubleCheckRounds: ['finals'], scrambleDoubleCheckOverrides: {},
  scrambleDoubleCheckWorldTop: 50, scrambleDoubleCheckRegionTop: null, scrambleDoubleCheckRegionScope: 'national',
  generationScope: { mode: 'everything', documents: { scorecards: true, scheduleTracker: true, nametags: true, roundChecklist: false, firstTimerSlips: false, groupOverview: false } },
  isCustomCompetition: false,
};
const cfg = (o: Partial<CompetitionSettings> = {}): CompetitionSettings => ({ ...BASE, ...o });

// v1-style advancement out of a round; evt() turns it into the next round's v2 participationRuleset.
type AdvancementCondition = { type: 'ranking' | 'percent' | 'attemptResult'; level: number };
type RoundSpec = Omit<Round, 'id'> & { adv?: AdvancementCondition | null };

// Build a round spec. limitCs=null → no time limit; limitCs=undefined → default 3 min.
function rSpec(format: RoundFormat, opts: {
  cutoffCs?: number;
  limitCs?: number | null;
  cumulative?: string[];
  adv?: AdvancementCondition | null;
  sets?: number;
} = {}): RoundSpec {
  const { cutoffCs, limitCs, cumulative = [], adv = null, sets = 1 } = opts;
  return {
    format,
    timeLimit: limitCs === null ? null : { centiseconds: limitCs ?? 18000, cumulativeRoundIds: cumulative },
    cutoff: cutoffCs !== undefined ? { numberOfAttempts: 2, resultValue: cutoffCs } : null,
    participationRuleset: null,
    adv,
    scrambleSetCount: sets,
    results: [],
  };
}

function evt(id: EventId, rounds: RoundSpec[]): Event {
  return {
    id,
    rounds: rounds.map((spec, i) => {
      const { adv: _adv, ...r } = spec; // eslint-disable-line @typescript-eslint/no-unused-vars
      const prev = rounds[i - 1]?.adv;
      const participationSource: ParticipationSource | null = i === 0 ? { type: 'registrations' }
        : prev ? {
          type: 'round', roundId: `${id}-r${i}`,
          resultCondition: {
            type: prev.type === 'attemptResult' ? 'resultAchieved' : prev.type, scope: 'average', value: prev.level,
          },
        } : null;
      return {
        ...r, id: `${id}-r${i + 1}`,
        participationRuleset: r.participationRuleset ?? { participationSource, reservedPlaces: null },
      };
    }),
    qualification: null,
  };
}

// Child activity - id must be unique within the test; use 100+ to avoid uid() collisions.
function ch(id: number, eventId: string, r: number, g: number, t = '2024-01-01T09:00:00Z'): ChildActivity {
  return {
    id, name: '',
    activityCode: `${eventId}-r${r}-g${g}`,
    startTime: t, endTime: t,
    childActivities: [], scrambleSets: [],
  };
}

function act(eventId: string, r: number, children: ChildActivity[]): Activity {
  return {
    id: uid(), name: '',
    activityCode: `${eventId}-r${r}`,
    startTime: children[0]?.startTime ?? '2024-01-01T09:00:00Z',
    endTime: '2024-01-01T10:00:00Z',
    childActivities: children, scrambleSets: [],
  };
}

function room(name: string, activities: Activity[]): Room {
  return { id: uid(), name, color: '#fff', activities };
}

type PersonOpts = {
  name?: string;
  wcaId?: string | null;
  gender?: 'm' | 'f' | 'o';
  status?: 'accepted' | 'pending' | 'deleted';
  personalBests?: PersonalBest[];
  // Non-competitor assignments, by activity id. Only the Group Overview reads these.
  staff?: Partial<Record<'staff-scrambler' | 'staff-runner' | 'staff-judge', number[]>>;
};
function per(
  registrantId: number,
  assignments: Array<{ aid: number; station?: number | null }>,
  opts: PersonOpts = {},
): Person {
  const {
    name = `P${registrantId}`, wcaId = `2024T${registrantId}`, gender = 'm',
    status = 'accepted', personalBests = [], staff = {},
  } = opts;
  return {
    registrantId, name,
    wcaUserId: registrantId, wcaId,
    countryIso2: 'FR', gender,
    registration: { wcaRegistrationId: registrantId, eventIds: ['333' as EventId], status, isCompeting: true },
    avatar: null, roles: [], personalBests,
    assignments: [
      ...assignments.map(a => ({
        activityId: a.aid, assignmentCode: 'competitor' as const, stationNumber: a.station ?? null,
      })),
      ...Object.entries(staff).flatMap(([code, aids]) =>
        aids.map(aid => ({
          activityId: aid, assignmentCode: code as Assignment['assignmentCode'], stationNumber: null,
        }))),
    ],
  };
}

function mkWCIF(events: Event[], rooms: Room[], persons: Person[] = []): WCIF {
  return {
    formatVersion: '1.0', id: 'TC2024', name: 'Test Comp 2024', shortName: 'TC24',
    persons, events,
    schedule: {
      startDate: '2024-01-01', numberOfDays: 1,
      venues: [{
        id: 1, name: 'Venue', latitudeMicrodegrees: 0, longitudeMicrodegrees: 0,
        countryIso2: 'FR', timezone: 'Europe/Paris', rooms,
      }],
    },
    competitorLimit: null,
  };
}

// Filter helpers (exclude empty padding covers)
const scs = (entries: ScorecardData[]) =>
  entries.filter((e): e is ScorecardEntry => e.kind === 'scorecard');
const cvs = (entries: ScorecardData[]) =>
  entries.filter((e): e is CoverEntry => e.kind === 'cover' && !!e.eventId);

// Inverts the 4-up imposition: reading with stride 4, one quadrant pile at a time, gives
// back the logical sorted order. Assert on that rather than on print layout.
const unimpose = <T,>(arr: T[]): T[] => {
  const out: T[] = [];
  for (let col = 0; col < 4; col++)
    for (let i = col; i < arr.length; i += 4) out.push(arr[i]);
  return out;
};

// Format selection

describe('scorecard format selection', () => {
  function fmtFor(eventId: EventId, roundSpec: RoundSpec): string | undefined {
    const c = ch(100, eventId, 1, 1);
    const e = evt(eventId, [roundSpec]);
    const r = room('Stage', [act(eventId, 1, [c])]);
    const p = per(1, [{ aid: 100 }]);
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg());
    return scs(result.firstRound).find(s => s.eventId === eventId)?.format;
  }

  it('avg5 for ao5 without cutoff', () => expect(fmtFor('333', rSpec('a'))).toBe('avg5'));
  it('bo2-avg5 for ao5 with cutoff', () => expect(fmtFor('333', rSpec('a', { cutoffCs: 3000 }))).toBe('bo2-avg5'));
  it('mo3 for format 3 without cutoff', () => expect(fmtFor('333', rSpec('3'))).toBe('mo3'));
  it('mo3 for format m without cutoff', () => expect(fmtFor('333', rSpec('m'))).toBe('mo3'));
  it('bo1-mo3 for format 3 with cutoff', () => expect(fmtFor('333', rSpec('3', { cutoffCs: 3000 }))).toBe('bo1-mo3'));
  it('bo2 for best-of-2 format', () => expect(fmtFor('skewb', rSpec('2'))).toBe('bo2'));

  it('forces 444bf to mo3 regardless of WCIF format', () => {
    expect(fmtFor('444bf', rSpec('2'))).toBe('mo3');
  });

  it('forces 444bf to bo1-mo3 when cutoff present', () => {
    expect(fmtFor('444bf', rSpec('2', { cutoffCs: 60000 }))).toBe('bo1-mo3');
  });

  it('forces 555bf to mo3 regardless of WCIF format', () => {
    expect(fmtFor('555bf', rSpec('2'))).toBe('mo3');
  });

  it('333bf is NOT in blind set - stays avg5', () => {
    expect(fmtFor('333bf', rSpec('a'))).toBe('avg5');
  });

  it('333mbf always bo2 - verified via finals blank cards', () => {
    // 333mbf persons are skipped in named assignments; test via blank finals cards.
    const c2 = ch(101, '333mbf', 2, 1, '2024-01-01T14:00:00Z');
    const e = evt('333mbf', [rSpec('2'), rSpec('2')]);
    const r = room('Stage', [
      act('333mbf', 1, [ch(100, '333mbf', 1, 1)]),
      act('333mbf', 2, [c2]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(scs(result.finals)[0]?.format).toBe('bo2');
  });

  it('null timeLimit does not throw and produces empty limit string', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a', { limitCs: null })]);
    const r = room('Stage', [act('333', 1, [c])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    const sc = scs(result.firstRound)[0];
    expect(sc?.limit).toBe('');
    expect(sc?.isCumulative).toBe(false);
  });

  it('reads the WCIF v2 cutoff field (resultValue), never NaN', () => {
    const c = ch(100, '444', 1, 1);
    const e = evt('444', [rSpec('a')]);
    e.rounds[0].cutoff = JSON.parse('{"numberOfAttempts": 2, "resultValue": 9000}');
    const r = room('Stage', [act('444', 1, [c])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    expect(scs(result.firstRound)[0]?.cutoff).toBe('1:30');
  });
});

// Round categorisation

describe('round categorisation', () => {
  function mkNRounds(n: number) {
    const rounds = Array.from({ length: n }, () => rSpec('a'));
    const activities = Array.from({ length: n }, (_, i) => {
      const t = `2024-01-01T${String(9 + i).padStart(2, '0')}:00:00Z`;
      return act('333', i + 1, [ch(100 + i, '333', i + 1, 1, t)]);
    });
    const e = evt('333', rounds);
    const r = room('Stage', activities);
    const p = per(1, [{ aid: 100 }]); // assigned to round 1
    return parseWCIF(mkWCIF([e], [r], [p]), cfg());
  }

  it('1-round event: only firstRound is non-empty', () => {
    const result = mkNRounds(1);
    expect(scs(result.firstRound).length).toBeGreaterThan(0);
    expect(result.intermediate.length).toBe(0);
    expect(result.semis.length).toBe(0);
    expect(result.finals.length).toBe(0);
  });

  it('2-round event: firstRound and finals; no intermediate or semis', () => {
    const result = mkNRounds(2);
    expect(scs(result.firstRound).length).toBeGreaterThan(0);
    expect(result.intermediate.length).toBe(0);
    expect(result.semis.length).toBe(0);
    expect(scs(result.finals).length).toBeGreaterThan(0);
  });

  it('3-round event: firstRound, intermediate, finals; no semis', () => {
    const result = mkNRounds(3);
    expect(scs(result.firstRound).length).toBeGreaterThan(0);
    expect([...scs(result.intermediate), ...cvs(result.intermediate)].length).toBeGreaterThan(0);
    expect(result.semis.length).toBe(0);
    expect(scs(result.finals).length).toBeGreaterThan(0);
  });

  it('4-round event: all four buckets are non-empty', () => {
    const result = mkNRounds(4);
    expect(scs(result.firstRound).length).toBeGreaterThan(0);
    expect([...scs(result.intermediate), ...cvs(result.intermediate)].length).toBeGreaterThan(0);
    expect(scs(result.semis).length).toBeGreaterThan(0);
    expect(scs(result.finals).length).toBeGreaterThan(0);
  });

  it('2-round event round 2 goes to finals, not intermediate', () => {
    const result = mkNRounds(2);
    expect(scs(result.finals)[0]?.roundLabel).toBe('Final Round');
  });

  it('333fm is excluded from all buckets', () => {
    const c = ch(100, '333fm', 1, 1);
    const e = evt('333fm', [rSpec('3')]);
    const r = room('Stage', [act('333fm', 1, [c])]);
    const p = per(1, [{ aid: 100 }]);
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg());
    expect(result.firstRound.length).toBe(0);
    expect(result.intermediate.length).toBe(0);
    expect(result.semis.length).toBe(0);
    expect(result.finals.length).toBe(0);
  });
});

// FMC-only competition

describe('FMC-only competition', () => {
  it('produces no scorecards but still generates nametags and first-timer slips', () => {
    const e = evt('333fm', [rSpec('3')]);
    const r = room('Stage', [act('333fm', 1, [ch(100, '333fm', 1, 1), ch(101, '333fm', 1, 2)])]);
    const veteran  = per(1, [{ aid: 100 }]);                  // has WCA ID → nametag only
    const newcomer = per(2, [{ aid: 101 }], { wcaId: null }); // no WCA ID  → nametag + first-timer slip
    const result = parseWCIF(mkWCIF([e], [r], [veteran, newcomer]), cfg());

    expect(result.firstRound.length).toBe(0);
    expect(result.intermediate.length).toBe(0);
    expect(result.semis.length).toBe(0);
    expect(result.finals.length).toBe(0);
    expect(result.extras.length).toBe(0);

    expect(result.nametags.length).toBe(2);
    expect(result.firstTimers.length).toBe(1);
  });
});

// Group labels

describe('group labels - single stage', () => {
  it('English: "Group 1 of 2" / "Group 2 of 2"', () => {
    const c1 = ch(100, '333', 1, 1); const c2 = ch(101, '333', 1, 2);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c1, c2])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])]), cfg());
    const groups = new Set(scs(result.firstRound).map(s => s.group));
    expect(groups).toContain('Group 1 of 2');
    expect(groups).toContain('Group 2 of 2');
  });

  it('French: "Groupe 1 sur 2" / "Groupe 2 sur 2"', () => {
    const c1 = ch(100, '333', 1, 1); const c2 = ch(101, '333', 1, 2);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c1, c2])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])]), cfg({ language: 'fr' }));
    const groups = new Set(scs(result.firstRound).map(s => s.group));
    expect(groups).toContain('Groupe 1 sur 2');
    expect(groups).toContain('Groupe 2 sur 2');
  });

  it('single-stage event stays "Group N of M" even in a multi-room venue', () => {
    // 5BLD in a single side room - never uses stage-colour labels
    const c = ch(100, '555bf', 1, 1);
    const e = evt('555bf', [rSpec('2')]);
    const r = room('Salle Annexe', [act('555bf', 1, [c])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    expect(scs(result.firstRound)[0]?.group).toBe('Group 1 of 1');
  });
});

// The stage key is what distinguishes a room from the others running the same round.
// "Blue Stage"/"Red Stage" (colour first) has to behave exactly like "Scène Rouge"/"Scène
// Bleu" (colour last): the Brampton Summer 2026 bug report.

describe('stage keys from room names', () => {
  // Two rooms running 333-r1, two groups each.
  const twoStages = (nameA: string, nameB: string, extra: Room[] = []) => {
    const rA = room(nameA, [act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)])]);
    const rB = room(nameB, [act('333', 1, [ch(102, '333', 1, 3), ch(103, '333', 1, 4)])]);
    const persons = [
      per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }]),
      per(3, [{ aid: 102 }]), per(4, [{ aid: 103 }]),
    ];
    return parseWCIF(mkWCIF([evt('333', [rSpec('a')])], [rA, rB, ...extra], persons), cfg());
  };
  const stagesOf = (r: ReturnType<typeof parseWCIF>) =>
    [...new Set(scs(r.firstRound).map(s => s.stage))].sort();

  it('colour-first names: "Blue Stage"/"Red Stage" → blue/red, not both "stage"', () => {
    const result = twoStages('Blue Stage', 'Red Stage');
    expect(stagesOf(result)).toEqual(['blue', 'red']);
    const groups = new Set(scs(result.firstRound).map(s => s.group));
    expect(groups).toContain('Blue 1 of 4');
    expect(groups).toContain('Red 3 of 4');
    expect(groups).not.toContain('Group 1 of 4');
  });

  it('keeps the two stages as separate piles (distinct timeslot prefixes)', () => {
    // With both rooms collapsing to "stage" the piles interleaved - Sarah's "mixed together".
    const cards = scs(twoStages('Blue Stage', 'Red Stage').firstRound);
    const prefixes = new Set(cards.map(c => c.timeslot[0]));
    expect(prefixes).toEqual(new Set(['b', 'r']));
  });

  it('a side room running another event does not block the trim', () => {
    const side = room('Side Room', [act('333fm', 1, [ch(200, '333fm', 1, 1)])]);
    expect(stagesOf(twoStages('Blue Stage', 'Red Stage', [side]))).toEqual(['blue', 'red']);
  });

  it('rooms with no shared word keep their full names', () => {
    expect(stagesOf(twoStages('Red', 'Blue'))).toEqual(['blue', 'red']);
  });

  it('falls back to full names when trimming would empty one', () => {
    // "Stage" minus the shared word "stage" is nothing, so neither room is trimmed.
    expect(stagesOf(twoStages('Stage', 'Stage 2'))).toEqual(['stage', 'stage 2']);
  });

  it('ignores rooms that host no groups when computing the shared words', () => {
    // "General" (check-in, lunch) shares no word with the stages; counting it would leave
    // "blue stage"/"red stage" untrimmed.
    const general = room('General', [{
      id: uid(), name: '', activityCode: 'other-lunch',
      startTime: '2024-01-01T12:00:00Z', endTime: '2024-01-01T13:00:00Z',
      childActivities: [], scrambleSets: [],
    }]);
    expect(stagesOf(twoStages('Blue Stage', 'Red Stage', [general]))).toEqual(['blue', 'red']);
  });
});

describe('group labels - multi-stage (event across multiple rooms)', () => {
  it('4 distinct groups across 2 stages → "Rouge N of 4" / "Bleu N of 4"', () => {
    // rouge: g1, g2 - bleu: g3, g4 → 4 unique group codes
    const rRouge = room('Scène Rouge', [act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)])]);
    const rBleu  = room('Scène Bleu',  [act('333', 1, [ch(102, '333', 1, 3), ch(103, '333', 1, 4)])]);
    const e = evt('333', [rSpec('a')]);
    const persons = [
      per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }]),
      per(3, [{ aid: 102 }]), per(4, [{ aid: 103 }]),
    ];
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], persons), cfg());
    const groups = new Set(scs(result.firstRound).map(s => s.group));
    expect(groups).toContain('Rouge 1 of 4');
    expect(groups).toContain('Rouge 2 of 4');
    expect(groups).toContain('Bleu 3 of 4');
    expect(groups).toContain('Bleu 4 of 4');
    expect(groups).not.toContain('Group 1 of 4');
  });

  it('French multi-stage → "Rouge N sur 4"', () => {
    const rRouge = room('Scène Rouge', [act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)])]);
    const rBleu  = room('Scène Bleu',  [act('333', 1, [ch(102, '333', 1, 3), ch(103, '333', 1, 4)])]);
    const e = evt('333', [rSpec('a')]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }]), per(3, [{ aid: 102 }]), per(4, [{ aid: 103 }])];
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], persons), cfg({ language: 'fr' }));
    const groups = new Set(scs(result.firstRound).map(s => s.group));
    expect(groups).toContain('Rouge 1 sur 4');
    expect(groups).toContain('Bleu 3 sur 4');
  });

  it('unique group count: g1 in rouge + g1 in bleu = 1 group (not 2), still named per stage', () => {
    // Same group code g1 in both rooms → simultaneous → numGroups = 1. The count stays 1, but
    // the card must still say which stage to go to, so it is "Rouge 1", not "Group 1 of 1".
    const rRouge = room('Scène Rouge', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const rBleu  = room('Scène Bleu',  [act('333', 1, [ch(101, '333', 1, 1)])]);
    const e = evt('333', [rSpec('a')]);
    const p1 = per(1, [{ aid: 100 }]);
    const p2 = per(2, [{ aid: 101 }]);
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], [p1, p2]), cfg());
    const groups = new Set(scs(result.firstRound).map(s => s.group));
    expect(groups).toEqual(new Set(['Rouge 1', 'Bleu 1']));
    // One group per stage, so there is no "of N" to print.
    expect(groups).not.toContain('Rouge 1 of 1');
    expect(groups).not.toContain('Group 1 of 1');
  });
});

// Stationary rounds (fixed station-number assignments)

describe('stationary rounds (station-number assignments)', () => {
  // Stations are numbered across both stages (Rouge 1,3,5 / Bleu 2,4,6) and the label drops
  // the stage, so sorting by label alone interleaves them. The stage sort key must not.
  function mkStationary() {
    const e = evt('333', [rSpec('a')]);
    const rRouge = room('Scène Rouge', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const rBleu  = room('Scène Bleu',  [act('333', 1, [ch(101, '333', 1, 2)])]);
    const persons = [
      per(1, [{ aid: 100, station: 1 }]),
      per(3, [{ aid: 100, station: 3 }]),
      per(5, [{ aid: 100, station: 5 }]),
      per(2, [{ aid: 101, station: 2 }]),
      per(4, [{ aid: 101, station: 4 }]),
      per(6, [{ aid: 101, station: 6 }]),
    ];
    return parseWCIF(mkWCIF([e], [rRouge, rBleu], persons), cfg());
  }

  it('station number drives the visible group label (stage omitted on the card)', () => {
    const groups = new Set(scs(mkStationary().firstRound).map(s => s.group));
    expect(groups).toContain('Station 01');
    expect(groups).toContain('Station 06');
  });

  it('scorecards are grouped by stage, not interleaved by station number', () => {
    const ordered = scs(unimpose(mkStationary().firstRound)).filter(s => s.eventId === '333');
    const stages = ordered.map(s => s.stage);
    expect(stages.length).toBe(6);
    // One full stage block, then the other - never alternating.
    const firstStage = stages[0];
    const switchIdx = stages.findIndex(st => st !== firstStage);
    expect(switchIdx).toBeGreaterThan(0);
    expect(stages.slice(0, switchIdx).every(st => st === firstStage)).toBe(true);
    expect(stages.slice(switchIdx).every(st => st !== firstStage)).toBe(true);
  });
});

// Simultaneous multi-stage finals

describe('simultaneous multi-stage finals', () => {
  // 2-round event with simultaneous round-2 finals across rouge and bleu
  function mkSimultaneousFinals() {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    return parseWCIF(mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]), cfg());
  }

  it('finals covers are labeled "Bleu 1" and "Rouge 1" (stage name + group number)', () => {
    const result = mkSimultaneousFinals();
    const coverGroups = cvs(result.finals).map(e => e.group).sort();
    expect(coverGroups).toContain('Bleu 1');
    expect(coverGroups).toContain('Rouge 1');
    expect(coverGroups).not.toContain('Bleu');
    expect(coverGroups).not.toContain('Group 1 of 1');
  });

  it('blank finals cards carry the stage label (not station numbers)', () => {
    const result = mkSimultaneousFinals();
    const cards = scs(result.finals).filter(s => s.eventId === '333');
    const groups = new Set(cards.map(s => s.group));
    expect(groups).toContain('Bleu 1');
    expect(groups).toContain('Rouge 1');
    expect(cards.every(s => s.group === 'Bleu 1' || s.group === 'Rouge 1')).toBe(true);
  });

  it('blankCount is split by number of stages (stageCount = groups.length)', () => {
    // 2 stages → stageCount = 2 → blankCount = 16 each (no advancement condition)
    const result = mkSimultaneousFinals();
    const cards = scs(result.finals).filter(s => s.eventId === '333');
    // 2 covers × 16 blanks each = 32 blank scorecards
    expect(cards.length).toBe(32);
  });

  it('with ranking advancement: blankCount = ceil(level / stageCount)', () => {
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 8 } }),
      rSpec('a'),
    ]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]), cfg());
    // stageCount = 2 → blankCount = ceil(8/2) = 4 per stage
    const blanks = scs(result.finals).filter(s => s.eventId === '333');
    expect(blanks.length).toBe(8); // 2 stages × 4
  });
});

// Single-stage finals: numbered blank cards

describe('single-group single-stage finals', () => {
  // One group in one stage: event+round already identifies the stack, so the blanks are
  // numbered by station instead. Guards the `useStationNumbers` branch.
  function mkSingleStageFinals() {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    return parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
  }

  it('blank finals cards are numbered by station, not labeled "Group 1 of 1"', () => {
    const cards = scs(unimpose(mkSingleStageFinals().finals)).filter(s => s.eventId === '333');
    const groups = cards.map(s => s.group);
    expect(groups).toContain('Station 01');
    expect(groups).toContain('Station 02');
    expect(groups).not.toContain('Group 1 of 1');
    // Sequential and zero-padded across the whole blank run.
    expect(groups).toEqual(cards.map((_, i) => `Station ${String(i + 1).padStart(2, '0')}`));
  });
});

// Person filtering

describe('person filtering', () => {
  function singleGroupSetup(opts: PersonOpts = {}) {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const p = per(1, [{ aid: 100 }], opts);
    return parseWCIF(mkWCIF([e], [r], [p]), cfg());
  }

  it('pending registration is excluded', () => {
    const result = singleGroupSetup({ status: 'pending' });
    expect(scs(result.firstRound).length).toBe(0);
  });

  it('deleted registration is excluded', () => {
    const result = singleGroupSetup({ status: 'deleted' });
    expect(scs(result.firstRound).length).toBe(0);
  });

  it('accepted registration is included', () => {
    const result = singleGroupSetup({ status: 'accepted' });
    expect(scs(result.firstRound).length).toBe(1);
  });

  it('no wcaId → "New Competitor" in English', () => {
    const result = singleGroupSetup({ wcaId: null });
    expect(scs(result.firstRound)[0]?.wcaId).toBe('New Competitor');
  });

  it('no wcaId male → "Nouveau Compétiteur" in French', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const p = per(1, [{ aid: 100 }], { wcaId: null, gender: 'm' });
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg({ language: 'fr' }));
    expect(scs(result.firstRound)[0]?.wcaId).toBe('Nouveau Compétiteur');
  });

  it('no wcaId female → "Nouvelle Compétitrice" in French', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const p = per(1, [{ aid: 100 }], { wcaId: null, gender: 'f' });
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg({ language: 'fr' }));
    expect(scs(result.firstRound)[0]?.wcaId).toBe('Nouvelle Compétitrice');
  });

  it('333mbf competitor assignments are skipped (no named first-round cards)', () => {
    const c = ch(100, '333mbf', 1, 1);
    const e = evt('333mbf', [rSpec('2')]);
    const r = room('Stage', [act('333mbf', 1, [c])]);
    const p = per(1, [{ aid: 100 }]);
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg());
    expect(scs(result.firstRound).filter(s => s.eventId === '333mbf').length).toBe(0);
  });

  it('333mbf limit field is "H1b" regardless of WCIF timeLimit value', () => {
    const c2 = ch(101, '333mbf', 2, 1, '2024-01-01T14:00:00Z');
    const e = evt('333mbf', [rSpec('2', { limitCs: 36000 }), rSpec('2', { limitCs: 36000 })]);
    const r = room('Stage', [act('333mbf', 1, [ch(100, '333mbf', 1, 1)]), act('333mbf', 2, [c2])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(scs(result.finals)[0]?.limit).toBe('H1b');
  });
});

// Time limit flags

describe('time limit flags', () => {
  it('cumulative cumulativeRoundIds sets isCumulative = true', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a', { cumulative: ['333-r1'] })]);
    const r = room('Stage', [act('333', 1, [c])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    expect(scs(result.firstRound)[0]?.isCumulative).toBe(true);
  });

  it('empty cumulativeRoundIds: isCumulative = false', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    expect(scs(result.firstRound)[0]?.isCumulative).toBe(false);
  });

  it('null timeLimit: isCumulative = false and limit = ""', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a', { limitCs: null })]);
    const r = room('Stage', [act('333', 1, [c])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    const sc = scs(result.firstRound)[0];
    expect(sc?.isCumulative).toBe(false);
    expect(sc?.limit).toBe('');
  });
});

// Intermediate round modes

describe('intermediate round modes (3-round event, round 2)', () => {
  function mk3Round(mode: 'blanks' | 'prefilled', adv?: AdvancementCondition) {
    const e = evt('333', [
      rSpec('a', { adv: adv ?? null }),
      rSpec('a'),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z'), ch(111, '333', 2, 2, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    return parseWCIF(mkWCIF([e], [r], persons), cfg({ secondRoundMode: mode }));
  }

  it('blanks mode: intermediate scorecards have no names', () => {
    const result = mk3Round('blanks');
    expect(scs(result.intermediate).filter(s => s.eventId === '333').every(s => s.name === '')).toBe(true);
  });

  it('blanks mode: one cover per group', () => {
    const result = mk3Round('blanks');
    expect(cvs(result.intermediate).length).toBe(2);
  });

  it('prefilled mode: intermediate includes named round-1 participants', () => {
    const result = mk3Round('prefilled');
    const names = scs(result.intermediate).map(s => s.name);
    expect(names).toContain('P1');
    expect(names).toContain('P2');
  });

  it('prefilled mode: named cards carry a blank group placeholder "Group _ of 2"', () => {
    const result = mk3Round('prefilled');
    const named = scs(result.intermediate).filter(s => s.name !== '');
    expect(named.every(s => s.group === 'Group _ of 2')).toBe(true);
  });

  it('prefilled mode: cover cards exist - one per group', () => {
    const result = mk3Round('prefilled');
    expect(cvs(result.intermediate).length).toBe(2);
  });

  it('blanks mode with ranking advancement: blankCount = ceil(level / numGroups)', () => {
    // level=8, 2 groups → ceil(8/2) = 4 per group → 8 blanks
    const result = mk3Round('blanks', { type: 'ranking', level: 8 });
    expect(scs(result.intermediate).filter(s => s.eventId === '333').length).toBe(8);
  });

  it('prefilled simultaneous stages: covers labeled "Rouge 1"/"Bleu 1" with count divided by stages', () => {
    // 3-round event, round 2 runs simultaneously in rouge and bleu (g1 in both)
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 16 } }),
      rSpec('a'),
      rSpec('a'),
    ]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(121, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = Array.from({ length: 20 }, (_, i) => per(i + 1, [{ aid: 100 + (i % 2) }]));
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], persons), cfg({ secondRoundMode: 'prefilled' }));
    const cov = cvs(result.intermediate);
    // Two covers, one per stage, labeled with stage names
    expect(cov.length).toBe(2);
    const groups = cov.map(c => c.group).sort();
    expect(groups).toContain('Bleu 1');
    expect(groups).toContain('Rouge 1');
    // level=16, stageCount=2 → 8 each, sum = 16
    expect(cov.every(c => c.numScorecards === 8)).toBe(true);
  });

  it('prefilled: uneven qualifier count distributes remainder without overcounting', () => {
    // 17 qualifiers across 2 stages: one gets 9, the other 8 (total = 17, not 18)
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 17 } }),
      rSpec('a'),
      rSpec('a'),
    ]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(121, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]), cfg({ secondRoundMode: 'prefilled' }));
    const cov = cvs(result.intermediate);
    const counts = cov.map(c => c.numScorecards).sort((a, b) => a - b);
    // Totals must match the qualifier level exactly
    expect(counts.reduce((s, n) => s + n, 0)).toBe(17);
    // Distribution: one group gets floor(17/2)=8, one gets 9
    expect(counts).toEqual([8, 9]);
  });

  it('prefilled: 3 stages with non-multiple qualifier count', () => {
    // 17 qualifiers across 3 stages: [6, 6, 5] (sum = 17)
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 17 } }),
      rSpec('a'),
      rSpec('a'),
    ]);
    const mkStageRoom = (name: string, c1id: number, c2id: number, c3id: number) =>
      room(name, [
        act('333', 1, [ch(c1id, '333', 1, 1)]),
        act('333', 2, [ch(c2id, '333', 2, 1, '2024-01-01T12:00:00Z')]),
        act('333', 3, [ch(c3id, '333', 3, 1, '2024-01-01T16:00:00Z')]),
      ]);
    const rooms = [
      mkStageRoom('Scène Rouge', 100, 110, 120),
      mkStageRoom('Scène Bleu',  101, 111, 121),
      mkStageRoom('Scène Vert',  102, 112, 122),
    ];
    const result = parseWCIF(mkWCIF([e], rooms, [per(1, [{ aid: 100 }])]), cfg({ secondRoundMode: 'prefilled' }));
    const cov = cvs(result.intermediate);
    expect(cov.length).toBe(3);
    expect(cov.map(c => c.numScorecards).reduce((s, n) => s + n, 0)).toBe(17);
    // Sorted counts: [5, 6, 6]
    expect(cov.map(c => c.numScorecards).sort((a, b) => a - b)).toEqual([5, 6, 6]);
  });

  it('prefilled simultaneous stages: named cards use blank group divided by stageCount', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(121, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]), cfg({ secondRoundMode: 'prefilled' }));
    const named = scs(result.intermediate).filter(s => s.name !== '');
    // stageCount=2 → placeholder is "Group _ of 2"
    expect(named.every(s => s.group === 'Group _ of 2')).toBe(true);
  });

  it('blanks simultaneous stages: covers and cards labeled "Rouge 1"/"Bleu 1", count divided by stages', () => {
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 8 } }),
      rSpec('a'),
      rSpec('a'),
    ]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(121, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]), cfg({ secondRoundMode: 'blanks' }));
    const cov = cvs(result.intermediate);
    expect(cov.map(c => c.group).sort()).toEqual(['Bleu 1', 'Rouge 1']);
    // blankCount = ceil(8 / 2) = 4
    expect(cov.every(c => c.numScorecards === 4)).toBe(true);
    const blank = scs(result.intermediate).filter(s => s.eventId === '333');
    const groups = new Set(blank.map(s => s.group));
    expect(groups).toContain('Bleu 1');
    expect(groups).toContain('Rouge 1');
  });

  it('prefilled French language: blank group is "Groupe _ sur 2"', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z'), ch(111, '333', 2, 2, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg({ language: 'fr', secondRoundMode: 'prefilled' }));
    const named = scs(result.intermediate).filter(s => s.name !== '');
    expect(named.every(s => s.group === 'Groupe _ sur 2')).toBe(true);
  });
});

// Cover cards

describe('first-round cover cards', () => {
  it('numScorecards reflects actual participant count per group', () => {
    // 2 persons in g1, 1 in g2
    const c1 = ch(100, '333', 1, 1); const c2 = ch(101, '333', 1, 2);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c1, c2])]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 100 }]), per(3, [{ aid: 101 }])];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg());
    const cov = cvs(result.firstRound);
    expect(cov.find(c => c.group === 'Group 1 of 2')?.numScorecards).toBe(2);
    expect(cov.find(c => c.group === 'Group 2 of 2')?.numScorecards).toBe(1);
  });

  it('no participants in a group → no cover for that group', () => {
    // g1 has a person, g2 does not
    const c1 = ch(100, '333', 1, 1); const c2 = ch(101, '333', 1, 2);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c1, c2])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    const cov = cvs(result.firstRound);
    expect(cov.length).toBe(1);
    expect(cov[0]?.group).toBe('Group 1 of 2');
  });
});

// Simultaneous multi-stage semis

describe('simultaneous multi-stage semis', () => {
  // 4-round event, round 3 (semis) runs simultaneously in rouge and bleu (same g1)
  function mkSimultaneousSemis() {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a'), rSpec('a')]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T14:00:00Z')]),
      act('333', 4, [ch(130, '333', 4, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(121, '333', 3, 1, '2024-01-01T14:00:00Z')]),
      act('333', 4, [ch(131, '333', 4, 1, '2024-01-01T16:00:00Z')]),
    ]);
    return parseWCIF(mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]), cfg());
  }

  it('semis covers are labeled "Bleu 1" and "Rouge 1", not "Group 1 of 1"', () => {
    const result = mkSimultaneousSemis();
    const coverGroups = cvs(result.semis).map(e => e.group).sort();
    expect(coverGroups).toContain('Bleu 1');
    expect(coverGroups).toContain('Rouge 1');
    expect(coverGroups).not.toContain('Group 1 of 1');
  });

  it('semis blank cards carry the stage label', () => {
    const result = mkSimultaneousSemis();
    const cards = scs(result.semis).filter(s => s.eventId === '333');
    const groups = new Set(cards.map(s => s.group));
    expect(groups).toContain('Bleu 1');
    expect(groups).toContain('Rouge 1');
  });

  it('semis blankCount is split by number of stages', () => {
    const result = mkSimultaneousSemis();
    // 2 stages, 16 blanks each → 32 blank scorecards
    expect(scs(result.semis).filter(s => s.eventId === '333').length).toBe(32);
  });
});

// 4-round events (semis)

describe('4-round events - semi-finals bucket', () => {
  function mk4Round() {
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 16 } }),
      rSpec('a', { adv: { type: 'ranking', level: 8 } }),
      rSpec('a', { adv: { type: 'ranking', level: 4 } }),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T14:00:00Z')]),
      act('333', 4, [ch(130, '333', 4, 1, '2024-01-01T16:00:00Z')]),
    ]);
    return parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
  }

  it('semis bucket is non-empty', () => {
    expect(scs(mk4Round().semis).length).toBeGreaterThan(0);
  });

  it('round 3 of 4 goes to semis with correct round label', () => {
    const s = scs(mk4Round().semis).filter(s => s.eventId === '333');
    expect(s[0]?.roundLabel).toBe('Round 3 of 4');
  });

  it('round 4 of 4 goes to finals with "Final Round" label', () => {
    const s = scs(mk4Round().finals).filter(s => s.eventId === '333');
    expect(s[0]?.roundLabel).toBe('Final Round');
  });

  it('semis blankCount = ceil(prev-adv-level / numGroups)', () => {
    // prev round (r2) adv level=8, 1 group in semis → ceil(8/1) = 8
    const s = scs(mk4Round().semis).filter(s => s.eventId === '333');
    expect(s.length).toBe(8);
  });

  it('finals blankCount uses round-3 advancement (level=4, 1 group) → ceil(4/1) = 4', () => {
    const s = scs(mk4Round().finals).filter(s => s.eventId === '333');
    expect(s.length).toBe(4);
  });

  it('round 2 goes to intermediate, not semis', () => {
    const result = mk4Round();
    const intCards = [...scs(result.intermediate), ...cvs(result.intermediate)].filter(s => s.eventId === '333');
    const semisCards = scs(result.semis).filter(s => s.eventId === '333');
    expect(intCards.length).toBeGreaterThan(0);
    // intermediate cards are round 2 → "Round 2 of 4"
    expect([...scs(result.intermediate)].find(s => s.eventId === '333')?.roundLabel).toBe('Round 2 of 4');
    expect(semisCards[0]?.roundLabel).toBe('Round 3 of 4');
  });
});

// Cover-before-group ordering (cut-and-stack layout)

describe('cover-before-group ordering', () => {
  it('each cover immediately precedes its own group scorecards (not all covers first)', () => {
    // Simultaneous semis: Bleu 1 and Rouge 1 at the same timeslot, 2 blanks each.
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 4 } }),  // r1→r2
      rSpec('a', { adv: { type: 'ranking', level: 4 } }),  // r2→r3
      rSpec('a', { adv: { type: 'ranking', level: 4 } }),  // r3→r4 (semis, adv level=4 → blanks per stage = ceil(4/2) = 2)
      rSpec('a'),
    ]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T14:00:00Z')]),
      act('333', 4, [ch(130, '333', 4, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(121, '333', 3, 1, '2024-01-01T14:00:00Z')]),
      act('333', 4, [ch(131, '333', 4, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]), cfg());

    const semisReal = result.semis.filter(s => s.eventId === '333');

    const coverPositions = semisReal
      .map((e, i) => e.kind === 'cover' ? i : -1)
      .filter(i => i !== -1);

    // A cover is followed by its own group's scorecards, never by another cover.
    for (const pos of coverPositions) {
      const cover = semisReal[pos] as CoverEntry;
      const next = semisReal[pos + 1];
      // The card right after a cover must not be another cover.
      expect(next?.kind).not.toBe('cover');
      // If there is a next card, it must share the same group label.
      if (next) expect(next.group).toBe(cover.group);
    }
  });
});

// Timeslot ordering

describe('timeslot ordering', () => {
  it('scorecards are sorted by activity start time', () => {
    const early = ch(100, '333', 1, 1, '2024-01-01T09:00:00Z');
    const late  = ch(101, '222', 1, 1, '2024-01-01T10:00:00Z');
    const e333 = evt('333', [rSpec('a')]);
    const e222 = evt('222', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [early]), act('222', 1, [late])]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    const result = parseWCIF(mkWCIF([e333, e222], [r], persons), cfg());
    const all = scs(result.firstRound).filter(s => s.eventId === '333' || s.eventId === '222');
    const t333 = all.find(s => s.eventId === '333')?.timeslot ?? '';
    const t222 = all.find(s => s.eventId === '222')?.timeslot ?? '';
    expect(t333 < t222).toBe(true);
  });
});

// Extra scorecards

describe('extra scorecards', () => {
  it('one extra per round per event (two events, one round each)', () => {
    const e333 = evt('333', [rSpec('a')]);
    const e222 = evt('222', [rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('222', 1, [ch(101, '222', 1, 1)]),
    ]);
    const result = parseWCIF(mkWCIF([e333, e222], [r]), cfg());
    const extras = scs(result.extras);
    expect(extras.length).toBe(2);
    expect(extras.map(e => e.eventId).sort()).toEqual(['222', '333']);
  });

  it('two rounds per event: two extras per event', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-01T12:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    const extras = scs(result.extras);
    expect(extras.length).toBe(2);
    expect(extras[0]?.roundLabel).toBe('Round 1 of 2');
    expect(extras[1]?.roundLabel).toBe('Final Round');
  });

  it('single-group round: group label is "Group 1 of 1"', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(scs(result.extras)[0]?.group).toBe('Group 1 of 1');
  });

  it('multi-group round: group label is "Group _ of N"', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(scs(result.extras)[0]?.group).toBe('Group _ of 2');
  });

  it('French: single group → "Groupe 1 sur 1", multi-group → "Groupe _ sur N"', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg({ language: 'fr' }));
    const extras = scs(result.extras);
    expect(extras.find(e => e.roundLabel === 'Tour 1 sur 2')?.group).toBe('Groupe _ sur 2');
    expect(extras.find(e => e.roundLabel === 'Tour Final')?.group).toBe('Groupe 1 sur 1');
  });

  it('extras sorted by schedule order (round 2 before round 1 when scheduled earlier)', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 2, [ch(100, '333', 2, 1, '2024-01-01T09:00:00Z')]),
      act('333', 1, [ch(101, '333', 1, 1, '2024-01-01T11:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    const extras = scs(result.extras);
    // Round 2 starts earlier, so it comes first
    expect(extras[0]?.roundLabel).toBe('Final Round');
    expect(extras[1]?.roundLabel).toBe('Round 1 of 2');
  });

  it('extras is padded to a multiple of 4', () => {
    // 3 rounds: needs 1 extra padding → 4 total entries
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(102, '333', 3, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.extras.length % 4).toBe(0);
    expect(scs(result.extras).length).toBe(3);
  });

  it('333fm rounds are excluded from extras', () => {
    const eFm = evt('333fm', [rSpec('3')]);
    const e3  = evt('333',   [rSpec('a')]);
    const r = room('Stage', [
      act('333fm', 1, [ch(100, '333fm', 1, 1)]),
      act('333',   1, [ch(101, '333',   1, 1)]),
    ]);
    const result = parseWCIF(mkWCIF([eFm, e3], [r]), cfg());
    expect(scs(result.extras).every(e => e.eventId !== '333fm')).toBe(true);
  });

  it('extras carry correct format and cutoff from their round', () => {
    const e = evt('444', [rSpec('a', { cutoffCs: 6000, limitCs: 18000 }), rSpec('a')]);
    const r = room('Stage', [
      act('444', 1, [ch(100, '444', 1, 1)]),
      act('444', 2, [ch(101, '444', 2, 1, '2024-01-01T12:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    const r1Extra = scs(result.extras).find(e => e.roundLabel === 'Round 1 of 2');
    expect(r1Extra?.format).toBe('bo2-avg5');
    expect(r1Extra?.cutoff).toBe('1:00');
  });
});

// Schedule tracker

describe('schedule tracker', () => {
  it('one room produces one day with one stage', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.scheduleDays.length).toBe(1);
    expect(result.scheduleDays[0]?.stages.length).toBe(1);
    expect(result.scheduleDays[0]?.stages[0]?.stageName).toBe('Stage');
  });

  it('two rooms on the same day produce one day with two stages', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const rA = room('Stage A', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const rB = room('Stage B', [act('333', 2, [ch(101, '333', 2, 1)])]);
    const result = parseWCIF(mkWCIF([e], [rA, rB]), cfg());
    expect(result.scheduleDays.length).toBe(1);
    expect(result.scheduleDays[0]?.stages.length).toBe(2);
    expect(result.scheduleDays[0]?.stages[0]?.stageName).toBe('Stage A');
    expect(result.scheduleDays[0]?.stages[1]?.stageName).toBe('Stage B');
  });

  it('single-day competition: one day entry with all rows in its stage', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(102, '333', 3, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.scheduleDays.length).toBe(1);
    expect(result.scheduleDays[0]?.stages[0]?.rows.length).toBe(3);
  });

  it('multi-day competition: one scheduleDays entry per calendar day', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-02T09:00:00Z')]),
      act('333', 3, [ch(102, '333', 3, 1, '2024-01-03T09:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.scheduleDays.length).toBe(3);
    expect(result.scheduleDays[0]?.stages[0]?.rows.length).toBe(1);
    expect(result.scheduleDays[1]?.stages[0]?.rows.length).toBe(1);
    expect(result.scheduleDays[2]?.stages[0]?.rows.length).toBe(1);
  });

  it('day labels include day number and weekday', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-02T09:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    const labels = result.scheduleDays.map(d => d.dayLabel);
    expect(labels[0]).toMatch(/^Day 1/);
    expect(labels[1]).toMatch(/^Day 2/);
    expect(labels[0]).toContain('-');
  });

  it('eventRound uses the selected language for event names and round labels', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg({ language: 'fr' }));
    expect(result.scheduleDays[0]?.stages[0]?.rows[0]?.eventRound).toContain('Cube 3x3x3');
    expect(result.scheduleDays[0]?.stages[0]?.rows[0]?.eventRound).toContain('Final');
  });

  it('French: eventRound uses "Tour N" for intermediate and "Final" for last', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(102, '333', 3, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg({ language: 'fr' }));
    const rows = result.scheduleDays[0]?.stages[0]?.rows ?? [];
    expect(rows[0]?.eventRound).toBe('Cube 3x3x3 Tour 1');
    expect(rows[1]?.eventRound).toBe('Cube 3x3x3 Tour 2');
    expect(rows[2]?.eventRound).toBe('Cube 3x3x3 Final');
  });

  it('single-round event uses "Final" label in eventRound', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.scheduleDays[0]?.stages[0]?.rows[0]?.eventRound).toBe('3x3x3 Cube Final');
  });

  it('multi-round event: intermediate rounds use "Round N" and last uses "Final"', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(102, '333', 3, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    const rows = result.scheduleDays[0]?.stages[0]?.rows ?? [];
    expect(rows[0]?.eventRound).toBe('3x3x3 Cube Round 1');
    expect(rows[1]?.eventRound).toBe('3x3x3 Cube Round 2');
    expect(rows[2]?.eventRound).toBe('3x3x3 Cube Final');
  });

  it('rows within a day are sorted by activity start time', () => {
    const e333 = evt('333', [rSpec('a')]);
    const e222 = evt('222', [rSpec('a')]);
    // 222 starts earlier but appears second in room.activities
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T11:00:00Z')]),
      act('222', 1, [ch(101, '222', 1, 1, '2024-01-01T09:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e333, e222], [r]), cfg());
    const rows = result.scheduleDays[0]?.stages[0]?.rows ?? [];
    expect(rows[0]?.eventRound).toContain('2x2x2');
    expect(rows[1]?.eventRound).toContain('3x3x3');
  });

  it('scheduleDays are sorted chronologically', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    // Day 2 activity appears before Day 1 in room.activities
    const r = room('Stage', [
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-02T09:00:00Z')]),
      act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.scheduleDays[0]?.dayLabel).toMatch(/Day 1/);
    expect(result.scheduleDays[1]?.dayLabel).toMatch(/Day 2/);
  });

  it('333fm appears in schedule tracker (not excluded)', () => {
    const eFm = evt('333fm', [rSpec('3')]);
    const r = room('Stage', [act('333fm', 1, [ch(100, '333fm', 1, 1)])]);
    const result = parseWCIF(mkWCIF([eFm], [r]), cfg());
    const rows = result.scheduleDays[0]?.stages[0]?.rows ?? [];
    expect(rows.some(row => row.eventRound.includes('FMC'))).toBe(true);
  });

  it('non-event activities (activityCode not matching eventId-rN) are excluded', () => {
    const e = evt('333', [rSpec('a')]);
    const miscActivity = {
      id: uid(), name: 'Lunch', activityCode: 'other-lunch',
      startTime: '2024-01-01T12:00:00Z', endTime: '2024-01-01T13:00:00Z',
      childActivities: [], scrambleSets: [],
    };
    const r: Room = {
      id: uid(), name: 'Stage', color: '#fff',
      activities: [act('333', 1, [ch(100, '333', 1, 1)]), miscActivity],
    };
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.scheduleDays[0]?.stages[0]?.rows.length).toBe(1);
  });

  it('day numbering is shared across all rooms (Day 1 = earliest date in whole comp)', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    // Stage A only has Day 2 events; Stage B only has Day 1 events.
    const rA = room('Stage A', [act('333', 2, [ch(101, '333', 2, 1, '2024-01-02T09:00:00Z')])]);
    const rB = room('Stage B', [act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')])]);
    const result = parseWCIF(mkWCIF([e], [rA, rB]), cfg());
    // Day 1 (earliest date) contains Stage B's activity
    expect(result.scheduleDays[0]?.dayLabel).toMatch(/Day 1/);
    expect(result.scheduleDays[0]?.stages[0]?.stageName).toBe('Stage B');
    // Day 2 contains Stage A's activity (not mislabeled as Day 1)
    expect(result.scheduleDays[1]?.dayLabel).toMatch(/Day 2/);
    expect(result.scheduleDays[1]?.stages[0]?.stageName).toBe('Stage A');
  });
});

// Spanish language support
describe('group overview', () => {
  // Two rooms so the multi-stage heading and the room column both get exercised.
  function mkOverview() {
    const events = [evt('333' as EventId, [rSpec('a'), rSpec('a')]), evt('222' as EventId, [rSpec('a')])];
    const g1 = ch(101, '333', 1, 1, '2024-01-01T09:00:00Z');
    const g2 = ch(102, '333', 1, 2, '2024-01-01T10:00:00Z');
    const g3 = ch(103, '222', 1, 1, '2024-01-01T11:00:00Z');
    const rooms = [
      room('Main Stage', [act('333', 1, [g1, g2])]),
      room('Side Stage', [act('222', 1, [g3])]),
    ];
    const persons = [
      per(1, [{ aid: 101, station: 3 }], { name: 'Carol', staff: { 'staff-judge': [102] } }),
      per(2, [{ aid: 101, station: 1 }], { name: 'Alice', staff: { 'staff-scrambler': [102], 'staff-runner': [103] } }),
      per(3, [{ aid: 101, station: 2 }], { name: 'Bob',   staff: { 'staff-judge': [102] } }),
    ];
    return parseWCIF(mkWCIF(events, rooms, persons), cfg());
  }

  it('lists one entry per scheduled group, chronologically', () => {
    const go = mkOverview().groupOverview;
    expect(go.map(e => e.heading)).toEqual([
      '3x3x3 Cube Round 1 - Group 1',
      '3x3x3 Cube Round 1 - Group 2',
      '2x2x2 Cube Final - Group 1',
    ]);
  });

  it('puts each assignment in its own column', () => {
    const g2 = mkOverview().groupOverview[1];
    expect(g2.competitors).toEqual([]);
    expect(g2.scramblers).toEqual(['Alice']);
    expect(g2.judges).toEqual(['Bob', 'Carol']);
    expect(g2.runners).toEqual([]);
  });

  it('orders competitors by station number, not alphabetically', () => {
    // Alice/Bob/Carol sit at stations 1/2/3, so alphabetical order would hide the bug.
    expect(mkOverview().groupOverview[0].competitors).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('sorts staff alphabetically', () => {
    expect(mkOverview().groupOverview[1].judges).toEqual(['Bob', 'Carol']);
  });

  it('carries each group\'s own room name', () => {
    const go = mkOverview().groupOverview;
    expect(go.map(e => e.room)).toEqual(['Main Stage', 'Main Stage', 'Side Stage']);
  });

  it('keeps a group with no staff, so the competitor list still prints', () => {
    const go = mkOverview().groupOverview;
    expect(go[2].competitors).toEqual([]);
    expect(go[2].runners).toEqual(['Alice']);
  });

  it('qualifies the group label with the stage when a round spans rooms', () => {
    const events = [evt('333' as EventId, [rSpec('a')])];
    const red  = ch(201, '333', 1, 1, '2024-01-01T09:00:00Z');
    const blue = ch(202, '333', 1, 1, '2024-01-01T09:00:00Z');
    const rooms = [room('Red Stage', [act('333', 1, [red])]), room('Blue Stage', [act('333', 1, [blue])])];
    const persons = [per(1, [{ aid: 201 }], { name: 'Alice' }), per(2, [{ aid: 202 }], { name: 'Bob' })];
    const go = parseWCIF(mkWCIF(events, rooms, persons), cfg()).groupOverview;
    expect(go.map(e => e.heading)).toEqual([
      '3x3x3 Cube Final - Group 1 (Red)',
      '3x3x3 Cube Final - Group 1 (Blue)',
    ]);
  });

  it('drops a scheduled final nobody is assigned to yet', () => {
    // Regression: finals are scheduled with REAL group child activities from day one, so
    // the synthetic-unit check never saw them and they printed as four empty columns.
    const events = [evt('333' as EventId, [rSpec('a'), rSpec('a')])];
    const r1 = ch(401, '333', 1, 1, '2024-01-01T09:00:00Z');
    const fin = ch(402, '333', 2, 1, '2024-01-01T13:00:00Z');
    const rooms = [room('Main Stage', [act('333', 1, [r1]), act('333', 2, [fin])])];
    const go = parseWCIF(mkWCIF(events, rooms, [per(1, [{ aid: 401 }])]), cfg()).groupOverview;
    expect(go.map(e => e.heading)).toEqual(['3x3x3 Cube Round 1 - Group 1']);
  });

  it('keeps a final once its groups are assigned', () => {
    const events = [evt('333' as EventId, [rSpec('a'), rSpec('a')])];
    const r1 = ch(501, '333', 1, 1, '2024-01-01T09:00:00Z');
    const fin = ch(502, '333', 2, 1, '2024-01-01T13:00:00Z');
    const rooms = [room('Main Stage', [act('333', 1, [r1]), act('333', 2, [fin])])];
    const persons = [per(1, [{ aid: 501 }, { aid: 502 }], { name: 'Alice' })];
    const go = parseWCIF(mkWCIF(events, rooms, persons), cfg()).groupOverview;
    expect(go.map(e => e.heading)).toEqual([
      '3x3x3 Cube Round 1 - Group 1',
      '3x3x3 Cube Final - Group 1',
    ]);
  });

  // Staff are sometimes assigned to a round before its competitors are, so "empty" means
  // nobody at all, not "no competitors".
  it('keeps a group that has staff but no competitors', () => {
    const events = [evt('333' as EventId, [rSpec('a')])];
    const g1 = ch(601, '333', 1, 1, '2024-01-01T09:00:00Z');
    const rooms = [room('Main Stage', [act('333', 1, [g1])])];
    const persons = [per(1, [], { name: 'Alice', staff: { 'staff-judge': [601] } })];
    const go = parseWCIF(mkWCIF(events, rooms, persons), cfg()).groupOverview;
    expect(go).toHaveLength(1);
    expect(go[0].competitors).toEqual([]);
    expect(go[0].judges).toEqual(['Alice']);
  });

  it('skips synthesized later-round groups - they carry no assignments', () => {
    // Round 2 scheduled as a bare time block: groupUnitsOf synthesizes groups for the
    // scorecards, but a block of four empty columns is not worth a page.
    const events = [evt('333' as EventId, [rSpec('a', { adv: { type: 'ranking', level: 2 } }), rSpec('a', { sets: 2 })])];
    const g1 = ch(301, '333', 1, 1, '2024-01-01T09:00:00Z');
    const bare: Activity = {
      id: 999, name: '', activityCode: '333-r2',
      startTime: '2024-01-01T13:00:00Z', endTime: '2024-01-01T14:00:00Z',
      childActivities: [], scrambleSets: [],
    };
    const rooms = [room('Main Stage', [act('333', 1, [g1]), bare])];
    const go = parseWCIF(mkWCIF(events, rooms, [per(1, [{ aid: 301 }])]), cfg()).groupOverview;
    expect(go.map(e => e.roundNum)).toEqual([1]);
  });

  it('is empty when the schedule has no groups yet', () => {
    const events = [evt('333' as EventId, [rSpec('a')])];
    const bare: Activity = {
      id: 998, name: '', activityCode: '333-r1',
      startTime: '2024-01-01T09:00:00Z', endTime: '2024-01-01T10:00:00Z',
      childActivities: [], scrambleSets: [],
    };
    expect(parseWCIF(mkWCIF(events, [room('Main Stage', [bare])], []), cfg()).groupOverview)
      .toEqual([]);
  });
});

describe('Spanish language', () => {
  it('no wcaId male → "Nuevo Competidor" in Spanish', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const p = per(1, [{ aid: 100 }], { wcaId: null, gender: 'm' });
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg({ language: 'es' }));
    expect(scs(result.firstRound)[0]?.wcaId).toBe('Nuevo Competidor');
  });

  it('no wcaId female → "Nueva Competidora" in Spanish', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const p = per(1, [{ aid: 100 }], { wcaId: null, gender: 'f' });
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg({ language: 'es' }));
    expect(scs(result.firstRound)[0]?.wcaId).toBe('Nueva Competidora');
  });

  it('round label uses Spanish "Ronda N de M" / "Ronda Final"', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const c1 = ch(100, '333', 1, 1);
    const c2 = ch(101, '333', 2, 1);
    const c3 = ch(102, '333', 3, 1);
    const r = room('Stage', [act('333', 1, [c1]), act('333', 2, [c2]), act('333', 3, [c3])]);
    const p = per(1, [{ aid: 100 }, { aid: 101 }, { aid: 102 }]);
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg({ language: 'es' }));
    const round1 = scs(result.firstRound);
    const round2 = scs(result.intermediate);
    const finals = scs(result.finals);
    expect(round1[0]?.roundLabel).toBe('Ronda 1 de 3');
    expect(round2[0]?.roundLabel).toBe('Ronda 2 de 3');
    expect(finals[0]?.roundLabel).toBe('Ronda Final');
  });

  it('event name uses Spanish for "es" language', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const p = per(1, [{ aid: 100 }]);
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg({ language: 'es' }));
    expect(scs(result.firstRound)[0]?.eventName).toBe('Cubo 3x3x3');
  });

  it('group label uses Spanish "Grupo N de M"', () => {
    const c1 = ch(100, '333', 1, 1);
    const c2 = ch(101, '333', 1, 2);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c1, c2])]);
    const p = per(1, [{ aid: 100 }]);
    const result = parseWCIF(mkWCIF([e], [r], [p]), cfg({ language: 'es' }));
    expect(scs(result.firstRound)[0]?.group).toBe('Grupo 1 de 2');
  });

  it('blank group label uses Spanish "Grupo _ de N" (prefilled mode)', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z'), ch(111, '333', 2, 2, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg({ language: 'es', secondRoundMode: 'prefilled' }));
    const named = scs(result.intermediate).filter(s => s.name !== '');
    expect(named.every(s => s.group === 'Grupo _ de 2')).toBe(true);
  });
});

// Nametag entries

describe('nametag entries', () => {
  function mkNametag(registrantId: number, wcaUserId: number, wcaRegistrationId = 1385268): NametTagEntry[] {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const p: Person = {
      registrantId, name: `Person ${registrantId}`,
      wcaUserId, wcaId: `2024T${registrantId}`,
      countryIso2: 'FR', gender: 'm',
      registration: { wcaRegistrationId, eventIds: ['333'], status: 'accepted', isCompeting: true },
      avatar: null, roles: [], personalBests: [],
      assignments: [{ activityId: 100, assignmentCode: 'competitor', stationNumber: null }],
    };
    return parseWCIF(mkWCIF([e], [r], [p]), cfg()).nametags;
  }

  it('registrantId on nametag matches WCIF person registrantId', () => {
    const tags = mkNametag(42, 99999);
    expect(tags[0]?.registrantId).toBe(42);
  });

  it('wcaUserId on nametag matches WCIF person wcaUserId', () => {
    const tags = mkNametag(42, 99999);
    expect(tags[0]?.wcaUserId).toBe(99999);
  });

  it('registrationId on nametag matches WCIF registration.wcaRegistrationId', () => {
    const tags = mkNametag(42, 99999, 1385268);
    expect(tags[0]?.registrationId).toBe(1385268);
  });

  it('the three ids are kept separate - they are different numbers', () => {
    // registrantId keys wcaLivePersonIds for a WCA Live person URL, and is what scoretakers type.
    // wcaUserId is the WCA website account ID, used by neither URL.
    // registrationId is the global registration row id, the one in an ILR competitor URL.
    const tags = mkNametag(5, 916687, 1385268);
    expect(tags[0]?.registrantId).toBe(5);
    expect(tags[0]?.wcaUserId).toBe(916687);
    expect(tags[0]?.registrationId).toBe(1385268);
  });

  it('pending persons are excluded from nametags', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const accepted = per(1, [{ aid: 100 }]);
    const pending  = per(2, [],           { status: 'pending' });
    const result = parseWCIF(mkWCIF([e], [r], [accepted, pending]), cfg());
    expect(result.nametags.length).toBe(1);
    expect(result.nametags[0]?.registrantId).toBe(1);
  });

  it('role field: delegate, organizer, new-competitor, competitor', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const delegate  = { ...per(1, [{ aid: 100 }]), roles: ['delegate'] };
    const organizer = { ...per(2, [{ aid: 100 }]), roles: ['organizer'] };
    const newComp   = { ...per(3, [{ aid: 100 }]), wcaId: null } as ReturnType<typeof per>;
    const comp      = per(4, [{ aid: 100 }]);
    const result = parseWCIF(mkWCIF([e], [r], [delegate, organizer, newComp, comp]), cfg());
    const byId = Object.fromEntries(result.nametags.map(t => [t.registrantId, t]));
    expect(byId[1]?.role).toBe('delegate');
    expect(byId[2]?.role).toBe('organizer');
    expect(byId[3]?.role).toBe('new-competitor');
    expect(byId[4]?.role).toBe('competitor');
  });

  it('Spanish nametag titles use correct gender-aware Spanish strings', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const male   = per(1, [{ aid: 100 }], { gender: 'm' });
    const female = per(2, [{ aid: 100 }], { gender: 'f' });
    const result = parseWCIF(mkWCIF([e], [r], [male, female]), cfg({ language: 'es' }));
    const byId = Object.fromEntries(result.nametags.map(t => [t.registrantId, t]));
    expect(byId[1]?.titleFront).toBe('COMPETIDOR');
    expect(byId[1]?.titleBack).toBe('COMPETIDOR');
    expect(byId[2]?.titleFront).toBe('COMPETIDORA');
    expect(byId[2]?.titleBack).toBe('COMPETIDORA');
  });

  it('primary FR + secondary EN nametag: titleFront=FR, titleBack=EN', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const male = per(1, [{ aid: 100 }], { gender: 'm' });
    const result = parseWCIF(mkWCIF([e], [r], [male]), cfg({ language: 'fr', secondaryLanguage: 'en' }));
    expect(result.nametags[0]?.titleFront).toBe('COMPÉTITEUR');
    expect(result.nametags[0]?.titleBack).toBe('COMPETITOR');
  });

  it('arbitrary pair FR + ES nametag: titleFront=FR, titleBack=ES', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const female = per(2, [{ aid: 100 }], { gender: 'f' });
    const result = parseWCIF(mkWCIF([e], [r], [female]), cfg({ language: 'fr', secondaryLanguage: 'es' }));
    expect(result.nametags[0]?.titleFront).toBe('COMPÉTITRICE');
    expect(result.nametags[0]?.titleBack).toBe('COMPETIDORA');
  });

  it('French delegate female gets DÉLÉGUÉE on nametag', () => {
    const c = ch(100, '333', 1, 1);
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [c])]);
    const delegate = { ...per(1, [{ aid: 100 }], { gender: 'f' }), roles: ['delegate'] };
    const result = parseWCIF(mkWCIF([e], [r], [delegate]), cfg({ language: 'fr' }));
    expect(result.nametags[0]?.titleFront).toBe('DÉLÉGUÉE');
  });
});

describe('first-timer entries', () => {
  const c = ch(100, '333', 1, 1);
  const e = evt('333', [rSpec('a')]);
  const r = room('Stage', [act('333', 1, [c])]);

  // A newcomer = accepted registrant with no WCA ID.
  function newcomer(id: number, name: string, birthdate?: string) {
    return { ...per(id, [{ aid: 100 }], { name, wcaId: null }), birthdate };
  }

  it('includes accepted registrants with no WCA ID, and excludes returning competitors', () => {
    const returning = per(1, [{ aid: 100 }], { name: 'Returning', wcaId: '2019TEST01' });
    const result = parseWCIF(mkWCIF([e], [r], [returning, newcomer(2, 'Newbie')]), cfg());
    expect(result.firstTimers.map(f => f.name)).toEqual(['Newbie']);
  });

  it('excludes pending newcomers', () => {
    const pending = { ...per(2, [], { name: 'Pending', wcaId: null, status: 'pending' }) };
    const result = parseWCIF(mkWCIF([e], [r], [pending]), cfg());
    expect(result.firstTimers).toHaveLength(0);
  });

  it('strips a local name in parentheses', () => {
    const result = parseWCIF(mkWCIF([e], [r], [newcomer(2, 'Yuki Tanaka (田中 雪)')]), cfg());
    expect(result.firstTimers[0]?.name).toBe('Yuki Tanaka');
  });

  it('sorts newcomers alphabetically by name', () => {
    const persons = [newcomer(3, 'Charlie'), newcomer(1, 'Alice'), newcomer(2, 'bob')];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg());
    expect(result.firstTimers.map(f => f.name)).toEqual(['Alice', 'bob', 'Charlie']);
  });

  it('carries birthdate through when present and leaves it null when absent', () => {
    const persons = [newcomer(1, 'Has DOB', '2015-01-13'), newcomer(2, 'No DOB')];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg());
    const byName = Object.fromEntries(result.firstTimers.map(f => [f.name, f]));
    expect(byName['Has DOB']?.birthdate).toBe('2015-01-13');
    expect(byName['No DOB']?.birthdate ?? null).toBeNull();
  });

  it('captures country and registered events', () => {
    const result = parseWCIF(mkWCIF([e], [r], [newcomer(2, 'Newbie')]), cfg());
    expect(result.firstTimers[0]?.countryIso2).toBe('FR');
    expect(result.firstTimers[0]?.eventIds).toEqual(['333']);
  });
});

// Scramble double-checking
describe('Scramble double-checking', () => {
  // 2-round event: round 1 (named) + finals (blank).
  function mk2Round(settings: Partial<CompetitionSettings>) {
    const e = evt('333', [rSpec('a', { adv: { type: 'ranking', level: 8 } }), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }], { wcaId: '2015FOOB01' })];
    return parseWCIF(mkWCIF([e], [r], persons), cfg(settings));
  }

  it('disabled by default: no card is flagged', () => {
    const result = mk2Round({ scrambleDoubleCheck: false });
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
    expect(scs(result.finals).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('round rule: enabling with default Finals flags finals but not round 1', () => {
    const result = mk2Round({ scrambleDoubleCheck: true, scrambleDoubleCheckRounds: ['finals'] });
    expect(scs(result.finals).every(s => s.scrambleDoubleCheck)).toBe(true);
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('round rule: selecting firstRound flags round-1 cards', () => {
    const result = mk2Round({ scrambleDoubleCheck: true, scrambleDoubleCheckRounds: ['firstRound'] });
    expect(scs(result.firstRound).every(s => s.scrambleDoubleCheck)).toBe(true);
  });

  it('override rule: flags a named round-1 card by WCA ID + event, regardless of round selection', () => {
    const result = mk2Round({
      scrambleDoubleCheck: true,
      scrambleDoubleCheckRounds: [], // no round selected
      scrambleDoubleCheckOverrides: { '2015FOOB01': ['333'] },
    });
    expect(scs(result.firstRound).every(s => s.scrambleDoubleCheck)).toBe(true);
  });

  it('override rule: event mismatch does not flag the card', () => {
    const result = mk2Round({
      scrambleDoubleCheck: true,
      scrambleDoubleCheckRounds: [],
      scrambleDoubleCheckOverrides: { '2015FOOB01': ['444'] },
    });
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('override rule does not affect blank later-round cards (no WCA ID)', () => {
    const result = mk2Round({
      scrambleDoubleCheck: true,
      scrambleDoubleCheckRounds: [],
      scrambleDoubleCheckOverrides: { '2015FOOB01': ['333'] },
    });
    expect(scs(result.finals).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  // Ranking rules (regulation 11i)
  // A personal best with only the ranking that matters set; the rest are 0 (unranked).
  function pb(
    type: 'single' | 'average',
    ranks: { world?: number; continental?: number; national?: number },
    eventId = '333',
  ): PersonalBest {
    return {
      eventId: eventId as EventId, value: 700, type,
      worldRanking: ranks.world ?? 0,
      continentalRanking: ranks.continental ?? 0,
      nationalRanking: ranks.national ?? 0,
    };
  }

  // Same 2-round event as mk2Round, with personal bests on the round-1 competitor.
  function mkRanked(bests: PersonalBest[], settings: Partial<CompetitionSettings>) {
    const e = evt('333', [rSpec('a', { adv: { type: 'ranking', level: 8 } }), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }], { wcaId: '2015FOOB01', personalBests: bests })];
    return parseWCIF(mkWCIF([e], [r], persons), cfg({
      scrambleDoubleCheck: true, scrambleDoubleCheckRounds: [], ...settings,
    }));
  }

  it('world rule: a top-50 competitor is flagged with no round selected', () => {
    const result = mkRanked([pb('single', { world: 30 })], { scrambleDoubleCheckWorldTop: 50 });
    expect(scs(result.firstRound).every(s => s.scrambleDoubleCheck)).toBe(true);
  });

  it('world rule: a rank outside the threshold is not flagged', () => {
    const result = mkRanked([pb('single', { world: 51 })], { scrambleDoubleCheckWorldTop: 50 });
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('world rule: a top-50 best in another event does not flag this card', () => {
    const result = mkRanked([pb('single', { world: 3 }, '444')], { scrambleDoubleCheckWorldTop: 50 });
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('world rule: an average best counts too (11i1b), not only the single', () => {
    const result = mkRanked([pb('average', { world: 12 })], { scrambleDoubleCheckWorldTop: 50 });
    expect(scs(result.firstRound).every(s => s.scrambleDoubleCheck)).toBe(true);
  });

  it('regional rule: the national record holder is flagged even when far outside the world top', () => {
    const result = mkRanked([pb('single', { world: 900, national: 1 })], {
      scrambleDoubleCheckWorldTop: 50,
      scrambleDoubleCheckRegionTop: 1,
      scrambleDoubleCheckRegionScope: 'national',
    });
    expect(scs(result.firstRound).every(s => s.scrambleDoubleCheck)).toBe(true);
  });

  it('regional rule: the continental scope reads the continental ranking, not the national one', () => {
    const bests = [pb('single', { world: 900, national: 1, continental: 40 })];
    const flagged = (settings: Partial<CompetitionSettings>) =>
      scs(mkRanked(bests, settings).firstRound).some(s => s.scrambleDoubleCheck);
    const base = { scrambleDoubleCheckWorldTop: null, scrambleDoubleCheckRegionTop: 1 } as const;
    expect(flagged({ ...base, scrambleDoubleCheckRegionScope: 'continental' })).toBe(false);
    expect(flagged({ ...base, scrambleDoubleCheckRegionScope: 'national' })).toBe(true);
  });

  it('both thresholds null: a world-number-one is not flagged', () => {
    const result = mkRanked([pb('single', { world: 1, national: 1 })], {
      scrambleDoubleCheckWorldTop: null, scrambleDoubleCheckRegionTop: null,
    });
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('an unranked (0) personal best is never inside a threshold', () => {
    const result = mkRanked([pb('single', {})], {
      scrambleDoubleCheckWorldTop: 50, scrambleDoubleCheckRegionTop: 1,
    });
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('ranking rules do not flag blank later-round cards (no WCA ID)', () => {
    const result = mkRanked([pb('single', { world: 1 })], { scrambleDoubleCheckWorldTop: 50 });
    expect(scs(result.finals).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('a newcomer with no WCA ID and no bests is never flagged', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const persons = [per(1, [{ aid: 100 }], { wcaId: null })];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg({
      scrambleDoubleCheck: true, scrambleDoubleCheckRounds: [], scrambleDoubleCheckWorldTop: 50,
    }));
    expect(scs(result.firstRound).some(s => s.scrambleDoubleCheck)).toBe(false);
  });

  it('single-round event: its only round counts as a final for the Finals selection', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const persons = [per(1, [{ aid: 100 }], { wcaId: '2015FOOB01' })];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg({
      scrambleDoubleCheck: true, scrambleDoubleCheckRounds: ['finals'],
    }));
    expect(scs(result.firstRound).every(s => s.scrambleDoubleCheck)).toBe(true);
  });
});

// Mid-competition: real group assignments for rounds 2+
describe('mid-competition named later rounds', () => {
  // 3-round 333; both competitors are assigned to BOTH round 1 and round 2 groups
  // (groups generated mid-competition). aid 110/111 are the two round-2 groups.
  function mk3RoundWithR2(mode: 'blanks' | 'prefilled' = 'blanks') {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z'), ch(111, '333', 2, 2, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = [
      per(1, [{ aid: 100 }, { aid: 110 }]),
      per(2, [{ aid: 101 }, { aid: 111 }]),
    ];
    return parseWCIF(mkWCIF([e], [r], persons), cfg({ secondRoundMode: mode }));
  }

  it('emits named round-2 scorecards with real group labels (not the blank placeholder)', () => {
    const result = mk3RoundWithR2('prefilled');
    const named = scs(result.intermediate).filter(s => s.name !== '');
    expect(named.map(s => s.name).sort()).toEqual(['P1', 'P2']);
    expect(named.map(s => s.group).sort()).toEqual(['Group 1 of 2', 'Group 2 of 2']);
    expect(named.every(s => s.group !== 'Group _ of 2')).toBe(true);
  });

  it('does not also emit blank/prefilled duplicates for the assigned round', () => {
    // Only the two real competitors → exactly 2 scorecards (no 16-blank padding rows).
    const result = mk3RoundWithR2('blanks');
    const cards = scs(result.intermediate).filter(s => s.eventId === '333');
    expect(cards.length).toBe(2);
    expect(cards.every(s => s.name !== '')).toBe(true);
  });

  it('reports the assigned round in laterRoundsWithAssignments', () => {
    const result = mk3RoundWithR2();
    expect(result.laterRoundsWithAssignments).toEqual([{ eventId: '333', roundNum: 2 }]);
  });

  it('tags every scorecard/cover with its roundNum', () => {
    const result = mk3RoundWithR2();
    expect(scs(result.firstRound).every(s => s.roundNum === 1)).toBe(true);
    expect([...scs(result.intermediate), ...cvs(result.intermediate)].every(e => e.roundNum === 2)).toBe(true);
  });

  it('emits a cover per assigned round-2 group', () => {
    const result = mk3RoundWithR2();
    const cov = cvs(result.intermediate);
    expect(cov.length).toBe(2);
    expect(cov.map(c => c.group).sort()).toEqual(['Group 1 of 2', 'Group 2 of 2']);
    expect(cov.every(c => c.numScorecards === 1)).toBe(true);
  });

  it('2-round event: an assigned round 2 produces named cards in the finals bucket', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }, { aid: 110 }])];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg());
    const named = scs(result.finals).filter(s => s.name !== '');
    expect(named.length).toBe(1);
    expect(named[0]?.name).toBe('P1');
    expect(named[0]?.roundLabel).toBe('Final Round');
    expect(result.intermediate.length).toBe(0);
    expect(result.laterRoundsWithAssignments).toEqual([{ eventId: '333', roundNum: 2 }]);
  });

  it('4-round event: an assigned round 3 produces named cards in the semis bucket', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T15:00:00Z')]),
      act('333', 4, [ch(130, '333', 4, 1, '2024-01-01T18:00:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }, { aid: 120 }])];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg());
    const named = scs(result.semis).filter(s => s.name !== '');
    expect(named.length).toBe(1);
    expect(named[0]?.name).toBe('P1');
    expect(named[0]?.roundNum).toBe(3);
    expect(result.laterRoundsWithAssignments).toEqual([{ eventId: '333', roundNum: 3 }]);
  });

  it('regression: an unassigned round 2 still produces prefilled/blank output (no behaviour change)', () => {
    // Competitors only assigned to round 1 - the normal pre-competition WCIF.
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z'), ch(111, '333', 2, 2, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    const result = parseWCIF(mkWCIF([e], [r], persons), cfg({ secondRoundMode: 'prefilled' }));
    const named = scs(result.intermediate).filter(s => s.name !== '');
    expect(named.every(s => s.group === 'Group _ of 2')).toBe(true);
    expect(result.laterRoundsWithAssignments).toEqual([]);
  });
});

describe('hasGroups', () => {
  it('is true when the schedule has group child-activities', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    expect(result.hasGroups).toBe(true);
  });

  it('is false for a pre-competition WCIF with no groups generated', () => {
    // Round activity exists but no group children - groups not yet assigned.
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.hasGroups).toBe(false);
  });
});

// Regression: UtepsaWelcomeSCZ2026 scheduled R2 and the final as bare time blocks, so no
// cards were generated and the second-round-mode option never appeared.
describe('later rounds scheduled without groups (single implicit group fallback)', () => {
  // A round activity scheduled as a bare time block - no group child-activities.
  function bareAct(eventId: string, r: number, t: string): Activity {
    return {
      id: uid(), name: '',
      activityCode: `${eventId}-r${r}`,
      startTime: t, endTime: t,
      childActivities: [], scrambleSets: [],
    };
  }

  // N accepted registrations for 333 (no assignments) - sets the Round-1 field size.
  const manyRegistered = (n: number) => Array.from({ length: n }, (_, i) => per(i + 1, []));

  // 3x3 with 3 rounds: R1 has real groups + assignments; R2 and R3 are bare blocks.
  // R1 advances by percent, R2 by ranking top 12 (mirrors the reported competition).
  function mkBareLaterRounds(mode: 'blanks' | 'prefilled' = 'blanks') {
    const e = evt('333', [
      rSpec('a', { adv: { type: 'percent', level: 60 } }),
      rSpec('a', { adv: { type: 'ranking', level: 12 } }),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
      bareAct('333', 3, '2024-01-01T16:00:00Z'),
    ]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    return parseWCIF(mkWCIF([e], [r], persons), cfg({ secondRoundMode: mode }));
  }

  it('generates round 2 scorecards from an implicit single group', () => {
    const result = mkBareLaterRounds();
    expect(scs(result.intermediate).filter(s => s.eventId === '333').length).toBeGreaterThan(0);
    // single implicit group → exactly one cover
    expect(cvs(result.intermediate).length).toBe(1);
  });

  it('generates the final from an implicit single group', () => {
    const result = mkBareLaterRounds();
    expect(scs(result.finals).filter(s => s.eventId === '333').length).toBeGreaterThan(0);
  });

  it('final blank count honors R2 ranking advancement (ceil(12/1) = 12)', () => {
    const result = mkBareLaterRounds();
    expect(scs(result.finals).filter(s => s.eventId === '333' && s.roundNum === 3).length).toBe(12);
  });

  it('extras include both bare later rounds', () => {
    const result = mkBareLaterRounds();
    const extraRounds = new Set(scs(result.extras).filter(s => s.eventId === '333').map(s => s.roundNum));
    expect(extraRounds.has(2)).toBe(true);
    expect(extraRounds.has(3)).toBe(true);
  });

  it('surfaces the second-round-mode option (hasUnassignedIntermediate is true)', () => {
    expect(hasUnassignedIntermediate(mkBareLaterRounds())).toBe(true);
  });

  it('prefilled mode fills round 2 with all round-1 participants', () => {
    const result = mkBareLaterRounds('prefilled');
    const names = scs(result.intermediate).filter(s => s.name !== '').map(s => s.name);
    expect(names).toContain('P1');
    expect(names).toContain('P2');
  });

  it('does not flip hasGroups when the only scheduled activities are bare rounds', () => {
    // No real groups anywhere (R1 bare too): synthetic later-round groups must not set hasGroups.
    const e = evt('333', [
      rSpec('a'),
      rSpec('a', { adv: { type: 'ranking', level: 8 } }),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      bareAct('333', 1, '2024-01-01T09:00:00Z'),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
      bareAct('333', 3, '2024-01-01T16:00:00Z'),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.hasGroups).toBe(false);
  });

  it('does not synthesize a group when the round has real groups in another room', () => {
    // R2 has a real group in Rouge and a bare block in Bleu - must count as one group, not two.
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 16 } }),
      rSpec('a'),
      rSpec('a'),
    ]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
    ]);
    const persons = Array.from({ length: 4 }, (_, i) => per(i + 1, [{ aid: 100 + (i % 2) }]));
    const result = parseWCIF(mkWCIF([e], [rRouge, rBleu], persons), cfg({ secondRoundMode: 'blanks' }));
    expect(cvs(result.intermediate).length).toBe(1);
  });

  // Scramble-set group count + advancement-based field size
  it('synthesizes scrambleSetCount groups (2 sets → 2 groups) and sizes them by the percent field', () => {
    // Mirrors UtepsaWelcomeSCZ2026: 35 registered, R1 percent 60 → R2 field 21, R2 has 2 sets.
    const e = evt('333', [
      rSpec('a', { adv: { type: 'percent', level: 60 } }),
      rSpec('a', { adv: { type: 'ranking', level: 12 }, sets: 2 }),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
      bareAct('333', 3, '2024-01-01T16:00:00Z'),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], manyRegistered(35)), cfg({ secondRoundMode: 'blanks' }));
    expect(cvs(result.intermediate).length).toBe(2);                 // 2 synthesized groups
    const perGroup = Math.ceil(21 / 2);                              // field 21 over 2 groups → 11
    expect(scs(result.intermediate).filter(s => s.eventId === '333' && s.roundNum === 2).length).toBe(perGroup * 2); // 22
    // Chained: R2 ranking 12 → final field 12, 1 set → ceil(12/1) = 12
    expect(scs(result.finals).filter(s => s.eventId === '333' && s.roundNum === 3).length).toBe(12);
  });

  it('falls back to a single group when the bare round has no scramble sets', () => {
    const e = evt('333', [
      rSpec('a', { adv: { type: 'ranking', level: 12 } }),
      rSpec('a', { sets: 0 }),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], manyRegistered(20)), cfg({ secondRoundMode: 'blanks' }));
    expect(cvs(result.finals).length).toBe(1);                       // one implicit group
  });

  it('sizes an unassigned round with REAL groups from percent advancement (not the flat 16)', () => {
    // R2 has two real but UNassigned groups; the improvement applies here too, not just to
    // bare synthesized rounds.
    const e = evt('333', [
      rSpec('a', { adv: { type: 'percent', level: 50 } }),
      rSpec('a', { adv: { type: 'ranking', level: 8 } }),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [
        ch(200, '333', 2, 1, '2024-01-01T12:00:00Z'),
        ch(201, '333', 2, 2, '2024-01-01T13:00:00Z'),
      ]),
      act('333', 3, [ch(300, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], manyRegistered(40)), cfg({ secondRoundMode: 'blanks' }));
    const perGroup = Math.ceil(20 / 2);                              // field floor(0.5*40)=20 over 2 groups → 10
    expect(scs(result.intermediate).filter(s => s.eventId === '333' && s.roundNum === 2).length).toBe(perGroup * 2); // 20
  });

  it('keeps the flat 16 blank fallback when the previous round advances by attemptResult', () => {
    // 2-round event: R2 is the final; a non-count advancement leaves the field unknown.
    const e = evt('333', [
      rSpec('a', { adv: { type: 'attemptResult', level: 1200 } }),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], manyRegistered(30)), cfg({ secondRoundMode: 'blanks' }));
    expect(scs(result.finals).filter(s => s.eventId === '333' && s.roundNum === 2).length).toBe(16);
  });

  it('sizes dual rounds from registrations and the round after them from the linked source', () => {
    // WCIF v2 Dual Round: R1+R2 open to everyone (Reg 9v5), R3 = top 6 across both.
    const reg = { participationSource: { type: 'registrations' as const }, reservedPlaces: null };
    const e = evt('333', [
      rSpec('a'),
      { ...rSpec('a'), participationRuleset: reg },
      { ...rSpec('a'), participationRuleset: {
        participationSource: {
          type: 'linkedRounds', roundIds: ['333-r1', '333-r2'],
          resultCondition: { type: 'ranking', scope: 'average', value: 6 },
        },
        reservedPlaces: null,
      } },
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
      bareAct('333', 3, '2024-01-01T14:00:00Z'),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], manyRegistered(30)), cfg({ secondRoundMode: 'blanks' }));
    expect(scs(result.intermediate).filter(s => s.eventId === '333' && s.roundNum === 2).length).toBe(30);
    expect(scs(result.finals).filter(s => s.eventId === '333' && s.roundNum === 3).length).toBe(6);
  });

  it('prefilled cover counts use the percent field size', () => {
    // 35 registered, R1 percent 60 → R2 field 21; prefilled covers should sum to 21.
    const e = evt('333', [
      rSpec('a', { adv: { type: 'percent', level: 60 } }),
      rSpec('a', { adv: { type: 'ranking', level: 12 }, sets: 2 }),
      rSpec('a'),
    ]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      bareAct('333', 2, '2024-01-01T12:00:00Z'),
      bareAct('333', 3, '2024-01-01T16:00:00Z'),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], manyRegistered(35)), cfg({ secondRoundMode: 'prefilled' }));
    const covers = cvs(result.intermediate).filter(c => c.eventId === '333' && c.roundNum === 2);
    expect(covers.reduce((sum, c) => sum + c.numScorecards, 0)).toBe(21);
  });
});

// Covers are gated at emission, not filtered afterwards: finalizeEntries sorts, pads and
// quadrant-reorders. These pin both the counts and the pile ordering.

describe('scorecardCheckMode', () => {
  // 333: 3 rounds (r1 named with 2 groups, r2 intermediate, r3 final).
  function mkComp(mode: CompetitionSettings['scorecardCheckMode']) {
    const e = evt('333', [rSpec('a'), rSpec('a', { sets: 2 }), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T12:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T16:00:00Z')]),
    ]);
    const persons = [
      per(1, [{ aid: 100 }]), per(2, [{ aid: 100 }]), per(3, [{ aid: 101 }]),
    ];
    return parseWCIF(mkWCIF([e], [r], persons), cfg({ scorecardCheckMode: mode }));
  }

  it("'per-group-card' emits one cover per group (the default behaviour)", () => {
    const result = mkComp('per-group-card');
    const cov = cvs(result.firstRound);
    expect(cov.map(c => c.group).sort()).toEqual(['Group 1 of 2', 'Group 2 of 2']);
    expect(cov.every(c => c.numGroups === 1)).toBe(true);
  });

  it("'none' emits no cover cards at all", () => {
    for (const bucket of ['firstRound', 'intermediate', 'finals'] as const) {
      expect(cvs(mkComp('none')[bucket]).length).toBe(0);
    }
  });

  it('dropping covers never changes the scorecards themselves', () => {
    const withCovers = scs(mkComp('per-group-card').firstRound);
    const without    = scs(mkComp('none').firstRound);
    expect(without.map(s => `${s.group}|${s.name}`).sort())
      .toEqual(withCovers.map(s => `${s.group}|${s.name}`).sort());
  });

  it('every bucket stays padded to a multiple of 4 after covers are dropped', () => {
    const result = mkComp('none');
    for (const bucket of [result.firstRound, result.intermediate, result.finals]) {
      if (bucket.length > 0) expect(bucket.length % 4).toBe(0);
    }
  });

  it("'per-round-card' collapses a round's group covers into one", () => {
    const cov = cvs(mkComp('per-round-card').firstRound);
    expect(cov.length).toBe(1);
    expect(cov[0]?.roundNum).toBe(1);
    // No group label - the card stands for the whole round.
    expect(cov[0]?.group).toBe('');
    expect(cov[0]?.numGroups).toBe(2);
    // 2 competitors in g1 + 1 in g2.
    expect(cov[0]?.numScorecards).toBe(3);
  });

  it("'per-round-card' keeps the collapsed cover ahead of the round's scorecards", () => {
    // '' sorts before every real group label, so after finalize the cover must still
    // be the first entry of its round in sorted (pre-quadrant) order.
    const cov = cvs(mkComp('per-round-card').firstRound);
    expect(cov[0]?.group).toBe('');
    expect(cov[0]?.group < 'Group 1 of 2').toBe(true);
  });

  it("'per-round-card' takes the earliest timeslot of the round's groups", () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [
      ch(100, '333', 1, 1, '2024-01-01T14:00:00Z'),
      ch(101, '333', 1, 2, '2024-01-01T09:00:00Z'),
    ])]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    const perGroup = cvs(parseWCIF(mkWCIF([e], [r], persons), cfg({ scorecardCheckMode: 'per-group-card' })).firstRound);
    const perRound = cvs(parseWCIF(mkWCIF([e], [r], persons), cfg({ scorecardCheckMode: 'per-round-card' })).firstRound);
    const earliest = perGroup.map(c => c.timeslot).sort()[0];
    expect(perRound.length).toBe(1);
    expect(perRound[0]?.timeslot).toBe(earliest);
  });

  it('covers carry their group\'s scheduled local time; per-round-card spans the round', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const timed = (c: ChildActivity, end: string) => ({ ...c, endTime: end });
    const r = room('Stage', [
      act('333', 1, [
        timed(ch(100, '333', 1, 1, '2024-01-01T08:00:00Z'), '2024-01-01T08:30:00Z'),
        timed(ch(101, '333', 1, 2, '2024-01-01T08:30:00Z'), '2024-01-01T09:15:00Z'),
      ]),
      act('333', 2, [timed(ch(110, '333', 2, 1, '2024-01-01T13:00:00Z'), '2024-01-01T13:45:00Z')]),
    ]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    const parse = (mode: CompetitionSettings['scorecardCheckMode']) =>
      parseWCIF(mkWCIF([e], [r], persons), cfg({ scorecardCheckMode: mode }));
    // Europe/Paris is UTC+1 in January.
    const perGroup = parse('per-group-card');
    expect(cvs(perGroup.firstRound).map(c => `${c.startTime}-${c.endTime}`).sort())
      .toEqual(['09:00-09:30', '09:30-10:15']);
    // Blank finals covers take the same path through the schedule.
    expect(cvs(perGroup.finals).map(c => `${c.startTime}-${c.endTime}`)).toEqual(['14:00-14:45']);
    expect(cvs(parse('per-round-card').firstRound).map(c => `${c.startTime}-${c.endTime}`))
      .toEqual(['09:00-10:15']);
  });

  it("'per-round-card' gives a multi-stage named round one cover per stage", () => {
    // Each stage is its own physical pile, so each needs its own head card.
    const e = evt('333', [rSpec('a')]);
    const rA = room('Scène Rouge', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const rB = room('Scène Bleu',  [act('333', 1, [ch(101, '333', 1, 2)])]);
    const persons = [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])];
    const cov = cvs(parseWCIF(mkWCIF([e], [rA, rB], persons), cfg({ scorecardCheckMode: 'per-round-card' })).firstRound);
    expect(cov.length).toBe(2);
    expect(cov.map(c => c.stage).sort()).toEqual(['bleu', 'rouge']);
    expect(cov.every(c => c.group === '')).toBe(true);
  });

  it("'per-round-card' collapses blank finals covers too", () => {
    const e = evt('333', [rSpec('a'), rSpec('a', { sets: 3 })]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      bareAct2('333', 2, '2024-01-01T16:00:00Z'),
    ]);
    const persons = [per(1, [{ aid: 100 }])];
    const wcif = mkWCIF([e], [r], persons);
    const perGroup = cvs(parseWCIF(wcif, cfg({ scorecardCheckMode: 'per-group-card' })).finals);
    const perRound = cvs(parseWCIF(wcif, cfg({ scorecardCheckMode: 'per-round-card' })).finals);
    expect(perGroup.length).toBeGreaterThan(1);
    expect(perRound.length).toBe(1);
    expect(perRound[0]?.numGroups).toBe(perGroup.length);
    expect(perRound[0]?.numScorecards)
      .toBe(perGroup.reduce((sum, c) => sum + c.numScorecards, 0));
  });
});

// Local copy: the original lives inside another describe block.
function bareAct2(eventId: string, r: number, t: string): Activity {
  return {
    id: uid(), name: '',
    activityCode: `${eventId}-r${r}`,
    startTime: t, endTime: t,
    childActivities: [], scrambleSets: [],
  };
}

// Checking sheet data

describe('checking sheet', () => {
  // The two documents share days and nothing else: the tracker keeps one table per room,
  // the checklist has no room dimension at all (see 'one table per day').
  it('shares the schedule tracker\'s days but not its room partition', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const rA = room('Hall A', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const rB = room('Hall B', [act('333', 2, [ch(101, '333', 2, 1)])]);
    const result = parseWCIF(mkWCIF([e], [rA, rB]), cfg());
    expect(result.checkingDays.length).toBe(result.scheduleDays.length);
    expect(result.checkingDays[0]?.dayLabel).toBe(result.scheduleDays[0]?.dayLabel);
    expect(result.scheduleDays[0]?.stages.map(s => s.stageName)).toEqual(['Hall A', 'Hall B']);
    expect(result.checkingDays[0]?.rows.length).toBe(2);
  });

  it('produces one row per round, matching the schedule rows', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(120, '333', 3, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    const rows = result.checkingDays[0]?.rows ?? [];
    expect(rows.length).toBe(3);
    expect(rows.map(x => x.eventRound))
      .toEqual(result.scheduleDays[0]?.stages[0]?.rows.map(x => x.eventRound));
  });

  it('counts the groups scheduled for each round', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [
      ch(100, '333', 1, 1), ch(101, '333', 1, 2), ch(102, '333', 1, 3),
    ])]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.checkingDays[0]?.rows[0]?.groupCount).toBe(3);
  });

  it('counts every room\'s groups on the round\'s single row', () => {
    const e = evt('333', [rSpec('a')]);
    const rA = room('Stage A', [act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)])]);
    const rB = room('Stage B', [act('333', 1, [ch(102, '333', 1, 3)])]);
    const day = parseWCIF(mkWCIF([e], [rA, rB]), cfg()).checkingDays[0];
    expect(day?.rows.length).toBe(1);
    expect(day?.rows[0]?.groupCount).toBe(3);
  });

  it('groupCount is 0 for a round with no groups generated yet', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [bareAct2('333', 1, '2024-01-01T09:00:00Z')]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.checkingDays[0]?.rows[0]?.groupCount).toBe(0);
  });

  // Cover cards and the Round Checklist are independent artefacts; the mode must not
  // influence whether the checklist rows exist.
  it('is built regardless of the cover-card mode', () => {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    for (const mode of ['per-group-card', 'per-round-card', 'none'] as const) {
      const result = parseWCIF(mkWCIF([e], [r]), cfg({ scorecardCheckMode: mode }));
      expect(result.checkingDays.length).toBe(1);
    }
  });

  it('orders days chronologically', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-02T09:00:00Z')]),
      act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r]), cfg());
    expect(result.checkingDays.length).toBe(2);
    expect(result.checkingDays[0]?.rows[0]?.eventRound).toContain('Round 1');
    expect(result.checkingDays[1]?.rows[0]?.eventRound).toContain('Final');
  });
});

// A round produces one pile however many rooms it runs across, so the day is the only
// partition. Room names have no effect: keying off them silently prints the wrong layout for
// a competition with rooms named "Red"/"Blue".

describe('checking sheet: one table per day', () => {
  const twoRooms = (nameA: string, nameB: string) => {
    const e = evt('333', [rSpec('a')]);
    return mkWCIF([e], [
      room(nameA, [act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)])]),
      room(nameB, [act('333', 1, [ch(102, '333', 1, 3)])]),
    ]);
  };

  it('gives a round split across two rooms a single row', () => {
    const day = parseWCIF(twoRooms('Red Stage', 'Blue Stage'), cfg()).checkingDays[0];
    expect(day?.rows.length).toBe(1);
    expect(day?.rows[0]?.groupCount).toBe(3);
  });

  it('produces identical rows whatever the rooms are called', () => {
    // The exact regression that killed the room-name heuristic: "Red"/"Blue" must behave
    // the same as "Red Stage"/"Blue Stage".
    const named = parseWCIF(twoRooms('Red Stage', 'Blue Stage'), cfg()).checkingDays;
    const plain = parseWCIF(twoRooms('Red', 'Blue'), cfg()).checkingDays;
    const other = parseWCIF(twoRooms('Side Room', 'Salle FMC'), cfg()).checkingDays;
    expect(plain).toEqual(named);
    expect(other).toEqual(named);
  });

  it('puts a genuinely separate room\'s rounds in the same table, in time order', () => {
    const e = evt('333', [rSpec('a')]);
    const f = evt('333fm', [rSpec('m')]);
    const wcif = mkWCIF([e, f], [
      room('Red Stage', [act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')])]),
      room('Blue Stage', [act('333', 1, [ch(101, '333', 1, 2, '2024-01-01T09:00:00Z')])]),
      room('Side Room', [act('333fm', 1, [ch(102, '333fm', 1, 1, '2024-01-01T11:00:00Z')])]),
    ]);
    const day = parseWCIF(wcif, cfg()).checkingDays[0];
    expect(day?.rows.map(x => x.eventRound)).toEqual(['3x3x3 Cube Final', 'FMC Final']);
    expect(day?.rows[0]?.groupCount).toBe(2);
  });

  it('spans the merged row from the earliest start to the latest end', () => {
    const e = evt('333', [rSpec('a')]);
    const early = act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]);
    const late = {
      ...act('333', 1, [ch(101, '333', 1, 2, '2024-01-01T09:30:00Z')]),
      endTime: '2024-01-01T11:00:00Z',
    };
    const wcif = mkWCIF([e], [room('Red Stage', [early]), room('Blue Stage', [late])]);
    const row = parseWCIF(wcif, cfg()).checkingDays[0]?.rows[0];
    expect(row?.startTime).toBe('10:00'); // 09:00Z in Europe/Paris
    expect(row?.endTime).toBe('12:00');   // 11:00Z, from the later room
  });

  it('counts one logical group running on two stages once', () => {
    // Simultaneous stages share the group's code, so summing per room would double it.
    const e = evt('333', [rSpec('a')]);
    const wcif = mkWCIF([e], [
      room('Red Stage', [act('333', 1, [ch(100, '333', 1, 1)])]),
      room('Blue Stage', [act('333', 1, [ch(101, '333', 1, 1)])]),
    ]);
    const row = parseWCIF(wcif, cfg()).checkingDays[0]?.rows[0];
    expect(row?.groupCount).toBe(1);
  });

  it('does not double a later round\'s synthesized groups', () => {
    // groupUnitsOf synthesizes g1..gN per room from the round-wide scramble-set count.
    const e = evt('333', [rSpec('a'), rSpec('a', { sets: 3 })]);
    const wcif = mkWCIF([e], [
      room('Red Stage', [bareAct2('333', 2, '2024-01-01T09:00:00Z')]),
      room('Blue Stage', [bareAct2('333', 2, '2024-01-01T09:00:00Z')]),
    ]);
    const row = parseWCIF(wcif, cfg()).checkingDays[0]?.rows[0];
    expect(row?.groupCount).toBe(3);
  });

  it('keeps one table per day, not one table for the competition', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const wcif = mkWCIF([e], [
      room('Red Stage', [
        act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
        act('333', 2, [ch(102, '333', 2, 1, '2024-01-02T09:00:00Z')]),
      ]),
      room('Blue Stage', [act('333', 1, [ch(101, '333', 1, 2, '2024-01-01T09:00:00Z')])]),
    ]);
    const days = parseWCIF(wcif, cfg()).checkingDays;
    expect(days.map(d => d.rows.length)).toEqual([1, 1]);
  });

  it('recomputes the lunch rule on the merged rows', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const wcif = mkWCIF([e], [
      room('Red Stage', [
        act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
        otherAct('Lunch', '2024-01-01T12:00:00Z'),
        act('333', 2, [ch(102, '333', 2, 1, '2024-01-01T14:00:00Z')]),
      ]),
      room('Blue Stage', [
        act('333', 1, [ch(101, '333', 1, 2, '2024-01-01T09:00:00Z')]),
        act('333', 2, [ch(103, '333', 2, 2, '2024-01-01T14:00:00Z')]),
      ]),
    ]);
    const rows = parseWCIF(wcif, cfg()).checkingDays[0]?.rows ?? [];
    expect(rows.map(x => x.breakBefore)).toEqual([false, true]);
  });

  it('leaves the schedule tracker one table per room', () => {
    // The tracker records when each stage actually runs, which merging would erase.
    const parsed = parseWCIF(twoRooms('Red Stage', 'Blue Stage'), cfg());
    expect(parsed.scheduleDays[0]?.stages.map(s => s.stageName))
      .toEqual(['Red Stage', 'Blue Stage']);
    expect(parsed.scheduleDays[0]?.stages.every(s => s.rows.length === 1)).toBe(true);
  });
});

// Pre-ticked first rounds
// Round 1's groups are created on competitiongroups and its scorecards produced before
// the competition starts, so the sheet prints those two boxes already ticked.

describe('checking sheet: pre-checked first rounds', () => {
  it('marks round 1 pre-checked and later rounds blank', () => {
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-01T11:00:00Z')]),
      act('333', 3, [ch(102, '333', 3, 1, '2024-01-01T13:00:00Z')]),
    ]);
    const rows = parseWCIF(mkWCIF([e], [r]), cfg()).checkingDays[0]?.rows ?? [];
    expect(rows.map(x => x.preChecked)).toEqual([true, false, false]);
  });

  it('pre-checks a one-round event even though its row reads "Final"', () => {
    // Only round 1 exists, so it is labelled Final - but its groups are still made in
    // advance, which is what the box records.
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const row = parseWCIF(mkWCIF([e], [r]), cfg()).checkingDays[0]?.rows[0];
    expect(row?.eventRound).toContain('Final');
    expect(row?.preChecked).toBe(true);
  });

  it('pre-checks a single-group round (groups are still created for it)', () => {
    // Delegates create the group even for a 1-group round so it shows up on
    // competitiongroups at all.
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const row = parseWCIF(mkWCIF([e], [r]), cfg()).checkingDays[0]?.rows[0];
    expect(row?.groupCount).toBe(1);
    expect(row?.preChecked).toBe(true);
  });
});

// Lunch break rule

// A non-round activity, e.g. lunch. `code` defaults to the standard WCA activity code.
function otherAct(name: string, t: string, code = 'other-lunch'): Activity {
  return {
    id: uid(), name, activityCode: code,
    startTime: t, endTime: t,
    childActivities: [], scrambleSets: [],
  };
}

describe('lunch break rule', () => {
  const twoRounds = (lunch?: Activity, lunchRoom?: string) => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const morning = act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]);
    const afternoon = act('333', 2, [ch(101, '333', 2, 1, '2024-01-01T14:00:00Z')]);
    if (lunch && lunchRoom) {
      return mkWCIF([e], [
        room('Stage', [morning, afternoon]),
        room(lunchRoom, [lunch]),
      ]);
    }
    return mkWCIF([e], [
      room('Stage', lunch ? [morning, lunch, afternoon] : [morning, afternoon]),
    ]);
  };

  it('marks the round after an other-lunch activity', () => {
    const parsed = parseWCIF(twoRounds(otherAct('Lunch', '2024-01-01T12:00:00Z')), cfg());
    const rows = parsed.checkingDays[0]?.rows ?? [];
    expect(rows.map(x => x.breakBefore)).toEqual([false, true]);
  });

  it('marks nothing when the competition schedules no lunch', () => {
    const parsed = parseWCIF(twoRounds(), cfg());
    const rows = parsed.checkingDays[0]?.rows ?? [];
    expect(rows.map(x => x.breakBefore)).toEqual([false, false]);
  });

  it('recognises a localised lunch name under a generic activity code', () => {
    // Delegates routinely file lunch as other-misc with a local name.
    for (const name of ['Dîner', 'Déjeuner', 'Almuerzo', 'Almoço', 'Comida']) {
      const parsed = parseWCIF(
        twoRounds(otherAct(name, '2024-01-01T12:00:00Z', 'other-misc')), cfg(),
      );
      const rows = parsed.checkingDays[0]?.rows ?? [];
      expect(rows.map(x => x.breakBefore), name).toEqual([false, true]);
    }
  });

  it('ignores other kinds of break', () => {
    // Only lunch draws a rule - awards and tutorials would clutter a busy day.
    for (const [name, code] of [['Awards', 'other-awards'], ['Tutorial', 'other-tutorial']]) {
      const parsed = parseWCIF(twoRounds(otherAct(name, '2024-01-01T12:00:00Z', code)), cfg());
      const rows = parsed.checkingDays[0]?.rows ?? [];
      expect(rows.map(x => x.breakBefore), name).toEqual([false, false]);
    }
  });

  it('applies a lunch scheduled in another room to the competing rounds', () => {
    // Lunch is often entered once, in a side room or the main room only.
    const parsed = parseWCIF(
      twoRounds(otherAct('Lunch', '2024-01-01T12:00:00Z'), 'Lunch Room'), cfg(),
    );
    const rows = parsed.checkingDays[0]?.rows ?? [];
    expect(rows.map(x => x.breakBefore)).toEqual([false, true]);
  });

  it('never marks the first row - the header border is already above it', () => {
    const parsed = parseWCIF(twoRounds(otherAct('Lunch', '2024-01-01T06:00:00Z')), cfg());
    const rows = parsed.checkingDays[0]?.rows ?? [];
    expect(rows.map(x => x.breakBefore)).toEqual([false, false]);
  });

  it('does not carry a rule across days', () => {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const r = room('Stage', [
      act('333', 1, [ch(100, '333', 1, 1, '2024-01-01T09:00:00Z')]),
      otherAct('Lunch', '2024-01-01T12:00:00Z'),
      act('333', 2, [ch(101, '333', 2, 1, '2024-01-02T09:00:00Z')]),
    ]);
    const parsed = parseWCIF(mkWCIF([e], [r]), cfg());
    // Day 2's only row must not inherit day 1's lunch.
    expect(parsed.checkingDays[1]?.rows.map(x => x.breakBefore)).toEqual([false]);
  });

  it('adds a rule, never a row', () => {
    // The lunch activity itself must stay out of the table.
    const parsed = parseWCIF(twoRounds(otherAct('Lunch', '2024-01-01T12:00:00Z')), cfg());
    const rows = parsed.checkingDays[0]?.rows ?? [];
    expect(rows.length).toBe(2);
    expect(rows.every(x => x.eventRound.includes('3x3x3'))).toBe(true);
  });

  it('marks the schedule tracker at exactly the same boundary', () => {
    const parsed = parseWCIF(twoRounds(otherAct('Lunch', '2024-01-01T12:00:00Z')), cfg());
    expect(parsed.scheduleDays[0]?.stages[0]?.rows.map(x => x.breakBefore))
      .toEqual(parsed.checkingDays[0]?.rows.map(x => x.breakBefore));
  });
});

// PrintGuide.tsx tells organisers to cut each sheet into 4, keep one pile per quadrant and
// stack them 1-2-3-4. Nothing else asserts that, so a layout change fails here instead of
// silently making the printed instructions wrong.

describe('cut-and-stack imposition (what PrintGuide promises)', () => {
  // 333 round 1 with 2 groups and enough competitors to fill several sheets.
  function deck() {
    const e = evt('333', [rSpec('a')]);
    const r = room('Stage', [act('333', 1, [ch(100, '333', 1, 1), ch(101, '333', 1, 2)])]);
    const persons = Array.from({ length: 13 }, (_, i) =>
      per(i + 1, [{ aid: i % 2 === 0 ? 100 : 101 }]));
    return parseWCIF(mkWCIF([e], [r], persons), cfg()).firstRound;
  }

  it('pads the printed deck to whole sheets of 4', () => {
    expect(deck().length % 4).toBe(0);
  });

  it('reading quadrant 1 down the sheets, then 2, 3, 4, gives the sorted order', () => {
    const printed = deck();
    const stacked = unimpose(printed);
    // Each pile is one quadrant read top sheet to bottom sheet.
    const piles = [0, 1, 2, 3].map(q => printed.filter((_, i) => i % 4 === q));
    expect(stacked).toEqual([...piles[0], ...piles[1], ...piles[2], ...piles[3]]);

    // ...and the stack is the order the guide claims: group, then name.
    const keys = stacked.map(x => `${x.group}|${x.kind === 'scorecard' ? x.name : ''}`);
    expect(keys.filter(k => !k.startsWith('|'))).toEqual(
      [...keys.filter(k => !k.startsWith('|'))].sort(),
    );
  });

  it("each group's cover card sits directly on top of that group's scorecards", () => {
    const stacked = unimpose(deck()).filter(x => x.kind !== 'cover' || !!x.eventId);
    for (let i = 0; i < stacked.length; i++) {
      if (stacked[i].kind !== 'cover') continue;
      const next = stacked[i + 1];
      expect(next?.kind).toBe('scorecard');
      expect(next?.group).toBe(stacked[i].group);
    }
  });
});

// `splitPdfsByStage` is the only thing that tags blank rounds with a stage. It has to stay that
// way: the tag splits the collapsed per-round cover and reorders the piles, so turning it on for
// everyone would change output for people who never asked for the per-stage split.
describe('stage tagging on blank rounds (splitPdfsByStage)', () => {
  // 2-round event, simultaneous blank finals across rouge and bleu.
  function blankFinals(splitPdfsByStage: boolean, over: Partial<CompetitionSettings> = {}) {
    const e = evt('333', [rSpec('a'), rSpec('a')]);
    const rRouge = room('Scène Rouge', [
      act('333', 1, [ch(100, '333', 1, 1)]),
      act('333', 2, [ch(110, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const rBleu = room('Scène Bleu', [
      act('333', 1, [ch(101, '333', 1, 1)]),
      act('333', 2, [ch(111, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    return parseWCIF(
      mkWCIF([e], [rRouge, rBleu], [per(1, [{ aid: 100 }])]),
      cfg({ splitPdfsByStage, ...over }),
    );
  }

  it('leaves blank finals cards and covers untagged when off', () => {
    const result = blankFinals(false);
    expect(scs(result.finals).every(c => c.stage === undefined)).toBe(true);
    expect(cvs(result.finals).every(c => c.stage === undefined)).toBe(true);
  });

  it('tags blank finals cards and covers when on', () => {
    const result = blankFinals(true);
    const cards = scs(result.finals).filter(c => c.eventId === '333');
    expect(new Set(cards.map(c => c.stage))).toEqual(new Set(['bleu', 'rouge']));
    expect(new Set(cvs(result.finals).map(c => c.stage))).toEqual(new Set(['bleu', 'rouge']));
  });

  it('still collapses to one cover per blank round in per-round-card mode when off', () => {
    const result = blankFinals(false, { scorecardCheckMode: 'per-round-card' });
    expect(cvs(result.finals).filter(c => c.eventId === '333')).toHaveLength(1);
  });

  it('collapses per stage in per-round-card mode when on, so each stage file has a cover', () => {
    const result = blankFinals(true, { scorecardCheckMode: 'per-round-card' });
    const covers = cvs(result.finals).filter(c => c.eventId === '333');
    expect(covers).toHaveLength(2);
    expect(new Set(covers.map(c => c.stage))).toEqual(new Set(['bleu', 'rouge']));
  });

  it('tags blank semis too', () => {
    // 4-round event: round 3 of 4 lands in the semis bucket.
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a'), rSpec('a')]);
    const mk = (name: string, a: number, b: number) => room(name, [
      act('333', 1, [ch(a, '333', 1, 1)]),
      act('333', 3, [ch(b, '333', 3, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(
      mkWCIF([e], [mk('Scène Rouge', 100, 110), mk('Scène Bleu', 101, 111)], [per(1, [{ aid: 100 }])]),
      cfg({ splitPdfsByStage: true }),
    );
    expect(new Set(scs(result.semis).filter(c => c.eventId === '333').map(c => c.stage)))
      .toEqual(new Set(['bleu', 'rouge']));
  });

  it('never tags the prefilled round-2 competitor cards, which have no stage to know', () => {
    // 3-round event: round 2 is prefilled from the round-1 field, before stages are known.
    const e = evt('333', [rSpec('a'), rSpec('a'), rSpec('a')]);
    const mk = (name: string, a: number, b: number) => room(name, [
      act('333', 1, [ch(a, '333', 1, 1)]),
      act('333', 2, [ch(b, '333', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(
      mkWCIF([e], [mk('Scène Rouge', 100, 110), mk('Scène Bleu', 101, 111)],
        [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])]),
      cfg({ splitPdfsByStage: true, secondRoundMode: 'prefilled' }),
    );
    const named = scs(result.intermediate).filter(c => c.name !== '');
    expect(named.length).toBeGreaterThan(0);
    expect(named.every(c => c.stage === undefined)).toBe(true);
  });
});

describe('stageCount', () => {
  const oneRoom = () => parseWCIF(
    mkWCIF([evt('333', [rSpec('a')])], [room('Main Stage', [act('333', 1, [ch(100, '333', 1, 1)])])],
      [per(1, [{ aid: 100 }])]),
    cfg(),
  );

  it('is 1 for a single-room competition', () => {
    expect(oneRoom().stageCount).toBe(1);
  });

  it('counts the stages one round runs across', () => {
    const rA = room('Blue Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const rB = room('Red Stage', [act('333', 1, [ch(101, '333', 1, 2)])]);
    const result = parseWCIF(
      mkWCIF([evt('333', [rSpec('a')])], [rA, rB], [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])]),
      cfg(),
    );
    expect(result.stageCount).toBe(2);
  });
});

// The second way competitions model stages: one room holding every stage, with the stage named
// in each group activity and the SAME activity code reused across stages. NAC 2026 is shaped
// this way (one "Hall B" running Red/Blue/Green/Orange), and reading only room names collapsed
// all four into one interleaved pile labelled "Group N of 3".
describe('stages packed into one room (stage named in the group activity)', () => {
  // A group activity whose name carries the stage, as Groupifier writes it.
  function namedCh(id: number, eventId: string, r: number, g: number, label: string, t: string) {
    return {
      id, name: `${roundName(eventId, r)} ${label}`,
      activityCode: `${eventId}-r${r}-g${g}`,
      startTime: t, endTime: t, childActivities: [], scrambleSets: [],
    };
  }
  const roundName = (eventId: string, r: number) => `${eventId} Round ${r}`;

  function namedAct(eventId: string, r: number, children: ChildActivity[]): Activity {
    return {
      id: uid(), name: roundName(eventId, r),
      activityCode: `${eventId}-r${r}`,
      startTime: children[0]?.startTime ?? '2024-01-01T09:00:00Z',
      endTime: '2024-01-01T10:00:00Z',
      childActivities: children, scrambleSets: [],
    };
  }

  // One hall, two stages, two groups each. Red 1/Blue 1 share the code "333-r1-g1".
  function packedHall(settings: Partial<CompetitionSettings> = {}) {
    const hall = room('Hall B', [namedAct('333', 1, [
      namedCh(100, '333', 1, 1, 'Red 1', '2024-01-01T09:00:00Z'),
      namedCh(101, '333', 1, 2, 'Red 2', '2024-01-01T10:00:00Z'),
      namedCh(102, '333', 1, 1, 'Blue 1', '2024-01-01T09:00:00Z'),
      namedCh(103, '333', 1, 2, 'Blue 2', '2024-01-01T10:00:00Z'),
    ])]);
    const persons = [
      per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }]),
      per(3, [{ aid: 102 }]), per(4, [{ aid: 103 }]),
    ];
    return parseWCIF(mkWCIF([evt('333', [rSpec('a')])], [hall], persons), cfg(settings));
  }

  it('reads the stage from the group name, not the room name', () => {
    expect([...new Set(scs(packedHall().firstRound).map(s => s.stage))].sort())
      .toEqual(['blue', 'red']);
  });

  it('reports the stage count so the per-stage split is offered', () => {
    expect(packedHall().stageCount).toBe(2);
  });

  it('labels the groups by stage instead of "Group N of 2"', () => {
    const groups = new Set(scs(packedHall().firstRound).map(s => s.group));
    expect(groups).toContain('Red 1 of 2');
    expect(groups).toContain('Blue 2 of 2');
    expect(groups).not.toContain('Group 1 of 2');
  });

  it('keeps the two stages as separate piles (distinct timeslot prefixes)', () => {
    const prefixes = new Set(scs(packedHall().firstRound).map(c => c.timeslot[0]));
    expect(prefixes).toEqual(new Set(['b', 'r']));
  });

  it('splits into one PDF per stage, even though both stages share a group code', () => {
    const result = packedHall({ splitPdfsByStage: true });
    const cards = scs(result.firstRound).filter(c => c.eventId !== '');
    expect(new Set(cards.map(c => c.stage))).toEqual(new Set(['blue', 'red']));
  });

  // Room 302 at NAC: FMC/MBLD groups named "... Group 1", no stage token.
  it('names the stage even when each stage runs a single group', () => {
    // NAC 2026 round 2: one group per stage, four stages, all sharing the code g1. Printing
    // "Group 1 of 1" on all four leaves the competitor no way to know where to go.
    const hall = room('Hall B', [namedAct('333', 1, [
      namedCh(100, '333', 1, 1, 'Red 1', '2024-01-01T09:00:00Z'),
      namedCh(101, '333', 1, 1, 'Blue 1', '2024-01-01T09:00:00Z'),
    ])]);
    const result = parseWCIF(
      mkWCIF([evt('333', [rSpec('a')])], [hall], [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])]),
      cfg(),
    );
    expect(new Set(scs(result.firstRound).map(s => s.group))).toEqual(new Set(['Red 1', 'Blue 1']));
  });

  it('falls back to the room name for groups with no stage token', () => {
    const hall = room('Hall B', [namedAct('333', 1, [
      namedCh(100, '333', 1, 1, 'Red 1', '2024-01-01T09:00:00Z'),
      namedCh(101, '333', 1, 1, 'Blue 1', '2024-01-01T09:00:00Z'),
    ])]);
    const side = room('Room 302', [namedAct('222', 1, [
      namedCh(200, '222', 1, 1, 'Group 1', '2024-01-01T11:00:00Z'),
    ])]);
    const result = parseWCIF(
      mkWCIF([evt('333', [rSpec('a')]), evt('222', [rSpec('a')])], [hall, side],
        [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }]), per(3, [{ aid: 200 }])]),
      cfg(),
    );
    const stageOf = (eventId: string) =>
      [...new Set(scs(result.firstRound).filter(c => c.eventId === eventId).map(c => c.stage))];
    expect(stageOf('333').sort()).toEqual(['blue', 'red']);
    expect(stageOf('222')).toEqual(['room 302']);
  });

  it('leaves the room-per-stage shape alone', () => {
    // Unnamed activities (the classic shape) must still key off the room name.
    const rA = room('Blue Stage', [act('333', 1, [ch(100, '333', 1, 1)])]);
    const rB = room('Red Stage', [act('333', 1, [ch(101, '333', 1, 2)])]);
    const result = parseWCIF(
      mkWCIF([evt('333', [rSpec('a')])], [rA, rB], [per(1, [{ aid: 100 }]), per(2, [{ aid: 101 }])]),
      cfg(),
    );
    expect([...new Set(scs(result.firstRound).map(s => s.stage))].sort()).toEqual(['blue', 'red']);
  });
});

describe('subStageLabel', () => {
  it('extracts the stage token after the round name', () => {
    expect(subStageLabel('3x3x3 Cube Round 1', '3x3x3 Cube Round 1 Red 2')).toBe('Red');
    expect(subStageLabel('5x5x5 Cube Round 1', '5x5x5 Cube Round 1 Orange 10')).toBe('Orange');
  });

  it('returns nothing for a plain "Group N" name, across separators and locales', () => {
    expect(subStageLabel('3x3x3 Cube Round 1', '3x3x3 Cube Round 1 Group 1')).toBe('');
    expect(subStageLabel('3x3x3 Cube, Round 1', '3x3x3 Cube, Round 1, Group 2')).toBe('');
    expect(subStageLabel('3x3x3 Cube Round 1', '3x3x3 Cube Round 1 Grupo 2')).toBe('');
    expect(subStageLabel('R', 'R g1')).toBe('');
  });

  it('returns nothing when the group name does not start with the round name', () => {
    expect(subStageLabel('3x3x3 Cube Round 1', 'Totally Different Name')).toBe('');
  });

  it('returns nothing for the unnamed activities the room-per-stage shape uses', () => {
    expect(subStageLabel('', '')).toBe('');
  });
});

// On-the-spot registrants are not in the WCIF, so they get fill-in blanks after everyone else.
describe('on-the-spot blanks', () => {
  const c = ch(100, '333', 1, 1);
  const e = evt('333', [rSpec('a')]);
  const e2 = evt('222', [rSpec('a')]);
  const r = room('Stage', [act('333', 1, [c])]);
  const persons = () => [
    per(1, [{ aid: 100 }], { name: 'Zed' }),
    { ...per(2, [{ aid: 100 }], { name: 'Amy', wcaId: null }) },
  ];

  it('adds nothing when off', () => {
    const result = parseWCIF(mkWCIF([e, e2], [r], persons()), cfg());
    expect(result.nametags.some(t => t.blank)).toBe(false);
    expect(result.firstTimers.some(f => f.blank)).toBe(false);
    expect(result.extras.some(x => x.kind === 'scorecard' && x.eventId === '')).toBe(false);
  });

  it('appends 4 blank name tags after the sorted real ones', () => {
    const result = parseWCIF(mkWCIF([e, e2], [r], persons()), cfg({ otsBlanks: true }));
    const tags = result.nametags;
    expect(tags.slice(0, 2).map(t => t.name)).toEqual(['Zed', 'Amy']);
    expect(tags.slice(2)).toHaveLength(4);
    expect(tags.slice(2).every(t => t.blank && t.name === '' && t.role === 'competitor')).toBe(true);
  });

  it('appends blank first-timer slips listing every competition event, after the real ones', () => {
    const result = parseWCIF(mkWCIF([e, e2], [r], persons()), cfg({ otsBlanks: true }));
    expect(result.firstTimers[0]?.name).toBe('Amy');
    const blanks = result.firstTimers.slice(1);
    expect(blanks.length).toBeGreaterThan(0);
    expect(blanks.every(f => f.blank && f.name === '')).toBe(true);
    expect(blanks[0]?.eventIds).toEqual(['333', '222']);
  });

  it('appends one page of pure-blank scorecards after the padded extras', () => {
    const result = parseWCIF(mkWCIF([e, e2], [r], persons()), cfg({ otsBlanks: true }));
    expect(result.extras.length % 4).toBe(0);
    const tail = result.extras.slice(-4) as ScorecardEntry[];
    expect(tail.every(x => x.kind === 'scorecard' && x.eventId === '' && x.eventName === '' && x.group === '')).toBe(true);
  });

  // 1-up: no sheet to fill, so no padding covers and a single pure blank.
  it('on A6, skips the padding and adds one pure blank', () => {
    const result = parseWCIF(mkWCIF([e, e2], [r], persons()), cfg({ otsBlanks: true, scorecardsA6: true }));
    const extras = result.extras as ScorecardEntry[];
    expect(extras.every(x => x.kind === 'scorecard')).toBe(true);
    expect(extras.map(x => x.eventId)).toEqual(['333', '']);
  });
});

describe('later-round blanks match advancement seats', () => {
  it('top-16 final in one group prints exactly Station 01..16, no spares', () => {
    const e = evt('222', [rSpec('a', { adv: { type: 'ranking', level: 16 } }), rSpec('a')]);
    const r = room('Stage', [
      act('222', 1, [ch(100, '222', 1, 1)]),
      act('222', 2, [ch(110, '222', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100 }])]), cfg());
    const cards = scs(result.finals).filter(s => s.eventId === '222');
    expect(cards.map(c => c.group).sort()).toEqual(
      Array.from({ length: 16 }, (_, i) => `Station ${String(i + 1).padStart(2, '0')}`));
    expect(cvs(result.finals).filter(c => c.eventId === '222')[0]?.numScorecards).toBe(16);
  });
});

describe('finals station numbers', () => {
  // Top-16 final, one group, one room. `stations` writes Groupifier's RoomConfig.
  function finalGroups(settings: Partial<CompetitionSettings>, opts: { stations?: number; assigned?: number } = {}) {
    const e = evt('222', [rSpec('a', { adv: { type: 'ranking', level: 16 } }), rSpec('a')]);
    const r = room('Stage', [
      act('222', 1, [ch(100, '222', 1, 1)]),
      act('222', 2, [ch(110, '222', 2, 1, '2024-01-01T14:00:00Z')]),
    ]);
    if (opts.stations != null)
      r.extensions = [{ id: 'groupifier.RoomConfig', data: { stations: opts.stations } }];
    const result = parseWCIF(mkWCIF([e], [r], [per(1, [{ aid: 100, station: opts.assigned }])]), cfg(settings));
    return { stations: result.stations, groups: new Set(scs(result.finals).map(c => c.group)) };
  }
  const stationary = (g: Set<string>) => g.has('Station 01') && g.has('Station 16');

  it('keeps station numbers when no station count is known', () => {
    const { groups, stations } = finalGroups({});
    expect(stationary(groups)).toBe(true);
    expect(stations).toBeNull();
  });

  it('drops them when the toggle is off', () => {
    expect(stationary(finalGroups({ finalStationNumbers: false }).groups)).toBe(false);
  });

  it('drops them when the field exceeds the override', () => {
    expect(stationary(finalGroups({ stationsPerStage: 12 }).groups)).toBe(false);
    expect(stationary(finalGroups({ stationsPerStage: 16 }).groups)).toBe(true);
  });

  it('reads the Groupifier room station count', () => {
    const small = finalGroups({}, { stations: 10 });
    expect(stationary(small.groups)).toBe(false);
    expect(small.stations).toEqual({ count: 10, source: 'groupifier' });
    expect(stationary(finalGroups({}, { stations: 20 }).groups)).toBe(true);
  });

  it('falls back to the highest assigned station (Delegate Dashboard)', () => {
    const r = finalGroups({}, { assigned: 8 });
    expect(stationary(r.groups)).toBe(false);
    expect(r.stations).toEqual({ count: 8, source: 'assignments' });
  });

  it('prefers Groupifier over assigned stations, and the override over both', () => {
    expect(finalGroups({}, { stations: 20, assigned: 8 }).stations).toEqual({ count: 20, source: 'groupifier' });
    expect(stationary(finalGroups({}, { stations: 20, assigned: 8 }).groups)).toBe(true);
    expect(stationary(finalGroups({ stationsPerStage: 10 }, { stations: 20 }).groups)).toBe(false);
  });
});
