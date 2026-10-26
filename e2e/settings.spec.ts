import { test, expect, download } from './fixtures';
import { realWcif } from './fakeWca';

test.beforeEach(async ({ page, pick }) => {
  await pick(realWcif('PickeringBlindfolded2026'));
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

test('the whole flow works in French', async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await expect(page.getByRole('button', { name: 'Générer →' })).toBeVisible();
  await page.getByRole('button', { name: 'Générer →' }).click();
  await expect(page.getByRole('button', { name: 'Télécharger' })).toBeEnabled();

  const { name } = await download(page, 'Télécharger');
  expect(name).toBe('PickeringBlindfolded2026_pdfs.zip');
});
