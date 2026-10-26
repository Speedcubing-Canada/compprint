// An in-memory WCA, WCA Live and same-origin backend behind a stubbed global `fetch`, so a test
// runs the real src/auth/wca.ts (authFetch, the 401 hook, fetchErrorKey) instead of mocking it.
// Unknown requests throw: a test that reaches the network should fail loudly, not hang.
//
// Tokens behave like Doorkeeper's: they expire on the clock, and a refresh spends the refresh
// token it was given and rotates in a new one.

import { vi } from 'vitest';
import type { WCIF } from '../types/wcif';
import type { WCAToken } from '../auth/wca';
import { freshToken, organizer } from './fixtures';
import { addCompetition as add, answerWca, emptyWcaData, type ManagedCompetition } from './wcaApi';

export type { ManagedCompetition };

type Request = { url: URL; method: string; init: RequestInit | undefined; body: string };
/** `next()` answers as the fake would have without the override. */
type Handler = (req: Request, next: () => Promise<Response>) => Response | Promise<Response>;

function emptyBackend() {
  return {
    ...emptyWcaData(organizer),
    /** Access tokens the API has issued; past `created_at + expires_in` they answer 401. */
    issued: new Map<string, WCAToken>(),
    /** The one refresh token that still works. */
    refreshToken: 'test-refresh',
    /** `METHOD host/pathname` → handler, checked before the defaults. */
    overrides: new Map<string, Handler>(),
    /** Every request, as `METHOD url`. */
    calls: [] as string[],
  };
}

export const backend = emptyBackend();

export function resetBackend() {
  Object.assign(backend, emptyBackend());
}

/** Make the API accept `token` until it expires. renderApp does this for the session it seeds. */
export function issue(token: WCAToken) {
  backend.issued.set(token.access_token, token);
  if (token.refresh_token) backend.refreshToken = token.refresh_token;
}

/** Replace one endpoint, keyed `METHOD host/pathname`, for error paths and held requests. */
export function on(route: string, handler: Handler) {
  backend.overrides.set(route, handler);
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

let rotation = 0;
function mint(): WCAToken {
  rotation += 1;
  const token = freshToken({ access_token: `test-token-${rotation}`, refresh_token: `test-refresh-${rotation}` });
  issue(token);
  return token;
}

function authed(init: RequestInit | undefined): boolean {
  const bearer = (new Headers(init?.headers).get('Authorization') ?? '').replace(/^Bearer /, '');
  const token = backend.issued.get(bearer);
  return !!token && (token.created_at + token.expires_in) * 1000 > Date.now();
}

async function route(req: Request): Promise<Response> {
  const { url, method, init, body } = req;

  const api = answerWca(backend, { url, method, body, authed: authed(init) });
  if (api) return json(api[1], api[0]);

  if (url.origin === window.location.origin) {
    if (url.pathname === '/wca-token' && method === 'POST') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code') {
        return form.get('code') === 'good-code' ? json(mint()) : json({ error: 'invalid_grant' }, 400);
      }
      if (form.get('refresh_token') !== backend.refreshToken) return json({ error: 'invalid_grant' }, 400);
      return json(mint());
    }
    if (url.pathname === '/api/event' && method === 'POST') return new Response(null, { status: 204 });
  }

  throw new Error(`unexpected fetch ${method} ${url.href}`);
}

/** Install the fake as global `fetch`. Undone by vi.unstubAllGlobals(). */
export function stubWcaFetch() {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    backend.calls.push(`${method} ${url.href}`);
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    const req = { url, method, init, body };
    const override = backend.overrides.get(`${method} ${url.host}${url.pathname}`);
    return override ? override(req, () => route(req)) : route(req);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Register a competition everywhere the app looks for it. The listing is upcoming by default. */
export function addCompetition(wcif: WCIF, over: Partial<ManagedCompetition> = {}) {
  add(backend, wcif, over);
}
