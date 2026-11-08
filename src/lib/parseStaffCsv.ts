import type { Person } from '../types/wcif';
import type { StaffCsvLine } from '../types/settings';
import { csvRows } from './csv';
import { fold } from './splitName';
import { getsNametag, isOfficial, isWcaId, printedName } from './person';

const HEADER_RE = /^(wca[ _]?id|id|(full )?name|nom( complet)?|nombre( completo)?|nome( completo)?)$/;

// Letters NFD keeps whole, so "Søren" still matches a "Soren" line.
const STROKED: Record<string, string> = { ø: 'o', ł: 'l', đ: 'd', ħ: 'h', ß: 'ss', æ: 'ae', œ: 'oe' };

export const staffNameKey = (name: string) =>
  fold(name.trim().replace(/\s+/g, ' ')).replace(/[øłđħßæœ]/g, c => STROKED[c]!);

/**
 * Staff team file, one person per line:
 *   WCAID-or-full-name[,badge label]
 * A header row is skipped. A repeated person keeps their last line.
 */
export function parseStaffCsv(text: string): StaffCsvLine[] {
  const rows = csvRows(text);
  if (rows[0] && HEADER_RE.test(staffNameKey(rows[0][0]!))) rows.shift();
  const byKey = new Map<string, StaffCsvLine>();
  for (const [who = '', label] of rows) {
    if (!who) continue;
    const key = isWcaId(who) ? who.toUpperCase() : staffNameKey(who);
    byKey.set(key, { key, who, label: label ? label.toUpperCase() : null });
  }
  return [...byKey.values()];
}

export interface StaffMatch {
  // Badge label per listed person; null = the translated STAFF title.
  labels: Map<Person, string | null>;
  // Lines matching no one who gets a name tag.
  unmatched: string[];
  // Lines whose name several people share.
  ambiguous: string[];
  // Printed names of listed Delegates and organizers: their own badge wins unless the line has a label.
  officials: string[];
}

// A name-and-WCA-ID sheet's second column names the person, it is not a badge.
const namesPerson = (label: string, p: Person) =>
  isWcaId(label) || [p.name, printedName(p.name)].some(n => staffNameKey(n) === staffNameKey(label));

/** Resolves staff lines against the people who get a name tag; a name matches with or without its local suffix. */
export function matchStaff(persons: Person[], lines: StaffCsvLine[], staffNametags: boolean): StaffMatch {
  const byWcaId = new Map<string, Person>();
  const byName = new Map<string, Person>();
  const shared = new Set<string>();
  for (const p of persons) {
    if (!getsNametag(p, staffNametags)) continue;
    if (p.wcaId) byWcaId.set(p.wcaId.toUpperCase(), p);
    for (const key of new Set([staffNameKey(p.name), staffNameKey(printedName(p.name))])) {
      if (byName.has(key)) shared.add(key);
      byName.set(key, p);
    }
  }
  const out: StaffMatch = { labels: new Map(), unmatched: [], ambiguous: [], officials: [] };
  for (const { key, who, label } of lines) {
    if (shared.has(key)) { out.ambiguous.push(who); continue; }
    const p = (isWcaId(key) ? byWcaId : byName).get(key);
    if (!p) { out.unmatched.push(who); continue; }
    out.labels.set(p, label && !namesPerson(label, p) ? label : null);
  }
  for (const [p, label] of out.labels) {
    if (!isOfficial(p)) continue;
    out.officials.push(printedName(p.name));
    if (label === null) out.labels.delete(p);
  }
  return out;
}
