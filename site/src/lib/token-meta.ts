/** Shared token metadata cache (logo / name / socials / launchpad).
 *
 *  Why this exists: the ticker kept its metadata in component state. The Terminal re-renders on live trades and
 *  the strip remounts with it, so the state reset to {} and every remount re-asked the bot for the same ten
 *  tokens — 826 requests in 17 seconds at one point. The bot serves its HTTP API on the same event loop as the
 *  swap indexer, so that flood starved the indexer and froze every market cap on the site.
 *
 *  The cache therefore lives at module scope (survives remounts), de-duplicates concurrent requests for the same
 *  address, and refuses to ask again for a token it asked about recently — even if the answer was "nothing".
 */

import { BOT_API } from "@/lib/bot-api";

export type TokenMeta = {
  symbol?: string | null;
  name?: string | null;
  logo?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  launchpad?: string | null;
  launchpad_label?: string | null;
  /** Real mint time from the explorer's oldest transfer. The list's own createdAt is only the first block
   *  OUR index saw, which dates an old token from the day we noticed it (ARCT read 3 days at 10.4 days old). */
  deploy_ts?: number | null;
};

const TTL = 10 * 60_000;                 // a logo does not change; 10 minutes is plenty
const NEG_TTL = 5 * 60_000;              // "we know nothing about it" is also an answer worth remembering
const cache = new Map<string, { at: number; v: TokenMeta | null }>();
const inflight = new Map<string, Promise<void>>();

const fresh = (e: { at: number; v: TokenMeta | null } | undefined) =>
  !!e && Date.now() - e.at < (e.v ? TTL : NEG_TTL);

/** Metadata for the addresses we already hold — never triggers a request. */
export function peekMeta(tokens: string[]): Record<string, TokenMeta> {
  const out: Record<string, TokenMeta> = {};
  for (const t of tokens) {
    const e = cache.get(t.toLowerCase());
    if (e?.v) out[t.toLowerCase()] = e.v;
  }
  return out;
}

/** Fetch whatever is missing (batched, deduplicated) and resolve with everything known afterwards. */
export async function loadMeta(tokens: string[]): Promise<Record<string, TokenMeta>> {
  const want = [...new Set(tokens.map((t) => t.toLowerCase()).filter((t) => /^0x[0-9a-f]{40}$/.test(t)))];
  const miss = want.filter((t) => !fresh(cache.get(t)));
  const waits: Promise<void>[] = [];
  const ask: string[] = [];
  for (const t of miss) {
    const p = inflight.get(t);
    if (p) waits.push(p);
    else ask.push(t);
  }
  if (ask.length) {
    // 40 addresses per request keeps the URL inside the bot's 8 KB request-line limit
    for (let i = 0; i < ask.length; i += 40) {
      const chunk = ask.slice(i, i + 40);
      const job = fetch(`${BOT_API}/api/token-meta?tokens=${chunk.join(",")}`)
        .then((r) => r.json())
        .then((j: { meta?: Record<string, TokenMeta> }) => {
          const got = j?.meta ?? {};
          const at = Date.now();
          for (const t of chunk) cache.set(t, { at, v: got[t] ?? got[t.toLowerCase()] ?? null });
        })
        .catch(() => {
          // a failed call must still back off, or a broken endpoint turns into a request storm
          const at = Date.now();
          for (const t of chunk) if (!cache.has(t)) cache.set(t, { at, v: null });
        })
        .finally(() => { for (const t of chunk) inflight.delete(t); });
      for (const t of chunk) inflight.set(t, job);
      waits.push(job);
    }
  }
  if (waits.length) await Promise.allSettled(waits);
  return peekMeta(want);
}


/** Real birthdays for the addresses we already hold, as unix seconds. Never triggers a request. */
export function peekBirthdays(tokens: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tokens) {
    const ts = cache.get(t.toLowerCase())?.v?.deploy_ts;
    if (typeof ts === "number" && ts > 0) out.set(t.toLowerCase(), ts);
  }
  return out;
}
