import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, type Download, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { CHANGELOG } from '../src/changelog';
import type { WCIF } from '../src/types/wcif';
import { FakeWca } from './fakeWca';

export { expect };

type Fixtures = {
  wca: FakeWca;
  /** Console errors a test expects, such as the 401 it provokes. Anything else fails the test. */
  allowConsole: RegExp[];
  /** Signs in through the real PKCE redirect. */
  loginAs: () => Promise<void>;
  /** Puts the competition on the fake WCA, signs in and picks it: the start of most journeys. */
  pick: (wcif: WCIF) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  allowConsole: [[], { option: true }],

  wca: [async ({ page }, use) => {
    const wca = new FakeWca();
    await wca.install(page);
    // A UI preference, not auth: keeps the What's New dialog from covering the first page.
    await page.addInitScript((id) => localStorage.setItem('changelog_seen', id), CHANGELOG[0]!.id);
    await use(wca);
  }, { auto: true }],

  // Every test fails on a console error or a CSP violation, which Chromium logs as one.
  page: async ({ page, allowConsole }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await use(page);
    expect(errors.filter((e) => !allowConsole.some((re) => re.test(e)))).toEqual([]);
  },

  loginAs: async ({ page }, use) => {
    await use(async () => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Sign in with WCA' }).click();
      await page.waitForURL('**/competitions');
    });
  },

  pick: async ({ page, wca, loginAs }, use) => {
    await use(async (wcif) => {
      wca.add(wcif);
      await loginAs();
      await page.getByText(wcif.name).click();
      await page.getByRole('button', { name: 'Continue →' }).waitFor();
    });
  },
});

/** Clicks the button and returns the file it downloads, unzipped: filename → bytes. */
export async function download(page: Page, button: string | RegExp): Promise<{ name: string; files: Record<string, Uint8Array> }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  const bytes = await read(dl);
  const name = dl.suggestedFilename();
  return { name, files: name.endsWith('.zip') ? unzipSync(bytes) : { [name]: bytes } };
}

async function read(dl: Download): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of await dl.createReadStream()) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export const pageCount = async (pdf: Uint8Array) => (await PDFDocument.load(pdf)).getPageCount();

/** The PDF's text, through poppler: the CI job installs it. */
export function pdfText(pdf: Uint8Array): string {
  const path = join(mkdtempSync(join(tmpdir(), 'e2e-pdf-')), 'doc.pdf');
  writeFileSync(path, pdf);
  return execFileSync('pdftotext', ['-raw', path, '-'], { encoding: 'utf8' });
}
