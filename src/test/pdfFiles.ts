import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

/** A download as filename → bytes: a zip unpacked, a bare PDF as itself. */
export const unpack = (name: string, bytes: Uint8Array): Record<string, Uint8Array> =>
  name.endsWith('.zip') ? unzipSync(bytes) : { [name]: bytes };

export const pageCount = async (pdf: Uint8Array) => (await PDFDocument.load(pdf)).getPageCount();

export const hasPdftotext = (() => {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

/** The PDF's text, through poppler. */
export const pdfText = (pdf: Uint8Array) =>
  execFileSync('pdftotext', ['-raw', '-', '-'], { input: pdf, encoding: 'utf8' });
