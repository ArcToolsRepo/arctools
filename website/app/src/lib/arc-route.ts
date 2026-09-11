/**
 * Swap aggregation for Arc: quote every venue a token trades on (Uniswap V3 tiers, Uniswap V4 pools, ArcToolsPad
 * curves), pick the best, and try 2-venue splits. Returns legs ready for ArcAggregator.buy/sell.
 * Units: USDC side always NATIVE 1e18 (msg.value); tokens 1e18.
 */
import { createServerFn } from "@tanstack/react-start";
import { rpc } from "./arc-api";

export const ARC_AGGREGATOR = "0xff9A8F35F683C810f6C1507f7409Bf0637093707";
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
export type Leg = { venue: 1 | 2 | 3 | 4; target: string; fee: number; key: V4Key | null; amount: string; label: string; out: string };
export type RouteResult = {
  legs: Leg[];
  out: string;              // total expected output (wei-ish string)
  single: { label: string; out: string }[];   // per-venue quotes for display
  split: boolean;
  error?: string;
};

type Venue = { kind: "v3"; fee: number; label: string } | { kind: "v4"; key: V4Key; label: string } | { kind: "pad"; target: string; label: string } | { kind: "curve"; target: string; label: string };

async function call(to: string, data: string): Promise<string | null> {
  try {
    const r = (await rpc("eth_call", [{ data, to }, "latest"])) as string;
    return r && r !== "0x" ? r : null;
  } catch {
    return null;
  }
}

const V4_NAMES: Record<string, string> = {
  "0xa368005ad249fbebcd5baa7396c9e3b3e44e6044": "Arguspad",
  "0x465af15c85ac291d5cffb8d02d8c8e23102fe6e3": "act.fun",
  "0x20eead6db6b3d0a4491e9073119dd0ebff166acc": "UBI.fun",
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
  for (const p of (v4?.pools ?? []).filter((p) => p.fee !== null && p.fee !== undefined)) {
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
    if (!graduated && (q.toLowerCase() === ZERO || q.toLowerCase() === USDC)) out.push({ kind: "pad", target: PAD_V3, label: "ArcToolsPad v3 curve" });
  }
  return out;
}

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
  const r = await call(v.target, (side === "buy" ? SEL.quoteBuy : SEL.quoteSell) + p32(token) + pnum(amount));
  return r ? BigInt("0x" + r.slice(2, 66)) : null;
}

function toLeg(v: Venue, amount: bigint, out: bigint): Leg {
  if (v.kind === "v3") return { venue: 1, target: ZERO, fee: v.fee, key: null, amount: amount.toString(), label: v.label, out: out.toString() };
  if (v.kind === "v4") return { venue: 2, target: ZERO, fee: 0, key: v.key, amount: amount.toString(), label: v.label, out: out.toString() };
  if (v.kind === "curve") return { venue: 4, target: v.target, fee: 0, key: null, amount: amount.toString(), label: v.label, out: out.toString() };
  return { venue: 3, target: v.target, fee: 0, key: null, amount: amount.toString(), label: v.label, out: out.toString() };
}

export const routeSwap = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; side: "buy" | "sell"; amount: string }) => input)
  .handler(async ({ data }): Promise<RouteResult> => {
    const token = data.token.toLowerCase();
    const amount = BigInt(data.amount);
    if (!/^0x[0-9a-f]{40}$/.test(token) || amount <= 0n) return { legs: [], out: "0", single: [], split: false, error: "bad input" };
    const venues = await discoverVenues(token);
    if (venues.length === 0) return { legs: [], out: "0", single: [], split: false, error: "no venue" };
    const quotes = await Promise.all(venues.map((v) => quoteVenue(v, token, data.side, amount)));
    const ranked = venues
      .map((v, i) => ({ v, out: quotes[i] }))
      .filter((x): x is { v: Venue; out: bigint } => x.out !== null && x.out > 0n)
      .sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0));
    if (ranked.length === 0) return { legs: [], out: "0", single: [], split: false, error: "no liquidity" };
    const single = ranked.map((x) => ({ label: x.v.label, out: x.out.toString() }));
    let best: { legs: Leg[]; out: bigint; split: boolean } = { legs: [toLeg(ranked[0].v, amount, ranked[0].out)], out: ranked[0].out, split: false };
    // 2-venue split: only worth it when the runner-up is within 40% of the best (else the split cannot win)
    if (ranked.length >= 2 && ranked[1].out * 10n >= ranked[0].out * 6n) {
      const [a, b] = [ranked[0].v, ranked[1].v];
      for (const pctA of [75n, 50n, 25n]) {
        const amtA = (amount * pctA) / 100n;
        const amtB = amount - amtA;
        const [qa, qb] = await Promise.all([quoteVenue(a, token, data.side, amtA), quoteVenue(b, token, data.side, amtB)]);
        if (qa && qb && qa + qb > best.out) best = { legs: [toLeg(a, amtA, qa), toLeg(b, amtB, qb)], out: qa + qb, split: true };
      }
    }
    return { legs: best.legs, out: best.out.toString(), single, split: best.split };
  });
