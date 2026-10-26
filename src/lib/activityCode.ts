export interface ActivityCode {
  eventId: string;
  round: number;
  group?: number;
  // FMC and multi-attempt MBLD are scheduled per attempt ("333fm-r1-a1").
  attempt?: number;
}

/** `333-r1`, `333-r1-g2`, `333fm-r1-a1` or `333fm-r1-g1-a1`; null for anything else (`other-lunch`). */
export function parseActivityCode(code: string): ActivityCode | null {
  const m = /^([^-]+)-r(\d+)(?:-g(\d+))?(?:-a(\d+))?$/.exec(code);
  if (!m) return null;
  return {
    eventId: m[1],
    round: Number(m[2]),
    ...(m[3] ? { group: Number(m[3]) } : {}),
    ...(m[4] ? { attempt: Number(m[4]) } : {}),
  };
}

/** `333-r2`, the WCIF round id. */
export const roundIdOf = (c: ActivityCode) => `${c.eventId}-r${c.round}`;
