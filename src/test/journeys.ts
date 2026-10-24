// UI steps shared by the route tests. Callers pass i18n.t(...) so keys stay typed at the call site.

import { fireEvent, screen } from '@testing-library/react';
import i18n from '../i18n/index';

export const click = async (name: string | RegExp) =>
  fireEvent.click(await screen.findByRole('button', { name }));

/** Picker → scope → settings, through the UI only. Leaves the caller on /settings. */
export async function walkToSettings(competitionName: string) {
  fireEvent.click(await screen.findByText(competitionName));
  await click(i18n.t('scope.continue'));
  await screen.findByRole('button', { name: i18n.t('settings.generate_button') });
}
