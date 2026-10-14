import { PDFDocument } from 'pdf-lib';

/** Concatenates PDFs, producing each part only when its turn comes, so one part's render is live at a time. */
export async function mergePdfs(parts: Array<() => Promise<ArrayBuffer | Uint8Array>>): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(await part());
    if (out.getPageCount() === 0) {
      out.setTitle(src.getTitle() ?? '');
      out.setAuthor(src.getAuthor() ?? '');
    }
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return out.save();
}
