import type { ScorecardEntry } from './wcif-parser';

// Surname particles: the surname starts at the first one after the first word.
const PARTICLES = new Set([
  'de', 'da', 'do', 'dos', 'das', 'del', 'della', 'di', 'du', 'des', 'van', 'von', 'der', 'den',
  'ter', 'ten', 'le', 'la', 'bin', 'ibn', 'al', 'el',
]);

// Two-surname naming: Spain, Portugal, Latin America and Lusophone Africa/Asia.
const TWO_SURNAMES = new Set([
  'ES', 'PT', 'BR', 'MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'DO', 'PR', 'CO', 'VE',
  'EC', 'PE', 'BO', 'PY', 'CL', 'AR', 'UY', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL', 'GQ',
]);

// Common compound given names in two-surname countries, accent-free and lower-case.
// ponytail: fixed list, extend it as real names come up.
const COMPOUND_GIVEN = new Set([
  'ana beatriz', 'ana carolina', 'ana clara', 'ana julia', 'ana laura', 'ana luiza', 'ana luisa',
  'ana maria', 'ana paula', 'ana sofia', 'maria clara', 'maria eduarda', 'maria fernanda',
  'maria jose', 'maria julia', 'maria luiza', 'maria luisa', 'maria paula', 'maria vitoria',
  'joao pedro', 'joao paulo', 'joao victor', 'joao vitor', 'joao gabriel', 'joao lucas',
  'pedro henrique', 'luiz felipe', 'luis felipe', 'luiz fernando', 'luis fernando',
  'carlos eduardo', 'jose luis', 'jose antonio', 'jose maria', 'juan carlos', 'juan pablo',
  'juan jose', 'juan manuel', 'juan sebastian', 'juan david', 'juan diego', 'juan esteban',
  'miguel angel', 'luis miguel', 'jose miguel', 'maria camila', 'maria alejandra', 'maria paz',
  'paulo henrique', 'luiz henrique', 'luis carlos', 'luiz gustavo', 'joao guilherme',
]);

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Splits a printed name at the surname. Words are space-separated; a hyphenated part is one word. */
export function splitName(name: string, countryIso2: string): { given: string; surname: string } {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return { given: words.join(' '), surname: '' };
  const twoSurnames = TWO_SURNAMES.has(countryIso2.toUpperCase());
  if (twoSurnames && words.length > 2 && COMPOUND_GIVEN.has(fold(`${words[0]} ${words[1]}`))) {
    return { given: words.slice(0, 2).join(' '), surname: words.slice(2).join(' ') };
  }
  const particle = words.findIndex((w, i) => i > 0 && i < words.length - 1 && PARTICLES.has(w.toLowerCase()));
  const at = particle !== -1 ? particle
    : words.length === 2 ? 1
    : words.length - (twoSurnames ? 2 : 1);
  return { given: words.slice(0, at).join(' '), surname: words.slice(at).join(' ') };
}

// Per group (stations folded into their cover group), accent- and case-insensitive.
export function markSharedFirstNames(named: { entry: ScorecardEntry; country: string }[]): void {
  const byKey = new Map<string, { entry: ScorecardEntry; surname: string }[]>();
  for (const { entry, country } of named) {
    const { given, surname } = splitName(entry.name, country);
    const key = `${entry.eventId}|${entry.roundNum}|${entry.coverGroup ?? entry.group}|${fold(given.split(' ')[0])}`;
    byKey.set(key, [...(byKey.get(key) ?? []), { entry, surname }]);
  }
  for (const same of byKey.values()) {
    if (same.length < 2) continue;
    for (const { entry, surname } of same) if (surname) entry.underlinedSurname = surname;
  }
}
