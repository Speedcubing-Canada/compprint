// Setup for the `routes` project (*.route.test.tsx): the fake WCA behind fetch, the in-thread
// worker, a captured download, and a clean slate after every test.

import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetBackend, stubWcaFetch } from './fakeWca';
import { FakeWorker, resetWorkers, workers } from './fakeWorker';
import { stubMatchMedia, useEnglish } from './render';
import { markAllSeen } from '../changelog';
import { clearWcifCache } from '../lib/wcifCache';

vi.mock('@react-pdf/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  pdf: () => ({ toBlob: async () => new Blob(['%PDF-fake'], { type: 'application/pdf' }) }),
}));

export const downloads: { filename: string; blob: Blob }[] = [];
// React and the router report mistakes (navigating during render, missing keys, act warnings)
// through console.error and console.warn and carry on, so a route test fails on any of them.
const consoleErrors: unknown[][] = [];
const blobs = new Map<string, Blob>();

beforeEach(async () => {
  stubWcaFetch();
  stubMatchMedia();
  vi.stubGlobal('Worker', FakeWorker);
  // jsdom's Blob has no stream(), which runJobs zips through.
  vi.stubGlobal('Blob', NodeBlob);
  // jsdom has neither, so assigning leaks nothing into the next file.
  URL.createObjectURL = (b: Blob) => { const u = `blob:test/${blobs.size}`; blobs.set(u, b); return u; };
  URL.revokeObjectURL = () => {};
  // The page downloads through a synthetic <a download> click, which jsdom would try to navigate.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href);
    if (blob && this.download) downloads.push({ filename: this.download, blob });
  });
  for (const level of ['error', 'warn'] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { consoleErrors.push([level, ...args]); });
  markAllSeen();
  await useEnglish();
});

afterEach(() => {
  cleanup();
  const errors = consoleErrors.splice(0);
  const escaped = [...workers.unhandled];
  sessionStorage.clear();
  localStorage.clear();
  resetBackend();
  resetWorkers();
  clearWcifCache();
  // The auth callback reads window.location, so a test that sets it must not hand it on.
  window.history.replaceState({}, '', '/');
  downloads.length = 0;
  blobs.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (escaped.length > 0) throw new Error(`runJobs rejected instead of posting an error: ${escaped.map(String).join('; ')}`);
  if (errors.length > 0) throw new Error(`console output during the test:\n${errors.map((a) => a.map(String).join(' ')).join('\n')}`);
});
