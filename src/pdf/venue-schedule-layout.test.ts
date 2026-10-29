import { describe, expect, it } from 'vitest';
import {
  PAGE_H, VENUE_SCHEDULE as V, VENUE_DAY_COLS as DAY_COLS, VENUE_EVENT_COLS as EVENT_COLS,
  VENUE_ROUND_COLS as ROUND_COLS, VENUE_ICON as ICON,
} from './layoutConstants';
import { textWidth } from './nameFit';
import { getVenueScheduleStrings } from '../lib/i18n';
import type { LocaleCode } from '../types/settings';

// Rows have a fixed height the page estimate counts on, so nothing in them may wrap.
// Letter is the narrower page in landscape.
const contentW = PAGE_H.LETTER - 2 * V.pagePadH;
const share = (cols: Record<string, number>, k: string, of = contentW) =>
  (cols[k] / Object.values(cols).reduce((a, b) => a + b, 0)) * of;
const roundsW = contentW - share(EVENT_COLS, 'event');
const CELL_PAD = 8;

describe.each<LocaleCode>(['en', 'fr', 'es', 'pt'])('%s labels fit their column on one line', (lang) => {
  const t = getVenueScheduleStrings(lang);
  const format = `${t.formats['2']} / ${t.formats.a}`;

  it.each([
    ['format', format, 9, false],
    ['proceed', t.topPercent(50), 9, false],
    ['proceed', t.top(100), 9, false],
    ['timeLimit', t.cumulative('1:00:00.00'), 9, false],
    ['start', '12:55 PM', 9, false],
  ] as const)('day %s: %s', (col, text, size, bold) => {
    expect(textWidth(text, size, bold)).toBeLessThan(share(DAY_COLS, col) - CELL_PAD);
  });

  it.each([
    ['format', format],
    ['proceed', t.topPercent(50)],
    ['timeLimit', t.cumulative('1:00:00.00')],
  ] as const)('events %s: %s', (col, text) => {
    expect(textWidth(text, 9, false)).toBeLessThan(share(ROUND_COLS, col, roundsW) - CELL_PAD);
  });

  it('every translated activity name', () => {
    // Icon on the left, a spacer of the same width on the right, the gaps and padding.
    const room = share(DAY_COLS, 'activity') - 2 * ICON - 2 * 6 - 12;
    for (const name of Object.values(t.activities)) expect(textWidth(name, 10), name).toBeLessThan(room);
  });
});
