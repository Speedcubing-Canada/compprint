import {
  finalizeEntries, realEntries, stackQuadrants, unstackQuadrants,
  type ScorecardData, type ParsedWCIF, type NametTagEntry,
} from './wcif-parser';
import { cmp } from './sort';
import type { CompetitionSettings, CustomEvent } from '../types/settings';
import {
  scorecardsPerPage, MAX_PAGES_PER_SCORECARD_PDF,
  NAMETAGS_PER_PAGE, MAX_PAGES_PER_NAMETAG_PDF,
} from '../pdf/layoutConstants';

const cardsPerPdf = (a6: boolean) => MAX_PAGES_PER_SCORECARD_PDF * scorecardsPerPage(a6);
const TAGS_PER_PDF = MAX_PAGES_PER_NAMETAG_PDF * NAMETAGS_PER_PAGE;

/**
 * One PDF to render. The worker builds the files and the UI counts and names them off this
 * same list, so a document cannot reach one and not the other.
 *
 * Custom events carry the raw `CustomEvent`: `buildCustomEntries` is worth paying for inside
 * the worker, not on every render of the generate page.
 */
export type PdfJob =
  | { kind: 'scorecards';   filename: string; label: string; entries: ScorecardData[]; mergedRounds?: true }
  | { kind: 'nametags';     filename: string; label: string; nametags: NametTagEntry[] }
  | { kind: 'schedule';     filename: string; label: string }
  | { kind: 'checking';     filename: string; label: string }
  | { kind: 'first-timers'; filename: string; label: string }
  | { kind: 'group-overview'; filename: string; label: string }
  | { kind: 'custom';       filename: string; label: string; custom: CustomEvent };

/**
 * Splits a bucket into one PDF per stage, or null when it cannot be cut that way: a real entry
 * with no stage (prefilled round 2 deals round-1 qualifiers before stages are known), or a
 * single stage, where the split would just rename the file.
 */
function byStage(entries: ScorecardData[]): Map<string, ScorecardData[]> | null {
  const out = new Map<string, ScorecardData[]>();
  for (const entry of realEntries(entries)) {
    if (!entry.stage) return null;
    const list = out.get(entry.stage);
    if (list) list.push(entry);
    else out.set(entry.stage, [entry]);
  }
  return out.size > 1 ? out : null;
}

/** A6 prints 1-up, so it undoes the cut-and-stack order and its padding. */
const finalizeFor = (a6: boolean) => (list: ScorecardData[]) =>
  a6 ? unstackQuadrants(finalizeEntries(list)) : finalizeEntries(list);

/**
 * One PDF, or one per stage. Past the cap, `splitLarge` also cuts one PDF per event and that
 * event into sheet-aligned parts; otherwise the renderer draws the big file in parts and merges
 * them. `entries` must already be in `a6`'s order.
 */
function scorecardJobs(
  entries: ScorecardData[], competitionId: string, slug: string, label: string,
  splitStages: boolean, a6: boolean, splitLarge: boolean,
): PdfJob[] {
  if (entries.length === 0) return [];
  const finalize = finalizeFor(a6);

  const stages = splitStages ? byStage(entries) : null;
  if (stages) {
    const keys = [...stages.keys()].sort(cmp);
    const slugs = uniqueSlugs(keys, 'stage');
    return keys.flatMap((stage, i) =>
      // finalizeEntries per stage: each file pads and quadrant-reorders on its own, so no
      // printed sheet ever straddles two stages.
      scorecardJobs(
        finalize(stages.get(stage)!), competitionId,
        `${slug}_${slugs[i]}`, `${label} (${titleCase(stage)})`, false, a6, splitLarge,
      ));
  }

  if (!splitLarge || entries.length <= cardsPerPdf(a6))
    return [{ kind: 'scorecards', filename: `${competitionId}_${slug}.pdf`, entries, label }];

  const byEvent = new Map<string, ScorecardData[]>();
  for (const entry of realEntries(entries)) {
    const list = byEvent.get(entry.eventId);
    if (list) list.push(entry);
    else byEvent.set(entry.eventId, [entry]);
  }

  return [...byEvent]
    .map(([eventId, list]) => ({
      eventId,
      eventName: list[0].eventName,
      minTimeslot: list.reduce((m, e) => (e.timeslot < m ? e.timeslot : m), list[0].timeslot),
      list,
    }))
    .sort((a, b) => cmp(a.minTimeslot, b.minTimeslot) || cmp(a.eventId, b.eventId))
    .flatMap(({ eventId, eventName, list }) =>
      splitToCap(finalize(list), `${competitionId}_${slug}_${eventId}`, `${label} (${eventName})`, a6));
}

/** Cuts on sheet boundaries, so no printed sheet straddles two files. */
function splitToCap(entries: ScorecardData[], base: string, label: string, a6: boolean): PdfJob[] {
  if (entries.length <= cardsPerPdf(a6))
    return [{ kind: 'scorecards', filename: `${base}.pdf`, entries, label }];

  const chunks = evenChunks(entries, cardsPerPdf(a6), scorecardsPerPage(a6));
  return chunks.map((slice, i) => ({
    kind: 'scorecards',
    filename: `${base}_part${i + 1}.pdf`,
    entries: slice,
    label: `${label} ${i + 1}/${chunks.length}`,
  }));
}

/** Even slices of at most `cap`, each a whole number of `unit`s except the last. */
function evenChunks<T>(items: T[], cap: number, unit: number): T[][] {
  const parts = Math.ceil(items.length / cap);
  const per = Math.ceil(items.length / parts / unit) * unit;
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += per) out.push(items.slice(start, start + per));
  return out;
}

/** One PDF, or with `splitLarge` equal parts of one past the cap. */
function nametagJobs(nametags: NametTagEntry[], competitionId: string, splitLarge: boolean): PdfJob[] {
  if (nametags.length === 0) return [];
  if (!splitLarge || nametags.length <= TAGS_PER_PDF)
    return [{ kind: 'nametags', filename: `${competitionId}_nametags.pdf`, label: 'Name Tags', nametags }];

  const chunks = evenChunks(nametags, TAGS_PER_PDF, NAMETAGS_PER_PAGE);
  return chunks.map((slice, i) => ({
    kind: 'nametags',
    filename: `${competitionId}_nametags_part${i + 1}.pdf`,
    label: `Name Tags ${i + 1}/${chunks.length}`,
    nametags: slice,
  }));
}

/** Whether any file is past the page cap, i.e. whether `splitLargePdfs` would change anything. */
export function hasOversizedPdf(jobs: PdfJob[], a6: boolean): boolean {
  return jobs.some(j =>
    (j.kind === 'scorecards' && j.entries.length > cardsPerPdf(a6))
    || (j.kind === 'nametags' && j.nametags.length > TAGS_PER_PDF));
}

/** Custom-event and stage names become filenames, so strip anything a filesystem dislikes. */
function safeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 40);
}

/**
 * Sanitised names, deduplicated. Two names can reduce to the same slug (room names, custom
 * events, anything non-Latin), and a zip holding two entries under one name loses a PDF.
 * Compared case-blind: macOS and Windows unzip onto case-insensitive disks.
 */
function uniqueSlugs(names: string[], fallback: string): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const slug = safeName(name);
    const base = /[a-zA-Z0-9]/.test(slug) ? slug : fallback;
    let out = base;
    for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${base}_${n}`;
    taken.add(out.toLowerCase());
    return out;
  });
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether every round shares one scorecard PDF: either split setting wins over the merge. */
export const mergesRounds = (
  settings: Pick<CompetitionSettings, 'mergeScorecardRounds' | 'splitPdfsByStage' | 'splitLargePdfs'>,
) =>
  settings.mergeScorecardRounds === true
  && settings.splitPdfsByStage !== true && settings.splitLargePdfs !== true;

/**
 * The PDFs a parse produces, in render order. An emptied bucket produces no job, which is how
 * document selection is enforced; there is no per-document flag down here.
 */
export function buildPdfJobs(parsed: ParsedWCIF, settings: CompetitionSettings): PdfJob[] {
  const id = settings.competitionId;
  const jobs: PdfJob[] = [];

  const stages = settings.splitPdfsByStage === true;
  const a6 = settings.scorecardsA6 === true;
  const splitLarge = settings.splitLargePdfs === true;
  // The parser hands back the 4-up order; A6 unstacks it before any split, so each part is a
  // contiguous run of the sorted deck.
  const bucket = (list: ScorecardData[]) => (a6 ? unstackQuadrants(list) : list);
  const rounds = [
    { list: parsed.firstRound, slug: 'round1', label: 'Round 1' },
    { list: parsed.intermediate, slug: 'round2', label: 'Round 2' },
    { list: parsed.semis, slug: 'semis', label: 'Semis' },
    { list: parsed.finals, slug: 'finals', label: 'Finals' },
  ];
  if (mergesRounds(settings) && rounds.filter(r => r.list.length > 0).length > 1) {
    // Joined in sorted 1-up order, then stacked once: per-round stacks would interleave rounds
    // once the sheets are cut. No re-sort, so prefilled round 2 keeps its order. Never split.
    const oneUp = rounds.flatMap(r => unstackQuadrants(r.list));
    jobs.push({
      kind: 'scorecards', filename: `${id}_scorecards.pdf`, label: 'Scorecards',
      entries: a6 ? oneUp : stackQuadrants(oneUp), mergedRounds: true,
    });
  } else {
    for (const r of rounds)
      jobs.push(...scorecardJobs(bucket(r.list), id, r.slug, r.label, stages, a6, splitLarge));
  }
  // Never split: extras are not produced by finalizeEntries, so they must not go back through it.
  if (parsed.extras.length > 0)
    jobs.push({ kind: 'scorecards', filename: `${id}_extras.pdf`, entries: parsed.extras, label: 'Extras' });
  if (parsed.scheduleDays.length > 0)
    jobs.push({ kind: 'schedule', filename: `${id}_schedule.pdf`, label: 'Schedule Tracker' });
  // Already emptied by filterParsedByScope unless the Round Checklist was selected.
  if (parsed.checkingDays.length > 0)
    jobs.push({ kind: 'checking', filename: `${id}_checklist.pdf`, label: 'Round Checklist' });
  // Already emptied by filterParsedByScope unless the Group Overview was selected.
  if (parsed.groupOverview.length > 0)
    jobs.push({ kind: 'group-overview', filename: `${id}_group_overview.pdf`, label: 'Group Overview' });
  jobs.push(...nametagJobs(parsed.nametags, id, splitLarge));
  if (parsed.firstTimers.length > 0)
    jobs.push({ kind: 'first-timers', filename: `${id}_first_timers.pdf`, label: 'First-Timer Slips' });

  const customs = (settings.customEvents ?? []).filter((c) => c.name.trim());
  const customSlugs = uniqueSlugs(customs.map((c) => c.name), 'event');
  customs.forEach((custom, i) => jobs.push({
    kind: 'custom',
    filename: `${id}_custom_${customSlugs[i]}.pdf`,
    label: custom.name,
    custom,
  }));

  return jobs;
}

/**
 * Driven by the jobs, not the settings, so a schedule-only download is never told how to cut
 * scorecards. Custom-event cards print alongside ordinary ones, so they fold in.
 */
export type GuideSection =
  | 'scorecards' | 'schedule' | 'checking' | 'group-overview' | 'nametags' | 'first-timers';

export function guideSections(jobs: PdfJob[]): GuideSection[] {
  const kinds = new Set(jobs.map(j => j.kind));
  const out: GuideSection[] = [];
  if (kinds.has('scorecards') || kinds.has('custom')) out.push('scorecards');
  if (kinds.has('schedule')) out.push('schedule');
  if (kinds.has('checking')) out.push('checking');
  if (kinds.has('group-overview')) out.push('group-overview');
  if (kinds.has('nametags')) out.push('nametags');
  if (kinds.has('first-timers')) out.push('first-timers');
  return out;
}

/** A lone PDF ships as itself, printable straight from the download; two or more are zipped. */
export function downloadTarget(
  jobs: PdfJob[],
  competitionId: string,
): { filename: string; mimeType: string } {
  if (jobs.length === 1) {
    return { filename: jobs[0].filename, mimeType: 'application/pdf' };
  }
  return { filename: `${competitionId}_pdfs.zip`, mimeType: 'application/zip' };
}
