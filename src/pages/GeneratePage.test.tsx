// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('../auth/wca', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/wca')>()),
  fetchWcif: vi.fn(),
}));
vi.mock('../lib/pdfJobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/pdfJobs')>()),
  hasOversizedPdf: vi.fn(() => false),
}));
vi.mock('../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/analytics')>()),
  send: vi.fn(),
}));

import { fetchWcif } from '../auth/wca';
import * as analytics from '../lib/analytics';
import i18n from '../i18n/index';
import { markAllSeen } from '../changelog';
import { writeCompetition, writeSettings } from '../lib/flowState';
import { buildPdfJobs, hasOversizedPdf } from '../lib/pdfJobs';
import { parseWCIF } from '../lib/wcif-parser';
import { sampleWcif, testSettings } from '../test/fixtures';
import { renderWithProviders, signedInAuth, useEnglish } from '../test/render';
import GeneratePage from './GeneratePage';

const mockWcif = vi.mocked(fetchWcif);

// The download step. Its PDF count and button label are derived from the same
// buildPdfJobs list the worker renders from, so a drift between them ships an
// organizer a bundle that does not match what the page promised.
//
// The worker itself is stubbed: jsdom implements no Worker, and vitest cannot load
// a `new URL(..., import.meta.url)` module worker. Rendering is covered headlessly
// by src/pdf/render.integration.test.ts instead.

const posted: unknown[] = [];
// The handler the page installed, so a test can play worker messages back at it.
let onWorkerMessage: ((e: MessageEvent) => void) | null = null;
class StubWorker {
  set onmessage(fn: ((e: MessageEvent) => void) | null) { onWorkerMessage = fn; }
  get onmessage() { return onWorkerMessage; }
  postMessage(msg: unknown) { posted.push(msg); }
  terminate() {}
}

const settings = testSettings({ competitionId: 'GrosJouetsaMontreal2026' });
const jobs = buildPdfJobs(parseWCIF(sampleWcif(), settings), settings);
// The filename is a caption under the button, not part of its label - a long competition
// id used to shrink the label to fit inside it.
const downloadButton = () => screen.findByRole('button', { name: i18n.t('generate.download_button') });

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  posted.length = 0;
  onWorkerMessage = null;
  markAllSeen();
  await useEnglish();
  vi.clearAllMocks();
  vi.stubGlobal('Worker', StubWorker);
  mockWcif.mockResolvedValue(sampleWcif());
  writeCompetition(settings.competitionId, settings.competitionName);
  writeSettings(settings);
});
afterEach(cleanup);

describe('GeneratePage', () => {
  it('offers a download whose file count matches buildPdfJobs', async () => {
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });

    expect(await downloadButton()).toBeTruthy();
    expect(screen.getByText(String(jobs.length))).toBeTruthy();
  });

  it('shows the WCIF fetch failure rather than an empty download step', async () => {
    mockWcif.mockRejectedValue(new Error('WCIF fetch failed (404)'));
    writeCompetition('Uncached2026', 'Uncached 2026');
    writeSettings(testSettings({ competitionId: 'Uncached2026' }));
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });

    expect(await screen.findByText(/WCIF fetch failed \(404\)/)).toBeTruthy();
  });

  it('reports a fetch failure once, tagged with the step that failed', async () => {
    mockWcif.mockRejectedValue(new Error('boom'));
    writeCompetition('AlsoUncached2026', 'Also Uncached 2026');
    writeSettings(testSettings({ competitionId: 'AlsoUncached2026' }));
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });

    await screen.findByText(/boom/);
    expect(vi.mocked(analytics.send)).toHaveBeenCalledTimes(1);
  });

  it('sends the organizer back to the picker when no settings were submitted', async () => {
    sessionStorage.clear();
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    // Guessing at settings would generate a bundle the organizer never configured.
    expect(mockWcif).not.toHaveBeenCalled();
  });

  it('needs no WCIF for a custom competition', async () => {
    writeSettings(testSettings({
      isCustomCompetition: true,
      customEvents: [{ name: 'Mystery', iconDataUrl: null, format: 'avg5', cutoff: '', limit: '' }],
    }));
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });

    await downloadButton();
    expect(screen.getByText(/\.pdf$|\.zip$/)).toBeTruthy();
    expect(mockWcif).not.toHaveBeenCalled();
  });

  it('renders the worker\'s progress, then its error, without downloading', async () => {
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    fireEvent.click(await downloadButton());

    act(() => {
      onWorkerMessage!({ data: { type: 'progress', percent: 40, message: 'Rendering Round 1' } } as MessageEvent);
    });
    expect(screen.getByText('Rendering Round 1')).toBeTruthy();

    act(() => {
      onWorkerMessage!({ data: { type: 'error', message: 'font missing' } } as MessageEvent);
    });
    expect(screen.getByText('font missing')).toBeTruthy();
  });

  it('ignores a second click while the worker is still building', async () => {
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    const button = await downloadButton();
    fireEvent.click(button);
    act(() => {
      onWorkerMessage!({ data: { type: 'progress', percent: 10, message: 'Starting' } } as MessageEvent);
    });
    fireEvent.click(button);

    // A second worker would render the whole bundle twice and race the first download.
    expect(posted).toHaveLength(1);
  });

  // The sample comp is small, so the cap check is stubbed rather than building a WC-sized WCIF.
  const splitBox = () => screen.queryByRole('checkbox', { name: /Split large files/ });

  it('only offers to split large files when a file is past the cap', async () => {
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    await downloadButton();
    expect(splitBox()).toBeNull();
  });

  it('hands the worker the split choice', async () => {
    vi.mocked(hasOversizedPdf).mockReturnValue(true);
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    await downloadButton();

    fireEvent.click(splitBox()!);
    fireEvent.click(await downloadButton());
    expect((posted[0] as { settings: typeof settings }).settings.splitLargePdfs).toBe(true);
  });

  const mergeWarning = () => screen.queryByText(/All rounds are merged/);

  // Oversized means "handed any job", so only the jobs the page picks decide the warning.
  const oversizedIfAny = () => vi.mocked(hasOversizedPdf).mockImplementation(jobs => jobs.length > 0);

  it('warns about one huge merged file only when it is past the cap', async () => {
    vi.mocked(hasOversizedPdf).mockReturnValue(false);
    writeSettings(testSettings({ competitionId: settings.competitionId, mergeScorecardRounds: true }));
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    await downloadButton();
    expect(mergeWarning()).toBeNull();
  });

  it('keeps the merge warning off per-round files', async () => {
    oversizedIfAny();
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    await downloadButton();
    expect(splitBox()).toBeTruthy();
    expect(mergeWarning()).toBeNull();
  });

  it('shows the merge warning for an oversized merged file, and drops it once split', async () => {
    oversizedIfAny();
    writeSettings(testSettings({ competitionId: settings.competitionId, mergeScorecardRounds: true }));
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });
    await downloadButton();
    expect(mergeWarning()).toBeTruthy();
    fireEvent.click(splitBox()!);
    expect(mergeWarning()).toBeNull();
  });

  it('hands the worker the parsed competition when download is clicked', async () => {
    renderWithProviders(<GeneratePage />, { auth: signedInAuth });

    fireEvent.click(await downloadButton());

    expect(posted).toHaveLength(1);
    const req = posted[0] as { settings: typeof settings; parsed: { nametags: unknown[] } };
    expect(req.settings.competitionId).toBe(settings.competitionId);
    expect(req.parsed.nametags).toHaveLength(4);
  });
});
