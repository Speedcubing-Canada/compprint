// An in-memory WCA, WCA Live and same-origin backend behind a stubbed global `fetch`, so a test
// runs the real src/auth/wca.ts (authFetch, the 401 hook, fetchErrorKey) instead of mocking it.
// Unknown requests throw: a test that reaches the network should fail loudly, not hang.

import { vi } from 'vitest';
import type { WCIF } from '../types/wcif';
import type { WCAToken, WCAUser } from '../auth/wca';

export interface ManagedCompetition {
  id: string;
  name: string;
  city: string;
  country_iso2: string;
  start_date: string;
  end_date: string;
  [key: string]: unknown;
}

type Handler = (req: { url: URL; init: RequestInit | undefined; body: string }) => Response | Promise<Response>;

export const organizer: WCAUser = {
  id: 1, name: 'Test Organizer', wca_id: '2010TEST01', email: '', avatar: { thumb_url: '' },
};

export function freshToken(over: Partial<WCAToken> = {}): WCAToken {
  return {
    access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'Bearer', scope: 'public manage_competitions',
    expires_in: 7200, created_at: Math.floor(Date.now() / 1000), ...over,
  };
}

function emptyBackend() {
  return {
    me: organizer,
    competitions: [] as ManagedCompetition[],
    wcifs: new Map<string, WCIF>(),
    /** Fields of the single-competition endpoint, by id. */
    info: new Map<string, { scoretaking_software?: string; on_the_spot_registration?: boolean }>(),
    /** WCA Live: wcaId → live id, and live id → competitors. */
    liveIds: new Map<string, string>(),
    livePeople: new Map<string, { id: string; registrantId: number }[]>(),
    /** Access tokens the API accepts; anything else is a 401. */
    validTokens: new Set(['test-token']),
    /** `METHOD pathname` → handler, checked before the defaults. */
    overrides: new Map<string, Handler>(),
    /** Every request, as `METHOD url`. */
    calls: [] as string[],
    beacons: [] as unknown[],
  };
}

export const backend = emptyBackend();

export function resetBackend() {
  Object.assign(backend, emptyBackend());
}

/** Replace one endpoint, for error paths and held requests. */
export function on(methodAndPath: string, handler: Handler) {
  backend.overrides.set(methodAndPath, handler);
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

function authed(init: RequestInit | undefined): boolean {
  const header = new Headers(init?.headers).get('Authorization') ?? '';
  return backend.validTokens.has(header.replace(/^Bearer /, ''));
}

async function route(url: URL, init: RequestInit | undefined, body: string): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const override = backend.overrides.get(`${method} ${url.pathname}`);
  if (override) return override({ url, init, body });

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
      const ok = form.get('grant_type') === 'authorization_code'
        ? form.get('code') === 'good-code'
        : form.get('refresh_token') === 'test-refresh';
      return ok ? json(freshToken()) : json({ error: 'invalid_grant' }, 400);
    }
    if (url.pathname === '/api/event' && method === 'POST') {
      backend.beacons.push(JSON.parse(body));
      return new Response(null, { status: 204 });
    }
  }

  throw new Error(`unexpected fetch ${method} ${url.href}`);
}

/** Install the fake as global `fetch`. Undone by vi.unstubAllGlobals(). */
export function stubWcaFetch() {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, window.location.origin);
    backend.calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.href}`);
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    return route(url, init, body);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** A managed-competitions row for `wcif`, the shape the picker reads. */
export function listingFor(wcif: WCIF, over: Partial<ManagedCompetition> = {}): ManagedCompetition {
  const start = wcif.schedule.startDate;
  const end = new Date(Date.parse(start) + (wcif.schedule.numberOfDays - 1) * 86_400_000).toISOString().slice(0, 10);
  return { id: wcif.id, name: wcif.name, city: 'Montréal', country_iso2: 'CA', start_date: start, end_date: end, ...over };
}

/** Register a competition everywhere the app looks for it. */
export function addCompetition(wcif: WCIF, over: Partial<ManagedCompetition> = {}) {
  backend.wcifs.set(wcif.id, wcif);
  backend.competitions.push(listingFor(wcif, over));
}
