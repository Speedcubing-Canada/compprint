import { test, expect, download, pageCount } from './fixtures';
import { realWcif } from './fakeWca';

/** A stat card shows its value just above its label. */
const stat = (page: import('@playwright/test').Page, label: string) =>
  page.getByText(label, { exact: true }).locator('xpath=preceding-sibling::*[1]').innerText();

test('picks a competition, prints everything, and downloads what the page promised', async ({ page, wca, loginAs }) => {
  wca.add(realWcif('PickeringBlindfolded2026'));
  await loginAs();

  await page.getByText('Pickering Blindfolded 2026').click();
  await page.getByRole('heading', { name: 'What to generate' }).waitFor();
  for (const box of await page.getByRole('group', { name: 'Document types' }).getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.getByRole('button', { name: 'Generate →' }).click();

  await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
  const promisedPdfs = Number(await stat(page, 'PDFs'));
  const promisedPages = Number(await stat(page, 'Pages'));

  const { name, files } = await download(page, 'Download');
  expect(name).toBe('PickeringBlindfolded2026_pdfs.zip');
  expect(Object.keys(files)).toHaveLength(promisedPdfs);
  expect(Object.keys(files).every((f) => f.startsWith('PickeringBlindfolded2026_') && f.endsWith('.pdf'))).toBe(true);

  let pages = 0;
  for (const pdf of Object.values(files)) pages += await pageCount(pdf);
  // Pickering's schedule and checklist fit a page each, so the flowing estimates are exact here too.
  expect(pages).toBe(promisedPages);
});
