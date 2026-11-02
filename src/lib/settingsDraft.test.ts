import { describe, expect, it } from 'vitest';
import { coverTimingShown, restorableSettings, submittedSettings, type SettingsDraft } from './settingsDraft';
import { testSettings } from '../test/fixtures';

const scope = testSettings().generationScope!;
const draftOf = (): SettingsDraft => testSettings({
    wcaLivePersonIds: { 1: '9' }, liveResultsMode: 'ilr', wcaLiveId: ' 4242 ', hideWcaLiveId: false, otsBlanks: true,
    customEvents: [
      { name: 'Relay', iconDataUrl: null, format: 'mo3', cutoff: '', limit: '' },
      { name: '  ', iconDataUrl: null, format: 'mo3', cutoff: '', limit: '' },
    ],
  });
const flow = (isCustomCompetition: boolean) => ({
  competitionId: 'C', competitionName: 'Comp', generationScope: scope, isCustomCompetition,
});

describe('submittedSettings', () => {
  it('keeps a WCA competition\'s live settings, trimmed, and drops unnamed custom events', () => {
    const out = submittedSettings(draftOf(), flow(false));
    expect(out).toMatchObject({
      competitionId: 'C', isCustomCompetition: false, liveResultsMode: 'ilr', wcaLiveId: '4242',
      wcaLivePersonIds: { 1: '9' }, hideWcaLiveId: false, otsBlanks: true, scrambleDoubleCheck: true,
    });
    expect(out.customEvents.map(e => e.name)).toEqual(['Relay']);
  });

  it('strips everything official from a custom competition', () => {
    expect(submittedSettings(draftOf(), flow(true))).toMatchObject({
      isCustomCompetition: true, liveResultsMode: 'wca-live', wcaLiveId: null, wcaLivePersonIds: null,
      hideWcaLiveId: true, otsBlanks: false, scrambleDoubleCheck: false,
    });
  });

  it('round-trips through restorableSettings, minus what the flow owns', () => {
    const saved = submittedSettings(draftOf(), flow(false));
    expect(restorableSettings(saved)).not.toHaveProperty('competitionId');
    expect(restorableSettings(null)).toEqual({});
    expect(restorableSettings({ ...saved, wcaLiveId: null }).wcaLiveId).toBe('');
  });
});

describe('coverTiming', () => {
  const docs = (scheduleTracker: boolean) => ({ ...scope.documents, scheduleTracker });

  it('follows the tracker until chosen', () => {
    expect(coverTimingShown(undefined, docs(true))).toBe(false);
    expect(coverTimingShown(undefined, docs(false))).toBe(true);
    expect(coverTimingShown(true, docs(true))).toBe(true);
    expect(coverTimingShown(false, docs(false))).toBe(false);
  });

  it('stores and restores the draft value as-is', () => {
    const untouched = submittedSettings({ ...draftOf(), coverTiming: undefined }, flow(false));
    expect(untouched.coverTiming).toBeUndefined();
    expect(restorableSettings(JSON.parse(JSON.stringify(untouched)))).not.toHaveProperty('coverTiming');
    expect(restorableSettings(submittedSettings({ ...draftOf(), coverTiming: false }, flow(false))).coverTiming).toBe(false);
  });
});
