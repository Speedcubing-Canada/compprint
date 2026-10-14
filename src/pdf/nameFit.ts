// Competitor-name sizing for the scorecard header. Pure, so the layout tests can import it.

// Helvetica-Bold AFM advance widths (1/1000 em), grouped by width.
const WIDTH_GROUPS: Record<number, string> = {
  238: "'",
  278: 'Iijl .,',
  333: 'ft-()',
  389: 'r',
  500: 'z',
  556: 'Jacekvsxy0123456789',
  611: 'FLTZbdghnopqu',
  667: 'EPSVXY',
  722: 'ABCDHKNRU',
  778: 'GOQw',
  833: 'M',
  889: 'm',
  944: 'W',
};
const BOLD_W = new Map<string, number>(
  Object.entries(WIDTH_GROUPS).flatMap(([w, chars]) => [...chars].map(c => [c, Number(w)] as const)),
);

// Unknown glyphs (CJK, symbols) count as a full em so the name errs small, never clipped.
export function boldWidth(text: string, fontSize: number): number {
  let w = 0;
  // NFD folds "é" to "e" plus a zero-width combining mark.
  for (const ch of text.normalize('NFD')) {
    if (/\p{M}/u.test(ch)) continue;
    w += BOLD_W.get(ch) ?? 1000;
  }
  return (w / 1000) * fontSize;
}

// Card minus border (1.5) and padding (3) a side, the left cell, the name cell's padding
// (3) a side, and 4pt clear of each neighbour. Height: 56pt header minus the ID line (~11)
// and the comp-name line (~12) when shown.
export function nameBox(cardW: number, hasLogo: boolean, withCompName: boolean) {
  const leftW = hasLogo ? 80 : 26;
  return { w: cardW - 9 - leftW - 6 - 8, h: 56 - 11 - (withCompName ? 12 : 0) };
}

export const NAME_MAX_FS = 18;
export const NAME_MIN_FS = 7;
// Below this a one-line name is hard to read across a table, so try two lines.
const WRAP_BELOW_FS = 11;
export const NAME_LINE_HEIGHT = 1.1;

export function nameLayout(name: string, availW: number, availH: number): { text: string; fontSize: number } {
  const fit = (lines: string[]) => Math.min(
    NAME_MAX_FS,
    availW / Math.max(...lines.map(l => boldWidth(l, 1)), 1),
    availH / (lines.length * NAME_LINE_HEIGHT),
  );
  const one = fit([name]);
  let best = { text: name, fontSize: one };
  if (one < WRAP_BELOW_FS) {
    const words = name.split(' ');
    for (let i = 1; i < words.length; i++) {
      const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const fs = fit(lines);
      if (fs > best.fontSize) best = { text: lines.join('\n'), fontSize: fs };
    }
  }
  return { text: best.text, fontSize: Math.max(NAME_MIN_FS, Math.floor(best.fontSize * 2) / 2) };
}
