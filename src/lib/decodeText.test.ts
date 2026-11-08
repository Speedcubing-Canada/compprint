import { describe, it, expect } from 'vitest';
import { decodeText } from './decodeText';

describe('decodeText', () => {
  it('reads UTF-8, and falls back to Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('Zoé Núñez').buffer)).toBe('Zoé Núñez');
    expect(decodeText(new Uint8Array([0x5a, 0x6f, 0xe9]).buffer)).toBe('Zoé');
  });
});
