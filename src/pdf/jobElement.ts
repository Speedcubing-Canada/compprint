import React from 'react';
import type { ParsedWCIF } from '../lib/wcif-parser';
import type { CompetitionSettings } from '../types/settings';
import { buildCustomEntries } from '../lib/customScorecards';
import type { PdfJob } from '../lib/pdfJobs';
import { ScorecardDocument } from './ScorecardDocument';
import { NametTagDocument } from './NametTagDocument';
import { ScheduleTrackerDocument } from './ScheduleTrackerDocument';
import { CheckingSheetDocument } from './CheckingSheetDocument';
import { FirstTimerSlipDocument } from './FirstTimerSlipDocument';
import { GroupOverviewDocument } from './GroupOverviewDocument';
import { RENDER_PART_PAGES, NAMETAGS_PER_PAGE, scorecardsPerPage } from './layoutConstants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Element = any;

/** @react-pdf's element typing does not survive a generic component, so the casts live here. */
function e<P extends object>(component: (props: P) => Element, props: P): Element {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return React.createElement(component as any, props);
}

/**
 * Out of scorecardWorker.ts, which assigns `self.onmessage` at module scope and so cannot be
 * imported: this is what render.pdf.test.ts exercises.
 */
export function jobElement(
  job: PdfJob, parsed: ParsedWCIF, settings: CompetitionSettings,
): Element {
  switch (job.kind) {
    case 'nametags':     return e(NametTagDocument,        { nametags: job.nametags, settings });
    case 'schedule':     return e(ScheduleTrackerDocument, { days: parsed.scheduleDays, settings });
    case 'checking':     return e(CheckingSheetDocument,   { days: parsed.checkingDays, settings });
    case 'first-timers': return e(FirstTimerSlipDocument,  { entries: parsed.firstTimers, settings });
    case 'group-overview': return e(GroupOverviewDocument, { entries: parsed.groupOverview, settings });
    case 'custom':       return e(ScorecardDocument,       { entries: buildCustomEntries(job.custom, settings.scorecardsA6), settings });
    case 'scorecards':   return e(ScorecardDocument,       { entries: job.entries, settings });
    // Element is `any`, so a missing case would compile and hand the worker `undefined`.
    default: { const _exhaustive: never = job; throw new Error(`unhandled job kind: ${JSON.stringify(_exhaustive)}`); }
  }
}

/** Whole-page slices of at most `size`; always at least one, so an empty job still renders. */
function slices<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length > 0 ? out : [items];
}

/**
 * The job as page-capped documents, to render one at a time and merge: @react-pdf's heap grows
 * with page count (see "Generation performance" in the README), so a big file is drawn in parts.
 */
export function jobElements(
  job: PdfJob, parsed: ParsedWCIF, settings: CompetitionSettings,
): Element[] {
  if (job.kind === 'scorecards') {
    const size = RENDER_PART_PAGES * scorecardsPerPage(settings.scorecardsA6 === true);
    return slices(job.entries, size).map(entries => e(ScorecardDocument, { entries, settings }));
  }
  if (job.kind === 'nametags')
    return slices(job.nametags, RENDER_PART_PAGES * NAMETAGS_PER_PAGE)
      .map(nametags => e(NametTagDocument, { nametags, settings }));
  return [jobElement(job, parsed, settings)];
}
