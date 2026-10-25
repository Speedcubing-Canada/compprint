import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { writeSettings } from '../lib/flowState';
import { testSettings } from '../test/fixtures';
import { workers } from '../test/fakeWorker';
import { SAMPLE, seedCompetition } from '../test/journeys';
import { downloads } from '../test/routeSetup';
import { renderApp } from '../test/renderApp';

const download = () => screen.findByRole('button', { name: i18n.t('generate.download_button') });

function atGenerate() {
  seedCompetition();
  writeSettings(testSettings({ competitionId: SAMPLE.id }));
  renderApp('/generate');
}

describe('a failed render', () => {
  // The fetched competition is still good, so the organizer must be able to try again from
  // here; the error used to replace the whole page, Download button included.
  it('when the worker fails to load, says so and offers Download again', async () => {
    atGenerate();
    workers.failToLoad = 'Failed to fetch dynamically imported module';
    fireEvent.click(await download());
    expect(await screen.findByText(/Failed to fetch dynamically imported module/)).toBeTruthy();

    workers.failToLoad = null;
    fireEvent.click(await download());
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });

  it('when one document throws mid-render, says which and offers Download again', async () => {
    const renderer = await import('@react-pdf/renderer');
    atGenerate();
    const spy = vi.spyOn(renderer, 'pdf').mockImplementationOnce(() => { throw new Error('font failed to load'); });
    fireEvent.click(await download());
    expect(await screen.findByText(/font failed to load/)).toBeTruthy();
    spy.mockRestore();
    fireEvent.click(await download());
    await waitFor(() => expect(downloads).toHaveLength(1));
  });
});
