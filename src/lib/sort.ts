/** Plain code-unit order, for ASCII keys that need no collation. */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
