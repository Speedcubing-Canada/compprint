import type { Person } from '../types/wcif';
import type { StaffCsvLine } from '../types/settings';
import { csvRows } from './csv';
import { fold } from './splitName';
import { getsNametag, isOfficial, isWcaId, printedName } from './person';

const ID_HEADER = /^(wca[ _-]?id|id)$/;
const NAME_HEADER = /^((full )?name|nom( complet| et prenom)?|prenom( et)? nom|nombre( completo| y apellidos?)?|nome( completo| e sobrenome)?)$/;

// Letters NFD keeps whole, so "Søren" still matches a "Soren" line.
const STROKED: Record<string, string> = { ø: 'o', ł: 'l', đ: 'd', ħ: 'h', ß: 'ss', æ: 'ae', œ: 'oe' };

export const staffNameKey = (name: string) =>
  fold(name.trim().replace(/\s+/g, ' ')).replace(/[øłđħßæœ]/g, c => STROKED[c]!);

const lineKey = (who: string) => (isWcaId(who) ? who.toUpperCase() : staffNameKey(who));

/**
 * Staff team file, one person per line:
 *   WCAID-or-full-name[,badge title]
 * A line with both a name and a WCA ID is matched on the ID. A header row is skipped, and one
 * naming the second column a name keeps it from being read as a title. A repeated person keeps
 * their last line.
 */
export function parseStaffCsv(text: string): StaffCsvLine[] {
  const rows = csvRows(text);
  const header = rows[0] && [ID_HEADER, NAME_HEADER].some(re => re.test(staffNameKey(rows[0]![0]!))) ? rows.shift() : undefined;
  const namedColumn = !!header?.[1] && NAME_HEADER.test(staffNameKey(header[1]));
  const byKey = new Map<string, StaffCsvLine>();
  for (const [first = '', ...rest] of rows) {
    const idSecond = !isWcaId(first) && isWcaId(rest[0] ?? '');
    const who = idSecond ? rest[0]! : first;
    if (!who) continue;
    const extra = idSecond || namedColumn ? rest.slice(1) : rest;
    byKey.set(lineKey(who), { who, extra: extra.map(f => f.toUpperCase()) });
  }
  return [...byKey.values()];
}

export interface StaffMatch {
  // Badge title per listed person; null = the translated STAFF title.
  labels: Map<Person, string | null>;
  // Lines matching no one who gets a name tag.
  unmatched: string[];
  // Lines whose name several people share.
  ambiguous: string[];
  // Printed names of listed Delegates and organizers: their own badge wins unless the line has a title.
  officials: string[];
}

const namesPerson = (field: string, p: Person) =>
  [p.name, printedName(p.name)].some(n => staffNameKey(n) === staffNameKey(field));

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
  const found: [StaffCsvLine, Person][] = [];
  for (const line of lines) {
    const key = lineKey(line.who);
    if (shared.has(key)) { out.ambiguous.push(line.who); continue; }
    const p = (isWcaId(key) ? byWcaId : byName).get(key);
    if (p) found.push([line, p]); else out.unmatched.push(line.who);
  }
  // ponytail: one exact name in the second column marks it a name column for the whole file; a
  // file whose every name is misspelled still prints them as titles.
  const nameColumn = found.some(([{ extra }, p]) => !!extra[0] && namesPerson(extra[0], p));
  const officials = new Set<string>();
  for (const [{ extra }, p] of found) {
    const title = extra[nameColumn ? 1 : 0] || null;
    if (isOfficial(p)) officials.add(printedName(p.name));
    if (title || !isOfficial(p)) out.labels.set(p, title);
    else out.labels.delete(p);
  }
  out.officials = [...officials];
  return out;
}
