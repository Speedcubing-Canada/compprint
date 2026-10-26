import type { WCIF } from '../types/wcif';

// Tiny in-memory cache so the WCIF fetched on the scope step can be reused by GeneratePage
// without a second network round-trip. Lives for the SPA session; a hard reload clears it,
// in which case consumers fall back to fetching again. Keyed by competition id.
const cache = new Map<string, WCIF>();

export function getCachedWcif(competitionId: string): WCIF | undefined {
  return cache.get(competitionId);
}

export function setCachedWcif(competitionId: string, wcif: WCIF): void {
  cache.set(competitionId, wcif);
}

export function clearWcifCache(): void {
  cache.clear();
}
