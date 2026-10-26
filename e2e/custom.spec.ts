import { test, expect, download, pageCount } from './fixtures';

test('a custom competition with a CSV of competitors prints one named card each', async ({ page, loginAs }) => {
  await loginAs();
  await page.getByRole('button', { name: /Create a custom competition/ }).click();
  await page.getByPlaceholder('e.g. Cube Club Open 2026').fill('Club Meetup');
  await page.getByRole('button', { name: '+ Add custom event' }).click();
  await page.getByPlaceholder('Event name (e.g. Clock Relay)').fill('Mystery Puzzle');
  await page.locator('input[accept=".csv,text/csv,text/plain"]').setInputFiles({
    name: 'people.csv', mimeType: 'text/csv',
    buffer: Buffer.from('# name,wca id\nAli Hakim,2019HAKI01\nMatheus de Souza Macêdo\n'),
  });
  await expect(page.getByText('2 competitor(s) loaded')).toBeVisible();

  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.getByRole('button', { name: 'Generate →' }).click();
  const { name, files } = await download(page, 'Download');

  // One event is one PDF, shipped bare; two named cards pad to a single sheet of four.
  expect(name).toMatch(/\.pdf$/);
  expect(await pageCount(files[name]!)).toBe(1);
});
