import type { GroupOverviewEntry } from '../lib/wcif-parser';
import type { GroupOverviewStrings } from '../lib/i18n';
import type { PaperFormat } from '../types/settings';
import { GROUP_OVERVIEW as G, GROUP_OVERVIEW_FLEX, PAGE_W, TABLE_BORDER_W, TABLE_BORDER_INNER_W } from './layoutConstants';
import { textWidth } from './nameFit';

// Beside the document rather than in it, so the layout test can import this without
// dragging @react-pdf in (and so the document file only exports a component).

export type ColumnKey = 'competitors' | 'scramblers' | 'runners' | 'judges';

export const COLUMNS: { key: ColumnKey; flex: number; label: (s: GroupOverviewStrings) => string }[] = [
  { key: 'competitors', flex: GROUP_OVERVIEW_FLEX.competitors, label: (s) => s.competitors },
  { key: 'scramblers',  flex: GROUP_OVERVIEW_FLEX.scramblers,  label: (s) => s.scramblers },
  { key: 'runners',     flex: GROUP_OVERVIEW_FLEX.runners,     label: (s) => s.runners },
  { key: 'judges',      flex: GROUP_OVERVIEW_FLEX.judges,      label: (s) => s.judges },
];

/**
 * A staff column empty for every group is dropped rather than printed blank: before the
 * organizer assigns staff, the WCIF has groups but no scramblers, runners or judges.
 * Document-wide, not per group, so the columns do not shift between blocks on one page.
 */
export function visibleColumns(entries: Pick<GroupOverviewEntry, ColumnKey>[]) {
  return COLUMNS.filter(
    (c) => c.key === 'competitors' || entries.some((e) => e[c.key].length > 0),
  );
}

/** The ordinal IS the station number when the WCIF assigns stations. */
export const cellText = (key: ColumnKey, name: string, i: number) =>
  key === 'competitors' ? `${i + 1}. ${name}` : name;

/**
 * Lines `text` prints on at `width`. Breaks at spaces, and inside a word too wide for a line.
 * Hyphen and CJK break points are not modelled, so those can only overcount.
 */
export function lineCount(text: string, width: number, fontSize = G.fontSize, bold = false): number {
  const space = textWidth(' ', fontSize, bold);
  let lines = 1;
  let used = 0;
  for (const word of text.split(' ')) {
    let w = textWidth(word, fontSize, bold);
    if (used > 0 && used + space + w > width) { lines++; used = 0; }
    for (; w > width; w -= width) lines++;
    used += (used > 0 ? space : 0) + w;
  }
  return lines;
}

export const TITLE_FS = 18;

export const overviewTitle = (competitionName: string, s: GroupOverviewStrings) => `${competitionName} ${s.title}`;

/** The title's height, margin included: it wraps on a long competition name. */
export function titleHeight(title: string, paperFormat: PaperFormat): number {
  return G.titleGap + G.titleLineH * lineCount(title, PAGE_W[paperFormat] - 2 * G.pagePadH, TITLE_FS, true);
}

/** Printed lines in the group's tallest column. Wraps up to 0.1pt earlier than react-pdf. */
export function groupBlockRows(
  entry: Pick<GroupOverviewEntry, ColumnKey>, columns: typeof COLUMNS, paperFormat: PaperFormat,
): number {
  const flex = columns.reduce((n, c) => n + c.flex, 0);
  const tableW = PAGE_W[paperFormat] - 2 * G.pagePadH - 2 * TABLE_BORDER_W - (columns.length - 1) * TABLE_BORDER_INNER_W;
  return Math.max(...columns.map((c) => {
    const w = (tableW * c.flex) / flex - 2 * G.cellPadH;
    return entry[c.key].reduce((n, name, i) => n + lineCount(cellText(c.key, name, i), w), 0);
  }));
}
