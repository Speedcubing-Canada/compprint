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

export interface ManagedCompetition {
  id: string;
  name: string;
  city: string;
  country_iso2: string;
  start_date: string;
  end_date: string;
}

type Request = { url: URL; method: string; init: RequestInit | undefined; body: string };
/** `next()` answers as the fake would have without the override. */
type Handler = (req: Request, next: () => Promise<Response>) => Response | Promise<Response>;

function emptyBackend() {
  return {
    me: organizer,
    competitions: [] as ManagedCompetition[],
    wcifs: new Map<string, WCIF>(),
    /** Fields of the single-competition endpoint, by id. Absent answers 404. */
    info: new Map<string, { scoretaking_software?: string; on_the_spot_registration?: boolean }>(),
    /** WCA Live: wcaId → live id, and live id → competitors. */
    liveIds: new Map<string, string>(),
    livePeople: new Map<string, { id: string; registrantId: number }[]>(),
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

  if (url.host === 'www.worldcubeassociation.org' && url.pathname.startsWith('/api/v0/')) {
    const path = url.pathname.slice('/api/v0'.length);
    const wcif = path.match(/^\/competitions\/([^/]+)\/wcif\/version\/2$/);
    const single = path.match(/^\/competitions\/([^/]+)$/);
    if (single) {
      const info = backend.info.get(single[1]);
      return info ? json(info) : json({ error: 'not found' }, 404);
    }
    if (!authed(init)) return json({ error: 'invalid_token' }, 401);
    if (path === '/me') return json({ me: backend.me });
    if (path === '/competitions' && url.searchParams.get('managed_by_me') === 'true') {
      const perPage = Number(url.searchParams.get('per_page') ?? 25);
      const page = Number(url.searchParams.get('page') ?? 1);
      return json(backend.competitions.slice((page - 1) * perPage, page * perPage));
    }
    if (wcif) {
      const found = backend.wcifs.get(wcif[1]);
      return found ? json(structuredClone(found)) : json({ error: 'not found' }, 404);
    }
  }

  if (url.host === 'live.worldcubeassociation.org' && url.pathname === '/api' && method === 'POST') {
    const { query, variables } = JSON.parse(body) as { query: string; variables?: { id: string } };
    if (query.includes('competitions {')) {
      return json({ data: { competitions: [...backend.liveIds].map(([wcaId, id]) => ({ id, wcaId })) } });
    }
    if (variables?.id) {
      const competitors = backend.livePeople.get(variables.id);
      return json({ data: { competition: competitors ? { competitors } : null } });
    }
  }

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
  backend.wcifs.set(wcif.id, wcif);
  backend.competitions.push({
    id: wcif.id, name: wcif.name, city: 'Montréal', country_iso2: 'CA',
    // The picker hides past competitions, and the fixtures' dates are long gone.
    start_date: '2999-05-16', end_date: '2999-05-16', ...over,
  });
}
