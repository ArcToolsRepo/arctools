/**
 * long.supply — custodial bridge that mints Robinhood-Chain tokenized stocks (CRCL, NVDA, SPY, TSLA, OPENAI…) on Arc
 * and a launchpad that opens Uniswap V3 pools quoting memecoins in those wrapped stocks.
 *
 * Public endpoints (their Next.js API, same data their UI renders):
 *   GET https://long.supply/api/pairs      → wrapped stocks: arcStock address, vault, underlying, usdX18 (stock price)
 *   GET https://long.supply/api/launches   → launched tokens: token, deployer, pool (V3), pairToken, priceX18 (in pair token), image, socials
 *
 * We surface both in the Terminal (source chip "long.supply", "Stocks" filter, STOCK · IOU badge), on token pages
 * (custodial-IOU notice instead of a Token Score for the stocks themselves) and as quote-token options in ArcToolsPad.
 */
import { memo, multicall, type PadToken } from "@/lib/arc-api";

/** Wrapped stocks have no on-chain logo; the issuer's company mark (Google favicon service by domain, 128 px) is the honest picture. */
const STOCK_LOGO: Record<string, string> = {
  CRCL: "https://www.google.com/s2/favicons?domain=circle.com&sz=128", NVDA: "https://www.google.com/s2/favicons?domain=nvidia.com&sz=128", TSLA: "https://www.google.com/s2/favicons?domain=tesla.com&sz=128",
  SPY: "https://www.google.com/s2/favicons?domain=ssga.com&sz=128", AAPL: "https://www.google.com/s2/favicons?domain=apple.com&sz=128", GME: "https://www.google.com/s2/favicons?domain=gamestop.com&sz=128",
  AMC: "https://www.google.com/s2/favicons?domain=amctheatres.com&sz=128", HIMS: "https://www.google.com/s2/favicons?domain=forhims.com&sz=128", SNAP: "https://www.google.com/s2/favicons?domain=snap.com&sz=128",
  SPCX: "https://www.google.com/s2/favicons?domain=spacex.com&sz=128", OPENAI: "https://www.google.com/s2/favicons?domain=openai.com&sz=128", ANTHROPIC: "https://www.google.com/s2/favicons?domain=anthropic.com&sz=128",
  WETH: "https://www.google.com/s2/favicons?domain=ethereum.org&sz=128",
};

const API = "https://long.supply/api";
// long.supply's domain dropped out of DNS on 14.09 while their keeper backend on Railway kept serving the same JSON
// (without the /api prefix). Try the public host first, then the keeper — same shapes, same data.
const API_HOSTS = ["https://long.supply/api", "https://long-supply-keeper-production.up.railway.app"];
async function lsFetch<T>(path: string): Promise<T> {
  let last: unknown = null;
  for (const h of API_HOSTS) {
    try {
      const r = await fetch(`${h}${path}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
      if (!r.ok) { last = new Error(`${h}${path} ${r.status}`); continue; }
      return (await r.json()) as T;
    } catch (e) { last = e; }
  }
  throw last ?? new Error("long.supply unreachable");
}
const SEL_SUPPLY = "0x18160ddd";
const SEL_NAME = "0x06fdde03";

export type Stock = { token: string; symbol: string; name: string; usd: number; vault: string; underlying: string; supply: number; mcapUsd: number; launches: number; usdcPool: string | null; poolFee: number | null; usdcLiq: number | null };
export type Launch = {
  token: string; deployer: string; pool: string; pairToken: string; pairSymbol: string; pairUsd: number; name: string; symbol: string;
  image: string | null; description: string | null; website: string | null; twitter: string | null; telegram: string | null;
  priceInPair: number; priceUsd: number; supply: number; mcapUsd: number; block: number; updatedAt: number; liqUsd: number | null; createdAt: string | null;
};

/** block → unix ts, linear from two reference blocks (Arc block time is steady); cached 10 min */
const blockClock = (): Promise<{ head: number; ts: number; slope: number }> => memo("long:blockclock", 600_000, async () => {
  const { rpc } = await import("@/lib/arc-api");
  const h = await rpc("eth_getBlockByNumber", ["latest", false]) as { number: string; timestamp: string };
  const head = Number(BigInt(h.number)); const ts = Number(BigInt(h.timestamp));
  const back = 200_000;
  const o = await rpc("eth_getBlockByNumber", ["0x" + (head - back).toString(16), false]) as { timestamp: string };
  const slope = (ts - Number(BigInt(o.timestamp))) / back;
  return { head, ts, slope: slope > 0 ? slope : 1 };
}, (v) => v.head > 0);

const decStr = (hex: string | null): string => {
  if (!hex || hex === "0x" || hex.length < 66) return "";
  try {
    const off = Number(BigInt("0x" + hex.slice(2, 66))) * 2;
    const len = Number(BigInt("0x" + hex.slice(2 + off, 2 + off + 64)));
    return Buffer.from(hex.slice(2 + off + 64, 2 + off + 64 + len * 2), "hex").toString("utf8");
  } catch { return ""; }
};
const toNum18 = (hex: string | null): number => (hex && hex !== "0x" ? Number(BigInt(hex)) / 1e18 : 0);

async function chainMeta(tokens: string[]): Promise<Record<string, { supply: number; name: string }>> {
  const out: Record<string, { supply: number; name: string }> = {};
  if (!tokens.length) return out;
  const calls = tokens.flatMap((t) => [{ target: t, data: SEL_SUPPLY }, { target: t, data: SEL_NAME }]);
  const res = await multicall(calls).catch(() => calls.map(() => null));
  tokens.forEach((t, i) => { out[t] = { supply: toNum18(res[i * 2]), name: decStr(res[i * 2 + 1]) }; });
  return out;
}

/** long.supply's API goes away from time to time (DNS outage on 14.09 wiped every stock pair from the site until the
 *  cache was rebuilt). Keep the last good answer in KV for 30 days, outside the purge-able memo keys, and serve it
 *  whenever the live call fails or comes back empty. */
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

/** Wrapped stocks (13 as of Sep 2026). Cached 5 min; supply/name from chain cached a day. */
export const longStocks = (): Promise<Stock[]> => memo<Stock[]>("long:stocks", 300_000, () => lastGood<Stock[]>("long:stocks", async () => {
  const [pairs, launches] = await Promise.all([
    lsFetch(`/pairs`) as Promise<{ pairs: { symbol: string; vault: string; arcStock: string; underlying: string; usdX18: string }[] }>,
    lsFetch(`/launches?limit=1`).catch(() => ({ countByPair: {} })) as Promise<{ countByPair?: Record<string, number> }>,
  ]);
  const toks = (pairs.pairs ?? []).map((p) => p.arcStock.toLowerCase());
  const meta = await memo<Record<string, { supply: number; name: string }>>("long:stockmeta:" + toks.join(","), 86_400_000, () => chainMeta(toks), (v) => Object.values(v).some((m) => m.supply > 0));
  // USDC pool per stock (factory.getPool on 4 tiers) + how much USDC sits in it — this is what decides whether the
  // stock is a usable pair on ArcToolsPad and how badly USDC buyers get slipped
  const pools = await memo<Record<string, { pool: string | null; fee: number | null; liq: number | null }>>("long:stockpools:" + toks.join(","), 120_000, async () => {
    const FACTORY = "0xf0db7b58379503491d857db50ac9ece64c653918"; const USDC = "0x3600000000000000000000000000000000000000";
    const p32 = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
    const tiers = [10000, 3000, 500, 100];
    const calls = toks.flatMap((t) => tiers.map((f) => ({ target: FACTORY, data: "0x1698ee82" + p32(USDC) + p32(t) + f.toString(16).padStart(64, "0") })));
    const res = await multicall(calls).catch(() => calls.map(() => null));
    const out: Record<string, { pool: string | null; fee: number | null; liq: number | null }> = {};
    const poolCalls: { target: string; data: string }[] = []; const poolIdx: string[] = [];
    toks.forEach((t, i) => {
      let pool: string | null = null, fee: number | null = null;
      tiers.forEach((f, j) => { const r = res[i * tiers.length + j]; if (!pool && r && !/^0x0+$/.test(r)) { pool = "0x" + r.slice(-40); fee = f; } });
      out[t] = { pool, fee, liq: null };
      if (pool) { poolCalls.push({ target: USDC, data: "0x70a08231" + p32(pool) }); poolIdx.push(t); }
    });
    const bal = await multicall(poolCalls).catch(() => poolCalls.map(() => null));
    poolIdx.forEach((t, i) => { const b = bal[i]; out[t].liq = b && b !== "0x" ? Number(BigInt(b)) / 1e6 : null; });
    return out;
  }, (v) => Object.values(v).some((x) => x.pool));
  return (pairs.pairs ?? []).map((p) => {
    const t = p.arcStock.toLowerCase(); const usd = Number(p.usdX18) / 1e18; const m = meta[t] ?? { supply: 0, name: "" }; const pl = pools[t] ?? { pool: null, fee: null, liq: null };
    return { token: t, symbol: p.symbol, name: m.name || `${p.symbol} • Arc Token`, usd, vault: p.vault, underlying: p.underlying, supply: m.supply, mcapUsd: usd * m.supply, launches: launches.countByPair?.[t] ?? 0,
      usdcPool: pl.pool, poolFee: pl.fee, usdcLiq: pl.liq };
  });
}, (v) => v.length > 0), (v) => v.length > 0);

/** Every token launched on long.supply, priced in USD through the wrapped-stock quote. Cached 60 s. */
export const longLaunches = (): Promise<Launch[]> => memo<Launch[]>("long:launches", 60_000, () => lastGood<Launch[]>("long:launches", async () => {
  const pages: { launches: Record<string, unknown>[]; usdByPairToken: Record<string, string>; total: number }[] = [];
  for (let off = 0; off < 1000; off += 100) {
    const j = await lsFetch(`/launches?limit=100&offset=${off}`) as typeof pages[number];
    pages.push(j);
    if (off + 100 >= (j.total ?? 0)) break;
  }
  const usdBy: Record<string, number> = {};
  for (const p of pages) for (const [k, v] of Object.entries(p.usdByPairToken ?? {})) usdBy[k.toLowerCase()] = Number(v) / 1e18;
  const stocks = await longStocks().catch(() => [] as Stock[]);
  const symOf = new Map(stocks.map((s) => [s.token, s.symbol]));
  const rows = pages.flatMap((p) => p.launches ?? []);
  const toks = rows.map((r) => String(r.token).toLowerCase());
  const meta = await memo<Record<string, { supply: number; name: string }>>("long:launchmeta:" + toks.length + ":" + toks.slice(-3).join(","), 3_600_000, async () => {
    let m = await chainMeta(toks);
    // a dropped multicall chunk leaves supply 0 → retry once before caching (mcap would show as "—")
    const missing = toks.filter((t) => !(m[t]?.supply > 0));
    if (missing.length && missing.length < toks.length) { const again = await chainMeta(missing); m = { ...m, ...again }; }
    return m;
  }, (v) => Object.values(v).filter((x) => x.supply > 0).length >= Object.keys(v).length * 0.9);
  // liquidity = pair-token balance sitting in the pool × stock USD × 2 (both sides), one multicall, cached 2 min
  const liq = await memo<Record<string, number>>("long:launchliq:" + toks.length, 120_000, async () => {
    const ok = rows.filter((r) => /^0x[0-9a-f]{40}$/i.test(String(r.pool ?? "")) && /^0x[0-9a-f]{40}$/i.test(String(r.pairToken ?? "")));
    const calls = ok.map((r) => ({ target: String(r.pairToken).toLowerCase(), data: "0x70a08231" + String(r.pool).replace(/^0x/, "").toLowerCase().padStart(64, "0") }));
    const out: Record<string, number> = {};
    let pending = ok.map((r, i) => i);
    for (let pass = 0; pass < 3 && pending.length; pass++) {   // relay drops whole chunks at times: re-run only what is missing
      const res = await multicall(pending.map((i) => calls[i]), 40).catch(() => pending.map(() => null));
      const next: number[] = [];
      pending.forEach((i, j) => {
        const b = res[j];
        if (b && b !== "0x") out[String(ok[i].token).toLowerCase()] = (Number(BigInt(b)) / 1e18) * (usdBy[String(ok[i].pairToken).toLowerCase()] ?? 0) * 2;
        else next.push(i);
      });
      pending = next;
      if (pending.length) await new Promise((r) => setTimeout(r, 300));
    }
    return out;
  }, (v) => Object.keys(v).length >= rows.length * 0.8);
  const clock = await blockClock().catch(() => null);
  return rows.map((r) => {
    const token = String(r.token).toLowerCase(); const pair = String(r.pairToken).toLowerCase();
    const pairUsd = usdBy[pair] ?? 0; const priceInPair = Number(r.priceX18 ?? 0) / 1e18; const supply = meta[token]?.supply ?? 0;
    const priceUsd = priceInPair * pairUsd;
    return {
      token, deployer: String(r.deployer ?? "").toLowerCase(), pool: String(r.pool ?? "").toLowerCase(), pairToken: pair, pairSymbol: symOf.get(pair) ?? "STOCK", pairUsd,
      name: String(r.name ?? ""), symbol: String(r.symbol ?? ""), image: (r.image as string) ?? null, description: (r.description as string) ?? null,
      website: (r.website as string) ?? null, twitter: (r.twitter as string) ?? null, telegram: (r.telegram as string) ?? null,
      priceInPair, priceUsd, supply, mcapUsd: priceUsd * supply, block: Number(r.block ?? 0), updatedAt: Number(r.updatedAt ?? 0),
      liqUsd: liq[token] ?? null,
      createdAt: clock && Number(r.block) > 0 ? new Date((clock.ts - (clock.head - Number(r.block)) * clock.slope) * 1000).toISOString() : null,
    };
  });
}, (v) => v.length > 0), (v) => v.length > 0);

/** Terminal rows: launches (pad "long.supply") + the wrapped stocks themselves (flagged `stock`). */
export async function longSupplyTokens(): Promise<PadToken[]> {
  const [launches, stocks] = await Promise.all([longLaunches().catch(() => [] as Launch[]), longStocks().catch(() => [] as Stock[])]);
  const a: PadToken[] = launches.map((l) => ({
    createdAt: l.createdAt, logo: l.image, mcapUsd: l.mcapUsd || null, name: l.name, pad: "long.supply", pool: l.pool, priceUsd: l.priceUsd || null,
    stage: `V3 · ${l.pairSymbol} pair`, symbol: l.symbol, telegram: l.telegram, token: l.token, twitter: l.twitter, venueUrl: `https://long.supply/${l.token}`,
    volUsd: null, website: l.website, og: false, dexes: [], quote: l.pairToken, quoteSymbol: l.pairSymbol, liqUsd: l.liqUsd,
  }));
  const b: PadToken[] = stocks.map((s) => ({
    createdAt: null, logo: STOCK_LOGO[s.symbol.toUpperCase()] ?? null, mcapUsd: s.mcapUsd || null, name: s.name, pad: "long.supply", pool: null, priceUsd: s.usd, stage: "wrapped stock · custodial IOU",
    symbol: s.symbol, telegram: null, token: s.token, twitter: "https://x.com/Longdotsupply", venueUrl: "https://long.supply/bridge", volUsd: null, website: "https://long.supply",
    og: false, dexes: [], stock: true,
  }));
  return [...a, ...b];
}
