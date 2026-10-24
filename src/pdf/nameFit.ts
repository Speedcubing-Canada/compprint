// Competitor-name sizing for scorecards and name tags. Pure, so the layout tests can import it.
import { SCORECARD_HEADER as H } from './layoutConstants';

// Advance widths (1/1000 em) of the embedded Scorecard Sans, which shares Helvetica's metrics
// and also covers the letters Helvetica lacks (Ł, ł, Đ). The test checks each against the OTF.
// Regular lists the accented i's: they sit on the 278-wide dotless i, not the 222-wide i.
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
    // Dropping marks folds "é" to "e"; the horn (U+031B) stays, since Ơ and Ư are wider.
    const base = ch.normalize('NFD').replace(/(?!̛)\p{M}/gu, '').normalize('NFC');
    w += widths.get(ch) ?? (base === '' ? 0 : widths.get(base) ?? 1000);
  }
  return (w / 1000) * fontSize;
}

// Name cell minus 4pt clear of each neighbour. Height: the header minus the ID line, and the
// comp-name line when shown.
export function nameBox(cardW: number, hasLogo: boolean, withCompName: boolean) {
  const leftW = hasLogo ? H.logoCellW : H.compNameCellW;
  return {
    w: cardW - 2 * (H.cardBorder + H.cardPadH + H.nameCellPadH + 4) - leftW,
    h: H.h - H.idLineH - (withCompName ? H.compNameLineH : 0),
  };
}

export const NAME_MAX_FS = 18;
export const NAME_MIN_FS = 7;
// Built-in Helvetica's line box ((900 + 200) / 1000), so one-line names sit where they always did.
export const NAME_LINE_HEIGHT = 1.1;
// Two lines win when one would be hard to read across a table, or when they print
// `wrapGainFs` bigger. Scorecards set a high bar: the originals keep 13pt+ names on one line.
const WRAP_BELOW_FS = 11;
const SCORECARD_WRAP_GAIN_FS = 3;

// `oneLineFs` overrides the measured one-line size (name tags keep the originals' sizes).
export function nameLayout(
  name: string, availW: number, availH: number,
  { bold = true, maxFs = NAME_MAX_FS, wrapGainFs = SCORECARD_WRAP_GAIN_FS, oneLineFs }:
    { bold?: boolean; maxFs?: number; wrapGainFs?: number; oneLineFs?: number } = {},
): { text: string; fontSize: number } {
  const t = name.normalize('NFC').trim().replace(/\s+/g, ' ') || ' ';
  const fit = (lines: string[]) => Math.min(
    maxFs,
    availW / Math.max(...lines.map(l => textWidth(l, 1, bold)), 1),
    availH / (lines.length * NAME_LINE_HEIGHT),
  );
  const one = { text: t, fontSize: oneLineFs ?? fit([t]) };
  // Break at a space, or after a hyphen keeping it on the first line. When height caps every
  // split at the same size, a space beats a hyphen ("Charles-Olivier" stays whole), then evenness.
  const rank = (fs: number, atSpace: boolean, longest: number) => [fs, atSpace ? 1 : 0, -longest];
  let two = { text: t, fontSize: 0, rank: [0, 0, -Infinity] };
  for (let i = 1; i < t.length; i++) {
    if (t[i] !== ' ' && t[i - 1] !== '-') continue;
    const lines = [t.slice(0, i), t.slice(i).trimStart()];
    const fs = fit(lines);
    const r = rank(fs, t[i] === ' ', Math.max(...lines.map(l => textWidth(l, 1, bold))));
    const k = r.findIndex((v, j) => v !== two.rank[j]);
    if (k !== -1 && r[k] > two.rank[k]) two = { text: lines.join('\n'), fontSize: fs, rank: r };
  }
  const wrap = two.fontSize > one.fontSize
    && (one.fontSize < WRAP_BELOW_FS || two.fontSize >= one.fontSize + wrapGainFs);
  const best = wrap ? two : one;
  return { text: best.text, fontSize: Math.max(NAME_MIN_FS, Math.floor(best.fontSize * 2) / 2) };
}

// Vertical name tags: panel padding (7) and border (1.5) a side, plus 4pt clear.
export const NAMETAG_NAME_MAX_FS = 20;
export const nametagNameW = (panelW: number) => panelW - 2 * (7 + 1.5 + 4);

// One line keeps the originals' length-based size; two lines once they are 2pt bigger. The size
// counts characters, not glyph widths, so it is capped where a wide name would overrun the panel.
export function nametagName(name: string, panelW: number, availH: number, compact: boolean) {
  const inner = panelW - 2 * (7 + 1.5);
  const fits = Math.floor((inner / Math.max(textWidth(name, 1, false), 1)) * 2) / 2;
  const legacy = Math.min(fits, NAMETAG_NAME_MAX_FS, Math.max(9, Math.floor((panelW - 14) / Math.max(name.length * 0.55, 1))));
  if (compact) return { text: name, fontSize: Math.min(14, legacy) };
  return nameLayout(name, nametagNameW(panelW), availH, { bold: false, maxFs: NAMETAG_NAME_MAX_FS, wrapGainFs: 2, oneLineFs: legacy });
}
