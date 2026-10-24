import type { CustomEvent, CustomEventFormat } from '../types/settings';
import { printedName, type ScorecardData, type ScorecardEntry, type ScorecardFormat } from './wcif-parser';

import { scorecardsPerPage } from '../pdf/layoutConstants';

/**
 * Map a custom event's chosen format to the card layout. Mirrors the WCIF
 * mapping in getScorecardFormat: bo3 uses the mo3 layout (3 attempt rows,
 * WCIF format '3' behaves the same); bo2/bo1 have no post-cutoff phase, so a
 * cutoff is meaningless and ignored for them.
 */
export function resolveCustomFormat(format: CustomEventFormat, hasCutoff: boolean): ScorecardFormat {
  switch (format) {
    case 'avg5': return hasCutoff ? 'bo2-avg5' : 'avg5';
    case 'mo3':
    case 'bo3':  return hasCutoff ? 'bo1-mo3' : 'mo3';
    case 'bo2':  return 'bo2';
    case 'bo1':  return 'bo1';
  }
}

/**
 * Build the scorecards for one custom event: without competitors, a page of
 * identical blank cards; with competitors, one named card per row padded with
 * blank cards to fill the last page. liveId is always '' - custom
 * competitions are unofficial and never reference WCA Live.
 */
export function buildCustomEntries(custom: CustomEvent, a6 = false): ScorecardData[] {
  // bo2/bo1 have no post-cutoff phase - drop any stray cutoff value.
  const hasCutoff = custom.cutoff.trim() !== '' && custom.format !== 'bo2' && custom.format !== 'bo1';
  const format = resolveCustomFormat(custom.format, hasCutoff);
  const blank: ScorecardEntry = {
    kind: 'scorecard',
    timeslot: 'ZZZ',
    eventId: 'custom',
    eventName: custom.name,
    roundLabel: custom.roundLabel?.trim() ?? '',
    roundNum: 0,
    group: '',
    name: '',
    wcaId: '',
    liveId: '',
    gender: '',
    cutoff: hasCutoff ? custom.cutoff.trim() : '',
    limit: custom.limit.trim(),
    format,
    isCumulative: false,
    iconDataUrl: custom.iconDataUrl ?? undefined,
  };

  const entries: ScorecardData[] = (custom.competitors ?? []).map((c) => ({
    ...blank,
    name: printedName(c.name),
    wcaId: c.wcaId,
  }));
  while (entries.length === 0 || entries.length % scorecardsPerPage(a6) !== 0) entries.push(blank);
  return entries;
}

/** Cards `buildCustomEntries` returns, without building them. */
export function customEventCardCount(custom: CustomEvent, a6 = false): number {
  const perPage = scorecardsPerPage(a6);
  return Math.max(1, Math.ceil((custom.competitors?.length ?? 0) / perPage)) * perPage;
}
