import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIVATE_KEYS, scrubWcif } from './corpus';

const DIR = 'tests/fixtures/wcif';
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

// Read as text, not through the loader: a private field must fail here even if a later
// change to corpus.ts would hide it.
describe.each(files)('%s', (file) => {
  const text = readFileSync(`${DIR}/${file}`, 'utf8');

  it.each(PRIVATE_KEYS)('holds no "%s" key', (key) => {
    expect(text).not.toContain(`"${key}":`);
  });

  it('holds nothing shaped like an email address', () => {
    expect(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []).toEqual([]);
  });

  it('is named after the competition it holds', () => {
    expect(`${JSON.parse(text).id}.json`).toBe(file);
  });
});

describe('scrubWcif', () => {
  it('removes private keys at any depth, keeps the rest', () => {
    const dirty = { id: 'X', persons: [{ name: 'A', email: 'a@b.c', birthdate: '2000-01-01', registration: { comments: 'hi', eventIds: ['333'] } }] };
    expect(scrubWcif(dirty)).toEqual({ id: 'X', persons: [{ name: 'A', registration: { eventIds: ['333'] } }] });
  });
});
