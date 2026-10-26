import { test, expect } from './fixtures';
import { organizer, realWcif } from './fakeWca';

const FAKE_ORIGIN = 'http://127.0.0.1:4180';
const grants = async () =>
  ((await (await fetch(`${FAKE_ORIGIN}/calls`)).json()) as { grant_type: string }[]).map((c) => c.grant_type);

test('signs in through WCA and lands on the competitions', async ({ page, wca, loginAs, isMobile }) => {
  wca.add(realWcif('PickeringBlindfolded2026'));
  await loginAs();
  await expect(page.getByText('Pickering Blindfolded 2026')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText(organizer.name)).toBeVisible();
  // The header avatar is WCA's thumbnail; a CSP block would also fail the console check.
  const avatar = page.locator(`img[src="${organizer.avatar.thumb_url}"]`).first();
  await expect(avatar).toBeAttached();
  expect(await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test.describe('a failed sign-in comes back to the login page with a message', () => {
  test.use({ allowConsole: [/status of (400|503)/] });

  for (const [name, authorize] of [
    ['state mismatch', { code: 'good-code', state: 'forged' }],
    ['WCA refuses', { error: 'access_denied' }],
    ['token endpoint down', { code: 'down-code' }],
  ] as const) {
    test(name, async ({ page, wca }) => {
      wca.authorize = authorize;
      await page.goto('/');
      await page.getByRole('button', { name: 'Sign in with WCA' }).click();
      await expect(page.getByRole('alert')).toHaveText('Sign-in did not complete. Please try again.');
      expect(new URL(page.url()).pathname).toBe('/');
      expect(await page.evaluate(() => sessionStorage.getItem('wca_token'))).toBeNull();
    });
  }
});

test('renews an expired session without sending the organizer back to WCA', async ({ page, wca, loginAs }) => {
  wca.add(realWcif('PickeringBlindfolded2026'));
  wca.authorize = { code: 'short-code' };
  await loginAs();
  const before = (await grants()).filter((g) => g === 'refresh_token').length;

  await page.reload();

  await expect(page.getByText('Pickering Blindfolded 2026')).toBeVisible();
  expect((await grants()).filter((g) => g === 'refresh_token')).toHaveLength(before + 1);
  expect(wca.calls.filter((c) => c.includes('/oauth/authorize'))).toHaveLength(1);
});

test('signing out clears the session and the wizard', async ({ page, wca, loginAs, isMobile }) => {
  wca.add(realWcif('PickeringBlindfolded2026'));
  await loginAs();
  await page.getByText('Pickering Blindfolded 2026').click();
  await page.getByRole('heading', { name: 'What to generate' }).waitFor();
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with WCA' })).toBeVisible();
  const left = await page.evaluate(() => Object.keys(sessionStorage));
  expect(left.filter((k) => !k.startsWith('analytics'))).toEqual([]);
});
