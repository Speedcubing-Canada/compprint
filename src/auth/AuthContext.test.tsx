// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { webcrypto } from 'node:crypto';

vi.mock('../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/analytics')>()),
  send: vi.fn(),
}));

import { send } from '../lib/analytics';
import { readCompetition, readIsCustom, writeCompetition, writeCustom } from '../lib/flowState';
import { AuthProvider } from './AuthContext';
import { fetchManagedCompetitions } from './wca';
import { useAuth, type AuthState } from './useAuth';

// The state check and the missing-verifier check are the app's only CSRF and PKCE defences,
// and each is one `if` deep.
//
// jsdom's crypto has getRandomValues but no subtle, which the S256 challenge needs: hence the
// webcrypto stub rather than a mocked pkce module. The real PKCE code runs here.

// Updated after every render rather than during one: reassigning an outer variable
// mid-render is the side effect react-hooks/globals rejects.
let auth: AuthState;
function Probe() {
  const ctx = useAuth();
  useEffect(() => { auth = ctx; });
  return null;
}

const mockSend = vi.mocked(send);
let hrefs: string[] = [];

function mount() {
  return render(<AuthProvider><Probe /></AuthProvider>);
}

// created_at must be live: a stale one reads as expired, and mounting would start a renewal
// these tests never asked for. The renewal describe below builds its own expired variants.
const token = {
  access_token: 'tok', token_type: 'Bearer', expires_in: 7200, scope: 'public',
  created_at: Math.floor(Date.now() / 1000),
};
const user = { id: 7, name: 'Test Organizer', wca_id: '2018TEST01' };

function stubExchange(...over: Partial<Response>[]) {
  const fn = vi.fn()
    .mockResolvedValueOnce(over[0] ?? { ok: true, status: 200, json: async () => token })
    .mockResolvedValueOnce(over[1] ?? { ok: true, status: 200, json: async () => ({ me: user }) });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', webcrypto);
  // jsdom refuses to navigate; capture the assignment instead of letting it warn.
  //
  // The setter closes over its own array rather than the live `hrefs` binding: a redirect
  // that settles after its own test ends then lands in that test's array, not the next one's.
  const mine: string[] = [];
  hrefs = mine;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'http://localhost:3000', pathname: '/', search: '',
      set href(v: string) { mine.push(v); },
    },
  });
});
afterEach(async () => {
  // Drain any redirect still in flight so it cannot land in the next test's location stub.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  cleanup();
  vi.unstubAllGlobals();
});

describe('login', () => {
  it('sends the organizer to the WCA with an S256 challenge and a stored state', async () => {
    mount();
    await act(() => auth.login());

    expect(hrefs).toHaveLength(1);
    const params = new URL(hrefs[0]).searchParams;
    expect(params.get('response_type')).toBe('code');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('client_id')).toBe('test-client-id');
    expect(params.get('scope')).toBe('public manage_competitions');
    // The state in the URL is what comes back; it has to be the one we can check against.
    expect(params.get('state')).toBe(sessionStorage.getItem('oauth_state'));

    const verifier = sessionStorage.getItem('pkce_verifier');
    const challenge = params.get('code_challenge')!;
    expect(verifier).toBeTruthy();
    // A challenge equal to the verifier means the hash step was skipped.
    expect(challenge).not.toBe(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a fresh verifier and state on every attempt', async () => {
    mount();
    await act(() => auth.login());
    const first = sessionStorage.getItem('pkce_verifier');
    await act(() => auth.login());
    expect(sessionStorage.getItem('pkce_verifier')).not.toBe(first);
  });
});

describe('handleCallback', () => {
  const arrive = () => {
    sessionStorage.setItem('oauth_state', 'the-state');
    sessionStorage.setItem('pkce_verifier', 'the-verifier');
  };

  it('refuses a state that does not match the one it stored', async () => {
    arrive();
    const fn = stubExchange();
    mount();

    await expect(act(() => auth.handleCallback('code', 'attacker-state')))
      .rejects.toThrow('OAuth state mismatch - possible CSRF');
    expect(fn).not.toHaveBeenCalled();
    expect(auth.token).toBeNull();
  });

  it('refuses a callback with no stored verifier', async () => {
    sessionStorage.setItem('oauth_state', 'the-state');
    const fn = stubExchange();
    mount();

    await expect(act(() => auth.handleCallback('code', 'the-state')))
      .rejects.toThrow('Missing PKCE verifier');
    expect(fn).not.toHaveBeenCalled();
  });

  it('consumes the state and the verifier before checking them, so neither can be replayed', async () => {
    arrive();
    stubExchange();
    mount();

    await expect(act(() => auth.handleCallback('code', 'wrong'))).rejects.toThrow();
    expect(sessionStorage.getItem('oauth_state')).toBeNull();
    expect(sessionStorage.getItem('pkce_verifier')).toBeNull();
  });

  it('exchanges the code, loads the user, and persists both', async () => {
    arrive();
    const fn = stubExchange();
    mount();
    await act(() => auth.handleCallback('the-code', 'the-state'));

    expect(auth.token).toEqual(token);
    expect(auth.user).toEqual(user);
    expect(JSON.parse(sessionStorage.getItem('wca_token')!)).toEqual(token);
    expect(JSON.parse(sessionStorage.getItem('wca_user')!)).toEqual(user);

    // The verifier reaches the token endpoint, and the fresh token reaches /me.
    expect(new URLSearchParams(fn.mock.calls[0][1].body).get('code_verifier')).toBe('the-verifier');
    expect(fn.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  it('reports one session event per sign-in', async () => {
    arrive();
    stubExchange();
    mount();
    await act(() => auth.handleCallback('the-code', 'the-state'));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  // A tab left open past the token life comes back through the same callback.
  it('reports no session event for a renewal redirect', async () => {
    arrive();
    sessionStorage.setItem('wca_token', JSON.stringify(token));
    stubExchange();
    mount();
    await act(() => auth.handleCallback('the-code', 'the-state'));
    expect(auth.token).toEqual(token);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('clears isLoading when the exchange fails', async () => {
    arrive();
    stubExchange({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' });
    mount();

    await expect(act(() => auth.handleCallback('code', 'the-state'))).rejects.toThrow();
    expect(auth.isLoading).toBe(false);
    expect(auth.token).toBeNull();
  });
});

describe('session restore and logout', () => {
  it('restores a token and user left by a previous mount', () => {
    sessionStorage.setItem('wca_token', JSON.stringify(token));
    sessionStorage.setItem('wca_user', JSON.stringify(user));
    mount();

    expect(auth.token).toEqual(token);
    expect(auth.user).toEqual(user);
  });

  it('logout drops both from state and from storage', async () => {
    sessionStorage.setItem('wca_token', JSON.stringify(token));
    sessionStorage.setItem('wca_user', JSON.stringify(user));
    mount();
    await act(async () => auth.logout());

    expect(auth.token).toBeNull();
    expect(sessionStorage.getItem('wca_token')).toBeNull();
    expect(sessionStorage.getItem('wca_user')).toBeNull();
  });

  it('logout also drops the wizard, so the next organizer starts clean', async () => {
    sessionStorage.setItem('wca_token', JSON.stringify(token));
    writeCompetition('GrosJouetsaMontreal2026', 'Gros Jouets à Montréal 2026');
    writeCustom([]);
    mount();
    await act(async () => auth.logout());

    expect(readCompetition()).toEqual({ id: '', name: '' });
    expect(readIsCustom()).toBe(false);
  });
});


const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('renewal', () => {
  const expired = { ...token, created_at: Math.floor(Date.now() / 1000) - 10_800, refresh_token: 'r1' };
  const fresh = { ...token, access_token: 'tok2', created_at: Math.floor(Date.now() / 1000), refresh_token: 'r2' };

  const stored = () => JSON.parse(sessionStorage.getItem('wca_token')!);

  function signedInWith(t: object) {
    sessionStorage.setItem('wca_token', JSON.stringify(t));
    sessionStorage.setItem('wca_user', JSON.stringify(user));
  }

  it('refreshes a token that expired while the tab sat open, without redirecting', async () => {
    signedInWith(expired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fresh }));

    await act(async () => { mount(); });
    await settle();

    expect(auth.token?.access_token).toBe('tok2');
    expect(hrefs).toEqual([]);
  });

  // Doorkeeper rotates: keeping the spent one would break the next renewal.
  it('persists the rotated refresh token', async () => {
    signedInWith(expired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fresh }));

    await act(async () => { mount(); });
    await settle();

    expect(stored().refresh_token).toBe('r2');
  });

  it('leaves a token with time left alone', async () => {
    const live = { ...token, created_at: Math.floor(Date.now() / 1000), refresh_token: 'r1' };
    signedInWith(live);
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);

    await act(async () => { mount(); });
    await settle();

    expect(fn).not.toHaveBeenCalled();
    expect(hrefs).toEqual([]);
  });

  it('falls back to the WCA redirect when the refresh token is spent', async () => {
    signedInWith(expired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid_grant' }));

    await act(async () => { mount(); });
    await settle();

    await vi.waitFor(() => expect(hrefs).toHaveLength(1));
    expect(hrefs[0].startsWith('https://www.worldcubeassociation.org/oauth/authorize')).toBe(true);
  });

  it('redirects straight away for a session stored before refresh tokens existed', async () => {
    const noRefresh = { ...expired, refresh_token: undefined };
    signedInWith(noRefresh);
    vi.stubGlobal('fetch', vi.fn());

    await act(async () => { mount(); });
    await settle();

    await vi.waitFor(() => expect(hrefs).toHaveLength(1));
  });

  it('stashes the current page so the wizard resumes where it was', async () => {
    signedInWith(expired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' }));
    const mine = hrefs;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3000', pathname: '/settings', search: '?x=1',
        set href(v: string) { mine.push(v); },
      },
    });

    await act(async () => { mount(); });
    await settle();

    expect(sessionStorage.getItem('post_login_return')).toBe('/settings?x=1');
    await vi.waitFor(() => expect(hrefs).toHaveLength(1));
  });

  // Without the cooldown a token that keeps 401ing would bounce through WCA forever.
  it('signs out instead of redirecting twice in a row', async () => {
    signedInWith(expired);
    sessionStorage.setItem('renew_attempt', String(Date.now()));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' }));

    await act(async () => { mount(); });
    await settle();

    expect(hrefs).toEqual([]);
    expect(auth.token).toBeNull();
    expect(auth.authError).toBe('session_expired');
  });

  it('renews when a 401 comes back despite the expiry looking fine', async () => {
    signedInWith({ ...token, created_at: Math.floor(Date.now() / 1000), refresh_token: 'r1' });
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' })
      .mockResolvedValue({ ok: true, status: 200, json: async () => fresh });
    vi.stubGlobal('fetch', fn);
    mount();

    // A revoked token passes the clock check, so only the server can report it.
    await act(async () => { await fetchManagedCompetitions('tok').catch(() => {}); });
    await settle();

    expect(auth.token?.access_token).toBe('tok2');
  });

  // The reported case: the tab sat open past the 2h token life and was switched back to.
  it('renews on tab refocus, before anything can render a fetch error', async () => {
    signedInWith({ ...token, created_at: Math.floor(Date.now() / 1000), refresh_token: 'r1' });
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fresh });
    vi.stubGlobal('fetch', fn);
    await act(async () => { mount(); });
    expect(fn).not.toHaveBeenCalled();

    // Time passes while the tab is in the background.
    sessionStorage.setItem('wca_token', JSON.stringify(expired));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();

    expect(auth.token?.access_token).toBe('tok2');
  });

  it('ignores a visibility change that is not a refocus', async () => {
    signedInWith(expired);
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fresh });
    vi.stubGlobal('fetch', fn);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    await act(async () => { mount(); });
    await settle();

    expect(fn).not.toHaveBeenCalled();
    // clearAllMocks leaves a getter spy in place, and the next test needs a visible tab.
    hidden.mockRestore();
  });

  // Refocus and a 401 from the page's own request can land together; two refresh grants would
  // spend the rotated token twice and strand the organizer.
  it('renews once when a second trigger lands mid-flight', async () => {
    signedInWith(expired);
    let release!: (v: unknown) => void;
    const fn = vi.fn().mockReturnValue(new Promise((r) => { release = r; }));
    vi.stubGlobal('fetch', fn);

    await act(async () => { mount(); });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { release({ ok: true, status: 200, json: async () => fresh }); });
    await settle();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(auth.token?.access_token).toBe('tok2');
  });

  it('comes up signed out when the stored token is corrupt, rather than white-screening', () => {
    sessionStorage.setItem('wca_token', '{not json');
    vi.stubGlobal('fetch', vi.fn());

    expect(() => mount()).not.toThrow();
    expect(auth.token).toBeNull();
  });
});
