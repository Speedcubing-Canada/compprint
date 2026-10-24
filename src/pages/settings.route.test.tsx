import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { readSettings } from '../lib/flowState';
import { sampleWcif } from '../test/fixtures';
import { addCompetition } from '../test/fakeWca';
import { click, walkToSettings } from '../test/journeys';
import { currentPath, renderApp } from '../test/renderApp';

const NAME = 'Gros Jouets à Montréal 2026';

async function atSettings() {
  addCompetition(sampleWcif(), { start_date: '2999-05-16', end_date: '2999-05-16' });
  renderApp('/competitions');
  await walkToSettings(NAME);
}

function upload(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe('a logo too big for sessionStorage', () => {
  // The logo rides in competition_settings as a data URL, and a phone photo blows the ~5 MB
  // sessionStorage quota. The write used to throw inside the click handler, so Generate did
  // nothing and said nothing.
  it('tells the organizer instead of silently staying put', async () => {
    await atSettings();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    upload(input, new File([new Uint8Array(4_500_000)], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeTruthy());

    await click(i18n.t('settings.generate_button'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(currentPath()).toBe('/settings');
    expect(readSettings()?.logoDataUrl ?? null).toBeNull();
  });
});
