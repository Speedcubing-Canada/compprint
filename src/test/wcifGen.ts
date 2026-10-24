// Seeded WCIF generator, shared by scripts/bench.ts (fixed profiles, comparable runs) and the
// invariant tests (randomWcif: many small, messy competitions).

import type {
  Activity, ChildActivity, Event, EventId, Person, Room, Round, WCIF,
} from '../types/wcif';

// Deterministic, so two runs of the same profile are comparable.
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export interface Profile {
  name: string;
  competitors: number;
  stages: number;
  /** Round-1 groups per stage. */
  groupsPerStage: number;
  /** Events every competitor is registered for, before the random tail. */
  coreEvents: EventId[];
  /** How many further events a competitor picks, on average. */
  extraEvents: number;
  days: number;
  /** Events on the schedule. Defaults to ALL_EVENTS. */
  events?: EventId[];
  seed?: number;
  /** A competitor's name; defaults to a plain numbered one. */
  personName?: (i: number, rnd: () => number) => string;
  /** Number competitors' stations within each group. */
  stations?: boolean;
}

const ALL_EVENTS: EventId[] = [
  '333', '222', '444', '555', '666', '777', '333bf', '333oh',
  'clock', 'minx', 'pyram', 'skewb', 'sq1', 'fto', '444bf', '555bf',
];

// Round counts by event, WC-shaped: 3x3 runs four rounds, the popular events three,
// the long ones a single round.
const ROUND_COUNT: Partial<Record<EventId, number>> = {
  '333': 4, '222': 3, '444': 3, '333oh': 3, 'pyram': 3, 'skewb': 3,
  '555': 2, 'minx': 2, 'clock': 2, 'sq1': 2, '333bf': 2,
};

export const PROFILES: Record<string, Profile> = {
  small: {
    name: 'small (club comp)',
    competitors: 120, stages: 1, groupsPerStage: 4,
    coreEvents: ['333', '222'], extraEvents: 2, days: 1,
  },
  medium: {
    name: 'medium (regional)',
    competitors: 450, stages: 2, groupsPerStage: 5,
    coreEvents: ['333', '222', '444'], extraEvents: 3, days: 2,
  },
  wc: {
    name: 'WC-scale (~1800 competitors)',
    competitors: 1800, stages: 8, groupsPerStage: 6,
    coreEvents: ['333', '222', '444', '333oh'], extraEvents: 4, days: 4,
  },
};

export function buildWcif(p: Profile): WCIF {
  const rnd = lcg(p.seed ?? 42);
  const eventIds = p.events ?? ALL_EVENTS;
  const dayIso = (d: number) => `2026-07-${String(9 + d).padStart(2, '0')}`;
  const at = (day: number, hhmm: string) => `${dayIso(day)}T${hhmm}:00Z`;
  const hhmm = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  const events: Event[] = eventIds.map((id) => {
    const n = ROUND_COUNT[id] ?? 1;
    const rounds: Round[] = [];
    for (let r = 1; r <= n; r++) {
      rounds.push({
        id: `${id}-r${r}`,
        format: id === '666' || id === '777' ? '3' : 'a',
        timeLimit: { centiseconds: 60000, cumulativeRoundIds: [] },
        cutoff: r === 1 && (id === '444' || id === '555') ? { numberOfAttempts: 2, resultValue: 9000 } : null,
        // Each round halves the field, which is what drives the blank-card counts.
        participationRuleset: {
          participationSource: r === 1 ? { type: 'registrations' } : {
            type: 'round', roundId: `${id}-r${r - 1}`,
            resultCondition: { type: 'percent', scope: 'average', value: 50 },
          },
          reservedPlaces: null,
        },
        scrambleSetCount: p.groupsPerStage,
        results: [],
      });
    }
    return { id, rounds, qualification: null };
  });

  // Registrations. Everyone takes the core events plus a deterministic tail.
  const tail = eventIds.filter((e) => !p.coreEvents.includes(e));
  const persons: Person[] = [];
  for (let i = 1; i <= p.competitors; i++) {
    const eventIds: EventId[] = [...p.coreEvents];
    for (const e of tail) if (rnd() < p.extraEvents / tail.length) eventIds.push(e);
    // Roughly a third of a big field are newcomers, which is what fills the slips.
    const newcomer = rnd() < 0.33;
    persons.push({
      registrantId: i,
      name: p.personName ? p.personName(i, rnd) : `Competitor Number ${i} Surname`,
      wcaUserId: 100000 + i,
      wcaId: newcomer ? null : `20${String(10 + (i % 15))}TEST${String(i % 100).padStart(2, '0')}`,
      countryIso2: 'CA',
      gender: i % 3 === 0 ? 'f' : 'm',
      birthdate: `20${String(10 + (i % 15))}-03-14`,
      registration: { wcaRegistrationId: 900000 + i, eventIds, status: 'accepted', isCompeting: true },
      avatar: null,
      roles: i <= 3 ? ['delegate'] : i <= 8 ? ['organizer'] : [],
      assignments: [],
      personalBests: newcomer ? [] : eventIds.map((eventId) => ({
        eventId, value: 1000 + Math.floor(rnd() * 5000),
        worldRanking: Math.floor(rnd() * 20000),
        continentalRanking: Math.floor(rnd() * 5000),
        nationalRanking: Math.floor(rnd() * 1000),
        type: 'single' as const,
      })),
    });
  }

  // Schedule: one room per stage, round activities spread over the days, round 1 carrying
  // real group child-activities (the named-scorecard path).
  const rooms: Room[] = [];
  let activityId = 1000;
  const roundActivities: { eventId: EventId; roundNum: number; groups: ChildActivity[] }[] = [];

  for (let stage = 0; stage < p.stages; stage++) {
    const activities: Activity[] = [];
    let day = 0;
    let cursor = 9 * 60;
    for (const event of events) {
      for (let r = 1; r <= event.rounds.length; r++) {
        // Stagger events across stages so not every stage runs every round.
        if ((eventIds.indexOf(event.id) + stage) % Math.max(1, Math.floor(eventIds.length / 4)) !== 0 && r > 1) continue;
        const dur = 60;
        if (cursor + dur > 19 * 60) { day = (day + 1) % p.days; cursor = 9 * 60; }
        const start = cursor;
        const end = cursor + dur;
        cursor = end;

        const groups: ChildActivity[] = [];
        if (r === 1) {
          const per = Math.floor(dur / p.groupsPerStage);
          for (let g = 1; g <= p.groupsPerStage; g++) {
            groups.push({
              id: ++activityId,
              name: '',
              activityCode: `${event.id}-r${r}-g${g}`,
              startTime: at(day, hhmm(start + (g - 1) * per)),
              endTime: at(day, hhmm(start + g * per)),
              childActivities: [],
              scrambleSets: [],
            });
          }
        }
        const act: Activity = {
          id: ++activityId,
          name: '',
          activityCode: `${event.id}-r${r}`,
          startTime: at(day, hhmm(start)),
          endTime: at(day, hhmm(end)),
          childActivities: groups,
          scrambleSets: [],
        };
        activities.push(act);
        if (r === 1) roundActivities.push({ eventId: event.id, roundNum: r, groups });
      }
      // A lunch break on each stage's first day, so the break rule is exercised.
      if (event.id === '444') {
        activities.push({
          id: ++activityId, name: 'Lunch', activityCode: 'other-lunch',
          startTime: at(day, hhmm(cursor)), endTime: at(day, hhmm(cursor + 60)),
          childActivities: [], scrambleSets: [],
        });
        cursor += 60;
      }
    }
    rooms.push({ id: stage + 1, name: `${['Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Grey'][stage % 8]} Stage`, color: '#2196f3', activities });
  }

  // Round-1 competitor assignments: every registered competitor lands in one group of
  // their event, spread evenly across that event's groups on every stage.
  const groupsByEvent = new Map<EventId, ChildActivity[]>();
  for (const ra of roundActivities) {
    const list = groupsByEvent.get(ra.eventId) ?? [];
    list.push(...ra.groups);
    groupsByEvent.set(ra.eventId, list);
  }
  const cursorByEvent = new Map<EventId, number>();
  for (const person of persons) {
    for (const eventId of person.registration!.eventIds) {
      const groups = groupsByEvent.get(eventId);
      if (!groups || groups.length === 0) continue;
      const i = cursorByEvent.get(eventId) ?? 0;
      cursorByEvent.set(eventId, i + 1);
      person.assignments.push({
        activityId: groups[i % groups.length].id,
        assignmentCode: 'competitor',
        stationNumber: p.stations ? Math.floor(i / groups.length) + 1 : null,
      });
    }
    // A staffing shift or two, which is what fills the name-tag duty lists.
    const staffGroups = groupsByEvent.get('333') ?? [];
    if (staffGroups.length > 0 && person.registrantId % 3 === 0) {
      person.assignments.push({
        activityId: staffGroups[person.registrantId % staffGroups.length].id,
        assignmentCode: 'staff-judge', stationNumber: null,
      });
      person.assignments.push({
        activityId: staffGroups[(person.registrantId + 1) % staffGroups.length].id,
        assignmentCode: 'staff-scrambler', stationNumber: null,
      });
    }
  }

  return {
    formatVersion: '1.0',
    id: 'BenchmarkComp2026',
    name: 'Benchmark Competition 2026',
    shortName: 'Benchmark 2026',
    persons,
    events,
    schedule: {
      startDate: dayIso(0),
      numberOfDays: p.days,
      venues: [{
        id: 1, name: 'Benchmark Arena',
        latitudeMicrodegrees: 45500000, longitudeMicrodegrees: -73500000,
        countryIso2: 'CA', timezone: 'America/Toronto',
        rooms,
      }],
    },
    competitorLimit: p.competitors,
  };
}


// Names the printing path has to survive: accents, non-Latin scripts, WCA's "Local (Latin)"
// form, nested parentheses, very long, and astral-plane characters.
const NAME_POOL = [
  'Ada Lovelace', 'Zoë Saldaña-Pérez', 'Łukasz Żółć', 'Nguyễn Văn Thành', 'Søren Kierkegaard',
  '王小明 (Xiaoming Wang)', '김민준 (Minjun Kim)', 'Александр Пушкин (Alexander Pushkin)',
  'محمد علي (Mohamed Ali)', 'Jean (JJ) Tremblay (Jean Tremblay)',
  'Maria da Conceição Albuquerque de Oliveira Santos Ferreira',
  'Hubert Blaine Wolfeschlegelsteinhausenbergerdorff', 'O\'Brien McDonald', 'X Æ A-12', '𝓐𝓷𝓷𝓪 Script',
];

/**
 * A small competition whose shape and mess come from the seed: random events (FMC and MBLD
 * included), stages, groups, stations, names, and the people the parser must leave out
 * (withdrawn, pending, non-competing staff, registration-less organizer accounts).
 */
export function randomWcif(seed: number): WCIF {
  const rnd = lcg(seed * 7919 + 1);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pool: EventId[] = [...ALL_EVENTS, '333fm', '333mbf'];
  const events = pool.filter((e) => e === '333' || rnd() < 0.3);

  const wcif = buildWcif({
    name: `random ${seed}`,
    seed,
    competitors: int(4, 60),
    stages: int(1, 3),
    groupsPerStage: int(1, 4),
    coreEvents: ['333'],
    extraEvents: int(0, 3),
    days: int(1, 2),
    events,
    stations: rnd() < 0.5,
    personName: (i, r) => (r() < 0.4 ? NAME_POOL[i % NAME_POOL.length] : `Competitor ${i}`),
  });
  wcif.id = `RandomComp${seed}`;

  // Formats and limits the bench profiles never use.
  for (const event of wcif.events) {
    for (const round of event.rounds) {
      if (event.id === '333fm') { round.format = 'm'; round.timeLimit = null; round.cutoff = null; }
      else if (event.id === '333mbf') {
        round.format = rnd() < 0.5 ? '1' : '2';
        round.timeLimit = null;
        round.cutoff = null;
      } else if (rnd() < 0.25) {
        // An hour or more, which the printed limit has to show as such.
        round.timeLimit = { centiseconds: int(1, 3) * 360000, cumulativeRoundIds: rnd() < 0.5 ? [round.id] : [] };
      }
    }
  }

  // People who must not get a scorecard, each holding a real group assignment.
  const someGroup = wcif.persons.flatMap((p) => p.assignments).find((a) => a.assignmentCode === 'competitor');
  const nextId = wcif.persons.length + 1;
  const ghost = (i: number, name: string, over: Partial<Person>): Person => ({
    ...structuredClone(wcif.persons[0]),
    registrantId: nextId + i, wcaUserId: 200000 + seed * 10 + i, name, wcaId: null, roles: [], personalBests: [],
    assignments: someGroup ? [{ ...someGroup }] : [],
    ...over,
  });
  const base = wcif.persons[0].registration!;
  wcif.persons.push(
    ghost(0, 'Withdrawn Person', { registration: { ...base, wcaRegistrationId: 990000 + seed, status: 'deleted' } }),
    ghost(1, 'Pending Person', { registration: { ...base, wcaRegistrationId: 990001 + seed, status: 'pending' } }),
    ghost(2, 'Staff Only', {
      registration: { ...base, wcaRegistrationId: 990002 + seed, isCompeting: false },
      assignments: someGroup ? [{ ...someGroup, assignmentCode: 'staff-judge' }] : [],
    }),
    // Org accounts appear in the WCIF as organizers with no registration.
    ghost(3, 'Club Organizing Account', { registration: null, roles: ['organizer'], assignments: [] }),
  );
  return wcif;
}
