// A UTF-16 BOM (Excel's "Unicode Text"), else UTF-8, else Windows-1252 (Excel's plain "CSV"
// export in French, Spanish and Portuguese).
export function decodeText(bytes: ArrayBuffer): string {
  const [b0, b1] = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (b0 === 0xff && b1 === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (b0 === 0xfe && b1 === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  // Any well-formed accent means UTF-8 with a few stray bytes, not a Windows-1252 file.
  return utf8.includes('\uFFFD') && !/[\u0080-\uFFFC]/.test(utf8)
    ? new TextDecoder('windows-1252').decode(bytes)
    : utf8;
}

const SEPARATORS = [',', ';', '\t'] as const;

// "Double quotes" only open at the start of a field, so a nickname like John "JJ" Doe stays as typed.
function splitFields(line: string, sep: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    while (line[i] === ' ') i++;
    let field = '';
    if (line[i] === '"') {
      for (i++; i < line.length; i++) {
        if (line[i] !== '"') field += line[i];
        else if (line[i + 1] === '"') { field += '"'; i++; } else { i++; break; }
      }
      const end = line.indexOf(sep, i);
      field += line.slice(i, end < 0 ? line.length : end);
      i = end < 0 ? line.length + 1 : end + 1;
    } else {
      const end = line.indexOf(sep, i);
      field = line.slice(i, end < 0 ? line.length : end);
      i = end < 0 ? line.length + 1 : end + 1;
    }
    out.push(field.trim());
  }
  return out;
}

/** Trimmed fields of each line; blank lines, `#` comments and a BOM are dropped. The separator
 * (comma, semicolon or tab) is whichever the first line uses most. */
export function csvRows(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  const first = lines[0]?.replace(/"[^"]*"/g, '') ?? '';
  const count = (s: string) => first.split(s).length;
  const sep = SEPARATORS.reduce((a, b) => (count(b) > count(a) ? b : a));
  return lines.map(l => splitFields(l, sep));
}
