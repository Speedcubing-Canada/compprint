import { describe, it, expect } from 'vitest';
import { sanitizeEvent } from './analytics.js';

const valid = {
  v: 1,
  event: 'generate',
  comp: { id: 'GrosJouets2026', country: 'CA', lat: 45.5017, lng: -73.5673, custom: false },
  size: { competitors: 87, groups: 31, stages: 2, days: 2 },
  scope: { mode: 'everything', documents: ['scorecards', 'nametags'] },
};

describe('sanitizeEvent', () => {
  it('passes a well-formed event through unchanged', () => {
    expect(sanitizeEvent(valid)).toEqual(valid);
  });

  it('accepts every event kind we send', () => {
    for (const event of ['generate', 'error', 'session'])
      expect(sanitizeEvent({ v: 1, event })).toEqual({ v: 1, event });
  });

  it('rejects anything that is not one of our events', () => {
    expect(sanitizeEvent({ v: 1, event: 'nope' })).toBeNull();
    expect(sanitizeEvent({ v: 9, event: 'generate' })).toBeNull();
    expect(sanitizeEvent({ event: 'generate' })).toBeNull();
    expect(sanitizeEvent(null)).toBeNull();
    expect(sanitizeEvent('generate')).toBeNull();
    expect(sanitizeEvent([{ v: 1, event: 'generate' }])).toBeNull();
  });

  it('truncates long strings instead of dropping them', () => {
    const out = sanitizeEvent({ v: 1, event: 'error', message: 'x'.repeat(500) });
    expect(out.message).toHaveLength(120);
  });

  it('drops non-finite numbers', () => {
    const out = sanitizeEvent({ v: 1, event: 'generate', a: NaN, b: Infinity, c: 0 });
    expect(out).toEqual({ v: 1, event: 'generate', c: 0 });
  });

  it('drops values that are not loggable scalars', () => {
    const out = sanitizeEvent({ v: 1, event: 'generate', fn: () => {}, un: undefined, ok: null });
    expect(out).toEqual({ v: 1, event: 'generate', ok: null });
  });

  it('keeps one level of nesting and drops what is below it', () => {
    const out = sanitizeEvent({ v: 1, event: 'generate', comp: { id: 'A', venue: { id: 'B' } } });
    expect(out.comp).toEqual({ id: 'A' });
  });

  it('caps array length', () => {
    const out = sanitizeEvent({ v: 1, event: 'generate', docs: Array(50).fill('scorecards') });
    expect(out.docs).toHaveLength(20);
  });

  it('caps key count', () => {
    const body = { v: 1, event: 'generate' };
    for (let i = 0; i < 100; i++) body[`k${i}`] = i;
    expect(Object.keys(sanitizeEvent(body))).toHaveLength(40);
  });

  it('does not let a key rewrite the output prototype', () => {
    const out = sanitizeEvent(JSON.parse('{"v":1,"event":"session","__proto__":{"polluted":true}}'));
    expect(out).toEqual({ v: 1, event: 'session' });
    expect({}.polluted).toBeUndefined();
  });
});

describe('sanitizeEvent arrays', () => {
  it('keeps a scalar array nested inside an object', () => {
    const out = sanitizeEvent({ v: 1, event: 'generate', scope: { documents: ['a', 'b'] } });
    expect(out.scope.documents).toEqual(['a', 'b']);
  });

  it('drops non-scalar array items rather than recursing into them', () => {
    const out = sanitizeEvent({ v: 1, event: 'generate', docs: ['a', { id: 'b' }, ['c']] });
    expect(out.docs).toEqual(['a']);
  });
});

// The client builds these (src/lib/analytics.ts) and this file's sanitiser is the only thing
// between them and the log. Nothing else checks that the two agree, and the failure mode is
// silent: a field added client-side that the sanitiser quietly eats.
describe('round trip with the real client payload', () => {
  it('preserves a generate event whole', async () => {
    const { buildGenerateEvent, buildOutput } = await import('./src/lib/analytics.ts');
    const event = buildGenerateEvent({
      parsed: {
        nametags: [{ name: 'Alice' }],
        scheduleDays: [{ dayLabel: 'Day 1', stages: [{ stageName: 'bleu', rows: [] }] }],
        checkingDays: [{ dayLabel: 'Day 1', rows: [{ groupCount: 4 }] }],
      },
      wcif: {
        events: [{ rounds: [{}, {}] }],
        schedule: { venues: [{ countryIso2: 'CA', latitudeMicrodegrees: 45501700, longitudeMicrodegrees: -73567300 }] },
      },
      settings: {
        competitionId: 'GrosJouets2026', paperFormat: 'A4', language: 'fr',
        secondaryLanguage: 'en', nametagLayout: 'vertical', nametagLogoMode: 'with-name',
        nametagQrMode: 'back-only', useDefaultLogo: true, logoDataUrl: null,
        hideWcaLiveId: false, secondRoundMode: 'prefilled',
        scorecardCheckMode: 'per-group-card', scrambleDoubleCheck: false,
        customEvents: [], isCustomCompetition: false,
        generationScope: { mode: 'everything', documents: { scorecards: true, nametags: true } },
      },
      uiLanguage: 'en',
      presetId: 'quebec',
      output: buildOutput([{}, {}], 42, 210, 14),
    });

    expect(sanitizeEvent(event)).toEqual(event);
  });
});

// Seeded random bodies: whatever arrives, the log line stays flat, finite and plain.
describe('sanitizeEvent on random input', () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const keys = ['a', 'event', 'v', '__proto__', 'constructor', 'prototype', 'x'.repeat(300), 'toString'];
  function value(depth) {
    const r = rnd();
    if (depth < 4 && r < 0.25) return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 50) }, () => [pick(keys) + Math.floor(rnd() * 9), value(depth + 1)]));
    if (depth < 4 && r < 0.4) return Array.from({ length: Math.floor(rnd() * 30) }, () => value(depth + 1));
    return pick(['s'.repeat(Math.floor(rnd() * 400)), NaN, Infinity, 1e308, true, null, undefined, () => 1, Symbol('x'), 10n]);
  }
  const depthOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? 1 + Math.max(0, ...Object.values(v).map(depthOf)) : 0);

  it('stays flat, bounded and JSON-safe over 300 bodies', () => {
   for (let i = 0; i < 300; i++) {
    const body = { ...value(0), v: 1, event: pick(['generate', 'error', 'session']) };
    const out = sanitizeEvent(body);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(depthOf(out)).toBeLessThanOrEqual(2);
    expect(Object.keys(out).length).toBeLessThanOrEqual(40);
    // Round-trips through JSON unchanged: nothing non-finite, no functions, no bigint.
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
   }
  });
});
