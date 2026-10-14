import { pdf } from '@react-pdf/renderer';
import { Zip, ZipPassThrough } from 'fflate';
import type { ParsedWCIF } from '../lib/wcif-parser';
import type { CompetitionSettings, LocaleCode } from '../types/settings';
import { buildPdfJobs, downloadTarget, type PdfJob } from '../lib/pdfJobs';
import { getWorkerStrings } from '../lib/i18n';
import { jobElements } from './jobElement';
import { mergePdfs } from './mergePdfs';

// Split out of scorecardWorker.ts so it imports neither `self` nor the Buffer polyfill and
// can run outside a worker.

export type WorkerRequest = {
  parsed: ParsedWCIF;
  settings: CompetitionSettings;
  uiLanguage: LocaleCode;
};

export type WorkerResponse =
  | { type: 'progress'; percent: number; message: string }
  // A Blob, not an ArrayBuffer: its bytes live outside the JS heap.
  | { type: 'done'; blob: Blob; filename: string; mimeType: string }
  | { type: 'error'; message: string };

export type Post = (msg: WorkerResponse) => void;

async function renderJob(
  job: PdfJob, parsed: ParsedWCIF, settings: CompetitionSettings,
): Promise<Blob> {
  const elements = jobElements(job, parsed, settings);
  if (elements.length === 1) return pdf(elements[0]).toBlob();
  const merged = await mergePdfs(elements.map(el => async () => (await pdf(el).toBlob()).arrayBuffer()));
  return new Blob([merged as BlobPart], { type: 'application/pdf' });
}

// Bytes held in the JS heap before the pending chunks are folded into a Blob part.
const FOLD_BYTES = 4 * 1024 * 1024;

/** Accumulates the ZIP stream, folding pending chunks into a Blob every few MB. */
class BlobSink {
  private parts: BlobPart[] = [];
  private pending = 0;

  push(chunk: Uint8Array): void {
    // Copied: fflate reuses its output buffer, and a Blob part must not change underneath.
    this.parts.push(chunk.slice());
    this.pending += chunk.length;
    if (this.pending >= FOLD_BYTES) {
      this.parts = [new Blob(this.parts)];
      this.pending = 0;
    }
  }

  blob(type: string): Blob {
    return new Blob(this.parts, { type });
  }
}

/** Streams one rendered PDF into the archive, a chunk at a time. */
async function addToZip(zip: Zip, filename: string, blob: Blob): Promise<void> {
  // level 0: these are PDFs, already compressed. Deflating them costs time and saves
  // nothing, which is what the old zipSync({ level: 0 }) said too.
  const file = new ZipPassThrough(filename);
  zip.add(file);
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    file.push(value);
  }
  file.push(new Uint8Array(0), true);
}

export async function runJobs({ parsed, settings, uiLanguage }: WorkerRequest, post: Post) {
  const msgs = getWorkerStrings(uiLanguage);

  // Shared with the generate page, so its stat and button label cannot drift from this.
  const jobs = buildPdfJobs(parsed, settings);
  const target = downloadTarget(jobs, settings.competitionId);

  if (jobs.length === 0) {
    post({ type: 'error', message: msgs.noEntries });
    return;
  }

  post({ type: 'progress', percent: 2, message: msgs.starting });

  try {
    // A single document ships as the PDF itself, not a one-file zip.
    if (jobs.length === 1) {
      post({ type: 'progress', percent: 5, message: msgs.rendering(jobs[0].label) });
      const blob = await renderJob(jobs[0], parsed, settings);
      post({ type: 'progress', percent: 99, message: msgs.finalizing });
      post({ type: 'done', blob, filename: target.filename, mimeType: target.mimeType });
      return;
    }

    const sink = new BlobSink();
    let zipError: Error | null = null;
    const zip = new Zip((err, chunk) => {
      if (err) zipError = err;
      else if (chunk) sink.push(chunk);
    });

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const startPct = Math.round(5  + (i / jobs.length) * 87);
      const endPct   = Math.round(5  + ((i + 1) / jobs.length) * 87);
      const capPct   = endPct - 3;

      post({ type: 'progress', percent: startPct, message: msgs.rendering(job.label) });

      // Closes 6% of the remaining gap per tick, minimum 0.4%: visibly moving, never stalled.
      let fpct = startPct;
      const timer = setInterval(() => {
        fpct = Math.min(fpct + Math.max(0.4, (capPct - fpct) * 0.06), capPct);
        post({ type: 'progress', percent: Math.round(fpct), message: msgs.rendering(job.label) });
      }, 100);

      try {
        // Not retained past this iteration: one document's bytes at a time is the budget.
        await addToZip(zip, job.filename, await renderJob(job, parsed, settings));
        clearInterval(timer);
        if (zipError) throw zipError;
        post({ type: 'progress', percent: endPct, message: msgs.done(job.label) });
      } catch (err) {
        clearInterval(timer);
        throw err;
      }
    }

    post({ type: 'progress', percent: 95, message: msgs.creatingZip });
    zip.end();
    if (zipError) throw zipError;
    post({ type: 'progress', percent: 99, message: msgs.finalizing });
    post({ type: 'done', blob: sink.blob(target.mimeType), filename: target.filename, mimeType: target.mimeType });
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
}
