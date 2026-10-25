import { expect, it } from 'vitest';
import { parseActivityCode, roundIdOf } from './activityCode';

it.each([
  ['333-r1', { eventId: '333', round: 1 }],
  ['333oh-r2-g3', { eventId: '333oh', round: 2, group: 3 }],
  ['333fm-r1-a2', { eventId: '333fm', round: 1, attempt: 2 }],
  ['333fm-r1-g1-a2', { eventId: '333fm', round: 1, group: 1, attempt: 2 }],
  ['333-r1-g12', { eventId: '333', round: 1, group: 12 }],
  ['other-lunch', null],
  ['333-r1-a1-g1', null],
  ['333', null],
])('parses %s', (code, expected) => {
  expect(parseActivityCode(code)).toEqual(expected);
});

it('rebuilds the round id', () => {
  expect(roundIdOf(parseActivityCode('333-r2-g4')!)).toBe('333-r2');
});
