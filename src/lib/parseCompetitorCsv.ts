import type { CustomCompetitor } from '../types/settings';
import { csvRows } from './csv';
import { isWcaId } from './person';

/**
 * One competitor per line: `Name` or `Name,WCAID`.
 *
 * A "name" header row is skipped. The WCA ID is the LAST field matching the ID shape;
 * everything before it is the name, re-joined with ", " so "Doe, John,2019DOEJ01" survives
 * without quoting. Empty names are skipped, duplicates kept (two rows, two cards).
 */
export function parseCompetitorCsv(text: string): CustomCompetitor[] {
  const rows = csvRows(text);
  if (rows[0]?.[0]?.toLowerCase() === 'name') rows.shift();

  const out: CustomCompetitor[] = [];
  for (const fields of rows) {
    const last = fields[fields.length - 1]!;
    const hasId = fields.length > 1 && isWcaId(last);
    const name = (hasId ? fields.slice(0, -1) : fields).filter(Boolean).join(', ');
    if (name) out.push({ name, wcaId: hasId ? last.toUpperCase() : '' });
  }
  return out;
}
