// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WCA_API_URL,
  WcaApiError,
  exchangeCodeForToken,
  fetchErrorKey,
  isExpired,
  refreshAccessToken,
  setOnAuthExpired,
  fetchManagedCompetitions,
  fetchMe,
  fetchCompetitionInfo,
  fetchWcaLiveId,
  fetchWcaLivePersonIds,
  fetchWcif,
} from './wca';

// Authed calls throw WcaApiError carrying the status: the pages pick a translated string off
// it, so `statusText` (empty over HTTP/2) is never what the organizer reads.
// The three WCA Live functions instead return null on every failure, by design.
//
// jsdom, not node: the module reads `window.location.origin` at import time for REDIRECT_URI.

function stubFetch(...responses: Partial<Response>[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (json: unknown): Partial<Response> => ({
  ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json),
});
const fail = (status: number, statusText = '', body = ''): Partial<Response> => ({
  ok: false, status, statusText, json: async () => ({}), text: async () => body,
});

/** The single argument list the stub was called with. */
const callArgs = (fn: ReturnType<typeof vi.fn>, i = 0) =>
  fn.mock.calls[i] as [string, RequestInit | undefined];

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('exchangeCodeForToken', () => {
  it('posts the PKCE grant to the same-origin proxy', async () => {
    const fn = stubFetch(ok({ access_token: 'tok' }));
    const token = await exchangeCodeForToken('the-code', 'the-verifier');

    expect(token).toEqual({ access_token: 'tok' });
    const [url, init] = callArgs(fn);
    // Must be same-origin: WCA's token endpoint sends no CORS headers, so a direct
    // call from the browser cannot work.
    expect(url).toBe('/wca-token');
    expect(init?.method).toBe('POST');

    const body = new URLSearchParams(init?.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('client_id')).toBe('test-client-id');
    // The secret is added server-side and must never appear in a browser-built body.
    expect(body.get('client_secret')).toBeNull();
  });

  it('carries the status and the response body into the error', async () => {
    stubFetch(fail(401, 'Unauthorized', 'invalid_client'));
    await expect(exchangeCodeForToken('c', 'v'))
      .rejects.toThrow('Token exchange failed (401): invalid_client');
  });

  it('falls back to the status text when the body is empty', async () => {
    stubFetch(fail(500, 'Internal Server Error', ''));
    await expect(exchangeCodeForToken('c', 'v'))
      .rejects.toThrow('Token exchange failed (500): Internal Server Error');
  });

  it('still reports the status when the body cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502, statusText: 'Bad Gateway',
      text: async () => { throw new Error('stream closed'); },
    }));
    await expect(exchangeCodeForToken('c', 'v')).rejects.toThrow('Token exchange failed (502)');
  });
});

describe('fetchMe', () => {
  it('unwraps the me envelope', async () => {
    const fn = stubFetch(ok({ me: { id: 7, name: 'Test Organizer' } }));
    expect(await fetchMe('tok')).toEqual({ id: 7, name: 'Test Organizer' });

    const [url, init] = callArgs(fn);
    expect(url).toBe(`${WCA_API_URL}/me`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws with the status text', async () => {
    stubFetch(fail(403, 'Forbidden'));
    await expect(fetchMe('tok')).rejects.toThrow(WcaApiError);
  });
});

describe('fetchManagedCompetitions', () => {
  it('requests the organizer-managed page', async () => {
    const fn = stubFetch(ok([{ id: 'Comp2026' }]));
    expect(await fetchManagedCompetitions('tok')).toEqual([{ id: 'Comp2026' }]);

    const [url, init] = callArgs(fn);
    expect(url).toBe(`${WCA_API_URL}/competitions?managed_by_me=true&per_page=50`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws with the status text', async () => {
    stubFetch(fail(500, 'Server Error'));
    await expect(fetchManagedCompetitions('tok'))
      .rejects.toThrow(WcaApiError);
  });
});

describe('fetchWcif', () => {
  it('fetches the competition WCIF with the token', async () => {
    const fn = stubFetch(ok({ formatVersion: '1.0', id: 'Comp2026' }));
    expect(await fetchWcif('Comp2026', 'tok')).toEqual({ formatVersion: '1.0', id: 'Comp2026' });

    const [url, init] = callArgs(fn);
    expect(url).toBe(`${WCA_API_URL}/competitions/Comp2026/wcif/version/2`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws with the status code, which the generate page renders', async () => {
    stubFetch(fail(404, 'Not Found'));
    await expect(fetchWcif('Nope2026', 'tok')).rejects.toMatchObject({ status: 404 });
  });
});

// Null on any failure, so a WCA Live outage degrades the QR codes instead of blocking
// the download.

describe('fetchCompetitionInfo', () => {
  const none = { scoretakingSoftware: null, onTheSpot: false };

  it('reads both fields off the single-competition endpoint', async () => {
    const fn = stubFetch(ok({ scoretaking_software: 'internal', on_the_spot_registration: true }));
    expect(await fetchCompetitionInfo('Comp2026', 'tok'))
      .toEqual({ scoretakingSoftware: 'internal', onTheSpot: true });
    expect(callArgs(fn)[0]).toBe(`${WCA_API_URL}/competitions/Comp2026`);
  });

  it('sends no Authorization header when called without a token', async () => {
    // Announced competitions are public; only unannounced ones need the token.
    const fn = stubFetch(ok({ scoretaking_software: 'wca_live' }));
    expect((await fetchCompetitionInfo('Comp2026')).scoretakingSoftware).toBe('wca_live');
    expect(callArgs(fn)[1]?.headers).toEqual({});
  });

  it('reads absent or null fields as unknown / no OTS', async () => {
    stubFetch(ok({ on_the_spot_registration: null }));
    expect(await fetchCompetitionInfo('Comp2026')).toEqual(none);
  });

  it('returns the empty result rather than throwing on a bad status', async () => {
    stubFetch(fail(404));
    expect(await fetchCompetitionInfo('Comp2026')).toEqual(none);
  });

  it('returns the empty result rather than throwing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchCompetitionInfo('Comp2026')).toEqual(none);
  });
});

describe('fetchWcaLiveId', () => {
  const live = (competitions: unknown) => ok({ data: { competitions } });

  it('matches on wcaId client-side, not on name', async () => {
    // WCA Live's competitions(filter:) matches on *name*, which can differ from the WCA's
    // and resolve to the wrong competition - hence the whole-list fetch and local match.
    const fn = stubFetch(live([
      { id: '11', wcaId: 'Other2026' },
      { id: '42', wcaId: 'Comp2026' },
    ]));
    expect(await fetchWcaLiveId('Comp2026')).toBe('42');

    const [url, init] = callArgs(fn);
    expect(url).toBe('https://live.worldcubeassociation.org/api');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string).query).toContain('competitions');
  });

  it('returns null when no competition matches', async () => {
    stubFetch(live([{ id: '11', wcaId: 'Other2026' }]));
    expect(await fetchWcaLiveId('Comp2026')).toBeNull();
  });

  it('returns null when the payload has no competitions', async () => {
    stubFetch(ok({}));
    expect(await fetchWcaLiveId('Comp2026')).toBeNull();
  });

  it('returns null on a bad status or a network error', async () => {
    stubFetch(fail(503));
    expect(await fetchWcaLiveId('Comp2026')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchWcaLiveId('Comp2026')).toBeNull();
  });
});

describe('fetchWcaLivePersonIds', () => {
  const competitors = (list: unknown) => ok({ data: { competition: { competitors: list } } });

  it('maps registrantId to the WCA Live person id', async () => {
    const fn = stubFetch(competitors([
      { id: 'p1', registrantId: 1 },
      { id: 'p2', registrantId: 2 },
    ]));
    expect(await fetchWcaLivePersonIds('42')).toEqual({ 1: 'p1', 2: 'p2' });

    expect(JSON.parse(callArgs(fn)[1]?.body as string).variables).toEqual({ id: '42' });
  });

  it('returns null, not an empty map, when the competition has no competitors', async () => {
    // The caller stores this in settings.wcaLivePersonIds; an empty object would read as
    // "looked up successfully, nobody has an id" and print QR codes pointing nowhere.
    stubFetch(competitors([]));
    expect(await fetchWcaLivePersonIds('42')).toBeNull();
  });

  it('returns null when the competition is missing from the payload', async () => {
    stubFetch(ok({ data: { competition: null } }));
    expect(await fetchWcaLivePersonIds('42')).toBeNull();
  });

  it('returns null on a bad status or a network error', async () => {
    stubFetch(fail(500));
    expect(await fetchWcaLivePersonIds('42')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchWcaLivePersonIds('42')).toBeNull();
  });
});


describe('isExpired', () => {
  const at = (secondsFromNow: number) => ({
    access_token: 'tok', token_type: 'Bearer', scope: 'public',
    expires_in: 7200, created_at: Math.floor(Date.now() / 1000) - 7200 + secondsFromNow,
  });

  it('is false for a token with time left', () => {
    expect(isExpired(at(600))).toBe(false);
  });

  it('is true once the lifetime has run out', () => {
    expect(isExpired(at(-1))).toBe(true);
  });

  // Without the skew a call starting here would race its own expiry and 401 mid-flight.
  it('treats the last seconds before expiry as already gone', () => {
    expect(isExpired(at(30))).toBe(true);
    expect(isExpired(at(30), 0)).toBe(false);
  });
});

describe('refreshAccessToken', () => {
  it('posts the refresh grant to the same-origin proxy', async () => {
    const fresh = { access_token: 'new', refresh_token: 'r2', expires_in: 7200, created_at: 1 };
    const fn = stubFetch(ok(fresh));

    expect(await refreshAccessToken('r1')).toEqual(fresh);

    const [url, init] = callArgs(fn);
    expect(url).toBe('/wca-token');
    const body = new URLSearchParams(init!.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r1');
    // The secret is appended server-side; it must never reach the bundle.
    expect(body.get('client_secret')).toBeNull();
  });

  it('throws when the refresh token is spent', async () => {
    stubFetch(fail(401, 'Unauthorized', 'invalid_grant'));
    await expect(refreshAccessToken('r1')).rejects.toThrow('Token refresh failed (401): invalid_grant');
  });
});

describe('the expired-session hook', () => {
  afterEach(() => setOnAuthExpired(null));

  it('fires once on a 401 from any authed call', async () => {
    const onExpired = vi.fn();
    setOnAuthExpired(onExpired);
    stubFetch(fail(401));

    await expect(fetchManagedCompetitions('tok')).rejects.toThrow(WcaApiError);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a server fault, which renewing would not fix', async () => {
    const onExpired = vi.fn();
    setOnAuthExpired(onExpired);
    stubFetch(fail(500));

    await expect(fetchWcif('C2026', 'tok')).rejects.toThrow(WcaApiError);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe('fetchErrorKey', () => {
  it('separates an expired session from a server fault', () => {
    expect(fetchErrorKey(new WcaApiError(401, 'x'))).toBe('errors.session_expired');
    expect(fetchErrorKey(new WcaApiError(503, 'x'))).toBe('errors.wcif_failed');
  });

  // A parse fault has no sensible translation; the caller shows the raw detail instead.
  it('declines to classify a non-WCA error', () => {
    expect(fetchErrorKey(new Error('bad wcif'))).toBeNull();
  });
});
