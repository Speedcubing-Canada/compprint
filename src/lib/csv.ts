// A UTF-16 BOM (Excel's "Unicode Text"), else UTF-8, else Windows-1252 (Excel's plain "CSV"
// export in French, Spanish and Portuguese).
export function decodeText(bytes: ArrayBuffer): string {
  const [b0, b1] = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (b0 === 0xff && b1 === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (b0 === 0xfe && b1 === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function readTextFile(file: File, onText: (text: string) => void) {
  const reader = new FileReader();
  reader.onload = () => onText(decodeText(reader.result as ArrayBuffer));
  reader.readAsArrayBuffer(file);
}

// Comma, semicolon (Excel in fr/es/pt) or tab separated; "double quotes" may hold a separator.
function splitFields(line: string): string[] {
  const out = [''];
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { out[out.length - 1] += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) out.push('');
    else out[out.length - 1] += ch;
  }
  return out.map(f => f.trim());
}

/** Trimmed fields of each line; blank lines, `#` comments and a BOM are dropped. */
export function csvRows(text: string): string[][] {
  return text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(splitFields);
}
