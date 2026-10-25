import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { readSettings } from '../lib/flowState';
import { sampleWcif } from '../test/fixtures';
import { addCompetition } from '../test/fakeWca';
import { click, walkToSettings } from '../test/journeys';
import { currentPath, renderApp } from '../test/renderApp';

async function atSettings() {
  addCompetition(sampleWcif());
  renderApp('/competitions');
  await walkToSettings();
}

function upload(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe('a logo too big for sessionStorage', () => {
  // The logo rides in competition_settings as a data URL, and a phone photo blows the ~5 MB
  // sessionStorage quota.
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

  it('drops the warning once the organizer removes the logo', async () => {
    await atSettings();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    upload(input, new File([new Uint8Array(4_500_000)], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeTruthy());
    await click(i18n.t('settings.generate_button'));
    await screen.findByRole('alert');

    await click(i18n.t('common.remove'));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('storage that refuses the save for another reason', () => {
  it('says so instead of doing nothing', async () => {
    await atSettings();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    await click(i18n.t('settings.generate_button'));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('settings.save_failed'));
    expect(currentPath()).toBe('/settings');
  });
});
