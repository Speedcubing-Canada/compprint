// WCA API v0 and WCA Live as pure data in, answer out. Shared by the unit fake (src/test/fakeWca.ts,
// a stubbed `fetch`) and the browser fake (e2e/fakeWca.ts, `page.route`), so the two cannot drift.
// Each caller decides what an accepted token is: they mint them differently.

import type { WCACompetition, WCIF } from '../types/wcif';
import type { WCAUser } from '../auth/wca';

export type ManagedCompetition = Pick<WCACompetition, 'id' | 'name' | 'city' | 'country_iso2' | 'start_date' | 'end_date'>;

export type WcaData = {
  me: WCAUser;
  competitions: ManagedCompetition[];
  wcifs: Map<string, WCIF>;
  /** Fields of the single-competition endpoint, by id. Absent answers 404. */
  info: Map<string, { scoretaking_software?: string; on_the_spot_registration?: boolean }>;
  /** WCA Live: wcaId → live id, and live id → competitors. */
  liveIds: Map<string, string>;
  livePeople: Map<string, { id: string; registrantId: number }[]>;
};

export const emptyWcaData = (me: WCAUser): WcaData => ({
  me, competitions: [], wcifs: new Map(), info: new Map(), liveIds: new Map(), livePeople: new Map(),
});

/** Register a competition everywhere the app looks for it. The listing is upcoming by default. */
export function addCompetition(data: WcaData, wcif: WCIF, over: Partial<ManagedCompetition> = {}) {
  data.wcifs.set(wcif.id, wcif);
  data.competitions.push({
    id: wcif.id, name: wcif.name, city: 'Montréal', country_iso2: 'CA',
    // The picker hides past competitions, and the fixtures' dates are long gone.
    start_date: '2999-05-16', end_date: '2999-05-16', ...over,
  });
  // The page fetches this for every competition, and a 404 logs a console error.
  if (!data.info.has(wcif.id)) data.info.set(wcif.id, { scoretaking_software: 'wca_live', on_the_spot_registration: false });
}

export type WcaRequest = { url: URL; method: string; body: string; authed: boolean };

/** The answer as `[status, json]`, or null when the request is not one WCA or WCA Live serves. */
export function answerWca(data: WcaData, { url, method, body, authed }: WcaRequest): [number, unknown] | null {
  if (url.host === 'www.worldcubeassociation.org' && url.pathname.startsWith('/api/v0/')) {
    const path = url.pathname.slice('/api/v0'.length);
    const single = path.match(/^\/competitions\/([^/]+)$/);
    if (single) {
      const info = data.info.get(single[1]!);
      return info ? [200, info] : [404, { error: 'not found' }];
    }
    if (!authed) return [401, { error: 'invalid_token' }];
    if (path === '/me') return [200, { me: data.me }];
    if (path === '/competitions' && url.searchParams.get('managed_by_me') === 'true') {
      const perPage = Number(url.searchParams.get('per_page') ?? 25);
      const page = Number(url.searchParams.get('page') ?? 1);
      return [200, data.competitions.slice((page - 1) * perPage, page * perPage)];
    }
    const wcif = path.match(/^\/competitions\/([^/]+)\/wcif\/version\/2$/);
    if (wcif) {
      const found = data.wcifs.get(wcif[1]!);
      return found ? [200, structuredClone(found)] : [404, { error: 'not found' }];
    }
    return null;
  }

  if (url.host === 'live.worldcubeassociation.org' && url.pathname === '/api' && method === 'POST') {
    const { query, variables } = JSON.parse(body) as { query: string; variables?: { id: string } };
    if (query.includes('competitions {')) {
      return [200, { data: { competitions: [...data.liveIds].map(([wcaId, id]) => ({ id, wcaId })) } }];
    }
    if (variables?.id) {
      const competitors = data.livePeople.get(variables.id);
      return [200, { data: { competition: competitors ? { competitors } : null } }];
    }
  }
  return null;
}
