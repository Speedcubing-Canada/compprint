import { test, expect, download } from './fixtures';
import { realWcif } from './fakeWca';

test.beforeEach(async ({ page, wca, loginAs }) => {
  wca.add(realWcif('PickeringBlindfolded2026'));
  await loginAs();
  await page.getByText('Pickering Blindfolded 2026').click();
  await page.getByRole('button', { name: 'Continue →' }).click();
});

test('a logo too big for the browser says so instead of losing the settings', async ({ page }) => {
  // A real image, padded past what sessionStorage holds once base64'd.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--${'x'.repeat(8_000_000)}--></svg>`;
  await page.locator('input[type="file"][accept^="image"]').first()
    .setInputFiles({ name: 'huge.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.getByRole('button', { name: 'Generate →' }).click();

  await expect(page.getByText('These images are too large to keep. Use a smaller logo or event icon, then try again.')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/settings');
});

test('the whole flow works in French, with no untranslated keys on screen', async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await expect(page.getByRole('button', { name: 'Générer →' })).toBeVisible();
  await page.getByRole('button', { name: 'Générer →' }).click();
  await expect(page.getByRole('button', { name: 'Télécharger' })).toBeEnabled();

  // i18next renders a missing key as the key itself: "generate.stats.pdfs".
  const text = await page.locator('body').innerText();
  expect(text.match(/\b[a-z]+_?[a-z]*\.[a-z_]+\.[a-z_.]+\b/g) ?? []).toEqual([]);

  const { files } = await download(page, 'Télécharger');
  expect(Object.keys(files).length).toBeGreaterThan(0);
});
