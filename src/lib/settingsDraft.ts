import type { CompetitionSettings } from '../types/settings';

type FlowOwned = 'competitionId' | 'competitionName' | 'generationScope' | 'isCustomCompetition';

/**
 * `CompetitionSettings` minus the four values the flow owns. Derived with Omit so a new
 * field is a type error here until it is given an initial value.
 */
export type SettingsDraft = Omit<CompetitionSettings, FlowOwned>;

/**
 * Seeds the form from a stored blob. `wcaLiveId` normalises back to `''`: the submit
 * writes `null` for an empty one, and `null` would make the input uncontrolled.
 */
export function restorableSettings(previous: CompetitionSettings | null): Partial<SettingsDraft> {
  if (!previous) return {};
  const rest: Partial<CompetitionSettings> = { ...previous };
  delete rest.competitionId;
  delete rest.competitionName;
  delete rest.generationScope;
  delete rest.isCustomCompetition;
  // Older blobs carry `false` and no control is left to undo that.
  delete rest.scrambleDoubleCheck;
  return { ...rest, wcaLiveId: rest.wcaLiveId ?? '' };
}

/** The draft as stored on submit. A custom competition is unofficial: no live results, no double-checking, no "WCA Live:" line. */
export function submittedSettings(
  draft: SettingsDraft,
  flow: Pick<CompetitionSettings, FlowOwned>,
): CompetitionSettings {
  const isCustom = flow.isCustomCompetition;
  return {
    ...draft,
    ...flow,
    customEvents: draft.customEvents.filter(e => e.name.trim()),
    liveResultsMode: isCustom ? 'wca-live' : draft.liveResultsMode,
    wcaLiveId: isCustom ? null : (draft.wcaLiveId?.trim() || null),
    wcaLivePersonIds: isCustom ? null : draft.wcaLivePersonIds,
    hideWcaLiveId: isCustom ? true : draft.hideWcaLiveId,
    otsBlanks: !isCustom && draft.otsBlanks,
    scrambleDoubleCheck: !isCustom,
  };
}
