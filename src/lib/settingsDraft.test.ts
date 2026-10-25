import { describe, expect, it } from 'vitest';
import { restorableSettings, submittedSettings, type SettingsDraft } from './settingsDraft';
import { testSettings } from '../test/fixtures';

const scope = testSettings().generationScope!;
const draftOf = (): SettingsDraft => testSettings({
    wcaLivePersonIds: { 1: '9' }, liveResultsMode: 'ilr', wcaLiveId: ' 4242 ', hideWcaLiveId: false, otsBlanks: true,
    customEvents: [
      { name: 'Relay', iconDataUrl: null, format: 'mo3', cutoff: '', limit: '' },
      { name: '  ', iconDataUrl: null, format: 'mo3', cutoff: '', limit: '' },
    ],
  });
const flow = (isCustom: boolean) => ({
  competitionId: 'C', competitionName: 'Comp', generationScope: scope, isCustom,
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
