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

/** Page-1 words with their boxes, through poppler. */
export function pdfWords(pdf: Uint8Array) {
  const xml = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', '-', '-'], { input: pdf, encoding: 'utf8' });
  return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map(([, x0, y0, x1, y1, text]) => ({ text, xMin: +x0, yMin: +y0, xMax: +x1, yMax: +y1 }));
}
