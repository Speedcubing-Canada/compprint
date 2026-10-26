import { test, expect } from './fixtures';
import { organizer, realWcif } from './fakeWca';
import { FAKE_WCA_ORIGIN } from './protocol';

const refreshGrants = async () =>
  ((await (await fetch(`${FAKE_WCA_ORIGIN}/calls`)).json()) as { grant_type: string }[])
    .filter((c) => c.grant_type === 'refresh_token').length;

const authorizeCalls = (calls: string[]) => calls.filter((c) => c.includes('/oauth/authorize')).length;

test('signs in through WCA and lands on the competitions', async ({ page, wca, loginAs, isMobile }) => {
  wca.add(realWcif('PickeringBlindfolded2026'));
  await loginAs();
  await expect(page.getByText('Pickering Blindfolded 2026')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText(organizer.name)).toBeVisible();
  // WCA's thumbnail, on a host the CSP must allow: a block would also fail the console check.
  const avatar = page.locator(`img[src="${organizer.avatar.thumb_url}"]`);
  await expect(avatar).toBeVisible();
  expect(await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test.describe('a failed sign-in comes back to the login page with a message', () => {
  test.use({ allowConsole: [/status of (400|503)/] });

  for (const [name, authorize] of [
    ['state mismatch', { state: 'forged' }],
    ['a code issued for another PKCE challenge', { challenge: 'forged' }],
    ['WCA refuses', { error: 'access_denied' }],
    ['token endpoint down', { outcome: 'down' }],
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

test('renews a token about to expire without sending the organizer back to WCA', async ({ page, wca, loginAs }) => {
  wca.add(realWcif('PickeringBlindfolded2026'));
  wca.authorize = { outcome: 'short' };
  await loginAs();
  const before = await refreshGrants();

  await page.reload();

  await expect.poll(refreshGrants).toBe(before + 1);
  await expect(page.getByText('Pickering Blindfolded 2026')).toBeVisible();
  expect(authorizeCalls(wca.calls)).toBe(1);
});

test.describe('a revoked token', () => {
  test.use({ allowConsole: [/status of 401/] });

  test('recovers through the refresh grant on the 401', async ({ page, wca, loginAs }) => {
    wca.add(realWcif('PickeringBlindfolded2026'));
    await loginAs();
    await expect(page.getByText('Pickering Blindfolded 2026')).toBeVisible();
    const before = await refreshGrants();
    wca.revoked.add(await page.evaluate(() => JSON.parse(sessionStorage.getItem('wca_token')!).access_token));

    await page.reload();

    await expect.poll(refreshGrants).toBe(before + 1);
    await expect(page.getByText('Pickering Blindfolded 2026')).toBeVisible();
    expect(authorizeCalls(wca.calls)).toBe(1);
  });
});

test('signing out clears the session and the wizard', async ({ page, pick, isMobile }) => {
  await pick(realWcif('PickeringBlindfolded2026'));
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with WCA' })).toBeVisible();
  const left = await page.evaluate(() => Object.keys(sessionStorage));
  expect(left.filter((k) => !k.startsWith('analytics'))).toEqual([]);
});
