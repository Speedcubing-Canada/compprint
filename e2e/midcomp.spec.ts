import { test, expect, download } from './fixtures';
import { realWcif } from './fakeWca';

/** Pickering on the morning of day two: round 1 done, the 3BLD final's groups assigned. */
function midComp() {
  const wcif = realWcif('PickeringBlindfolded2026');
  // The fixture's final has no groups yet: add one, as a grouping tool would.
  const round = wcif.schedule.venues.flatMap((v) => v.rooms).flatMap((r) => r.activities)
    .find((a) => a.activityCode === '333bf-r2')!;
  const final = { ...round, id: 9001, name: `${round.name}, Group 1`, activityCode: '333bf-r2-g1', childActivities: [] };
  round.childActivities.push(final);
  const finalists = wcif.persons.filter((p) => p.registration?.isCompeting && p.registration.eventIds.includes('333bf')).slice(0, 5);
  for (const p of finalists) p.assignments.push({ activityId: final.id, assignmentCode: 'competitor', stationNumber: null });
  return wcif;
}

test('mid-competition, the defaults print the latest round only', async ({ page, wca, loginAs }) => {
  const wcif = midComp();
  wca.add(wcif);
  await loginAs();
  await page.getByText('Pickering Blindfolded 2026').click();

  await expect(page.getByRole('radio', { name: /Latest round only/ })).toBeChecked();
  for (const doc of ['Schedule Tracker', 'Nametags']) await expect(page.getByRole('checkbox', { name: doc })).not.toBeChecked();

  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.getByRole('button', { name: 'Generate →' }).click();
  const { name } = await download(page, 'Download');
  expect(name).toBe('PickeringBlindfolded2026_finals.pdf');
});
