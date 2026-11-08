import { describe, it, expect } from 'vitest';
import { parseStaffCsv } from './parseStaffCsv';

describe('parseStaffCsv', () => {
  it('reads WCA IDs, names and optional labels', () => {
    expect(parseStaffCsv('2015doej01\r\n# team\n\n  Zoé  Núñez , stream \n"Ana Lima","Scoretaking"\n')).toEqual([
      { key: '2015DOEJ01', label: null },
      { key: 'zoe nunez', label: 'STREAM' },
      { key: 'ana lima', label: 'SCORETAKING' },
    ]);
  });

  it('keeps the last line for a repeated person', () => {
    expect(parseStaffCsv('Ana Lima,Stream\nana lima')).toEqual([{ key: 'ana lima', label: null }]);
  });

  it('skips lines without a person', () => {
    expect(parseStaffCsv(',Stream\n#x\n')).toEqual([]);
  });
});
