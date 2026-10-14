import type { LiveResultsMode, PaperFormat } from '../types/settings';

// Shared by the PDF documents (worker) and the page-count estimator (main thread).
// Must stay free of any @react-pdf import, or the estimator drags the PDF engine into
// the main bundle.

// One of the 14 PDF base fonts: no embedding, identical in every viewer.
export const PDF_FONT = 'Helvetica';
export const PDF_FONT_BOLD = 'Helvetica-Bold';

// Schedule tracker and Round Checklist share a clipboard, so they share their chrome.
// Row tint stays light enough to photocopy.
export const TABLE_BORDER = '0.75pt solid #888';
export const TABLE_BORDER_INNER = '0.5pt solid #bbb';
export const TABLE_ROW_ALT = '#f2f2f2';
export const TABLE_HEADER_BG = '#d8d8d8';

// 2x2 grid.
export const SCORECARDS_PER_PAGE = 4;

// Past this, a bucket splits into one PDF per event. See "Generation performance" in the README.
export const MAX_PAGES_PER_SCORECARD_PDF = 250;

// Tuned so the flex spacers around the provisional label stay 6-8pt each; the budget
// formula is in ScorecardDocument.tsx, the guard in scorecard-layout.test.ts.
export const ROW_HEIGHTS = {
  avg5: 34, 'bo2-avg5': 31, mo3: 51, 'bo1-mo3': 49, bo2: 55, bo1: 100,
} as const;

// A4 cards are 28pt taller than LETTER (373 vs 345). The rows absorb it, so the spacers keep
// their LETTER size instead of leaving a gap around the provisional label.
const A4_EXTRA_CARD_H = 28;

/** `rows` counts the numbered attempt rows; the extra row takes its share too. */
export function scorecardRowHeight(
  format: keyof typeof ROW_HEIGHTS, paper: 'A4' | 'LETTER', rows: number,
): number {
  return ROW_HEIGHTS[format] + (paper === 'A4' ? A4_EXTRA_CARD_H / (rows + 1) : 0);
}

// Four people per page, front + back panel each.
export const NAMETAGS_PER_PAGE = 4;

// Same ceiling, same reason.
export const MAX_PAGES_PER_NAMETAG_PDF = 250;

// The compact layout is tight enough that the QR side must stay uncluttered.
export function eventIconsVisible({ isQrSide, compact }: { isQrSide: boolean; compact: boolean }): boolean {
  return !(isQrSide && compact);
}

// Flex units, not points: the table fills the page width. `event` carries the longest
// text in the table (FR "3x3x3 à Une Main Tour 1", ~127pt) and has the least headroom.
// checking-sheet-layout.test.ts asserts every cell fits in every locale on both paper
// sizes: widen the column rather than truncating a translation.
export const CHECKING_FLEX = {
  start: 1,
  event: 2.7,
  groups: 1,
  scorecards: 1.1,
  dataEntry: 1.3,
  doubleCheck: 1.35,
  takenBy: 1.55,
};

// Taller than the schedule tracker's 6pt: these columns are filled in by hand.
export const CHECKING_CELL_PAD_V = 9;

// Shared with ScorecardDocument styles.coverCheckBox: same box in either mode.
export const CHECKING_BOX = 9;

// Lunch divider. Must read as one against the 0.5pt #bbb ordinary row rule.
export const CHECKING_BREAK_RULE = '1.5pt solid #444';
export const CHECKING_BREAK_RULE_W = 1.5;

// First-timer slip pitch. Fixed-height rows because @react-pdf inflates lineHeight by a
// constant factor. Sized so three large slips (4-5 events) still fit one page.
export const SLIP_FONT_SIZE = 10;
export const SLIP_LINE_H = 13;
export const SLIP_PAGE_PAD_TOP = 38;
export const SLIP_PAGE_PAD_BOTTOM = 36;
// One blank line beyond the base 18pt, so the cut point is unmistakable.
export const SLIP_MARGIN_BOTTOM = 18 + SLIP_LINE_H;
export const SLIP_INTRO_MARGIN_BOTTOM = 20;

// `hideWcaLiveId` only suppresses the line where there is no ID to print (liveId ''):
// blank, extra and custom-event cards. A competitor's card always keeps its ID.
export const showLiveIdLine = (hideWcaLiveId: boolean, liveId: string) =>
  !hideWcaLiveId || liveId !== '';

// The two live-results systems use unrelated competitor ids: wca-live needs a numeric
// competition id and person id off its GraphQL API, ilr builds the URL from ids already
// in hand. A missing wca-live id falls back to the home page, so the QR still scans.
export function liveQrTarget(
  cfg: {
    mode: LiveResultsMode;
    competitionId: string;
    wcaLiveId: string | null;
    wcaLivePersonIds: Record<number, string> | null;
  },
  entry: { registrantId: number; registrationId: number; blank?: boolean },
): { url: string; label: string } {
  if (cfg.mode === 'ilr') {
    const live = `https://www.worldcubeassociation.org/competitions/${cfg.competitionId}/live`;
    return {
      url: entry.blank ? live : `${live}/competitors/${entry.registrationId}`,
      label: 'worldcubeassociation.org',
    };
  }
  const personId = cfg.wcaLivePersonIds?.[entry.registrantId] ?? null;
  const home = 'https://live.worldcubeassociation.org';
  const comp = `${home}/competitions/${cfg.wcaLiveId}`;
  return {
    url: !cfg.wcaLiveId ? home
      : entry.blank ? comp
      : personId ? `${comp}/competitors/${personId}`
      : home,
    label: 'live.worldcubeassociation.org',
  };
}

// Group Overview. Flex units, not points: the table fills the page width. Competitor
// names carry an ordinal prefix and judge lists are the longest, so those two are wider.
// group-overview-layout.test.ts asserts every header fits in every locale on both sizes.
export const GROUP_OVERVIEW_FLEX = {
  competitors: 1.45,
  scramblers: 1,
  runners: 1,
  judges: 1.45,
};

export const GROUP_OVERVIEW = {
  pagePadH: 30,
  pagePadV: 36,
  fontSize: 9,
  lineH: 12,
  headerH: 18,
  headingH: 17,   // "3x3x3 Cube Round 1 - Group 2"
  subHeadH: 14,   // "09:00 - 09:25   Room: Salon"
  dayLabelH: 19,
  cellPadV: 4,
  blockGap: 14,
  titleH: 40,
};

const PAGE_H: Record<PaperFormat, number> = { LETTER: 792, A4: 842 };

/** One group's block, including the gap below it. Shared so the estimator cannot drift. */
export function groupBlockHeight(maxColumnRows: number, withDayLabel: boolean): number {
  const G = GROUP_OVERVIEW;
  return (withDayLabel ? G.dayLabelH : 0)
    + G.headingH + G.subHeadH
    + G.headerH + maxColumnRows * G.lineH + 2 * G.cellPadV
    + G.blockGap;
}

/**
 * True when a block is short enough to be worth pinning with wrap={false}. react-pdf squashes
 * an oversized non-breaking block instead of paginating it (see the Round Checklist note in
 * the README), so a freakishly large group has to be allowed to break across pages.
 */
export function groupBlockFitsPage(
  maxColumnRows: number, withDayLabel: boolean, paperFormat: PaperFormat,
): boolean {
  const usable = (PAGE_H[paperFormat] ?? PAGE_H.LETTER) - 2 * GROUP_OVERVIEW.pagePadV;
  return groupBlockHeight(maxColumnRows, withDayLabel) <= usable;
}

/**
 * Blocks are wrap={false}, so one that does not fit the remaining height starts a new page.
 * A block taller than a whole page still gets its own, which is what @react-pdf does with it.
 */
export function estimateGroupOverviewPages(
  blocks: { rows: number; withDayLabel: boolean }[],
  paperFormat: PaperFormat,
): number {
  if (blocks.length === 0) return 0;
  const usable = (PAGE_H[paperFormat] ?? PAGE_H.LETTER) - 2 * GROUP_OVERVIEW.pagePadV;
  let pages = 1;
  let used = GROUP_OVERVIEW.titleH;
  for (const b of blocks) {
    const h = groupBlockHeight(b.rows, b.withDayLabel);
    if (used > 0 && used + h > usable) { pages++; used = 0; }
    used += h;
  }
  return pages;
}
