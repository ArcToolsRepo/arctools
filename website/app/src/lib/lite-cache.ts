import type { PadToken } from "./arc-api";

/** Terminal rows the user has already seen — the token page renders from this instantly on client-side
 * navigation instead of waiting for the server (no 450 ms race, no list re-download).
 * Kept on globalThis so every code-split chunk sees the same map. */
const g = globalThis as unknown as { __arcLite?: Map<string, PadToken> };
export const liteCache: Map<string, PadToken> = g.__arcLite ?? (g.__arcLite = new Map());
export function rememberRows(rows: PadToken[]) {
  for (const r of rows) if (r?.token) liteCache.set(r.token.toLowerCase(), r);
}
