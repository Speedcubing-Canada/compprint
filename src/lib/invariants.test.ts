import { describe, expect, it } from 'vitest';
import type { CompetitionSettings } from '../types/settings';
import type { WCIF } from '../types/wcif';
import {
  finalizeEntries, parseWCIF, printedName, realEntries, unstackQuadrants,
  type ParsedWCIF, type ScorecardData, type ScorecardEntry,
} from './wcif-parser';
import { buildPdfJobs, type PdfJob } from './pdfJobs';
import { SCORECARD_BUCKETS, filterParsedByScope } from './generationScope';
import { parseActivityCode } from './activityCode';
import { scorecardsPerPage } from '../pdf/layoutConstants';
import { testSettings, variedSettings } from '../test/fixtures';
import { randomWcif } from '../test/wcifGen';
import { corpus } from '../test/corpus';

// Properties that hold for any competition, over seeded random ones and every real fixture.
// Example tests pin one shape; these catch the shape nobody wrote down.
// More seeds: `SEEDS=2000 npx vitest run src/lib/invariants.test.ts`.

const SEEDS = Number(process.env.SEEDS ?? 200);

const cases: [string, () => WCIF, number][] = [
  ...Array.from({ length: SEEDS }, (_, i): [string, () => WCIF, number] => {
    const seed = i + 1;
    return [`seed ${seed}`, () => randomWcif(seed), seed];
  }),
  ...corpus().flatMap(([id, w]) =>
    // Bits 0-4 of these cover A6, merged rounds, stage splits, prefilled and blank second rounds, OTS.
    [0, 3, 14, 21].map((s): [string, () => WCIF, number] => [`${id} #${s}`, () => w, s])),
];

const cards = (p: ParsedWCIF) => SCORECARD_BUCKETS.flatMap((b) => p[b]).filter((e): e is ScorecardEntry => e.kind === 'scorecard');
// FMC and MBLD print no named cards: answer sheets, and blank MBLD cards for the delegate.
const UNNAMED_EVENTS = new Set(['333fm', '333mbf']);

/** Competitor assignments as `event|round|name`, for the people the parser should print. */
function assignedCards(wcif: WCIF): Map<string, number> {
  const codeOf = new Map<number, string>();
  for (const venue of wcif.schedule.venues)
    for (const room of venue.rooms)
      for (const act of room.activities)
        for (const child of act.childActivities) codeOf.set(child.id, child.activityCode);

  const out = new Map<string, number>();
  for (const p of wcif.persons) {
    const reg = p.registration;
    if (!reg || reg.status !== 'accepted' || !reg.isCompeting) continue;
    for (const a of p.assignments) {
      if (a.assignmentCode !== 'competitor') continue;
      const code = parseActivityCode(codeOf.get(a.activityId) ?? '');
      if (code?.group === undefined || UNNAMED_EVENTS.has(code.eventId)) continue;
      const key = `${code.eventId}|${code.round}|${printedName(p.name)}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

interface Case { wcif: WCIF; settings: CompetitionSettings; parsed: ParsedWCIF; jobs: PdfJob[]; perPage: number }

/** expect.soft, labelled with the property's name. */
type Soft = (actual: unknown) => ReturnType<typeof expect.soft<unknown>>;

const PROPERTIES: Record<string, (c: Case, soft: Soft) => void> = {
  'prints one named card per competitor assignment, and none for anyone left out': ({ wcif, parsed }, soft) => {
    const expected = assignedCards(wcif);
    const assignedRounds = new Set([...expected.keys()].map((k) => k.split('|').slice(0, 2).join('|')));
    const actual = new Map<string, number>();
    for (const c of cards(parsed)) {
      if (!c.name || !assignedRounds.has(`${c.eventId}|${c.roundNum}`)) continue;
      const key = `${c.eventId}|${c.roundNum}|${c.name}`;
      actual.set(key, (actual.get(key) ?? 0) + 1);
    }
    soft(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
    soft(cards(parsed).filter((c) => c.name && UNNAMED_EVENTS.has(c.eventId))).toEqual([]);
  },
  'gives withdrawn, pending and organizer-account people nothing to print': ({ wcif, parsed }, soft) => {
    const named = (ps: WCIF['persons']) => new Set(ps.map((p) => printedName(p.name)));
    // Withdrawn or pending registrants, and organizer accounts (no registration, no WCA ID).
    const nothing = named(wcif.persons.filter((p) =>
      p.registration ? p.registration.status !== 'accepted' : !p.wcaId));
    // A delegate or organizer who did not register still gets a staff name tag, nothing else.
    const tagOnly = named(wcif.persons.filter((p) => !p.registration && p.wcaId));
    const onCards = [...cards(parsed).map((c) => c.name), ...parsed.firstTimers.map((f) => f.name)];
    soft(onCards.filter((n) => nothing.has(n) || tagOnly.has(n))).toEqual([]);
    soft(parsed.nametags.map((t) => t.name).filter((n) => nothing.has(n))).toEqual([]);
  },
  'never prints NaN, undefined or Infinity in a cutoff or limit': ({ parsed }, soft) => {
    const bad = cards(parsed).concat(parsed.extras.filter((e): e is ScorecardEntry => e.kind === 'scorecard'))
      .flatMap((c) => [c.cutoff, c.limit])
      .filter((v) => /NaN|undefined|Infinity|null/.test(String(v)));
    soft(bad).toEqual([]);
  },
  'every bucket is stacked on whole sheets, each cover on top of its own cards': ({ parsed }, soft) => {
    for (const b of SCORECARD_BUCKETS) {
      soft(parsed[b].length % 4).toBe(0);
      const piles = unstackQuadrants(parsed[b]);
      piles.forEach((e, i) => {
        // A round nobody advances to still gets its covers, with nothing under them.
        if (e.kind !== 'cover' || e.numScorecards === 0) return;
        // A prefilled second round stacks all its covers first, so skip the round's other covers.
        const next = piles.slice(i + 1).find((c) => c.kind !== 'cover' || c.eventId !== e.eventId || c.roundNum !== e.roundNum);
        soft(next && [next.kind, next.eventId, next.roundNum]).toEqual(['scorecard', e.eventId, e.roundNum]);
      });
    }
  },
  'finalizeEntries is idempotent': ({ parsed }, soft) => {
    for (const b of SCORECARD_BUCKETS) {
      const once = finalizeEntries(realEntries(unstackQuadrants(parsed[b])));
      soft(finalizeEntries(realEntries(unstackQuadrants(once)))).toEqual(once);
    }
  },
  'splits jobs without losing, duplicating or half-filling a sheet': ({ parsed, jobs, perPage }, soft) => {
    const scorecardJobs = jobs.filter((j): j is Extract<PdfJob, { kind: 'scorecards' }> => j.kind === 'scorecards');
    const fromJobs = scorecardJobs.flatMap((j) => realEntries(j.entries)).filter((e) => e.kind === 'scorecard');
    const fromParse = [...SCORECARD_BUCKETS.flatMap((b) => realEntries(parsed[b])), ...parsed.extras].filter((e) => e.kind === 'scorecard');
    const key = (e: ScorecardData) => JSON.stringify(e);
    soft(fromJobs.map(key).sort()).toEqual(fromParse.map(key).sort());
    for (const j of scorecardJobs) soft(j.entries.length % perPage).toBe(0);
  },
  'names every file uniquely, case-blind': ({ jobs }, soft) => {
    const names = jobs.map((j) => j.filename.toLowerCase());
    soft(new Set(names).size).toBe(names.length);
  },
  'an everything scope is the identity': ({ settings, parsed }, soft) => {
    const everything = filterParsedByScope(parsed, { ...settings.generationScope!, mode: 'everything' });
    for (const b of SCORECARD_BUCKETS) soft(realEntries(everything[b])).toEqual(realEntries(parsed[b]));
  },
};

// One test per competition; soft expects, so one run reports every property that broke.
it.each(cases)('%s holds every property', (_label, build, seed) => {
  const wcif = build();
  const settings = variedSettings(wcif, seed);
  const parsed = parseWCIF(structuredClone(wcif), settings);
  const c: Case = { wcif, settings, parsed, jobs: buildPdfJobs(parsed, settings), perPage: scorecardsPerPage(settings.scorecardsA6) };
  for (const [name, check] of Object.entries(PROPERTIES)) check(c, (v) => expect.soft(v, name));
});

// A compact print summary per real competition, so a parser change shows up in review as a
// readable diff of what organizers would get, not only as a pass or fail.
describe('what each real competition prints', () => {
  it.each(corpus())('%s', (id, wcif) => {
    const settings = testSettings({ competitionId: id, competitionName: wcif.name });
    const parsed = parseWCIF(wcif, settings);
    const summary = buildPdfJobs(parsed, settings).map((j) => {
      if (j.kind !== 'scorecards') return j.filename;
      const real = realEntries(j.entries);
      const named = real.filter((e): e is ScorecardEntry => e.kind === 'scorecard' && e.name !== '');
      const groups = [...new Set(real.filter((e): e is ScorecardEntry => e.kind === 'scorecard').map((e) => `${e.eventId}-r${e.roundNum} ${e.group}`))];
      return `${j.filename}: ${j.entries.length} cards, ${named.length} named, ${real.length - named.length} blank or cover; ${groups.length} groups: ${groups.slice(0, 4).join(' | ')}`;
    });
    expect([...summary, `${parsed.nametags.length} name tags, ${parsed.firstTimers.length} first-timer slips`]).toMatchSnapshot();
  });
});
