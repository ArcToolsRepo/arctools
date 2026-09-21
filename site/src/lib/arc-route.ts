/**
 * Swap aggregation for Arc: quote every venue a token trades on (Uniswap V3 tiers, Uniswap V4 pools, ArcToolsPad
 * curves), pick the best, and try 2-venue splits. Returns legs ready for ArcAggregator.buy/sell.
 * Units: USDC side always NATIVE 1e18 (msg.value); tokens 1e18.
 */
import { createServerFn } from "@tanstack/react-start";
import { rpc } from "./arc-api";

export const ARC_AGGREGATOR = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"; // v3: + VENUE_PADQUOTE (ArcToolsPad curves quoted in a wrapped stock)
/** v2 aggregator with the two-hop V3 leg (VENUE_V3PATH). null until ArcAggregatorV2 is deployed — the hop venue is
 *  then skipped in discovery so nothing routes through a contract that cannot execute it. */
export const V3PATH_AGGREGATOR: string | null = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A";
const SITE_API = typeof window !== "undefined" ? "" : "https://arctools.fun";
const USDC = "0x3600000000000000000000000000000000000000";
const ZERO = "0x0000000000000000000000000000000000000000";
const QUOTER_V2 = "0x7dfd4f31be6814d2906bde155c3e1b146eac1468";
const V3_FACTORY = "0xf0db7b58379503491d857db50ac9ece64c653918";
const PAD_V2 = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE";
const PAD_V3 = "0x2726AeC64D8a9BC41B9940dDA5D21c889458B348";
const INSIDER_API = "https://bot-production-4200.up.railway.app";

const SEL = {
  getPool: "0x1698ee82",
  quoteExactInputSingle: "0xc6a5026a",
  quoteExactInput: "0xcdca1753",
  poolFee: "0xddca3f43",
  quoteV4: "0x" + "00000000", // filled below (keccak computed at module load is not available: use constant)
  curve: "0x06d8d7db",
  quoteBuy: "0x0d7a94f6",
  quoteSell: "0xd98b2f5c",
  launch: "0x214013ca",
  // Warp-style curve (circlewarp.fun): token.curve() -> curve; curve.quoteBuy(usdcIn) / quoteSell(tokens) / graduated()
  tokenCurve: "0x7165485d",
  wQuoteBuy: "0x4beb394c",
  wQuoteSell: "0xa64190c4",
  wGraduated: "0xe7c2b772",
};
// keccak("quoteV4((address,address,uint24,int24,address),address,bool,uint256)")[:4]
SEL.quoteV4 = "0x3cf8388d";

const p32 = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const pnum = (n: bigint) => BigInt.asUintN(256, n).toString(16).padStart(64, "0");

export type V4Key = { id: string; currency0: string; currency1: string; fee: number; tick_spacing: number; hooks: string; usdc_dec: number };
export type Leg = { venue: 1 | 2 | 3 | 4 | 5 | 6; target: string; fee: number; key: V4Key | null; amount: string; label: string; out: string };
export type RouteResult = {
  legs: Leg[];
  out: string;              // total expected output (wei-ish string)
  single: { label: string; out: string }[];   // per-venue quotes for display
  split: boolean;
  error?: string;
  /** venue known but no quote could be fetched (RPC busy): out = 0, buyer goes in at market with minOut 0 */
  unquoted?: boolean;
};

type Venue = { kind: "v3"; fee: number; label: string } | { kind: "v3path"; mid: string; midSymbol: string; fee1: number; fee2: number; label: string } | { kind: "padquote"; target: string; quote: string; fee1: number; label: string } | { kind: "v4"; key: V4Key; label: string } | { kind: "pad"; target: string; label: string; curve?: { Q: bigint; T: bigint; real: bigint } } | { kind: "curve"; target: string; label: string };

async function call(to: string, data: string): Promise<string | null> {
  // a relay hiccup (502 / timeout) must not make a venue vanish from the route → one quick retry on transport errors
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = (await rpc("eth_call", [{ data, to }, "latest"], { priority: true })) as string;
      return r && r !== "0x" ? r : null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/revert|execution|invalid opcode/i.test(msg)) return null;   // genuine on-chain revert (e.g. quoter: no liquidity)
      if (attempt === 1) return null;
      await new Promise((res) => setTimeout(res, 250));
    }
  }
  return null;
}

const V4_NAMES: Record<string, string> = {
  "0xa368005ad249fbebcd5baa7396c9e3b3e44e6044": "Arguspad",
  "0xfea9dfe2a20e11f7c4d4b30c6c96a06e42e6e044": "Arguspad",
  "0x465af15c85ac291d5cffb8d02d8c8e23102fe6e3": "act.fun",
  "0x20eead6db6b3d0a4491e9073119dd0ebff166acc": "UBI.fun",
  "0xc780c0f4aac690908854d351b8bfda2812daefdc": "UBI.fun",
  "0xbaba3f590b3661de78998d1576a73a4d726b2acc": "Sashimi",
  "0x47e7936ae9891e61c5123db720593c05de7120cc": "faze.fun",
  "0x173c4bdd5cf95a935d2b5636c573c5f4df062044": "peach.ag",
  "0xf73a3f56c533f7f1146fbc97806f07efa66ce0cc": "Klik",
  "0xc75076a17c1ba3dd949773f9036efa4a840020cc": "Hopium",
  "0xca55cdde6578f6f8113dd339520e13418abc2acc": "Lift",
  "0x7cd35b33d495396c4707056d23582df68d0a28cc": "Archemist",
  "0xc0fda29b6683ef1aa5376d5d7054ff773f5a20cc": "Minara",
  "0xb6a65950534f061618b4ae102fbcbb8541a8e0cc": "Minara",
};

async function discoverVenues(token: string): Promise<Venue[]> {
  const t = token.toLowerCase();
  const out: Venue[] = [];
  const [p1, p2, p3, v4, c2, c3, l3, wc] = await Promise.all([
    call(V3_FACTORY, SEL.getPool + p32(t) + p32(USDC) + pnum(10000n)),
    call(V3_FACTORY, SEL.getPool + p32(t) + p32(USDC) + pnum(3000n)),
    call(V3_FACTORY, SEL.getPool + p32(t) + p32(USDC) + pnum(500n)),
    fetch(`${INSIDER_API}/api/v4pool?token=${t}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ pools?: (V4Key & { swaps: number })[] } | null>,
    call(PAD_V2, SEL.curve + p32(t)),
    call(PAD_V3, SEL.curve + p32(t)),
    call(PAD_V3, SEL.launch + p32(t)),
    call(t, SEL.tokenCurve),
  ]);
  // Warp bonding curve: token exposes curve(); trade there until graduated()
  if (wc && wc.length >= 66 && !/^0x0+$/.test(wc)) {
    const curve = "0x" + wc.slice(26, 66);
    const [code, grad] = await Promise.all([rpc("eth_getCode", [curve, "latest"]).catch(() => "0x"), call(curve, SEL.wGraduated)]);
    if (typeof code === "string" && code.length > 2 && !(grad && BigInt(grad) !== 0n)) out.push({ kind: "curve", target: curve, label: "Warp curve" });
  }
  for (const [r, fee] of [[p1, 10000], [p2, 3000], [p3, 500]] as [string | null, number][]) {
    if (r && !/^0x0+$/.test(r)) out.push({ kind: "v3", fee, label: `Uniswap V3 ${fee / 10000}%` });
  }
  // Only V4 pools that have actually traded. Anyone can initialise a pool for any token; TOLLY had 77, 76 of them
  // empty. An empty pool still answers quoteV4 with a price off its sqrtPrice — and that fake quote won the
  // route (213 USDC vs the real 3.8 on V3), then the swap delivered nothing. If no pool has traded yet (a fresh
  // launch), keep the newest few so a brand-new token is still routable.
  const v4all = (v4?.pools ?? []).filter((p) => p.fee !== null && p.fee !== undefined);
  const traded = v4all.filter((p) => (p.swaps ?? 0) > 0);
  for (const p of (traded.length ? traded : v4all.slice(0, 3))) {
    out.push({ kind: "v4", key: { ...p, usdc_dec: p.usdc_dec ?? 18 }, label: `Uniswap V4 · ${V4_NAMES[(p.hooks ?? "").toLowerCase()] ?? "pool"}` });
  }
  // ArcToolsPad curves: curve(token) -> (usdcReserve, tokenReserve, ...) active when tokenReserve > 0 and not graduated
  const active = (r: string | null) => !!r && r.length >= 130 && BigInt("0x" + r.slice(66, 130)) > 0n;
  if (active(c2)) out.push({ kind: "pad", target: PAD_V2, label: "ArcToolsPad curve" });
  if (active(c3)) {
    // v3: only USDC-quoted launches go through the aggregator (quote token = 0x0 or facade)
    // launch(token): quoteToken, quoteTier, mode, targetQuote, virtualQuote, graduated, pool, lpTokenId
    const q = l3 && l3.length >= 66 ? "0x" + l3.slice(26, 66) : ZERO;
    const graduated = !!l3 && l3.length >= 2 + 64 * 6 && BigInt("0x" + l3.slice(2 + 64 * 5, 2 + 64 * 6)) !== 0n;
    if (!graduated && (q.toLowerCase() === ZERO || q.toLowerCase() === USDC)) {
      // curve(token) = (quoteReserve, tokenReserve, …); launch(token) word 4 = virtualQuote. Real USDC in the curve = Q − virtual.
      out.push({ kind: "pad", target: PAD_V3, label: "ArcToolsPad v3 curve" });   // curve state is read fresh per quote (venues are memoised 5 min)
    }
    else if (!graduated && V3PATH_AGGREGATOR) {
      // ERC-20 quote (wrapped stock): USDC -> quote on V3, then the curve — one tx through ArcAggregator v3
      const fee1 = await stockTier(q);
      if (fee1) out.push({ kind: "padquote", target: PAD_V3, quote: q.toLowerCase(), fee1, label: `ArcToolsPad curve via ${await symbolOf(q)}` });
    }
  }
  // long.supply launches: main market is a V3 pool quoted in a wrapped stock → two-hop USDC -> stock -> token (needs the v2 aggregator)
  if (V3PATH_AGGREGATOR) {
    try {
      const ln = (await longLaunches()).find((l) => l.token === t);
      if (ln && ln.pool) {
        // USDC/stock tier: cached per stock (long.supply seeded every stock on the 1% tier; WETH also 0.3%)
        const fee1 = await stockTier(ln.pairToken);
        const feeHex = await call(ln.pool, SEL.poolFee);
        const fee2 = feeHex ? Number(BigInt(feeHex)) : 10000;   // their launch pools are all 1%
        if (fee1) out.push({ kind: "v3path", mid: ln.pairToken, midSymbol: ln.pairSymbol, fee1, fee2, label: `Uniswap V3 via ${ln.pairSymbol}` });
      }
    } catch { /* long.supply API down: no hop venue */ }
  }
  return out;
}

const _sym = new Map<string, string>();
async function symbolOf(token: string): Promise<string> {
  const k = token.toLowerCase();
  if (_sym.has(k)) return _sym.get(k)!;
  const r = await call(k, "0x95d89b41");
  let sym = "quote";
  try { if (r && r.length >= 130) { const ln = parseInt(r.slice(66, 130), 16); sym = Buffer.from(r.slice(130, 130 + ln * 2), "hex").toString("utf8") || sym; } } catch { /* keep */ }
  _sym.set(k, sym); return sym;
}

const _tier = new Map<string, number>();
async function stockTier(stock: string): Promise<number | null> {
  const k = stock.toLowerCase();
  if (_tier.has(k)) return _tier.get(k)!;
  for (let attempt = 0; attempt < 2; attempt++) {
    const tiers = await Promise.all([10000, 3000, 500, 100].map((f) => call(V3_FACTORY, SEL.getPool + p32(USDC) + p32(k) + pnum(BigInt(f)))));
    const idx = tiers.findIndex((r) => r && !/^0x0+$/.test(r));
    if (idx >= 0) { _tier.set(k, [10000, 3000, 500, 100][idx]); return _tier.get(k)!; }
    if (tiers.every((r) => r !== null)) break;   // all answered "no pool": genuine
  }
  return null;
}

let _long: { ts: number; v: { token: string; pool: string; pairToken: string; pairSymbol: string }[] } | null = null;
async function longLaunches() {
  if (_long && Date.now() - _long.ts < 60_000) return _long.v;
  let v: { token: string; pool: string; pairToken: string; pairSymbol: string }[] = [];
  if (typeof window === "undefined") {
    // server (routeSwap): a Worker cannot fetch its own hostname → read the memoized list directly
    const LS = await import("@/lib/longsupply");
    v = await LS.longLaunches().catch(() => []);
  } else {
    const j = (await fetch(`${SITE_API}/api/stocks?launches=1`).then((r) => r.json())) as { launches?: typeof v };
    v = j.launches ?? [];
  }
  if (v.length) _long = { ts: Date.now(), v };   // never cache an empty list (API hiccup) — retry next call
  return v;
}

/** abi.encodePacked(tokenA, fee, tokenB, fee, tokenC) for QuoterV2.quoteExactInput / SwapRouter02.exactInput */
const packPath = (a: string, f1: number, b: string, f2: number, c: string) =>
  a.replace(/^0x/, "").toLowerCase() + f1.toString(16).padStart(6, "0") + b.replace(/^0x/, "").toLowerCase() + f2.toString(16).padStart(6, "0") + c.replace(/^0x/, "").toLowerCase();
const encBytes = (hex: string) => pnum(BigInt(hex.length / 2)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");

/** Quote one venue. amount: buy = native USDC 1e18, sell = tokens 1e18. Returns output in the same convention. */
async function quoteVenue(v: Venue, token: string, side: "buy" | "sell", amount: bigint): Promise<bigint | null> {
  if (amount <= 0n) return null;
  if (v.kind === "v3") {
    const [tin, tout] = side === "buy" ? [USDC, token] : [token, USDC];
    const amt = side === "buy" ? amount / 10n ** 12n : amount;
    const r = await call(QUOTER_V2, SEL.quoteExactInputSingle + p32(tin) + p32(tout) + pnum(amt) + pnum(BigInt(v.fee)) + pnum(0n));
    if (!r) return null;
    const out = BigInt("0x" + r.slice(2, 66));
    return side === "buy" ? out : out * 10n ** 12n;   // facade 6-dec -> native 1e18
  }
  if (v.kind === "v3path") {
    const path = side === "buy" ? packPath(USDC, v.fee1, v.mid, v.fee2, token) : packPath(token, v.fee2, v.mid, v.fee1, USDC);
    const amt = side === "buy" ? amount / 10n ** 12n : amount;
    // quoteExactInput(bytes path, uint256 amountIn): head = offset(0x40) + amountIn, tail = bytes
    const r = await call(QUOTER_V2, SEL.quoteExactInput + pnum(64n) + pnum(amt) + encBytes(path));
    if (!r) return null;
    const out = BigInt("0x" + r.slice(2, 66));
    return side === "buy" ? out : out * 10n ** 12n;
  }
  if (v.kind === "padquote") {
    if (side === "buy") {
      // USDC -> quote (QuoterV2 single) -> curve quoteBuy(token, quoteIn)
      const r1 = await call(QUOTER_V2, SEL.quoteExactInputSingle + p32(USDC) + p32(v.quote) + pnum(amount / 10n ** 12n) + pnum(BigInt(v.fee1)) + pnum(0n));
      if (!r1) return null;
      const qIn = BigInt("0x" + r1.slice(2, 66));
      const r2 = await call(v.target, SEL.quoteBuy + p32(token) + pnum(qIn));
      return r2 ? BigInt("0x" + r2.slice(2, 66)) : null;
    }
    const r1 = await call(v.target, SEL.quoteSell + p32(token) + pnum(amount));
    if (!r1) return null;
    const qOut = BigInt("0x" + r1.slice(2, 66));
    if (qOut <= 0n) return null;
    const r2 = await call(QUOTER_V2, SEL.quoteExactInputSingle + p32(v.quote) + p32(USDC) + pnum(qOut) + pnum(BigInt(v.fee1)) + pnum(0n));
    return r2 ? BigInt("0x" + r2.slice(2, 66)) * 10n ** 12n : null;
  }
  if (v.kind === "v4") {
    const k = v.key;
    const key = p32(k.currency0) + p32(k.currency1) + pnum(BigInt(k.fee)) + pnum(BigInt(k.tick_spacing)) + p32(k.hooks);
    const r = await call(ARC_AGGREGATOR, SEL.quoteV4 + key + p32(token) + pnum(side === "buy" ? 1n : 0n) + pnum(amount));
    return r ? BigInt("0x" + r.slice(2, 66)) : null;
  }
  if (v.kind === "curve") {
    const r = await call(v.target, (side === "buy" ? SEL.wQuoteBuy : SEL.wQuoteSell) + pnum(amount));
    return r ? BigInt("0x" + r.slice(2, 66)) : null;
  }
  // pad: quoteBuy(token, usdcIn) / quoteSell(token, tokens) — both 1e18
  let amt = amount;
  if (side === "sell" && v.kind === "pad" && v.curve) amt = padSellCap(v.curve, amount);
  if (amt <= 0n) return null;
  const r = await call(v.target, (side === "buy" ? SEL.quoteBuy : SEL.quoteSell) + p32(token) + pnum(amt));
  return r ? BigInt("0x" + r.slice(2, 66)) : null;
}

/** Fresh curve state for a v3 pad token: (Q, T, real = Q − virtualQuote). Never memoised — a sell cap computed on a
 *  5-minute-old reserve is wrong the moment anyone trades. */
export async function padCurveState(token: string): Promise<{ Q: bigint; T: bigint; real: bigint; taxBps: bigint } | null> {
  const [c3, l3, m3] = await Promise.all([call(PAD_V3, SEL.curve + p32(token)), call(PAD_V3, SEL.launch + p32(token)), call(PAD_V3, "0xe021deff" + p32(token))]);
  if (!c3 || c3.length < 130 || !l3 || l3.length < 2 + 64 * 5) return null;
  const Q = BigInt("0x" + c3.slice(2, 66)), T = BigInt("0x" + c3.slice(66, 130));
  const virt = BigInt("0x" + l3.slice(2 + 64 * 4, 2 + 64 * 5));
  // meta(token): token, creator, mktWallet, marketingBps, rewardsBps, burnBps, … — marketing + rewards are taken from
  // the USDC that enters the curve on a buy (burn is taken in tokens)
  const w = (i: number) => (m3 && m3.length >= 2 + 64 * (i + 1) ? BigInt("0x" + m3.slice(2 + 64 * i, 2 + 64 * (i + 1))) : 0n);
  return { Q, T, real: Q > virt ? Q - virt : 0n, taxBps: w(3) + w(4) };
}

/** ArcPad v3.1 reverts a sell with "liquidity" when the curve payout would exceed the REAL reserve (Q − virtual):
 *  the 1 % buy fee leaves the curve, so the first buyer selling 100 % always trips it — the token looked like a
 *  honeypot and our own sim flagged it CANNOT EXIT. Payout for x tokens is gross(x) = Q − Q·T/(T+x) ≤ real
 *  ⇔ x ≤ T·real/(Q − real). Sell that much (minus a hair for rounding); the rest stays in the wallet. */
export function padSellCap(c: { Q: bigint; T: bigint; real: bigint }, want: bigint): bigint {
  if (c.real <= 0n || c.Q <= c.real) return 0n;
  const xMax = (c.T * c.real) / (c.Q - c.real);
  const safe = (xMax * 9_990n) / 10_000n;
  return want < safe ? want : safe;
}

function toLeg(v: Venue, amount: bigint, out: bigint, side: "buy" | "sell" = "buy"): Leg {
  if (side === "sell" && v.kind === "pad" && v.curve) { const a = padSellCap(v.curve, amount); if (a > 0n) amount = a; }
  if (v.kind === "v3") return { venue: 1, target: ZERO, fee: v.fee, key: null, amount: amount.toString(), label: v.label, out: out.toString() };
  if (v.kind === "padquote") return { venue: 6, target: v.target, fee: v.fee1, key: { id: "", currency0: v.quote, currency1: ZERO, fee: 0, tick_spacing: 0, hooks: ZERO, usdc_dec: 18 }, amount: amount.toString(), label: v.label, out: out.toString() };
  if (v.kind === "v3path") return { venue: 5, target: v.mid, fee: v.fee1, key: { id: "", currency0: ZERO, currency1: ZERO, fee: v.fee2, tick_spacing: 0, hooks: ZERO, usdc_dec: 18 }, amount: amount.toString(), label: v.label, out: out.toString() };
  if (v.kind === "v4") return { venue: 2, target: ZERO, fee: 0, key: v.key, amount: amount.toString(), label: v.label, out: out.toString() };
  if (v.kind === "curve") return { venue: 4, target: v.target, fee: 0, key: null, amount: amount.toString(), label: v.label, out: out.toString() };
  return { venue: 3, target: v.target, fee: 0, key: null, amount: amount.toString(), label: v.label, out: out.toString() };
}

export const routeSwap = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; side: "buy" | "sell"; amount: string; afterBuy?: string }) => input)
  .handler(async ({ data }): Promise<RouteResult> => {
    const token = data.token.toLowerCase();
    const amount = BigInt(data.amount);
    if (!/^0x[0-9a-f]{40}$/.test(token) || amount <= 0n) return { legs: [], out: "0", single: [], split: false, error: "bad input" };
    // venue discovery is ~8 RPC round-trips (0.3–1 s each through the relay) → remember it for a minute per token,
    // shared across isolates via KV; quotes themselves are always live
    const { memo } = await import("./arc-api");
    let venues = await memo<Venue[]>(`venues:${token.toLowerCase()}`, 300_000, () => discoverVenues(token), (v) => v.length > 0);
    if (venues.length === 0) {
      // discovery needs ~8 RPC round-trips; when the public RPCs are melting we still know the venue for most tokens from
      // the token list (launchpad → pool type). Instant-V3 pads all seed a 1 % USDC pool.
      try {
        const { listAllTokensImpl } = await import("./arc-api");
        const all = await memo("list:__all", 60_000, listAllTokensImpl, (v) => v.length > 50);
        const t = all.find((x) => x.token.toLowerCase() === token);
        const V3_PADS = new Set(["Lift", "eve.fun", "ArcPad", "Archemist", "RadarDex", "UniswapV3", "Arguspad V3", "Tolly"]);
        if (t && V3_PADS.has(t.pad) && !t.quote && !t.stock) venues = [{ kind: "v3", fee: 10000, label: "Uniswap V3 1% (assumed)" }];
      } catch { /* no list either */ }
    }
    if (venues.length === 0) return { legs: [], out: "0", single: [], split: false, error: "no venue" };
    // simulation support: the honeypot probe buys and sells in ONE call, so the curve it sells into already holds
    // the buy's USDC. afterBuy = the USDC the probe spends; the pad's real reserve grows by 99 % of it (1 % fee leaves).
    const afterBuy = data.afterBuy ? BigInt(data.afterBuy) : 0n;
    if (data.side === "sell" && venues.some((v) => v.kind === "pad" && v.target === PAD_V3)) {
      const st = await padCurveState(token);
      if (st) {
        // after the probe's buy: Q grows by the net USDC, T shrinks by the tokens bought (= the amount now being sold)
        // net USDC that reached the curve: minus the 1 % platform fee, minus the creator's marketing/rewards taxes
        const add = (((afterBuy * 99n) / 100n) * (10_000n - st.taxBps)) / 10_000n; const T = afterBuy > 0n && st.T > amount ? st.T - amount : st.T;
        const cur = { Q: st.Q + add, T, real: st.real + add };
        venues = venues.map((v) => (v.kind === "pad" && v.target === PAD_V3 ? { ...v, curve: cur } : v));
      }
    }
    const quotes = await Promise.all(venues.map((v) => quoteVenue(v, token, data.side, amount)));
    // A V4 pool with a hook can take its own fee, block, or reroute inside the swap — quoteV4 models plain AMM maths
    // and sees none of it. ARGUS: the hooked pool (128x less liquidity) quoted 0.4925, the plain pool 0.4852; the
    // hook skimmed on execution and the sell reverted on slippage. Rank hooked pools at 95 % of their quote: when one
    // still wins it wins by a real margin. The leg keeps its true quote for minOut.
    const HOOKED = (v: Venue) => v.kind === "v4" && !/^0x0+$/.test((v.key.hooks ?? "0x0").toLowerCase());
    const rankOut = (v: Venue, out: bigint) => (HOOKED(v) ? (out * 95n) / 100n : out);
    let ranked = venues
      .map((v, i) => ({ v, out: quotes[i] }))
      .filter((x): x is { v: Venue; out: bigint } => x.out !== null && x.out > 0n)
      .sort((a, b) => { const ra = rankOut(a.v, a.out), rb = rankOut(b.v, b.out); return rb > ra ? 1 : rb < ra ? -1 : 0; });
    // A V4 quote that beats every non-V4 venue by more than 3x is not a bargain, it is a lie: quoteV4 prices off
    // sqrtPrice and does not see that the pool's liquidity sits in ticks the swap never reaches (TOLLY: 213 USDC
    // quoted on V4, 3.8 real on V3, execution returned 0). Nobody leaves a real 3x arbitrage open on a live market.
    const bestOther = ranked.filter((x) => x.v.kind !== "v4").reduce((m, x) => (x.out > m ? x.out : m), 0n);
    if (bestOther > 0n) ranked = ranked.filter((x) => x.v.kind !== "v4" || x.out <= bestOther * 3n);
    if (ranked.length === 0) {
      // a v3 pad curve nobody has bought into holds no real USDC: there is nothing to sell yet, and that is not a routing failure
      const emptyPad = venues.find((v) => v.kind === "pad" && v.curve && v.curve.real <= 0n);
      if (data.side === "sell" && emptyPad && venues.every((v) => v.kind === "pad" || v.kind === "padquote")) return { legs: [], out: "0", single: [], split: false, error: "curve holds no USDC yet (no buys) — nothing to sell into" };
      // every quote failed (RPC busy) but the venue exists: hand back an UNQUOTED single-venue route so the buyer can still
      // go in at market with minOut = 0 (house rule: speed over protection) — the UI labels it "no quote".
      const pick = venues.find((v) => v.kind === "v3" && v.fee === 10000) ?? venues.find((v) => v.kind === "v3") ?? venues.find((v) => v.kind === "pad" || v.kind === "curve" || v.kind === "v4") ?? null;
      if (pick && quotes.some((q) => q === null)) return { legs: [toLeg(pick, amount, 0n, data.side)], out: "0", single: [], split: false, unquoted: true };
      return { legs: [], out: "0", single: [], split: false, error: "no liquidity" };
    }
    const single = ranked.map((x) => ({ label: x.v.label, out: x.out.toString() }));
    let best: { legs: Leg[]; out: bigint; split: boolean } = { legs: [toLeg(ranked[0].v, amount, ranked[0].out, data.side)], out: ranked[0].out, split: false };
    // 2-venue split: only worth it when the runner-up is within 40% of the best (else the split cannot win)
    if (ranked.length >= 2 && ranked[1].out * 10n >= ranked[0].out * 6n) {
      const [a, b] = [ranked[0].v, ranked[1].v];
      for (const pctA of [75n, 50n, 25n]) {
        const amtA = (amount * pctA) / 100n;
        const amtB = amount - amtA;
        const [qa, qb] = await Promise.all([quoteVenue(a, token, data.side, amtA), quoteVenue(b, token, data.side, amtB)]);
        if (qa && qb && qa + qb > best.out) best = { legs: [toLeg(a, amtA, qa, data.side), toLeg(b, amtB, qb, data.side)], out: qa + qb, split: true };
      }
    }
    return { legs: best.legs, out: best.out.toString(), single, split: best.split };
  });
