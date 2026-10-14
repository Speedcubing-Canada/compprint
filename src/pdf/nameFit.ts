// Competitor-name sizing for scorecards and name tags. Pure, so the layout tests can import it.

// Helvetica advance widths (1/1000 em), grouped by width. Letters Helvetica lacks (Ł, ł, Đ)
// take the embedded clone's widths, since only that font draws them.
const BOLD_GROUPS: Record<number, string> = {
  238: "'",
  278: 'Iijl .,’ı',
  333: 'ft-()',
  389: 'r',
  418: 'ł',
  474: '"',
  500: 'z',
  556: 'Jacekvsxy0123456789',
  611: 'FLTZbdghnopquøßðþđ',
  664: 'ħ',
  667: 'EPSVXYÞ',
  680: 'ơ',
  716: 'Ł',
  720: 'ư',
  722: 'ABCDHKNRUÐĐĦ',
  778: 'GOQwØ',
  812: 'Ơ',
  829: 'Ư',
  833: 'M',
  889: 'mæ',
  944: 'Wœ',
};
const REGULAR_GROUPS: Record<number, string> = {
  191: "'",
  222: 'ijl’ı',
  278: 'I .,ftìíîïĩīĭįǐȉỉ',
  305: 'ł',
  333: '-()r',
  355: '"',
  500: 'zJckvsxy',
  556: 'ae0123456789Lbdghnopquøðþđ',
  571: 'ơ',
  593: 'ħ',
  611: 'FTZß',
  614: 'ư',
  628: 'Ł',
  667: 'EPSVXYÞABK',
  722: 'CDHNRUÐĐĦw',
  778: 'GOQØƠ',
  781: 'Ư',
  833: 'Mm',
  889: 'æ',
  944: 'Wœ',
};
const widthMap = (groups: Record<number, string>) => new Map<string, number>(
  Object.entries(groups).flatMap(([w, chars]) => [...chars].map(c => [c, Number(w)] as const)),
);
const BOLD_W = widthMap(BOLD_GROUPS);
const REGULAR_W = widthMap(REGULAR_GROUPS);

// Unknown glyphs (CJK, symbols) count as a full em so the name errs small, never clipped.
export function textWidth(text: string, fontSize: number, bold = true): number {
  const widths = bold ? BOLD_W : REGULAR_W;
  let w = 0;
  for (const ch of text.normalize('NFC')) {
    // Dropping marks folds "é" to "e"; the horn stays, since Ơ and Ư are wider than O and U.
    const base = ch.normalize('NFD').replace(/(?!̛)\p{M}/gu, '').normalize('NFC');
    w += widths.get(ch) ?? (base === '' ? 0 : widths.get(base) ?? 1000);
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

export const NAME_MAX_FS = 16;
export const NAME_MIN_FS = 7;
// Below this a one-line name is hard to read across a table, so try two lines.
const WRAP_BELOW_FS = 11;
export const NAME_LINE_HEIGHT = 1.1;

export function nameLayout(
  name: string, availW: number, availH: number,
  { bold = true, maxFs = NAME_MAX_FS, wrapBelow = WRAP_BELOW_FS } = {},
): { text: string; fontSize: number } {
  const fit = (lines: string[]) => Math.min(
    maxFs,
    availW / Math.max(...lines.map(l => textWidth(l, 1, bold)), 1),
    availH / (lines.length * NAME_LINE_HEIGHT),
  );
  const one = fit([name]);
  let best = { text: name, fontSize: one };
  if (one < wrapBelow) {
    const t = name.trim().replace(/\s+/g, ' ');
    // Break at a space, or after a hyphen keeping it on the first line.
    for (let i = 1; i < t.length; i++) {
      if (t[i] !== ' ' && t[i - 1] !== '-') continue;
      const lines = [t.slice(0, i), t.slice(i).trimStart()];
      const fs = fit(lines);
      if (fs > best.fontSize) best = { text: lines.join('\n'), fontSize: fs };
    }
  }
  return { text: best.text, fontSize: Math.max(NAME_MIN_FS, Math.floor(best.fontSize * 2) / 2) };
}
