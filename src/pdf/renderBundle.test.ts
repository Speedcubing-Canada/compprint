import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

// Stub renderer: real PDF bytes are covered by ./render.pdf.test.ts. This file
// covers the orchestration around it.
const toBlob = vi.fn();
vi.mock('@react-pdf/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  pdf: () => ({ toBlob }),
}));

import { parseWCIF } from '../lib/wcif-parser';
import { filterParsedByScope } from '../lib/generationScope';
import { buildPdfJobs } from '../lib/pdfJobs';
import { getWorkerStrings } from '../lib/i18n';
import { emptyParsedWcif } from '../lib/wcif-parser';
import { sampleWcif, testSettings } from '../test/fixtures';
import { runJobs, type WorkerResponse } from './renderBundle';

// The seam between what the generate page promised and what the browser receives: nothing
// else checks that every job in the list reaches the bundle.

const settings = testSettings();
const parsed = parseWCIF(sampleWcif(), settings);

// Tagged so the zip entries can be told apart. A real Blob: runJobs streams it.
const fakePdf = (tag: string) => new Blob([`%PDF-${tag}`], { type: 'application/pdf' });

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

function collect() {
  const msgs: WorkerResponse[] = [];
  return { msgs, post: (m: WorkerResponse) => void msgs.push(m) };
}

const progress = (m: WorkerResponse[]) => m.filter(x => x.type === 'progress');
const done = (m: WorkerResponse[]) => m.find(x => x.type === 'done');
const error = (m: WorkerResponse[]) => m.find(x => x.type === 'error');

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  toBlob.mockImplementation(async () => fakePdf(String(n++)));
});
afterEach(() => vi.useRealTimers());

describe('nothing to render', () => {
  it('reports the localised no-entries message and renders nothing', async () => {
    const { msgs, post } = collect();
    await runJobs({ parsed: emptyParsedWcif(), settings, uiLanguage: 'en' }, post);

    expect(error(msgs)?.message).toBe(getWorkerStrings('en').noEntries);
    expect(progress(msgs)).toHaveLength(0);
    expect(toBlob).not.toHaveBeenCalled();
  });

  it('uses the organizer\'s UI language for that message', async () => {
    const { msgs, post } = collect();
    await runJobs({ parsed: emptyParsedWcif(), settings, uiLanguage: 'fr' }, post);
    expect(error(msgs)?.message).toBe(getWorkerStrings('fr').noEntries);
  });
});

describe('a single document', () => {
  // One document ships as the PDF itself, not a zip.
  const scope = {
    mode: 'everything' as const,
    documents: {
      scorecards: false, scheduleTracker: true, nametags: false,
      roundChecklist: false, firstTimerSlips: false, groupOverview: false, venueSchedule: false,
    },
  };
  const soloSettings = testSettings({ generationScope: scope });
  // The scope is applied by the generate page before the request reaches the worker.
  const solo = filterParsedByScope(parseWCIF(sampleWcif(), soloSettings), scope);

  it('ships the bare PDF, not a zip', async () => {
    const jobs = buildPdfJobs(solo, soloSettings);
    expect(jobs).toHaveLength(1);

    const { msgs, post } = collect();
    await runJobs({ parsed: solo, settings: soloSettings, uiLanguage: 'en' }, post);

    const d = done(msgs)!;
    expect(d.mimeType).toBe('application/pdf');
    expect(d.filename).toBe(jobs[0].filename);
    // The PDF bytes themselves, unwrapped.
    expect(await d.blob.text()).toBe('%PDF-0');
  });
});

describe('a bundle', () => {
  it('zips exactly the jobs buildPdfJobs listed', async () => {
    const jobs = buildPdfJobs(parsed, settings);
    expect(jobs.length).toBeGreaterThan(1);

    const { msgs, post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'en' }, post);

    const d = done(msgs)!;
    expect(d.mimeType).toBe('application/zip');
    expect(d.filename).toBe(`${settings.competitionId}_pdfs.zip`);

    // Catches a document dropped between the count shown and the bytes downloaded.
    const entries = Object.keys(unzipSync(await bytesOf(d.blob)));
    expect(entries.sort()).toEqual(jobs.map(j => j.filename).sort());
  });

  it('renders every job once', async () => {
    const { post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'en' }, post);
    expect(toBlob).toHaveBeenCalledTimes(buildPdfJobs(parsed, settings).length);
  });

  it('includes a custom event in the bundle', async () => {
    const withCustom = testSettings({
      customEvents: [{ name: 'Team BLD', iconDataUrl: null, format: 'mo3', cutoff: '', limit: '' }],
    });
    const p = parseWCIF(sampleWcif(), withCustom);
    const { msgs, post } = collect();
    await runJobs({ parsed: p, settings: withCustom, uiLanguage: 'en' }, post);

    const entries = Object.keys(unzipSync(await bytesOf(done(msgs)!.blob)));
    expect(entries).toContain(`${withCustom.competitionId}_custom_Team_BLD.pdf`);
  });
});

describe('progress', () => {
  it('never goes backwards and ends at 99 before the bundle is handed over', async () => {
    const { msgs, post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'en' }, post);

    const percents = progress(msgs).map(m => m.percent);
    expect(percents[0]).toBe(2);
    expect(percents.at(-1)).toBe(99);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    // The done message is last; nothing is posted after the bundle goes out.
    expect(msgs.at(-1)!.type).toBe('done');
  });

  it('names the document being rendered, in the organizer\'s language', async () => {
    const { msgs, post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'es' }, post);

    const label = buildPdfJobs(parsed, settings)[0].label;
    expect(progress(msgs).map(m => m.message))
      .toContain(getWorkerStrings('es').rendering(label));
  });
});

describe('a document that fails to render', () => {
  // In a worker a rejected onmessage is dropped on the floor, so the page would wait on
  // "building" forever. Every failure has to come back as an error message.
  it('reports a failure before rendering starts too, instead of rejecting', async () => {
    const { msgs, post } = collect();
    await expect(runJobs({ parsed: null as unknown as typeof parsed, settings, uiLanguage: 'en' }, post)).resolves.toBeUndefined();
    expect(error(msgs)).toBeTruthy();
    expect(done(msgs)).toBeUndefined();
  });

  it('reports the error and hands over no bundle', async () => {
    toBlob.mockRejectedValue(new Error('font missing'));
    const { msgs, post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'en' }, post);

    expect(error(msgs)?.message).toContain('font missing');
    expect(done(msgs)).toBeUndefined();
  });

  it('stops after the failing document rather than rendering the rest', async () => {
    toBlob.mockResolvedValueOnce(fakePdf('0')).mockRejectedValue(new Error('boom'));
    const { post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'en' }, post);
    expect(toBlob).toHaveBeenCalledTimes(2);
  });

  it('clears the easing timer, so nothing is posted after the error', async () => {
    vi.useFakeTimers();
    toBlob.mockRejectedValue(new Error('boom'));
    const { msgs, post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'en' }, post);

    const after = msgs.length;
    // A timer left running would keep posting progress into a closed worker.
    await vi.advanceTimersByTimeAsync(1000);
    expect(msgs).toHaveLength(after);
  });
});

describe('streaming the archive', () => {
  // The streaming path: the archive is Blob parts, not one heap allocation the size of every PDF.
  it('folds the output into Blob parts once past the threshold, and still unzips', async () => {
    // 6 MB per document, so the 4 MB fold threshold is crossed inside a single file.
    const big = new Uint8Array(6 * 1024 * 1024).fill(65);
    toBlob.mockImplementation(async () => new Blob([big], { type: 'application/pdf' }));

    const { msgs, post } = collect();
    await runJobs({ parsed, settings, uiLanguage: 'en' }, post);

    const d = done(msgs)!;
    const files = unzipSync(await bytesOf(d.blob));
    expect(Object.keys(files).sort()).toEqual(buildPdfJobs(parsed, settings).map(j => j.filename).sort());
    // Stored, not deflated, and byte-exact after the fold.
    expect(Object.values(files)[0]).toHaveLength(big.length);
  });
});
