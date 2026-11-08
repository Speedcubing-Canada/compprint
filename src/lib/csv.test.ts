import { describe, it, expect } from 'vitest';
import { csvRows, decodeText } from './csv';

const utf16 = (s: string, bom: number[], le: boolean) => {
  const out = [...bom];
  for (const c of s) { const n = c.charCodeAt(0); out.push(...(le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff])); }
  return new Uint8Array(out).buffer;
};

describe('decodeText', () => {
  it('reads UTF-8, and falls back to Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('Zoé Núñez').buffer)).toBe('Zoé Núñez');
    expect(decodeText(new Uint8Array([0x5a, 0x6f, 0xe9]).buffer)).toBe('Zoé');
  });

  it('reads UTF-16 with either byte order mark', () => {
    expect(csvRows(decodeText(utf16('Zoé,Stream', [0xff, 0xfe], true)))).toEqual([['Zoé', 'Stream']]);
    expect(csvRows(decodeText(utf16('Zoé,Stream', [0xfe, 0xff], false)))).toEqual([['Zoé', 'Stream']]);
  });

  it('reads an empty file', () => {
    expect(decodeText(new ArrayBuffer(0))).toBe('');
  });
});

describe('csvRows', () => {
  it('splits on commas, semicolons and tabs, across any line ending', () => {
    expect(csvRows('a, b\r\nc;d\re\tf\n')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
  });

  it('keeps separators inside double quotes', () => {
    expect(csvRows('"Doe, Jane","Stream; Lead"\n"Say ""Hi""",x')).toEqual([['Doe, Jane', 'Stream; Lead'], ['Say "Hi"', 'x']]);
  });

  it('drops a BOM, blank lines and comments', () => {
    expect(csvRows('\uFEFFa\n\n  \n# note\nb')).toEqual([['a'], ['b']]);
  });
});
