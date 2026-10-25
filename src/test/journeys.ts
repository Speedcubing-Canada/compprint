// UI steps shared by the route tests. Callers pass i18n.t(...) so keys stay typed at the call site.

import { fireEvent, screen } from '@testing-library/react';
import i18n from '../i18n/index';
import { writeCompetition } from '../lib/flowState';
import { addCompetition } from './fakeWca';
import { sampleWcif } from './fixtures';

const { id, name } = sampleWcif();
export const SAMPLE = { id, name };

export const click = async (name: string | RegExp) =>
  fireEvent.click(await screen.findByRole('button', { name }));

/** The sample competition on the fake WCA, already picked, as if the organizer had come through the picker. */
export function seedCompetition() {
  addCompetition(sampleWcif());
  writeCompetition(SAMPLE.id, SAMPLE.name);
}

/** Picker → scope → settings, through the UI only. Leaves the caller on /settings. */
export async function walkToSettings(competitionName = SAMPLE.name) {
  fireEvent.click(await screen.findByText(competitionName));
  await click(i18n.t('scope.continue'));
  await screen.findByRole('button', { name: i18n.t('settings.generate_button') });
}
