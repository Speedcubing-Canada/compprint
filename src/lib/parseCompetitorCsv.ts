import type { CustomCompetitor } from '../types/settings';
import { isWcaId } from './parseStaffCsv';

/**
 * One competitor per line, unquoted: `Name` or `Name,WCAID`.
 *
 * Blank lines, `#` comments, a "name" header row and a leading BOM are skipped. The WCA ID is
 * the LAST comma-field matching the ID shape; everything before it is the name, re-joined with
 * ", " so "Doe, John,2019DOEJ01" survives without quoting. Empty names are skipped, duplicates
 * kept (two rows, two cards).
 */
export function parseCompetitorCsv(text: string): CustomCompetitor[] {
  const out: CustomCompetitor[] = [];
  if (!text) return out;

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let first = true;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const fields = line.split(',').map(f => f.trim());
    if (first) {
      first = false;
      if (fields[0].toLowerCase() === 'name') continue; // header row
    }

    let name: string;
    let wcaId: string;
    const last = fields[fields.length - 1];
    if (fields.length > 1 && isWcaId(last)) {
      wcaId = last.toUpperCase();
      name = fields.slice(0, -1).filter(Boolean).join(', ');
    } else {
      wcaId = '';
      name = fields.filter(Boolean).join(', ');
    }

    if (!name) continue;
    out.push({ name, wcaId });
  }

  return out;
}
