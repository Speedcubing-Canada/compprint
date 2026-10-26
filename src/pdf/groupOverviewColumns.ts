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

/** Lines one name prints on, wrapped at spaces the way react-pdf does when it is wider than its cell. */
function lineCount(text: string, width: number): number {
  const space = textWidth(' ', G.fontSize, false);
  let lines = 1;
  let used = 0;
  for (const word of text.split(' ')) {
    const w = textWidth(word, G.fontSize, false);
    if (used > 0 && used + space + w > width) { lines++; used = w; }
    else used += (used > 0 ? space : 0) + w;
  }
  return lines;
}

/**
 * Printed lines in the group's tallest column, the row count its block is sized by. The table's
 * borders come off before the flex split. Measured against react-pdf, this wraps up to 0.1pt
 * early: a name in that band costs the estimate a line it does not print.
 */
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
