import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { runJobs, type WorkerResponse } from './renderBundle';
import { renderToBuffer } from '@react-pdf/renderer';
import { GROUP_OVERVIEW, RENDER_PART_PAGES } from './layoutConstants';
import { jobElement, jobElements } from './jobElement';
import { groupBlockRows, visibleColumns } from './groupOverviewColumns';
import { textWidth } from './nameFit';
import { parseWCIF, type GroupOverviewEntry } from '../lib/wcif-parser';
import { buildPdfJobs } from '../lib/pdfJobs';
import { filterParsedByScope, type DocumentSelection } from '../lib/generationScope';
import { estimateTotalPages } from '../lib/pageEstimate';
import { sampleWcif, testSettings, variedSettings } from '../test/fixtures';
import { corpus } from '../test/corpus';
import { randomWcif } from '../test/wcifGen';
import type { CompetitionSettings } from '../types/settings';
import type { WCIF } from '../types/wcif';

// The worker's whole path with nothing stubbed: parse, plan, render, split and merge, zip.
// render.pdf.test.ts proves each document renders; this proves what the organizer downloads.

const SLOW = 300_000;

/** What the generate page posts: the parse, narrowed to the selected documents. */
const prepare = (wcif: WCIF, settings: CompetitionSettings) =>
  filterParsedByScope(parseWCIF(wcif, settings), settings.generationScope);

async function generate(wcif: WCIF, settings: CompetitionSettings) {
  const parsed = prepare(wcif, settings);
  const jobs = buildPdfJobs(parsed, settings);
  const msgs: WorkerResponse[] = [];
  await runJobs({ parsed, settings, uiLanguage: 'en' }, (m) => msgs.push(m));
  const last = msgs.at(-1);
  if (last?.type !== 'done') throw new Error(`worker ended with ${JSON.stringify(last)}`);
  const bytes = new Uint8Array(await last.blob.arrayBuffer());
  const files = jobs.length === 1 ? { [last.filename]: bytes } : unzipSync(bytes);
  const pages: Record<string, number> = {};
  for (const [name, b] of Object.entries(files)) pages[name] = (await PDFDocument.load(b)).getPageCount();
  return { parsed, jobs, last, files, pages };
}

/** Every document off but `doc`; null for none at all. */
const onlyDocument = (doc: keyof DocumentSelection | null): Partial<CompetitionSettings> => ({
  generationScope: {
    mode: 'everything',
    documents: {
      scorecards: false, scheduleTracker: false, nametags: false,
      roundChecklist: false, firstTimerSlips: false, groupOverview: false,
      ...(doc ? { [doc]: true } : {}),
    },
  },
});

// One settings mix per competition, so A6, merged rounds, stage splits, blank second rounds
// and OTS each run on a real WCIF. `splits` and `wraps` name what a case is there to cover, and
// the case checks it still does: a fixture or generator change cannot quietly drop it.
type Case = { seed: number; splits?: true; wraps?: true };
const REAL: Record<string, Case> = {
  BCChampionship2026: { seed: 3, splits: true },
  CuberBrasilSumare2026: { seed: 14 },
  FMCaMontreal2026: { seed: 21 },
  GrosJouetsaMontreal2025: { seed: 0 },
  HUNbelievableChallengeBSB2026: { seed: 5 },
  PickeringBlindfolded2026: { seed: 10 },
  WaterlooSpring2026: { seed: 19 },
};
const cases: [string, Case, WCIF][] = [
  ...corpus().map(([id, w]): [string, Case, WCIF] => [id, REAL[id] ?? { seed: 0 }, w]),
  ...[9, 25, 26].map((seed): [string, Case, WCIF] => [`seed ${seed}`, { seed, wraps: true }, randomWcif(seed)]),
];

describe('the download, end to end', () => {
  it.each(cases)('%s: one file per job, page count as estimated', async (_id, { seed, splits, wraps }, wcif) => {
    const settings = variedSettings(wcif, seed);
    const { parsed, jobs, pages } = await generate(wcif, settings);

    // unzipSync keys by name, so a duplicate filename would show up as a missing entry.
    expect(Object.keys(pages).sort()).toEqual(jobs.map((j) => j.filename).sort());

    // The schedule and checklist flow and are counted as one page each; everything else is exact.
    const flowing = jobs.filter((j) => j.kind === 'schedule' || j.kind === 'checking');
    const flowingPages = flowing.reduce((n, j) => n + pages[j.filename], 0);
    const total = Object.values(pages).reduce((a, b) => a + b, 0);
    expect(total - flowingPages).toBe(estimateTotalPages(parsed, settings, jobs) - flowing.length);

    const parted = jobs.filter((j) => jobElements(j, parsed, settings).length > 1);
    if (splits) expect(parted.length).toBeGreaterThan(0);
    for (const j of parted) expect(pages[j.filename]).toBeGreaterThan(RENDER_PART_PAGES);

    if (wraps) {
      const columns = visibleColumns(parsed.groupOverview);
      expect(parsed.groupOverview.some((g) =>
        groupBlockRows(g, columns, settings.paperFormat) > Math.max(...columns.map((c) => g[c.key].length)))).toBe(true);
    }
  }, SLOW);
});

describe('the worker messages', () => {
  const [, pickering] = corpus().find(([id]) => id === 'PickeringBlindfolded2026')!;

  it('ships a single document as the bare PDF', async () => {
    const settings = testSettings({ competitionId: pickering.id, ...onlyDocument('scheduleTracker') });
    const { last, files } = await generate(pickering, settings);
    expect(last).toMatchObject({ filename: 'PickeringBlindfolded2026_schedule.pdf', mimeType: 'application/pdf' });
    expect(new TextDecoder().decode(Object.values(files)[0].subarray(0, 5))).toBe('%PDF-');
  });

  it('reports an error when nothing is selected', async () => {
    const settings = testSettings({ competitionId: pickering.id, ...onlyDocument(null) });
    const msgs: WorkerResponse[] = [];
    await runJobs({ parsed: prepare(pickering, settings), settings, uiLanguage: 'en' }, (m) => msgs.push(m));
    expect(msgs).toEqual([{ type: 'error', message: 'No entries to render.' }]);
  });

  it('turns a throw into an error message instead of a rejection', async () => {
    const msgs: WorkerResponse[] = [];
    await runJobs({ parsed: null as never, settings: testSettings(), uiLanguage: 'en' }, (m) => msgs.push(m));
    expect(msgs).toEqual([{ type: 'error', message: expect.stringContaining('TypeError') }]);
  });

  it('wires the worker entry point to runJobs', async () => {
    const posted: WorkerResponse[] = [];
    const self = { postMessage: (m: WorkerResponse) => posted.push(m), onmessage: null as unknown };
    Object.assign(globalThis, { self });
    try {
      await import('./scorecardWorker');
      const settings = testSettings({ competitionId: pickering.id, ...onlyDocument('roundChecklist') });
      await (self.onmessage as (e: { data: unknown }) => Promise<void>)({
        data: { parsed: prepare(pickering, settings), settings, uiLanguage: 'fr' },
      });
    } finally {
      Reflect.deleteProperty(globalThis, 'self');
    }
    expect(posted[0]).toEqual({ type: 'progress', percent: 2, message: expect.any(String) });
    expect(posted.at(-1)).toMatchObject({ type: 'done', filename: 'PickeringBlindfolded2026_checklist.pdf' });
  });
});

// The pixel baselines are tolerant enough to miss a wrong digit; text is not.
const hasPdftotext = (() => {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
// CI installs poppler, so a missing pdftotext there is a broken job, not a reason to skip.
describe.skipIf(!hasPdftotext && !process.env.CI)('the printed text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-text-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const [, waterloo] = corpus().find(([id]) => id === 'WaterlooSpring2026')!;
  const text = async (language: 'en' | 'fr') => {
    const settings = testSettings({ competitionId: waterloo.id, competitionName: waterloo.name, language });
    const { files } = await generate(waterloo, settings);
    const path = join(dir, `round1-${language}.pdf`);
    writeFileSync(path, files['WaterlooSpring2026_round1.pdf']);
    return execFileSync('pdftotext', ['-raw', path, '-'], { encoding: 'utf8' });
  };

  it.each([
    ['en', ['Square-1 Round 1 of 2 Red 1 of 2', '(DNF if not under 10:00)', 'Continue if Attempt 1 or 2 is below 1:00']],
    ['fr', ['Square-1 Tour 1 sur 2 Red 1 sur 2', "(DNF si n'est pas inférieur à 10:00)", 'Essai 1 ou 2 sont inférieurs à 1:00']],
  ] as const)('%s: a competitor card reads right', async (language, lines) => {
    const out = await text(language);
    expect(out).toContain('Avery Lam\n2026LAMA01 WCA Live: 79\n');
    for (const line of lines) expect(out).toContain(line);
  }, SLOW);
});

// A name within a point of its cell's edge is where the estimate and react-pdf part ways: one
// wraps it, the other does not, and every block on the page grows by a line.
describe('the group overview estimate at a cell edge', () => {
  const settings = testSettings();
  const names = [...new Set(Array.from({ length: 60 }, (_, i) => `Ana ${'n'.repeat(22 + (i >> 2))}${'i'.repeat(i & 3)}`))]
    .filter((n) => { const w = textWidth(n, GROUP_OVERVIEW.fontSize, false); return w > 145 && w < 160; });

  it('covers both sides of the edge', () => expect(names.length).toBeGreaterThan(8));

  it.each(names)('%s', async (judge) => {
    const groups: GroupOverviewEntry[] = Array.from({ length: 12 }, (_, g) => ({
      eventId: '333', roundNum: 1, dayLabel: 'Day 1', heading: `3x3x3 Cube Round 1 - Group ${g + 1}`,
      startTime: '09:00', endTime: '09:30', room: 'Hall',
      competitors: ['Ali Hakim'], scramblers: ['Bo'], runners: ['Cy'], judges: Array(9).fill(judge),
    }));
    const parsed = { ...parseWCIF(sampleWcif(), settings), scheduleDays: [], checkingDays: [], firstTimers: [], groupOverview: groups };
    const pdf = await renderToBuffer(jobElement({ kind: 'group-overview', filename: 'x.pdf', label: 'x' }, parsed, settings));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(estimateTotalPages(parsed, { ...settings, customEvents: [] }, []));
  });
});
