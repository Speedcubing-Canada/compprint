import { fold } from './splitName';

// key: an upper-cased WCA ID, or a folded full name. label: null = the translated STAFF title.
export interface StaffCsvLine {
  key: string;
  label: string | null;
}

const WCA_ID_RE = /^\d{4}[A-Z]{4}\d{2}$/i;

export const isWcaId = (s: string) => WCA_ID_RE.test(s);

export const staffNameKey = (name: string) => fold(name.trim().replace(/\s+/g, ' '));

/**
 * Staff team file, one person per line, no header:
 *   WCAID-or-full-name[,badge label]
 * `#` comments and blank lines are skipped. A repeated person keeps their last line.
 */
export function parseStaffCsv(text: string): StaffCsvLine[] {
  const byKey = new Map<string, string | null>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [who, label] = line.split(',').map(t => t.trim().replace(/^"|"$/g, '').trim());
    if (!who) continue;
    const key = isWcaId(who) ? who.toUpperCase() : staffNameKey(who);
    byKey.delete(key);
    byKey.set(key, label ? label.toUpperCase() : null);
  }
  return [...byKey].map(([key, label]) => ({ key, label }));
}
