import type { ParsedWCIF } from './wcif-parser';
import type { PdfJob } from './pdfJobs';
import type { CompetitionSettings } from '../types/settings';
import { customEventCardCount } from './customScorecards';
import { getFirstTimerSlipStrings } from './i18n';
import { packSlipPages } from '../pdf/firstTimerSlipLines';
import { groupBlockRows, visibleColumns } from '../pdf/groupOverviewColumns';
import {
  scorecardsPerPage, NAMETAGS_PER_PAGE, estimateGroupOverviewPages,
} from '../pdf/layoutConstants';

/**
 * Printed page count, shown before the render runs. Exact where pagination is fixed N-per-page,
 * estimated for the flowing documents. Counts `jobs`, not `parsed`, so it matches the ZIP.
 */
export function estimateTotalPages(
  parsed: ParsedWCIF, settings: CompetitionSettings, jobs: PdfJob[],
): number {
  let pages = 0;

  // Per job, not per parse: a split bucket pads each file to a full sheet separately.
  const perPage = scorecardsPerPage(settings.scorecardsA6);
  for (const job of jobs) {
    if (job.kind === 'scorecards') pages += Math.ceil(job.entries.length / perPage);
    if (job.kind === 'nametags')   pages += Math.ceil(job.nametags.length / NAMETAGS_PER_PAGE);
  }

  // Each custom event is its own PDF: a page of blanks, or the CSV competitors padded to a page.
  pages += (settings.customEvents ?? [])
    .filter((c) => c.name.trim() !== '')
    .reduce((n, c) => n + customEventCardCount(c, settings.scorecardsA6) / perPage, 0);

  // A single flowing page, estimated.
  if (parsed.scheduleDays.length > 0) pages += 1;

  // `checkingDays` is already empty when the checklist wasn't selected.
  if (parsed.checkingDays.length > 0) pages += 1;

  // Exact: the document packs the same wrap={false} blocks from the same constants and row count.
  const multiDay = new Set(parsed.groupOverview.map(e => e.dayLabel)).size > 1;
  const columns = visibleColumns(parsed.groupOverview);
  pages += estimateGroupOverviewPages(
    parsed.groupOverview.map((e, i, all) => ({
      rows: groupBlockRows(e, columns, settings.paperFormat),
      withDayLabel: multiDay && e.dayLabel !== all[i - 1]?.dayLabel,
    })),
    settings.paperFormat,
  );

  // Exact: the document renders this same packing.
  if (parsed.firstTimers.length > 0) {
    pages += estimateSlipPages(parsed, settings);
  }

  return pages;
}

function estimateSlipPages(parsed: ParsedWCIF, settings: CompetitionSettings): number {
  return packSlipPages(
    parsed.firstTimers,
    getFirstTimerSlipStrings(settings.language),
    settings.language,
    settings.paperFormat,
  ).length;
}
