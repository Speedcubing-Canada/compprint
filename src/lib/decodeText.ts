// UTF-8, else Windows-1252: Excel's plain "CSV" export in French, Spanish and Portuguese.
export function decodeText(bytes: ArrayBuffer): string {
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
