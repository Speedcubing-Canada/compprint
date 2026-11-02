import { describe, it, expect } from 'vitest';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';
import { ScorecardDocument } from './ScorecardDocument';
import { parseWCIF } from '../lib/wcif-parser';
import { buildPdfJobs, type PdfJob } from '../lib/pdfJobs';
import { sampleWcif, testSettings } from '../test/fixtures';
import { PDFDocument } from 'pdf-lib';
import { jobElement, jobElements } from './jobElement';
import { mergePdfs } from './mergePdfs';
import { RENDER_PART_PAGES } from './layoutConstants';
import type { ScorecardData, ScorecardEntry } from '../lib/wcif-parser';

// The layout tests assert measurements; this asserts the documents render at all.
// Nothing else in the suite executes src/pdf/*Document.tsx, so a job kind that
// buildPdfJobs can emit but no document can render would otherwise only surface
// on an organizer's download.

const settings = testSettings({
  customEvents: [{ name: 'Team BLD', iconDataUrl: null, format: 'mo3', cutoff: '', limit: '' }],
});
const parsed = parseWCIF(sampleWcif(), settings);
const jobs = buildPdfJobs(parsed, settings);

describe('PDF rendering', () => {
  it('emits one job of every kind', () => {
    expect(new Set(jobs.map(j => j.kind))).toEqual(
      new Set(['scorecards', 'schedule', 'checking', 'group-overview', 'venue-schedule', 'nametags', 'first-timers', 'custom']),
    );
  });

  // The switch is exhaustive over PdfJob, so only a cast can reach the default. Without
  // it a new kind would return undefined and fail inside the worker instead.
  it('throws on an unmapped job kind', () => {
    expect(() => jobElement({ kind: 'unmapped' } as unknown as PdfJob, parsed, settings))
      .toThrow(/unhandled job kind/);
  });

  it.each(jobs.map(j => [j.filename, j] as const))('renders %s', async (_name, job) => {
    const buf = await renderToBuffer(jobElement(job, parsed, settings));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // A document that renders zero pages still produces a valid, tiny PDF.
    expect(buf.byteLength).toBeGreaterThan(2000);
  });
});

// A big file is drawn in page-capped parts and merged, so the parts must tile it exactly.
describe('rendering a big job in parts', () => {
  const card = jobs.find(j => j.kind === 'scorecards')!;
  const cards = (card as Extract<PdfJob, { kind: 'scorecards' }>).entries;
  const big = (n: number): PdfJob => ({ ...card, entries: Array.from({ length: n }, (_, i) => cards[i % cards.length]) } as PdfJob);
  const parts = (job: PdfJob, a6: boolean) =>
    jobElements(job, parsed, { ...settings, scorecardsA6: a6 }).map(el => el.props.entries as ScorecardData[]);

  it.each([[false, 4], [true, 1]] as const)('A6 %s: whole pages, under the cap, in order', (a6, perPage) => {
    const job = big(RENDER_PART_PAGES * perPage * 2 + perPage * 3);
    const split = parts(job, a6);
    expect(split).toHaveLength(3);
    for (const p of split) expect(p.length).toBeLessThanOrEqual(RENDER_PART_PAGES * perPage);
    for (const p of split.slice(0, -1)) expect(p.length % perPage).toBe(0);
    expect(split.flat()).toEqual((job as Extract<PdfJob, { kind: 'scorecards' }>).entries);
  });

  it('leaves a job under the cap as one document', () => {
    expect(parts(card, false)).toHaveLength(1);
  });

  it('merges parts into one PDF, every page kept, title carried over', async () => {
    const render = async () => renderToBuffer(jobElement(card, parsed, settings));
    const one = await PDFDocument.load(await render());
    const merged = await PDFDocument.load(await mergePdfs([render, render]));
    expect(merged.getPageCount()).toBe(one.getPageCount() * 2);
    expect(merged.getTitle()).toBe(one.getTitle());
  });
});

// Off is the default for every non-Canadian organizer, so it must not move a single byte: the
// parser leaves the field unset when off, and the renderer never reads the setting.
describe('shared first name underline', () => {
  const named = parsed.firstRound.find((e): e is ScorecardEntry => e.kind === 'scorecard' && e.name.includes(' '))!;
  const flagged: ScorecardEntry = { ...named, underlinedSurname: named.name.split(' ').at(-1)! };
  // The creation date and the file ID it seeds differ per render.
  const bytes = async (entries: ScorecardData[], on: boolean) =>
    (await renderToBuffer(createElement(ScorecardDocument, { entries, settings: { ...settings, underlineSharedFirstNames: on } }) as ReactElement<DocumentProps>))
      .toString('latin1').replace(/\(D:\d{14}Z\)/g, '').replace(/\/ID \[[^\]]*\]/, '');

  it('renders an unflagged card byte-identical whatever the setting', async () => {
    expect('underlinedSurname' in named).toBe(false);
    expect(await bytes([named], true)).toBe(await bytes([named], false));
  });

  it('changes a flagged card', async () => {
    expect(await bytes([flagged], false)).not.toBe(await bytes([named], false));
  });
});
