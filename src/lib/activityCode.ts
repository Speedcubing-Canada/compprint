export interface ActivityCode {
  eventId: string;
  round: number;
  group?: number;
  // FMC and multi-attempt MBLD are scheduled per attempt ("333fm-r1-a1").
  attempt?: number;
}

/** `333-r1`, `333-r1-g2` or `333fm-r1-a1`; null for anything else (`other-lunch`, `333-r1-g1-a1`). */
export function parseActivityCode(code: string): ActivityCode | null {
  const m = /^([^-]+)-r(\d+)(?:-g(\d+)|-a(\d+))?$/.exec(code);
  if (!m) return null;
  return {
    eventId: m[1],
    round: Number(m[2]),
    ...(m[3] ? { group: Number(m[3]) } : {}),
    ...(m[4] ? { attempt: Number(m[4]) } : {}),
  };
}

/** Plain code-unit order, for ASCII keys that need no collation. */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
