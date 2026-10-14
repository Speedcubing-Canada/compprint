import type { CustomEvent, CustomEventFormat } from '../types/settings';
import type { ScorecardData, ScorecardEntry, ScorecardFormat } from './wcif-parser';

const CARDS_PER_PAGE = 4;

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
 * Build the scorecards for one custom event: without competitors, a page of 4
 * identical blank cards; with competitors, one named card per row padded with
 * blank cards to fill the last 4-card page. liveId is always '' - custom
 * competitions are unofficial and never reference WCA Live.
 */
export function buildCustomEntries(custom: CustomEvent): ScorecardData[] {
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

  const competitors = custom.competitors ?? [];
  if (competitors.length === 0) {
    return [blank, blank, blank, blank];
  }

  const entries: ScorecardData[] = competitors.map((c) => ({
    ...blank,
    name: c.name,
    wcaId: c.wcaId,
  }));
  while (entries.length % CARDS_PER_PAGE !== 0) entries.push(blank);
  return entries;
}

/** Printed pages for one custom event. */
export function customEventPageCount(custom: CustomEvent, perPage = CARDS_PER_PAGE): number {
  const n = custom.competitors?.length ?? 0;
  const cards = n > 0 ? Math.ceil(n / CARDS_PER_PAGE) * CARDS_PER_PAGE : CARDS_PER_PAGE;
  return cards / perPage;
}
