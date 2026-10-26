import { test, expect, generate, pageCount, pdfText } from './fixtures';

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

  const { name, files } = await generate(page);

  // One event is one PDF, shipped bare; two named cards pad to a single sheet of four.
  expect(name).toMatch(/\.pdf$/);
  expect(await pageCount(files[name]!)).toBe(1);
  // A long name wraps on the card, so compare words, not lines.
  const text = pdfText(files[name]!).replace(/\s+/g, ' ');
  expect(text).toContain('Ali Hakim 2019HAKI01');
  expect(text).toContain('Matheus de Souza Macêdo');
  // No time limit was given, so no limit line either.
  expect(text).not.toContain('DNF if not under');
});
