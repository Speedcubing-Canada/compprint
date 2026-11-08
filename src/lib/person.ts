import type { Person } from '../types/wcif';

// Drops the "(local name)" suffix. NFC, since the PDF fonts have accented letters but no
// standalone combining marks (a decomposed ư would lose its horn).
export function printedName(name: string): string {
  return name.replace(/ \(.*\)$/, '').normalize('NFC');
}

export const isDelegateRole = (p: Person) => p.roles.some(r => r === 'delegate' || r === 'trainee-delegate');

// Not competing: a volunteer, or an official not accepted as a competitor.
export function isNonCompetingStaff(p: Person): boolean {
  const official = isDelegateRole(p) || p.roles.includes('organizer');
  // ponytail: no account-type flag in the WCIF. An unregistered official with no WCA ID is
  // taken for an org account, so a never-competed human organizer gets no tag.
  const looksHuman = !!p.registration || !!p.wcaId;
  return p.registration?.isCompeting === false
    || (official && p.registration?.status !== 'accepted' && looksHuman);
}

export const getsNametag = (p: Person, staffNametags: boolean) =>
  isNonCompetingStaff(p) ? staffNametags : p.registration?.status === 'accepted';
