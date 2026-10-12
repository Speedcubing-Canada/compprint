// Generation benchmark. See "Generation performance" in the README.
//
//   npm run bench                 # WC2025-scale profile (~1800 competitors)
//   npm run bench -- small        # small / medium / wc
//   npm run bench -- wc --only=nametags
//
// Run through vite-node, not node: the documents are .tsx and the icon assets are
// `?inline` imports. --expose-gc makes the per-job heap numbers attributable.

import { renderToStream } from '@react-pdf/renderer';
import type {
  Activity, ChildActivity, Event, EventId, Person, Room, Round, WCIF,
} from '../src/types/wcif';
import type { CompetitionSettings } from '../src/types/settings';
import { parseWCIF } from '../src/lib/wcif-parser';
import { filterParsedByScope } from '../src/lib/generationScope';
import { buildPdfJobs } from '../src/lib/pdfJobs';
import { jobElement } from '../src/pdf/jobElement';
import { testSettings } from '../src/test/fixtures';

// Deterministic, so two runs of the same profile are comparable.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

interface Profile {
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

const PROFILES: Record<string, Profile> = {
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

function buildWcif(p: Profile): WCIF {
  const rnd = lcg(42);
  const dayIso = (d: number) => `2026-07-${String(9 + d).padStart(2, '0')}`;
  const at = (day: number, hhmm: string) => `${dayIso(day)}T${hhmm}:00Z`;
  const hhmm = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  const events: Event[] = ALL_EVENTS.map((id) => {
    const n = ROUND_COUNT[id] ?? 1;
    const rounds: Round[] = [];
    for (let r = 1; r <= n; r++) {
      rounds.push({
        id: `${id}-r${r}`,
        format: id === '666' || id === '777' ? '3' : 'a',
        timeLimit: { centiseconds: 60000, cumulativeRoundIds: [] },
        cutoff: r === 1 && (id === '444' || id === '555') ? { numberOfAttempts: 2, attemptResult: 9000 } : null,
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
  const tail = ALL_EVENTS.filter((e) => !p.coreEvents.includes(e));
  const persons: Person[] = [];
  for (let i = 1; i <= p.competitors; i++) {
    const eventIds: EventId[] = [...p.coreEvents];
    for (const e of tail) if (rnd() < p.extraEvents / tail.length) eventIds.push(e);
    // Roughly a third of a big field are newcomers, which is what fills the slips.
    const newcomer = rnd() < 0.33;
    persons.push({
      registrantId: i,
      name: `Competitor Number ${i} Surname`,
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
        if ((ALL_EVENTS.indexOf(event.id) + stage) % Math.max(1, Math.floor(ALL_EVENTS.length / 4)) !== 0 && r > 1) continue;
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
        stationNumber: null,
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

// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(0).padStart(6);
const ms = (t: number) => `${(t / 1000).toFixed(2).padStart(7)}s`;

function collect() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

/** Peak heapUsed and rss over the life of one measured step. */
function watchMemory() {
  let peakHeap = process.memoryUsage().heapUsed;
  let peakRss = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
    if (m.rss > peakRss) peakRss = m.rss;
  }, 20);
  timer.unref();
  return () => { clearInterval(timer); return { peakHeap, peakRss }; };
}

async function drain(stream: NodeJS.ReadableStream): Promise<number> {
  let bytes = 0;
  for await (const chunk of stream) bytes += (chunk as Buffer).length;
  return bytes;
}

async function main() {
  const args = process.argv.slice(2);
  const key = args.find((a) => !a.startsWith('--')) ?? 'wc';
  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
  const profile = PROFILES[key];
  if (!profile) {
    console.error(`Unknown profile "${key}". Options: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }
  if (typeof globalThis.gc !== 'function')
    console.warn('! gc() unavailable - run with --expose-gc for attributable heap numbers\n');

  console.log(`Profile: ${profile.name}\n`);

  const settings: CompetitionSettings = testSettings({
    competitionId: 'BenchmarkComp2026',
    competitionName: 'Benchmark Competition 2026',
  });

  collect();
  let stop = watchMemory();
  let t = performance.now();
  const wcif = buildWcif(profile);
  console.log(`  build wcif   ${ms(performance.now() - t)}  ${mb(stop().peakHeap)} MB heap  ` +
    `(${wcif.persons.length} persons, ${wcif.events.length} events)`);

  collect();
  stop = watchMemory();
  t = performance.now();
  const parsed = parseWCIF(wcif, settings);
  const parseMem = stop();
  console.log(`  parseWCIF    ${ms(performance.now() - t)}  ${mb(parseMem.peakHeap)} MB heap  ` +
    `(${parsed.firstRound.length} r1 cards, ${parsed.nametags.length} tags, ${parsed.firstTimers.length} slips)`);

  const scoped = filterParsedByScope(parsed, settings.generationScope!);
  const jobs = buildPdfJobs(scoped, settings).filter((j) => !only || j.kind === only);

  console.log(`\n  ${'document'.padEnd(34)} ${'time'.padStart(8)} ${'heap'.padStart(9)} ${'rss'.padStart(9)} ${'output'.padStart(9)}`);
  console.log(`  ${'-'.repeat(34)} ${'-'.repeat(8)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)}`);

  let totalTime = 0;
  let totalBytes = 0;
  let worstHeap = 0;
  for (const job of jobs) {
    collect();
    const stopJob = watchMemory();
    const start = performance.now();
    const bytes = await drain(await renderToStream(jobElement(job, scoped, settings)));
    const elapsed = performance.now() - start;
    const m = stopJob();
    totalTime += elapsed;
    totalBytes += bytes;
    worstHeap = Math.max(worstHeap, m.peakHeap);
    console.log(`  ${job.filename.padEnd(34)} ${ms(elapsed)} ${mb(m.peakHeap)} MB ${mb(m.peakRss)} MB ${mb(bytes)} MB`);
  }

  console.log(`  ${'-'.repeat(34)} ${'-'.repeat(8)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)}`);
  console.log(`  ${`${jobs.length} documents`.padEnd(34)} ${ms(totalTime)} ${mb(worstHeap)} MB ${''.padStart(9)} ${mb(totalBytes)} MB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
