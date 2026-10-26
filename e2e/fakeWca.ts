// The WCA the browser talks to: OAuth authorize, API v0, avatars and WCA Live, answered from
// page.route. The token exchange is not here: it leaves from server.js (e2e/fakeWcaOrigin.mjs).
// Anything else off-origin answers 404 naming the request, so a stray call fails loudly.

import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import type { WCIF } from '../src/types/wcif';

export const AVATAR = 'https://avatars.worldcubeassociation.org/uploads/user/avatar/2018LOVE01/1_thumb.jpg';

export const organizer = {
  id: 1, name: 'Ada Lovelace', wca_id: '2018LOVE01', email: 'ada@example.com',
  avatar: { url: AVATAR.replace('_thumb', ''), thumb_url: AVATAR },
};

/** A real competition from tests/fixtures/wcif, scrubbed of private fields when it was fetched. */
export const realWcif = (id: string): WCIF =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/wcif/${id}.json`, import.meta.url), 'utf8'));

// A 1x1 PNG.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export class FakeWca {
  competitions: { id: string; name: string; city: string; country_iso2: string; start_date: string; end_date: string }[] = [];
  wcifs = new Map<string, WCIF>();
  /** What WCA's authorize page sends back: the code server.js exchanges, or an error. */
  authorize: { code?: string; error?: string; state?: string } = { code: 'good-code' };
  /** `METHOD url` of every request this fake answered. */
  calls: string[] = [];
  /** Access tokens the API refuses, as if revoked. */
  revoked = new Set<string>();

  /** Listed as upcoming: the picker hides past competitions, and fixture dates are long gone. */
  add(wcif: WCIF) {
    this.wcifs.set(wcif.id, wcif);
    this.competitions.push({
      id: wcif.id, name: wcif.name, city: 'Montréal', country_iso2: 'CA',
      start_date: '2999-05-16', end_date: '2999-05-16',
    });
    return wcif;
  }

  async install(page: Page) {
    await page.route((url) => !url.host.startsWith('localhost'), (route) => this.answer(route));
  }

  private async answer(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    this.calls.push(`${req.method()} ${url.href}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.host === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });

    if (url.href.startsWith('https://www.worldcubeassociation.org/oauth/authorize')) {
      const back = new URL(url.searchParams.get('redirect_uri')!);
      const { code, error, state } = this.authorize;
      if (error) back.searchParams.set('error', error);
      else back.searchParams.set('code', code!);
      back.searchParams.set('state', state ?? url.searchParams.get('state')!);
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }

    if (url.host === 'avatars.worldcubeassociation.org') return route.fulfill({ contentType: 'image/png', body: PIXEL });

    if (url.host === 'www.worldcubeassociation.org' && url.pathname.startsWith('/api/v0/')) {
      const path = url.pathname.slice('/api/v0'.length);
      const single = path.match(/^\/competitions\/([^/]+)$/);
      if (single) return json({ scoretaking_software: 'wca_live', on_the_spot_registration: false });

      const bearer = (req.headers().authorization ?? '').replace(/^Bearer /, '');
      if (!bearer.startsWith('e2e-token-') || this.revoked.has(bearer)) return json({ error: 'invalid_token' }, 401);
      if (path === '/me') return json({ me: organizer });
      if (path === '/competitions') {
        const perPage = Number(url.searchParams.get('per_page') ?? 25);
        const page = Number(url.searchParams.get('page') ?? 1);
        return json(this.competitions.slice((page - 1) * perPage, page * perPage));
      }
      const wcif = path.match(/^\/competitions\/([^/]+)\/wcif\/version\/2$/);
      if (wcif && this.wcifs.has(wcif[1])) return json(this.wcifs.get(wcif[1]));
    }

    if (url.href === 'https://live.worldcubeassociation.org/api') return json({ data: { competitions: [] } });

    return route.fulfill({ status: 404, contentType: 'text/plain', body: `fake WCA has no ${req.method()} ${url.href}` });
  }
}
