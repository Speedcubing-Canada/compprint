import type { Person } from '../types/wcif';
import { fold } from './splitName';
import { getsNametag, isDelegateRole, printedName } from './person';

// key: an upper-cased WCA ID, or a folded full name. who: the line as typed, for warnings.
// label: null = the translated STAFF title.
export interface StaffCsvLine {
  key: string;
  who: string;
  label: string | null;
}

const WCA_ID_RE = /^\d{4}[A-Z]{4}\d{2}$/i;
const HEADER_RE = /^(wca ?id|id|name|nom|nombre|nome)$/;

export const isWcaId = (s: string) => WCA_ID_RE.test(s);

export const staffNameKey = (name: string) => fold(name.trim().replace(/\s+/g, ' '));

// Comma, semicolon (Excel in fr/es/pt) or tab separated; "double quotes" may hold a separator.
function splitFields(line: string): string[] {
  const out = [''];
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { out[out.length - 1] += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) out.push('');
    else out[out.length - 1] += ch;
  }
  return out.map(f => f.trim());
}

/**
 * Staff team file, one person per line:
 *   WCAID-or-full-name[,badge label]
 * `#` comments, blank lines and a header row are skipped. A repeated person keeps their last line.
 */
export function parseStaffCsv(text: string): StaffCsvLine[] {
  const byKey = new Map<string, StaffCsvLine>();
  let first = true;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [who = '', label] = splitFields(line);
    if (first && HEADER_RE.test(staffNameKey(who))) { first = false; continue; }
    first = false;
    if (!who) continue;
    const key = isWcaId(who) ? who.toUpperCase() : staffNameKey(who);
    byKey.set(key, { key, who, label: label ? label.toUpperCase() : null });
  }
  return [...byKey.values()];
}

export interface StaffMatch {
  // registrantId -> badge label; null = the translated STAFF title.
  byRegistrantId: Map<number, string | null>;
  // Lines matching no one who gets a name tag.
  unmatched: string[];
  // Lines whose name several people share.
  ambiguous: string[];
  // Printed names of matched Delegates and organizers, whose own badge wins without a label.
  officials: string[];
}

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
  const out: StaffMatch = { byRegistrantId: new Map(), unmatched: [], ambiguous: [], officials: [] };
  const officials = new Map<number, string>();
  for (const { key, who, label } of lines) {
    if (shared.has(key)) { out.ambiguous.push(who); continue; }
    const p = (isWcaId(key) ? byWcaId : byName).get(key);
    if (!p) { out.unmatched.push(who); continue; }
    if (isDelegateRole(p) || p.roles.includes('organizer')) {
      officials.set(p.registrantId, printedName(p.name));
      if (!label) continue;
    }
    out.byRegistrantId.set(p.registrantId, label);
  }
  out.officials = [...officials.values()];
  return out;
}
