// WCA as the browser sees it, from page.route. Anything unmatched off-origin 404s, naming the request.

import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import type { WCIF } from '../src/types/wcif';
import { organizer as baseOrganizer } from '../src/test/fixtures';
import { addCompetition, answerWca, emptyWcaData } from '../src/test/wcaApi';
import { accessTokenExpiry, authCode, type Outcome } from './protocol';

export const AVATAR = 'https://avatars.worldcubeassociation.org/uploads/user/avatar/2010TEST01/1_thumb.jpg';

// An email and an avatar, as the real /me has: the analytics spec checks neither leaks.
export const organizer = { ...baseOrganizer, email: 'organizer@example.com', avatar: { thumb_url: AVATAR } };

/** A real competition from tests/fixtures/wcif, scrubbed of private fields when it was fetched. */
export const realWcif = (id: string): WCIF =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/wcif/${id}.json`, import.meta.url), 'utf8'));

// A 1x1 PNG.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export class FakeWca {
  data = emptyWcaData(organizer);
  /** What WCA's authorize page sends back. `challenge` replaces the real one, to forge a code. */
  authorize: { outcome?: Outcome; error?: string; state?: string; challenge?: string } = { outcome: 'good' };
  /** `METHOD url` of every request this fake answered. */
  calls: string[] = [];
  /** Access tokens the API refuses before their expiry, as if revoked. */
  revoked = new Set<string>();

  add(wcif: WCIF) {
    addCompetition(this.data, wcif);
    // The page fetches this for every competition, and its 404 would fail the console check.
    this.data.info.set(wcif.id, { scoretaking_software: 'wca_live', on_the_spot_registration: false });
    return wcif;
  }

  async install(page: Page) {
    await page.route((url) => !url.host.startsWith('localhost'), (route) => this.answer(route));
  }

  private async answer(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    this.calls.push(`${req.method()} ${url.href}`);

    if (url.host === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.host === 'avatars.worldcubeassociation.org') return route.fulfill({ contentType: 'image/png', body: PIXEL });

    if (url.href.startsWith('https://www.worldcubeassociation.org/oauth/authorize')) {
      const back = new URL(url.searchParams.get('redirect_uri')!);
      const { outcome = 'good', error, state, challenge } = this.authorize;
      if (error) back.searchParams.set('error', error);
      else back.searchParams.set('code', authCode(outcome, challenge ?? url.searchParams.get('code_challenge')!));
      back.searchParams.set('state', state ?? url.searchParams.get('state')!);
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }

    const bearer = (req.headers()['authorization'] ?? '').replace(/^Bearer /, '');
    const expiry = accessTokenExpiry(bearer);
    const authed = expiry !== null && Date.now() < expiry && !this.revoked.has(bearer);
    const api = answerWca(this.data, { url, method: req.method(), body: req.postData() ?? '', authed });
    if (api) return route.fulfill({ status: api[0], contentType: 'application/json', body: JSON.stringify(api[1]) });

    return route.fulfill({ status: 404, contentType: 'text/plain', body: `fake WCA has no ${req.method()} ${url.href}` });
  }
}
