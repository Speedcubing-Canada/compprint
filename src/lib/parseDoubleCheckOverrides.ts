import type { ScrambleDoubleCheckOverrides } from '../types/settings';
import { csvRows } from './csv';

/**
 * Parse the scramble double-checking override file.
 *
 * Format: CSV, one competitor per line, no header:
 *   WCAID,event1,event2,...
 * e.g.
 *   2015FOOB01,333,444
 *   2018BARS02,333bf,555bf
 *
 * Lines with a WCA ID but no events are skipped. WCA IDs are upper-cased; event IDs are
 * lower-cased and de-duplicated.
 */
export function parseDoubleCheckOverrides(text: string): ScrambleDoubleCheckOverrides {
  const out: ScrambleDoubleCheckOverrides = {};
  for (const row of csvRows(text)) {
    const tokens = row.filter(Boolean);
    if (tokens.length < 2) continue; // need a WCA ID + at least one event

    const wcaId = tokens[0]!.toUpperCase();
    const existing = out[wcaId] ?? [];
    for (const ev of tokens.slice(1).map(t => t.toLowerCase())) {
      if (!existing.includes(ev)) existing.push(ev);
    }
    out[wcaId] = existing;
  }
  return out;
}
