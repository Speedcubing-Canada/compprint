import type { WCIF } from '../types/wcif';

export const WCA_OAUTH_URL = 'https://www.worldcubeassociation.org/oauth/authorize';
// Always same-origin: in dev the Vite middleware serves it, in production server.js does.
// Either way it must be proxied - WCA's token endpoint sends no CORS headers.
const WCA_TOKEN_URL = '/wca-token';
export const WCA_API_URL = 'https://www.worldcubeassociation.org/api/v0';

export const CLIENT_ID = import.meta.env.VITE_WCA_CLIENT_ID as string;
export const REDIRECT_URI = import.meta.env.VITE_WCA_REDIRECT_URI || `${window.location.origin}/auth/callback`;

export interface WCAToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  created_at: number;
  /** Absent on a token stored before renewal existed; those sessions fall back to the redirect. */
  refresh_token?: string;
}

/** Carries the status so callers can tell an expired session from a server fault. */
export class WcaApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WcaApiError';
    this.status = status;
  }
}

/**
 * The i18n key for a failed authed call: an expired session reads differently from a server
 * fault, and anything that is not a WCA error is a data problem whose raw detail is the point.
 */
export function fetchErrorKey(e: unknown): 'errors.session_expired' | 'errors.wcif_failed' | null {
  if (!(e instanceof WcaApiError)) return null;
  return e.status === 401 ? 'errors.session_expired' : 'errors.wcif_failed';
}

/** WCA sends unix seconds. The skew stops a call started just before expiry from racing it. */
export function isExpired(token: WCAToken, skewMs = 60_000): boolean {
  return (token.created_at + token.expires_in) * 1000 - skewMs <= Date.now();
}

// Every authed call goes through authFetch, so the expired-session hook belongs here rather
// than repeated in each page.
let onAuthExpired: (() => void) | null = null;

export function setOnAuthExpired(fn: (() => void) | null): void {
  onAuthExpired = fn;
}

async function authFetch(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 401) onAuthExpired?.();
    throw new WcaApiError(res.status, `WCA request failed (${res.status}): ${url}`);
  }
  return res.json();
}

export interface WCAUser {
  id: number;
  name: string;
  wca_id: string | null;
  avatar?: { thumb_url: string };
  email: string;
}

export async function exchangeCodeForToken(code: string, verifier: string): Promise<WCAToken> {
  const res = await fetch(WCA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * Doorkeeper rotates: the response carries a new refresh token and invalidates the one spent
 * here, so the caller must persist the whole token, not just the access half.
 */
export async function refreshAccessToken(refreshToken: string): Promise<WCAToken> {
  const res = await fetch(WCA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Token refresh failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

export async function fetchMe(token: string): Promise<WCAUser> {
  const data = await authFetch(`${WCA_API_URL}/me`, token);
  return data.me;
}

export async function fetchManagedCompetitions(token: string) {
  return authFetch(`${WCA_API_URL}/competitions?managed_by_me=true&per_page=50`, token);
}

export async function fetchWcif(competitionId: string, token: string): Promise<WCIF> {
  return authFetch(`${WCA_API_URL}/competitions/${competitionId}/wcif/version/2`, token);
}

export interface CompetitionInfo {
  // 'internal' is ILR, 'wca_live' the separate site; null when unreadable.
  scoretakingSoftware: 'external' | 'wca_live' | 'internal' | null;
  onTheSpot: boolean;
}

/**
 * Fields only on the single-competition endpoint, public once announced: the token is
 * needed for unannounced competitions only. Never throws.
 */
export async function fetchCompetitionInfo(
  competitionId: string,
  token?: string,
): Promise<CompetitionInfo> {
  try {
    const res = await fetch(`${WCA_API_URL}/competitions/${competitionId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { scoretakingSoftware: null, onTheSpot: false };
    const json = await res.json();
    return {
      scoretakingSoftware: json?.scoretaking_software ?? null,
      onTheSpot: json?.on_the_spot_registration === true,
    };
  } catch {
    return { scoretakingSoftware: null, onTheSpot: false };
  }
}

const WCA_LIVE_API = 'https://live.worldcubeassociation.org/api';

/**
 * The numeric WCA Live competition ID, or null on any failure.
 *
 * Matched client-side over the whole list: WCA Live has no by-wcaId lookup, and its
 * `competitions(filter:)` matches on name, which can resolve to the wrong competition. The
 * list is currently-listed competitions only (~550 rows, ~25 KB).
 */
export async function fetchWcaLiveId(wcaId: string): Promise<string | null> {
  try {
    const res = await fetch(WCA_LIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ competitions { id wcaId } }' }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const competitions: { id: string; wcaId: string }[] = json?.data?.competitions ?? [];
    const match = competitions.find(c => c.wcaId === wcaId);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

/** registrantId → the numeric person id in live.worldcubeassociation.org URLs. */
export async function fetchWcaLivePersonIds(
  competitionLiveId: string,
): Promise<Record<number, string> | null> {
  try {
    const res = await fetch(WCA_LIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($id: ID!) { competition(id: $id) { competitors { id registrantId } } }`,
        variables: { id: competitionLiveId },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const competitors: { id: string; registrantId: number }[] =
      json?.data?.competition?.competitors ?? [];
    if (competitors.length === 0) return null;
    const map: Record<number, string> = {};
    for (const c of competitors) map[c.registrantId] = c.id;
    return map;
  } catch {
    return null;
  }
}
