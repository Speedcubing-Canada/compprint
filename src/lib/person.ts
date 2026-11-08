import type { Person } from '../types/wcif';

// Drops the "(local name)" suffix. NFC, since the PDF fonts have accented letters but no
// standalone combining marks (a decomposed ư would lose its horn).
export function printedName(name: string): string {
  return name.replace(/ \(.*\)$/, '').normalize('NFC');
}

export const isWcaId = (s: string) => /^\d{4}[A-Z]{4}\d{2}$/i.test(s);

export const isDelegateRole = (p: Person) => p.roles.some(r => r === 'delegate' || r === 'trainee-delegate');

export const isOfficial = (p: Person) => isDelegateRole(p) || p.roles.includes('organizer');

// Not competing: a volunteer, or an official not accepted as a competitor.
export function isNonCompetingStaff(p: Person): boolean {
  // ponytail: no account-type flag in the WCIF. An unregistered official with no WCA ID is
  // taken for an org account, so a never-competed human organizer gets no tag.
  const looksHuman = !!p.registration || !!p.wcaId;
  return p.registration?.isCompeting === false
    || (isOfficial(p) && p.registration?.status !== 'accepted' && looksHuman);
}

export const getsNametag = (p: Person, staffNametags: boolean) =>
  isNonCompetingStaff(p) ? staffNametags : p.registration?.status === 'accepted';
