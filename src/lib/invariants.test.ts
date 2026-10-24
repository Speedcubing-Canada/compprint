import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompetitionSettings } from '../types/settings';
import type { WCIF } from '../types/wcif';
import {
  finalizeEntries, parseWCIF, printedName, realEntries, stackQuadrants, unstackQuadrants,
  type ParsedWCIF, type ScorecardData, type ScorecardEntry,
} from './wcif-parser';
import { buildPdfJobs, type PdfJob } from './pdfJobs';
import { filterParsedByScope } from './generationScope';
import { scorecardsPerPage } from '../pdf/layoutConstants';
import { testSettings } from '../test/fixtures';
import { randomWcif } from '../test/wcifGen';
import { corpus } from '../test/corpus';

// Properties that hold for any competition, checked over seeded random ones and every real
// fixture. Fish deeper in batches: `SEED_START=1000 SEEDS=400`. One worker holds about 500. Each example-based test pins one shape; these catch the shape nobody
// thought to write down.

const SEEDS = Number(process.env.SEEDS ?? 200);
const SEED_START = Number(process.env.SEED_START ?? 1);

/** Settings vary with the seed too, so every combination gets exercised somewhere. */
function settingsFor(wcif: WCIF, seed: number): CompetitionSettings {
  const bit = (n: number) => ((seed >> n) & 1) === 1;
  return testSettings({
    competitionId: wcif.id,
    competitionName: wcif.name,
    scorecardsA6: bit(0),
    mergeScorecardRounds: bit(1),
    splitPdfsByStage: bit(2),
    secondRoundMode: bit(3) ? 'blanks' : 'prefilled',
    otsBlanks: bit(4),
    language: (['en', 'fr', 'es', 'pt'] as const)[seed % 4],
  });
}

// Built lazily, inside each case: thousands of seeds must not all sit in memory.
const cases: [string, () => WCIF, number][] = [
  ...Array.from({ length: SEEDS }, (_, i): [string, () => WCIF, number] => {
    const seed = SEED_START + i;
    return [`seed ${seed}`, () => randomWcif(seed), seed];
  }),
  ...corpus().flatMap(([id, w]): [string, () => WCIF, number][] =>
    [0, 3, 6, 21].map((s) => [`${id} #${s}`, () => structuredClone(w), s])),
];

const BUCKETS = ['firstRound', 'intermediate', 'semis', 'finals'] as const;
const cards = (p: ParsedWCIF) => BUCKETS.flatMap((b) => p[b]).filter((e): e is ScorecardEntry => e.kind === 'scorecard');
const SKIPPED_EVENTS = new Set(['333fm', '333mbf']);

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
      const m = codeOf.get(a.activityId)?.match(/^([^-]+)-r(\d+)-g\d+$/);
      if (!m || SKIPPED_EVENTS.has(m[1])) continue;
      const key = `${m[1]}|${m[2]}|${printedName(p.name)}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

describe.each(cases)('%s', (_label, build, seed) => {
  let wcif: WCIF;
  let settings: CompetitionSettings;
  let parsed: ParsedWCIF;
  let jobs: PdfJob[];
  let perPage: number;
  beforeAll(() => {
    wcif = build();
    settings = settingsFor(wcif, seed);
    parsed = parseWCIF(structuredClone(wcif), settings);
    jobs = buildPdfJobs(parsed, settings);
    perPage = scorecardsPerPage(settings.scorecardsA6);
  });
  afterAll(() => { wcif = parsed = jobs = settings = undefined!; });

  it('prints one named card per competitor assignment, and none for anyone left out', () => {
    const expected = assignedCards(wcif);
    const assignedRounds = new Set([...expected.keys()].map((k) => k.split('|').slice(0, 2).join('|')));
    const actual = new Map<string, number>();
    for (const c of cards(parsed)) {
      if (!c.name || !assignedRounds.has(`${c.eventId}|${c.roundNum}`)) continue;
      const key = `${c.eventId}|${c.roundNum}|${c.name}`;
      actual.set(key, (actual.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  it('gives withdrawn, pending and organizer-account people nothing to print', () => {
    const named = (ps: WCIF['persons']) => new Set(ps.map((p) => printedName(p.name)));
    // Withdrawn or pending registrants, and organizer accounts (no registration, no WCA ID).
    const nothing = named(wcif.persons.filter((p) =>
      p.registration ? p.registration.status !== 'accepted' : !p.wcaId));
    // A delegate or organizer who did not register still gets a staff name tag, nothing else.
    const tagOnly = named(wcif.persons.filter((p) => !p.registration && p.wcaId));
    const onCards = [...cards(parsed).map((c) => c.name), ...parsed.firstTimers.map((f) => f.name)];
    expect(onCards.filter((n) => nothing.has(n) || tagOnly.has(n))).toEqual([]);
    expect(parsed.nametags.map((t) => t.name).filter((n) => nothing.has(n))).toEqual([]);
  });

  it('never prints NaN, undefined or Infinity in a cutoff or limit', () => {
    const bad = cards(parsed).concat(parsed.extras.filter((e): e is ScorecardEntry => e.kind === 'scorecard'))
      .flatMap((c) => [c.cutoff, c.limit])
      .filter((v) => /NaN|undefined|Infinity|null/.test(String(v)));
    expect(bad).toEqual([]);
  });

  it('cut-and-stack order round-trips and fills whole sheets', () => {
    for (const b of BUCKETS) {
      const sorted = unstackQuadrants(parsed[b]);
      const stacked = stackQuadrants(sorted);
      expect(stacked.length % 4).toBe(0);
      expect(unstackQuadrants(stacked)).toEqual(sorted);
    }
  });

  it('finalizeEntries is idempotent', () => {
    for (const b of BUCKETS) {
      const once = finalizeEntries(realEntries(unstackQuadrants(parsed[b])));
      expect(finalizeEntries(realEntries(unstackQuadrants(once)))).toEqual(once);
    }
  });

  it('splits jobs without losing, duplicating or half-filling a sheet', () => {
    const scorecardJobs = jobs.filter((j): j is Extract<PdfJob, { kind: 'scorecards' }> => j.kind === 'scorecards');
    const fromJobs = scorecardJobs.flatMap((j) => realEntries(j.entries)).filter((e) => e.kind === 'scorecard');
    const fromParse = [...BUCKETS.flatMap((b) => realEntries(parsed[b])), ...parsed.extras].filter((e) => e.kind === 'scorecard');
    const key = (e: ScorecardData) => JSON.stringify(e);
    expect(fromJobs.map(key).sort()).toEqual(fromParse.map(key).sort());
    for (const j of scorecardJobs) expect(j.entries.length % perPage).toBe(0);
  });

  it('names every file uniquely, case-blind', () => {
    const names = jobs.map((j) => j.filename.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('scopes to a subset, and to everything when the scope is everything', () => {
    const everything = filterParsedByScope(parsed, { ...settings.generationScope!, mode: 'everything' });
    for (const b of BUCKETS) expect(realEntries(everything[b])).toEqual(realEntries(parsed[b]));
  });
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
