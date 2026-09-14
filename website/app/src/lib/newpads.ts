/**
 * Launchpads with a public API: Lift (lift.fun) and Ellipse (ellipse.fun).
 * Both create a Uniswap V3 pool in the launch tx, so their tokens trade through the aggregator; the API gives us what the
 * chain does not: logo, socials, market cap, 24 h volume, pool liquidity, creation time.
 *   Lift    GET https://api.lift.fun/api/v1/tokens?limit=100&cursor=…   (e6 = 6-decimal USDC units)
 *   Ellipse GET https://ellipse.fun/api/launches                         (pairs: bridged CRCL / GLD / USDT / BTC; usdPair = pair token USD)
 * Cached 60 s in KV with a 30-day last-good snapshot (same pattern as long.supply).
 */
import { decodeString, memo, multicall } from "@/lib/arc-api";
import type { PadToken } from "@/lib/arc-api";

async function lastGood<T>(key: string, live: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  const { memoKV, keepAlive } = await import("./memo-kv");
  const kv = memoKV();
  try {
    const v = await live();
    if (ok(v)) { if (kv) keepAlive(kv.put(`lastgood:${key}`, JSON.stringify(v), { expirationTtl: 30 * 86400 }).catch(() => null)); return v; }
  } catch { /* fall through */ }
  if (kv) { const raw = await kv.get(`lastgood:${key}`, "text").catch(() => null); if (raw) { try { return JSON.parse(raw) as T; } catch { /* ignore */ } } }
  throw new Error(`${key}: live failed and no snapshot`);
}

type LiftItem = {
  address: string; creator: string; pool: string; name: string; symbol: string; image_url: string | null; website: string | null; x: string | null; telegram: string | null;
  created_at: string; market_cap_e6: string | null; pool_quote_balance_e6: string | null; volume_24h_e6: string | null; graduated: boolean; progress_bps: number | string | null; sqrt_price_x96: string | null;
};

export const liftTokens = (): Promise<PadToken[]> => memo<PadToken[]>("lift:tokens", 60_000, () => lastGood<PadToken[]>("lift:tokens", async () => {
  const out: PadToken[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 12; page++) {
    const j = (await fetch(`https://api.lift.fun/api/v1/tokens?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }).then((r) => r.json())) as { items?: LiftItem[]; next_cursor?: string | null };
    const items = j.items ?? [];
    for (const t of items) {
      const mc = t.market_cap_e6 != null ? Number(t.market_cap_e6) / 1e6 : null;
      const liq = t.pool_quote_balance_e6 != null ? (Number(t.pool_quote_balance_e6) / 1e6) * 2 : null;   // pool USDC side × 2
      const priceUsd = mc != null ? mc / 1e9 : null;   // Lift supply is 1e9
      out.push({
        token: t.address.toLowerCase(), symbol: (t.symbol ?? "").slice(0, 16), name: t.name ?? t.symbol ?? "", pad: "Lift", pool: t.pool?.toLowerCase() ?? null,
        logo: t.image_url || null, website: t.website || null, twitter: t.x || null, telegram: t.telegram || null,
        createdAt: t.created_at, mcapUsd: mc, priceUsd, volUsd: t.volume_24h_e6 != null ? Number(t.volume_24h_e6) / 1e6 : null, liqUsd: liq,
        stage: t.graduated ? "graduated" : null, venueUrl: `https://lift.fun/token/${t.address}`, og: false, dexes: ["v3"],
      } as PadToken);
    }
    cursor = j.next_cursor ?? null;
    if (!cursor || items.length < 100) break;
  }
  return out;
}, (v: PadToken[]) => v.length > 0), (v: PadToken[]) => v.length > 0);

type EllipseLaunch = {
  token: string; pool: string; creator: string; pairToken: string; sym: string; name: string; logoUrl: string | null; website: string | null; twitter: string | null; telegram: string | null;
  mcap: number | string | null; liquidita: number | string | null; volume24usd: number | string | null; fdv: number | string | null; usdPair: number | string | null; prezzoPair: number | string | null; supply: number | string | null;
  ufficiale?: boolean; marchioFinto?: boolean;
};

export const ellipseTokens = (): Promise<PadToken[]> => memo<PadToken[]>("ellipse:tokens", 60_000, () => lastGood<PadToken[]>("ellipse:tokens", async () => {
  const j = (await fetch("https://ellipse.fun/api/launches", { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" } }).then((r) => r.json())) as { launches?: EllipseLaunch[]; simboliPair?: Record<string, string> };
  const syms = Object.fromEntries(Object.entries(j.simboliPair ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  // the API's `sym` is the PAIR symbol; the token's own symbol comes from the chain (one multicall for all launches)
  const launches = j.launches ?? [];
  const tokSym: Record<string, string> = {};
  try {
    const res = await multicall(launches.map((l) => ({ target: l.token, data: "0x95d89b41" })));
    launches.forEach((l, i) => { const r = res[i]; if (r && r !== "0x") { try { tokSym[l.token.toLowerCase()] = decodeString(r).slice(0, 16); } catch { /* ignore */ } } });
  } catch { /* symbols fall back to the name */ }
  return launches.map((l) => {
    const pair = l.pairToken.toLowerCase();
    const quoteSymbol = syms[pair] ?? l.sym ?? "?";
    const num = (x: unknown) => (x == null || x === "" ? null : Number(x));
    const mc = num(l.mcap) ?? num(l.fdv);
    const supply = num(l.supply) ?? 1e9;
    return {
      token: l.token.toLowerCase(), symbol: tokSym[l.token.toLowerCase()] ?? (l.name ?? "").slice(0, 16), name: l.name ?? "", pad: "Ellipse", pool: l.pool?.toLowerCase() ?? null,
      logo: l.logoUrl || null, website: l.website || null, twitter: l.twitter || null, telegram: l.telegram || null,
      createdAt: null, mcapUsd: mc, priceUsd: mc != null && supply > 0 ? mc / supply : null, volUsd: num(l.volume24usd), liqUsd: num(l.liquidita),
      quote: pair, quoteSymbol: `b${quoteSymbol}`, quoteUsd: num(l.usdPair) ?? null,
      stage: null, venueUrl: `https://ellipse.fun/token/${l.token}`, og: false, dexes: ["v3"],
    } as PadToken;
  });
}, (v: PadToken[]) => v.length > 0), (v: PadToken[]) => v.length > 0);
