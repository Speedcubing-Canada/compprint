import { describe, it, expect } from 'vitest';
import { parseWCIF, type CoverEntry } from './wcif-parser';
import { buildWcif } from '../test/wcifGen';
import { testSettings } from '../test/fixtures';

// Red Stage in Toronto, Blue Stage in Paris, both running 333 round 1 at 09:00Z.
function twoVenueWcif() {
  const wcif = buildWcif({
    name: 'two venues', competitors: 8, stages: 2, groupsPerStage: 2,
    coreEvents: ['333'], extraEvents: 0, days: 1, events: ['333'],
  });
  const [toronto] = wcif.schedule.venues;
  const [red, blue] = toronto.rooms;
  wcif.schedule.venues = [
    { ...toronto, rooms: [red] },
    { ...toronto, id: 2, name: 'Paris Hall', timezone: 'Europe/Paris', rooms: [blue] },
  ];
  return wcif;
}

const parse = () => parseWCIF(twoVenueWcif(), testSettings({
  generationScope: { mode: 'everything', documents: {
    scorecards: true, scheduleTracker: true, nametags: false, roundChecklist: true,
    firstTimerSlips: false, groupOverview: true, venueSchedule: true,
  } },
}));

describe('each venue prints its own timezone', () => {
  it('schedule tracker', () => {
    const stages = parse().scheduleDays[0].stages;
    expect(stages.map(s => [s.stageName, s.rows[0].startTime])).toEqual([
      ['Red Stage', '05:00'], ['Blue Stage', '11:00'],
    ]);
  });

  it('group overview', () => {
    const g1 = parse().groupOverview.filter(g => g.heading.endsWith('Group 1 (Red)') || g.heading.endsWith('Group 1 (Blue)'));
    expect(g1.map(g => [g.room, g.startTime])).toEqual([['Red Stage', '05:00'], ['Blue Stage', '11:00']]);
  });

  it('cover card group times', () => {
    const covers = parse().firstRound.filter((e): e is CoverEntry => e.kind === 'cover' && e.group.includes(' 1 of '));
    expect(covers.map(c => [c.group, c.startTime])).toEqual([['Blue 1 of 2', '11:00'], ['Red 1 of 2', '05:00']]);
  });

  it('venue schedule', () => {
    const rows = parse().venueSchedule!.days[0].rows.filter(r => r.name === '3x3x3 Cube Round 1');
    expect(rows.map(r => [r.rooms, r.start])).toEqual([[['Red Stage'], '5:00 AM'], [['Blue Stage'], '11:00 AM']]);
  });
});
