/**
 * Server-side Arc chain access for the ArcTools site: new-pairs feed, token
 * scanner, portfolio and price watch. Read-only JSON-RPC against the public
 * Arc mainnet node, plus the venues' public metadata APIs.
 */
import { createServerFn } from "@tanstack/react-start";

import { bindings } from "@/lib/bindings.server";
import { keepAlive, memoKV } from "@/lib/memo-kv";

// Primary: our Railway relay (arc-scan via Railway egress: no CF 429, no quota).
// Fallbacks: Infura shared key (daily quota), then arc-scan direct.
const RPCS = [
  "https://rpc-production-ba7a.up.railway.app",
  "https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8",
  "https://rpc.arc-scan.org",
];
const RPC = RPCS[0];
const USDC = "0x3600000000000000000000000000000000000000";
const UNIV3_FACTORY = "0xf0db7b58379503491d857dB50AC9ece64c653918";
const QUOTER_V2 = "0x7dfd4f31be6814d2906bde155c3e1b146eac1468";

const SEL = {
  balanceOf: "0x70a08231",
  decimals: "0x313ce567",
  getPool: "0x1698ee82",
  liquidity: "0x1a686502",
  name: "0x06fdde03",
  owner: "0x8da5cb5b",
  quote: "0xc6a5026a",
  symbol: "0x95d89b41",
  totalSupply: "0x18160ddd",
} as const;

const PADS = [
  {
    factory: "0x4B638c1502a07A8E1a26112Ee98f51A3f34bC93a",
    name: "RadarDex",
    topic: "0x851d681a32f0efba577c4a1bd412f74b575764a6b91e499a05a48a23f3821d66",
  },
  {
    factory: "0x2d933Ce4bDe6F3d99540b5D7886b383E59b2b2F8",
    name: "RadarDex",
    topic: "0x851d681a32f0efba577c4a1bd412f74b575764a6b91e499a05a48a23f3821d66",
  },
  {
    factory: "0x24196CD6e534cfCE8F480B53E70809b68Ea86F29",
    name: "ArcPad",
    topic: "0x875522b092d9e19a1de359e4bd218090d582fa521c9733889acf1a5ff1941255",
  },
  {
    factory: "0x0dCad158e98bC24455f9e94F46709d8a5F6D1255",
    name: "Warp",
    topic: "0x0b4cfda446fdf9ec5a85855f088c154869eb62e3e723d7d80319b680f90e0cfd",
  },
  {
    factory: UNIV3_FACTORY,
    name: "UniswapV3",
    topic: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
  },
] as const;

const pad32 = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const padNum = (n: bigint) => n.toString(16).padStart(64, "0");
const topicAddr = (t: string) => "0x" + t.slice(-40);
export { pad32, padNum, topicAddr };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc(method: string, params: any[]): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = RPCS[attempt % RPCS.length];
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)",
        },
        method: "POST",
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) {
        const msg = json.error.message ?? "rpc error";
        // execution errors (revert, out of gas, invalid params) are deterministic: retrying only burns seconds
        if (!/quota|rate|limit|too many|timeout|502|503|unavailable|busy/i.test(msg)) throw Object.assign(new Error(msg), { permanent: true });
        throw new Error(msg);
      }
      return json.result;
    } catch (e) {
      if ((e as { permanent?: boolean }).permanent) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("rpc failed");
}

// ---------------- tiny per-isolate TTL memo with inflight dedupe ----------------

const memoStore = new Map<string, { ts: number; v: unknown }>();
const memoInflight = new Map<string, Promise<unknown>>();
const KV_MAX_STALE_MS = 6 * 60 * 60 * 1000;
const MEMO_HARD_TIMEOUT_MS = 25_000;   // serve a KV value up to 6 h old while a refresh runs

function kv() { return memoKV(); }

/** Cache fn() result for ttlMs.
 *  Tier 1: isolate memory. Tier 2: Cloudflare KV, shared by EVERY isolate and colo — a cold Worker
 *  answers from KV in a few ms instead of recomputing 9 upstreams. Stale-while-revalidate on both
 *  tiers: once the TTL expires exactly ONE caller recomputes, everyone else gets the previous value
 *  instantly, so tail latency never depends on upstream speed. /api/warm keeps KV fresh in background. */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>, cacheIf?: (v: T) => boolean): Promise<T> {
  const now = Date.now();
  const hit = memoStore.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.v as T;
  const inflight = memoInflight.get(key);
  if (inflight && hit) return hit.v as T;
  const store = kv();
  // tier 2: shared KV (also consulted before joining a slow in-flight compute)
  if (!hit && store) {
    try {
      const raw = await store.get(`memo:${key}`, "text");
      if (raw) {
        const rec = JSON.parse(raw) as { ts: number; v: T };
        memoStore.set(key, rec);
        if (now - rec.ts < ttlMs) return rec.v;
        // stale: refresh in background (unless one is already running), answer now
        if (!memoInflight.get(key)) keepAlive(refresh());
        return rec.v;
      }
    } catch { /* KV unavailable: fall through */ }
  }
  if (inflight) return inflight as Promise<T>;
  if (hit) { keepAlive(refresh()); return hit.v as T; }
  return refresh();

  async function refresh(): Promise<T> {
    const p = (async () => {
      try {
        // hard ceiling: a hung upstream must never pin the in-flight slot (and every joiner) forever
        const v = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`memo timeout: ${key}`)), MEMO_HARD_TIMEOUT_MS))]);
        // transient failures (RPC down, upstream 5xx) must never be remembered — the next visitor recomputes
        if (cacheIf && !cacheIf(v)) return v;
        const rec = { ts: Date.now(), v };
        memoStore.set(key, rec);
        if (store) {
          try { await store.put(`memo:${key}`, JSON.stringify(rec), { expirationTtl: Math.max(60, Math.ceil(KV_MAX_STALE_MS / 1000)) }); } catch { /* ignore */ }
        }
        return v;
      } finally {
        memoInflight.delete(key);
      }
    })();
    memoInflight.set(key, p);
    return p;
  }
}

// ---------------- Multicall3: hundreds of eth_calls in ONE request ----------------

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

function encodeAggregate3(calls: { target: string; data: string }[]): string {
  const n = calls.length;
  const elems: string[] = [];
  for (const c of calls) {
    const cd = c.data.replace(/^0x/, "");
    const cdPadded = cd.padEnd(Math.ceil(cd.length / 64) * 64, "0");
    elems.push(
      pad32(c.target) +
        padNum(1n) + // allowFailure = true
        padNum(96n) + // offset to bytes within the tuple (3 head words)
        padNum(BigInt(cd.length / 2)) +
        cdPadded,
    );
  }
  // element offsets are CUMULATIVE (elements differ in size with longer calldata)
  let offsets = "";
  let cum = 32 * n;
  for (const e of elems) {
    offsets += padNum(BigInt(cum));
    cum += e.length / 2;
  }
  return "0x82ad56cb" + padNum(32n) + padNum(BigInt(n)) + offsets + elems.join("");
}

function decodeAggregate3(hex: string, n: number): (string | null)[] {
  const out: (string | null)[] = new Array(n).fill(null);
  try {
    const body = hex.replace(/^0x/, "");
    const word = (pos: number) => parseInt(body.slice(pos * 64, pos * 64 + 64), 16);
    // word0 = offset to array (32), word1 = length
    const base = 2; // array elements' offsets start at word index 2
    for (let i = 0; i < n; i++) {
      const elOff = word(base + i) / 32 + base; // element start (in words)
      const success = word(elOff) === 1;
      if (!success) continue;
      const bytesOff = word(elOff + 1) / 32 + elOff;
      const len = word(bytesOff);
      out[i] = "0x" + body.slice((bytesOff + 1) * 64, (bytesOff + 1) * 64 + len * 2);
    }
  } catch {
    /* return what we have */
  }
  return out;
}

/** Runs many eth_calls through Multicall3 (chunked; chunks run 4 at a time). */
export async function multicall(
  calls: { target: string; data: string }[],
  chunk = 180,
): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(calls.length).fill(null);
  const starts: number[] = [];
  for (let i = 0; i < calls.length; i += chunk) starts.push(i);
  const CONC = 3; // relay/arc-scan handle parallel chunks fine; stay polite
  for (let s = 0; s < starts.length; s += CONC) {
    await Promise.all(
      starts.slice(s, s + CONC).map(async (i) => {
        const part = calls.slice(i, i + chunk);
        try {
          const res = (await rpc("eth_call", [{ data: encodeAggregate3(part), to: MULTICALL3 }, "latest"])) as string;
          decodeAggregate3(res, part.length).forEach((r, j) => (out[i + j] = r));
        } catch {
          /* leave nulls for this chunk */
        }
      }),
    );
  }
  return out;
}

export function decodeString(hex: string | null): string {
  if (!hex || hex === "0x" || hex.length < 130) return "?";
  try {
    const body = hex.slice(2);
    const len = parseInt(body.slice(64, 128), 16);
    const raw = body.slice(128, 128 + len * 2);
    const bytes = raw.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes)) || "?";
  } catch {
    return "?";
  }
}

export const toNum = (hex: string | null): bigint => {
  if (!hex || hex === "0x") return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
};

function quoteCalldata(token: string, amount: bigint): string {
  return SEL.quote + pad32(token) + pad32(USDC) + padNum(amount) + padNum(10000n) + padNum(0n);
}

/** Value `amount` of `token` in USDC: Uniswap V3 quoter -> ArcToolsPad curve (v2/v3, quote converted) -> RadarDex price. */
async function quoteToUsdc(token: string, amount: bigint): Promise<number | null> {
  if (amount <= 0n) return null;
  try {
    const res = (await rpc("eth_call", [{ data: quoteCalldata(token, amount), to: QUOTER_V2 }, "latest"])) as string;
    const v = Number(BigInt("0x" + res.slice(2, 66))) / 1e6;
    if (v > 0) return v;
  } catch {
    /* no canonical V3 pool — try the launchpads */
  }
  // ArcToolsPad curve: quoteSell(token, amount) in quote units (1e18); v3 quotes may be non-USDC
  for (const pad of ["0x2726AeC64D8a9BC41B9940dDA5D21c889458B348", "0x1EaAD48260eECC7624666F1dFec202b2D75257fE"]) {
    try {
      const r = (await rpc("eth_call", [{ data: "0xd98b2f5c" + pad32(token) + padNum(amount), to: pad }, "latest"])) as string;
      const outQ = r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : 0;
      if (outQ > 0) {
        if (pad.toLowerCase() === "0x2726aec64d8a9bc41b9940dda5d21c889458b348") {
          const l = (await rpc("eth_call", [{ data: "0x214013ca" + pad32(token), to: pad }, "latest"])) as string;
          const q = l && l.length >= 66 ? topicAddr("0x" + l.slice(2, 66)) : null;
          if (q && !/^0x0{40}$/.test(q) && q.toLowerCase() !== USDC) {
            const qres = (await rpc("eth_call", [{ data: quoteCalldata(q, 10n ** 18n), to: QUOTER_V2 }, "latest"]).catch(() => null)) as string | null;
            const qUsd = qres ? Number(BigInt("0x" + qres.slice(2, 66))) / 1e6 : 0;
            return qUsd > 0 ? outQ * qUsd : null;
          }
        }
        return outQ;
      }
    } catch {
      /* not this pad */
    }
  }
  // Uniswap V4 / other pads: screener spot price (USD per token) — valued linearly
  try {
    const list = (await memo("radar:tokens", 60_000, async () =>
      (await fetch("https://api.radardex.pro/tokens", { headers: { Accept: "application/json" } })).json(),
    )) as { tokens?: { address?: string; price?: number; decimals?: number }[] };
    const t = (list.tokens ?? []).find((x) => String(x.address ?? "").toLowerCase() === token.toLowerCase());
    if (t && typeof t.price === "number" && t.price > 0) {
      const dec = BigInt(t.decimals ?? 18);
      return (Number(amount / 10n ** (dec > 6n ? dec - 6n : 0n)) / (dec > 6n ? 1e6 : Number(10n ** dec))) * t.price;
    }
  } catch {
    /* screener down */
  }
  return null;
}

// ---------------- new pairs feed ----------------

export type FeedItem = {
  block: number;
  createdAt: string; // estimated from block distance (Arc ~0.63s blocks)
  pad: string;
  symbol: string;
  token: string;
};

export const getNewPairs = createServerFn({ method: "POST" }).handler(
  (): Promise<FeedItem[]> => memo("newpairs", 10_000, newPairsImpl),
);

async function newPairsImpl(): Promise<FeedItem[]> {
  const head = Number(toNum((await rpc("eth_blockNumber", [])) as string));
  const from = "0x" + Math.max(0, head - 9500).toString(16);
  const to = "0x" + head.toString(16);

  const logsPerPad = await Promise.all(
    PADS.map(async (p) => {
      try {
        const logs = (await rpc("eth_getLogs", [
          { address: p.factory, fromBlock: from, toBlock: to, topics: [p.topic] },
        ])) as { blockNumber: string; topics: string[] }[];
        return logs.map((l) => ({
          block: Number(toNum(l.blockNumber)),
          pad: p.name,
          token:
            p.name === "UniswapV3"
              ? topicAddr(l.topics[1]).toLowerCase() === USDC.toLowerCase()
                ? topicAddr(l.topics[2])
                : topicAddr(l.topics[1])
              : topicAddr(l.topics[1]),
          usdcPaired:
            p.name !== "UniswapV3" ||
            topicAddr(l.topics[1]).toLowerCase() === USDC.toLowerCase() ||
            topicAddr(l.topics[2]).toLowerCase() === USDC.toLowerCase(),
        }));
      } catch {
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  const items = logsPerPad
    .flat()
    .filter((l) => l.usdcPaired)
    .sort((a, b) => b.block - a.block)
    .filter((l) => {
      const k = l.token.toLowerCase();
      // dedicated pads report first (they are earlier in PADS and higher-signal)
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 25);

  const symbols = await multicall(items.map((it) => ({ data: SEL.symbol, target: it.token })));
  return items.map((it, i) => ({
    block: it.block,
    createdAt: new Date(Date.now() - (head - it.block) * 630).toISOString(),
    pad: it.pad,
    symbol: decodeString(symbols[i] as string | null),
    token: it.token,
  }));
}

// ---------------- token scanner ----------------

export type ScanReport = {
  clones: number;
  decimals: number;
  liquidityUsdc: number | null;
  mintable: boolean;
  name: string;
  owner: string | null;
  pausable: boolean;
  pool: string | null;
  price1m: number | null;
  radarBadge: boolean;
  poolVersion: string | null;
  launchpad: string | null;
  renounced: boolean;
  symbol: string;
  totalSupply: string;
};

// ---------------- unified token page (/token/$ca) ----------------

export const SWAP_FEE_ROUTER = "0xA4E79c06eeC23c4caAa63aA37aCC6Fb7f0370a12";
/** Our ownerless Uniswap V4 router (native + facade USDC, fee bps on the USDC side -> treasury). */
export const ARC_V4_ROUTER = "0x05a0158EF87E8E7bFE4E0242e11dda75f83954e1";
export type V4Key = { id: string; currency0: string; currency1: string; fee: number; tick_spacing: number; hooks: string; usdc_dec: number; venueName: string };
const V4_HOOK_NAMES: Record<string, string> = {
  "0xa368005ad249fbebcd5baa7396c9e3b3e44e6044": "Arguspad",
  "0x465af15c85ac291d5cffb8d02d8c8e23102fe6e3": "act.fun",
  "0x20eead6db6b3d0a4491e9073119dd0ebff166acc": "UBI.fun",
};
const ARCPAD_LAUNCHPAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE";
const ARCPAD_V3 = "0x2726AeC64D8a9BC41B9940dDA5D21c889458B348";
const SEL_CURVE = "0x06d8d7db";
const SEL_LAUNCH = "0x214013ca";

export type TokenPageInfo = {
  token: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number;
  /** pad = ArcToolsPad bonding curve · v3 = canonical Uniswap V3 (fee router) · external = other pad's own factory */
  venue: "pad" | "v3" | "v4" | "curve" | "external";
  v4Key: V4Key | null;
  curveAddress: string | null;
  pool: string | null;
  poolFee: number | null;
  liquidityUsdc: number | null;
  price1m: number | null;
  mcapUsd: number | null;
  logo: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  launchpad: string | null;
  venueUrl: string | null;
  holders: number | null;
  createdAt: string | null;
  deployer: string | null;
  /** launchpad contract for venue=pad (v2 or v3) */
  padAddress: string | null;
  /** v3 quote token (null = native USDC) + its symbol and USD price */
  quoteToken: string | null;
  quoteSymbol: string;
  quoteUsd: number;
  graduated: boolean;
  padMode: "v2" | "curve" | "instant" | null;
  targetQuote: number | null;
  /** long.supply: wrapped stock (custodial IOU) or a token whose main market is a V3 pool quoted in one */
  stock?: { symbol: string; usd: number; vault: string; underlying: string } | null;
  longPool?: { pool: string; pairToken: string; pairSymbol: string; pairUsd: number; liquidityUsd: number | null; priceUsd: number } | null;
};

export const tokenPage = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(({ data }) =>
    memo(`tokenpage:${data.token.toLowerCase()}`, 45_000, async (): Promise<TokenPageInfo | { error: string }> => {
      const token = data.token.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return { error: "That is not a contract address." };
      const lc = token.toLowerCase();

      // 1) basic ERC20 + venue detection, one multicall
      const tiers = [10000, 3000, 500, 100];
      const calls = [
        { data: SEL.name, target: token },
        { data: SEL.symbol, target: token },
        { data: SEL.decimals, target: token },
        { data: SEL.totalSupply, target: token },
        { data: SEL_CURVE + pad32(token), target: ARCPAD_LAUNCHPAD },
        ...tiers.map((f) => ({ data: SEL.getPool + pad32(token) + pad32(USDC) + padNum(BigInt(f)), target: UNIV3_FACTORY })),
        { data: SEL_CURVE + pad32(token), target: ARCPAD_V3 },
        { data: SEL_LAUNCH + pad32(token), target: ARCPAD_V3 },
      ];
      const res = await multicall(calls, 20);
      const name = decodeString(res[0]);
      const symbol = decodeString(res[1]);
      if ((!name || name === "?") && (!symbol || symbol === "?")) {
        const code = (await rpc("eth_getCode", [token, "latest"]).catch(() => null)) as string | null;
        if (code === null) throw new Error("RPC unavailable — retry");          // transient: not cached, client retries
        if (code === "0x" || code === "0x0") return { error: "No token contract at this address on Arc." };
        return { error: "Contract does not expose an ERC-20 name/symbol." };
      }
      const decimals = Number(toNum(res[2])) || 18;
      const supply = Number(toNum(res[3]) / BigInt(10) ** BigInt(Math.max(0, decimals - 6))) / 1e6;

      let venue: TokenPageInfo["venue"] = "external";
      let pool: string | null = null;
      let poolFee: number | null = null;
      let padAddress: string | null = null;
      let quoteToken: string | null = null;
      let quoteSymbol = "USDC";
      let quoteUsd = 1;
      let graduated = false;
      let padMode: TokenPageInfo["padMode"] = null;
      let targetQuote: number | null = null;
      let curve = res[4];
      const curve3 = res[5 + tiers.length];
      const launch3 = res[6 + tiers.length];
      const w = (hex: string | null, j: number) => (hex && hex.length >= 2 + 64 * (j + 1) ? toNum("0x" + hex.slice(2 + j * 64, 2 + (j + 1) * 64)) : 0n);
      const isV3 = !!launch3 && launch3.length >= 2 + 64 * 8 && (w(launch3, 3) > 0n || w(curve3, 1) > 0n);
      if (isV3) {
        padAddress = ARCPAD_V3;
        curve = curve3;
        const q = topicAddr("0x" + launch3!.slice(2, 66));
        quoteToken = !q || /^0x0{40}$/.test(q) || q.toLowerCase() === USDC ? null : q.toLowerCase();
        graduated = w(launch3, 5) === 1n;
        padMode = w(launch3, 2) === 1n ? "instant" : "curve";
        targetQuote = Number(w(launch3, 3) / 10n ** 12n) / 1e6;
        if (quoteToken) {
          const [qs, qp] = await Promise.all([
            rpc("eth_call", [{ data: SEL.symbol, to: quoteToken }, "latest"]).catch(() => null),
            quoteToUsdc(quoteToken, 10n ** 18n * 1_000_000n),
          ]);
          quoteSymbol = decodeString(qs as string | null) || "?";
          quoteUsd = qp && qp > 0 ? qp / 1e6 : 0;
        }
        if (graduated) {
          venue = "v3";
          pool = topicAddr("0x" + launch3!.slice(2 + 6 * 64, 2 + 7 * 64));
          poolFee = 10000;
        } else {
          venue = "pad";
          pool = ARCPAD_V3;
        }
      } else if (curve && curve.length >= 2 + 64 * 2 && toNum("0x" + curve.slice(2, 66)) > 0n) {
        venue = "pad";
        pool = ARCPAD_LAUNCHPAD;
        padAddress = ARCPAD_LAUNCHPAD;
        padMode = "v2";
      } else {
        for (let i = 0; i < tiers.length; i++) {
          const p = res[5 + i];
          if (p && toNum(p) !== 0n) {
            venue = "v3";
            pool = topicAddr(p);
            poolFee = tiers[i];
            break;
          }
        }
      }

      // 2) screener metadata (logo, socials, holders, launchpad, external pool)
      let meta: Record<string, unknown> = {};
      try {
        const list = (await memo("radar:tokens", 60_000, async () =>
          (await fetch("https://api.radardex.pro/tokens", { headers: { Accept: "application/json" } })).json(),
        )) as { tokens?: Record<string, unknown>[] };
        meta = (list.tokens ?? []).find((t) => String(t.address ?? "").toLowerCase() === lc) ?? {};
      } catch {
        /* screener down */
      }
      if (!meta.address) {
        // not in the top-200 screener list (older / quieter tokens like ARCT): per-token endpoint has the same fields
        try {
          const one = await memo(`radar:one:${lc}`, 60_000, async () => {
            const r = await fetch(`https://api.radardex.pro/token/${lc}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" }, signal: AbortSignal.timeout(6000) });
            return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
          }, (v) => !!v && typeof v === "object" && !!(v as Record<string, unknown>).address);
          if (one && one.address) meta = one;
        } catch { /* skip */ }
      }
      // Swieze tokeny Tolly nie sa jeszcze w RadarDex — rozpoznajemy je z listy Tolly
      // (launchpad, logo, sociale, mcap), inaczej strona nie wiedzialaby skad brac dane.
      if (!meta.launchpad) {
        try {
          const list = (await memo("tolly:tokens", 30_000, async () =>
            (await fetch("https://api.tollylabs.com/tokens", {
              headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" },
            })).json(),
          )) as { tokens?: Record<string, unknown>[] };
          const tl = (list.tokens ?? []).find((t) => String(t.address ?? "").toLowerCase() === lc);
          if (tl) {
            meta = {
              ...meta,
              deployTs: tl.created_ts,
              deployer: tl.creator,
              icon: tl.image_uri,
              launchpad: "tolly",
              liquidityUsdc: tl.liquidity,
              mcap: tl.marketCap,
              price: tl.price,
              telegram: tl.telegram,
              twitter: tl.twitter,
              website: tl.website,
            };
          }
        } catch {
          /* tolly down */
        }
      }
      if (venue === "external" && !pool) {
        try {
          const lr = (await memo("radar:launches", 30_000, async () =>
            (await fetch("https://api.radardex.pro/launches")).json(),
          )) as { launches?: { token?: string; pool?: string }[] };
          pool = (lr.launches ?? []).find((l) => (l.token ?? "").toLowerCase() === lc)?.pool ?? null;
        } catch {
          /* skip */
        }
      }
      // our own pad metadata (logo/socials from D1) when it's an ArcToolsPad token
      let padLogo: string | null = null;
      let padCreator: string | null = null;
      let padSocial: { website?: string; twitter?: string; telegram?: string } = {};
      if (padAddress) {
        try {
          const db = bindings().DB;
          const row = db
            ? ((await db
                .prepare("SELECT website, twitter, telegram, creator, CASE WHEN image != '' THEN 1 ELSE 0 END AS has_image FROM pad_meta WHERE token = ?")
                .bind(lc)
                .first()) as { website?: string; twitter?: string; telegram?: string; creator?: string; has_image?: number } | null)
            : null;
          if (row) {
            padSocial = row;
            padCreator = row.creator?.toLowerCase() ?? null;
            if (row.has_image) padLogo = `/api/pad-logo/${lc}`;
          }
        } catch {
          /* D1 unavailable */
        }
      }

      // 3) market numbers
      let liquidityUsdc: number | null = null;
      let price1m: number | null = null;
      if (venue === "pad" && curve) {
        // curve(token): quoteReserve(virtual+real), tokenReserve, volume, txCount — quote units 1e18
        const cw = (j: number) => toNum("0x" + curve!.slice(2 + j * 64, 2 + (j + 1) * 64));
        const qRes = cw(0);
        const tokRes = cw(1);
        const virtual = isV3 ? Number(w(launch3, 4) / 10n ** 12n) / 1e6 : 3000;
        if (tokRes > 0n) price1m = (Number((qRes * 1_000_000_000_000n) / tokRes) / 1e6) * quoteUsd;
        liquidityUsdc = Math.max(0, Number(qRes / 10n ** 12n) / 1e6 - virtual) * quoteUsd;
      } else if (pool) {
        const balHex = await rpc("eth_call", [{ data: SEL.balanceOf + pad32(pool), to: USDC }, "latest"]).catch(() => null);
        if (balHex) liquidityUsdc = Number(toNum(balHex as string)) / 1e6;
      }
      // Kanoniczna pula V3 istnieje, ale jest martwa (np. $0.5 z placeholdera) — realny handel
      // toczy sie na V4 / curve innego pada. Nie wolno tam kierowac swapow uzytkownika.
      if (venue === "v3" && !padAddress && (liquidityUsdc ?? 0) < 25) {
        venue = "external";
        poolFee = null;
        liquidityUsdc = null;
      }
      if (liquidityUsdc === null && typeof meta.liquidityUsdc === "number") liquidityUsdc = Number(meta.liquidityUsdc);
      // Uniswap V4 (act.fun, Arguspad, UBI.fun, ArcadeSwap...): PoolKey from the Arc Insider index -> tradeable via ArcV4Router
      let v4Key: V4Key | null = null;
      if (venue === "external") {
        try {
          const v4 = (await memo(`v4pool:${lc}`, 60_000, async () => {
            const r = await fetch(`https://bot-production-4200.up.railway.app/api/v4pool?token=${lc}`, { headers: { Accept: "application/json" } });
            return r.ok ? r.json() : null;
          })) as { pools?: { id: string; currency0: string; currency1: string; fee: number; tick_spacing: number; hooks: string; usdc_dec: number | null; swaps: number }[] } | null;
          const best = (v4?.pools ?? []).sort((a, b) => (b.swaps ?? 0) - (a.swaps ?? 0))[0];
          if (best) {
            v4Key = { ...best, usdc_dec: best.usdc_dec ?? 18, venueName: V4_HOOK_NAMES[(best.hooks ?? "").toLowerCase()] ?? "Uniswap V4" };
            venue = "v4";
            pool = best.id;
            poolFee = best.fee;
            const st = (await memo(`tokstats:${lc}`, 30_000, async () => {
              const r = await fetch(`https://bot-production-4200.up.railway.app/api/token-stats?token=${lc}`);
              return r.ok ? r.json() : null;
            })) as { price1m?: number | null } | null;
            if (st?.price1m && st.price1m > 0) price1m = st.price1m;
          }
        } catch {
          /* index down */
        }
      }
      // Warp-style bonding curve: token.curve() -> curve contract (buy/sell/quote there until graduated)
      let curveAddress: string | null = null;
      if (venue === "external") {
        try {
          const wc = (await rpc("eth_call", [{ data: "0x7165485d", to: token }, "latest"]).catch(() => null)) as string | null;
          if (wc && wc.length >= 66 && !/^0x0+$/.test(wc)) {
            const c = "0x" + wc.slice(26, 66);
            const [code, grad, q] = await Promise.all([
              rpc("eth_getCode", [c, "latest"]).catch(() => "0x"),
              rpc("eth_call", [{ data: "0xe7c2b772", to: c }, "latest"]).catch(() => null),
              rpc("eth_call", [{ data: "0xa64190c4" + padNum(10n ** 24n), to: c }, "latest"]).catch(() => null),
            ]);
            if (typeof code === "string" && code.length > 2 && !(grad && BigInt(grad as string) !== 0n)) {
              curveAddress = c;
              venue = "curve";
              pool = c;
              if (q && (q as string) !== "0x") price1m = Number(BigInt(q as string)) / 1e18;
            }
          }
        } catch {
          /* not a warp token */
        }
      }
      if (venue === "v3") price1m = await quoteToUsdc(token, BigInt(10) ** BigInt(decimals) * 1_000_000n);
      if (price1m !== null && !(price1m > 0)) price1m = null;
      if (price1m === null && typeof meta.price === "number") price1m = Number(meta.price) * 1e6;
      let mcapUsd = price1m !== null && supply > 0 ? (price1m / 1e6) * supply : (typeof meta.mcap === "number" ? Number(meta.mcap) : null);

      let lp = (meta.launchpad as string | undefined) ?? null;
      // long.supply: wrapped stocks + tokens whose real market is a V3 pool quoted in a wrapped stock (their public API)
      let stockInfo: TokenPageInfo["stock"] = null;
      let longPool: TokenPageInfo["longPool"] = null;
      let longUrl: string | null = null;
      try {
        const LS = await import("@/lib/longsupply");
        const [stocks, launches] = await Promise.all([LS.longStocks().catch(() => []), LS.longLaunches().catch(() => [])]);
        const st = stocks.find((x) => x.token === lc);
        if (st) {
          stockInfo = { symbol: st.symbol, usd: st.usd, vault: st.vault, underlying: st.underlying };
          price1m = st.usd * 1e6; mcapUsd = st.usd * supply; lp = "long.supply"; longUrl = "https://long.supply/bridge";
        }
        const ln = launches.find((x) => x.token === lc);
        if (ln && ln.pool) {
          let liq: number | null = null;
          try {
            const bal = await rpc("eth_call", [{ data: SEL.balanceOf + ln.pool.slice(2).padStart(64, "0"), to: ln.pairToken }, "latest"]) as string;
            if (bal && bal !== "0x") liq = (Number(BigInt(bal)) / 1e18) * ln.pairUsd * 2;
          } catch { /* keep null */ }
          longPool = { pool: ln.pool, pairToken: ln.pairToken, pairSymbol: ln.pairSymbol, pairUsd: ln.pairUsd, liquidityUsd: liq, priceUsd: ln.priceUsd };
          longUrl = `https://long.supply/${lc}`;
          // our own USDC venue is thinner than the stock-quoted pool (or missing) → price the page from the real market
          if (venue === "external" || (liq ?? 0) > (liquidityUsdc ?? 0) * 2) {
            if (ln.priceUsd > 0) { price1m = ln.priceUsd * 1e6; mcapUsd = ln.priceUsd * supply; }
            if (liq != null && venue === "external") liquidityUsdc = liq;
            lp = "long.supply";
          }
        }
      } catch { /* long.supply API down: page still works from our own data */ }
      const venueUrl =
        longUrl && (lp === "long.supply") ? longUrl
          : venue === "pad" || padAddress ? `/pad/${lc}`
          : lp === "tolly" ? `https://tollylabs.com/token/${lc}`
          : lp === "warp" ? `https://circlewarp.fun/token/${lc}`
          : lp === "arcpad" || lp === "arcfun" ? `https://arcpad.meme/token/${lc}`
          : `https://radardex.pro/#${lc}`;

      return {
        createdAt: typeof meta.deployTs === "number" ? new Date(Number(meta.deployTs) * 1000).toISOString() : null,
        decimals,
        deployer: typeof meta.deployer === "string" && /^0x[0-9a-fA-F]{40}$/.test(meta.deployer) ? meta.deployer.toLowerCase() : (padCreator ?? null),
        graduated,
        padAddress,
        padMode,
        quoteSymbol,
        quoteToken,
        quoteUsd,
        targetQuote,
        holders: typeof meta.holderCount === "number" ? Number(meta.holderCount) : null,
        launchpad: padAddress ? "ArcToolsPad" : lp === "long.supply" ? "long.supply" : (v4Key ? v4Key.venueName : curveAddress ? "Warp" : lp),
        stock: stockInfo,
        longPool,
        liquidityUsdc,
        logo: padLogo || ipfsToHttp(String(meta.icon ?? "")) || (await screenerIcons().then((m) => ipfsToHttp(m.get(lc) ?? "")).catch(() => "")) || xAvatar(padSocial.twitter || (meta.twitter as string) || null),
        mcapUsd,
        name,
        pool,
        poolFee,
        price1m,
        supply,
        symbol,
        telegram: normSocial("tg", padSocial.telegram || (meta.telegram as string) || null),
        token: lc,
        twitter: normSocial("x", padSocial.twitter || (meta.twitter as string) || null),
        curveAddress,
        v4Key,
        venue,
        venueUrl,
        website: normSocial("web", padSocial.website || (meta.website as string) || null),
      };
    // cache only complete results: a page computed while RadarDex / the RPC were rate-limiting comes back
    // without price, mcap or logo — serve it once, but let the next visitor recompute instead of freezing junk
    }, (v) => ("error" in v ? v.error === "That is not a contract address." : (v.mcapUsd != null || v.price1m != null) && (v.venue !== "external" || v.launchpad === "long.supply"))),
  );

/**
 * Venue-side market data used as a FALLBACK when our own swap index has not
 * caught up with a token yet (fresh launches, pools still in the repair queue).
 * RadarDex indexes every venue on Arc incl. Uniswap V4 and exposes per-token
 * stats + last 50 swaps; Tolly exposes real OHLC for its own tokens.
 */
export type VenueSwap = { ts: number; side: "buy" | "sell"; usdc: number; price1m: number; wallet: string; tx: string; venue: string };
export type VenueData = {
  stats: {
    price1m: number | null; mcap: number | null; liquidityUsdc: number | null; vol24: number;
    buys24: number; sells24: number; traders24: number; txns24: number; holders: number | null;
    change: { "5m": number | null; "1h": number | null; "6h": number | null; "24h": number | null };
  } | null;
  swaps: VenueSwap[];
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[]; // price1m units
};

export const venueData = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; launchpad?: string | null }) => input)
  .handler(({ data }) =>
    memo(`venue:${data.token.toLowerCase()}:${data.launchpad ?? ""}`, 15_000, async (): Promise<VenueData> => {
      const lc = data.token.toLowerCase();
      const H = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" };
      const [tok, sw, tc] = await Promise.all([
        fetch(`https://api.radardex.pro/token/${lc}`, { headers: H }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<Record<string, unknown> | null>,
        fetch(`https://api.radardex.pro/swaps?token=${lc}`, { headers: H }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ swaps?: Record<string, unknown>[] } | null>,
        data.launchpad === "tolly"
          ? (fetch(`https://api.tollylabs.com/candles?token=${lc}`, { headers: H }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ candles?: Record<string, number>[] } | null>)
          : Promise.resolve(null),
      ]);
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const tokOk = tok && String(tok.address ?? "").toLowerCase() === lc;
      // Tolly: swieze tokeny nie sa jeszcze w RadarDex, ale lista Tolly ma pelne statystyki
      let tl: Record<string, unknown> | null = null;
      if (!tokOk && data.launchpad === "tolly") {
        try {
          const list = (await memo("tolly:tokens", 30_000, async () =>
            (await fetch("https://api.tollylabs.com/tokens", { headers: H })).json(),
          )) as { tokens?: Record<string, unknown>[] };
          tl = (list.tokens ?? []).find((t) => String(t.address ?? "").toLowerCase() === lc) ?? null;
        } catch { /* skip */ }
      }
      const tlStats = tl
        ? {
            buys24: num(tl.buyTransactions6h) ?? 0,
            change: { "5m": null, "1h": num(tl.change1h), "6h": num(tl.change6h), "24h": num(tl.change24h) },
            holders: null,
            liquidityUsdc: num(tl.liquidity),
            mcap: num(tl.marketCap),
            price1m: num(tl.price) !== null ? Number(tl.price) * 1e6 : null,
            sells24: Math.max(0, (num(tl.txns24h) ?? 0) - (num(tl.buyTransactions6h) ?? 0)),
            traders24: num(tl.traders24h) ?? 0,
            txns24: num(tl.txns24h) ?? 0,
            vol24: num(tl.volume24h) ?? 0,
          }
        : null;
      const stats = tokOk && tok
        ? {
            buys24: num(tok.buys24) ?? 0,
            change: { "5m": num(tok.change5m), "1h": num(tok.change1h), "6h": num(tok.change6h), "24h": num(tok.change24h) },
            holders: num(tok.holderCount),
            liquidityUsdc: num(tok.liquidityUsdc),
            mcap: num(tok.mcap),
            price1m: num(tok.price) !== null ? Number(tok.price) * 1e6 : null,
            sells24: num(tok.sells24) ?? 0,
            traders24: num(tok.traders24) ?? 0,
            txns24: num(tok.txns24) ?? 0,
            vol24: num(tok.volume24) ?? 0,
          }
        : tlStats;
      // RadarDex /swaps?token= dla NIEZNANEGO tokena zwraca globalny strumien swapow (bez filtra) —
      // bez tej linii strona swiezego tokena pokazywalaby trade'y i wykres zupelnie innego tokena.
      const rawSwaps = (sw?.swaps ?? []).filter((s) =>
        String(s.token ?? "").toLowerCase() === lc &&
        typeof s.price === "number" && typeof s.usdc === "number" && Number(s.usdc) >= 0.25);
      // RadarDex miesza swapy ze wszystkich puli tokena, w tym martwych placeholderow z absurdalna cena.
      // Bierzemy dominujaca wersje puli i odrzucamy ceny poza [mediana/20, mediana*20].
      const byVer = new Map<string, number>();
      for (const s of rawSwaps) byVer.set(String(s.version ?? ""), (byVer.get(String(s.version ?? "")) ?? 0) + 1);
      const topVer = [...byVer.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const verSwaps = topVer !== undefined ? rawSwaps.filter((s) => String(s.version ?? "") === topVer) : rawSwaps;
      const prices = verSwaps.map((s) => Number(s.price)).filter((p) => p > 0).sort((a, b) => a - b);
      const med = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
      const clean = med > 0 ? verSwaps.filter((s) => Number(s.price) >= med / 6 && Number(s.price) <= med * 6) : verSwaps;
      const swaps: VenueSwap[] = clean
        .map((s) => ({
          price1m: Number(s.price) * 1e6,
          side: (s.side === "sell" ? "sell" : "buy") as "buy" | "sell",
          ts: Number(s.time ?? 0),
          tx: String(s.txHash ?? ""),
          usdc: Number(s.usdc),
          venue: String(s.version ?? "radar"),
          wallet: String(s.trader ?? ""),
        }))
        .sort((a, b) => b.ts - a.ts);
      const candles = (tc?.candles ?? [])
        .filter((c) => typeof c.open === "number")
        .map((c) => ({ c: c.close * 1e6, h: c.high * 1e6, l: c.low * 1e6, o: c.open * 1e6, t: Number(c.bucket), v: Number(c.volume ?? 0) }))
        .sort((a, b) => a.t - b.t);
      return { candles, stats, swaps };
    }),
  );

export const scanToken = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<ScanReport | { error: string }> => {
    const token = data.token.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return { error: "That is not a contract address." };

    // sequential reads: the shared Infura key throttles parallel bursts
    const symbolHex = await rpc("eth_call", [{ data: SEL.symbol, to: token }, "latest"]).catch(() => null);
    const nameHex = await rpc("eth_call", [{ data: SEL.name, to: token }, "latest"]).catch(() => null);
    const decHex = await rpc("eth_call", [{ data: SEL.decimals, to: token }, "latest"]).catch(() => null);
    const supplyHex = await rpc("eth_call", [{ data: SEL.totalSupply, to: token }, "latest"]).catch(() => null);
    const code = await rpc("eth_getCode", [token, "latest"]).catch(() => "0x");
    const ownerRes = await rpc("eth_call", [{ data: SEL.owner, to: token }, "latest"]).catch(() => null);
    const poolHex = await rpc("eth_call", [
      { data: SEL.getPool + pad32(token) + pad32(USDC) + padNum(10000n), to: UNIV3_FACTORY },
      "latest",
    ]).catch(() => null);

    if (!code || code === "0x") return { error: "No contract at this address on Arc." };

    const decimals = Number(toNum(decHex as string | null)) || 18;
    const symbol = decodeString(symbolHex as string | null);
    const bytecode = (code as string).toLowerCase();
    const owner = ownerRes && ownerRes !== "0x" ? topicAddr(ownerRes as string) : null;
    const renounced = owner === null || owner === "0x0000000000000000000000000000000000000000";

    const pool = poolHex && toNum(poolHex as string) !== 0n ? topicAddr(poolHex as string) : null;
    // fallback: pady (RadarDex itd.) tworza poole wlasnymi fabrykami,
    // wiec kanoniczny getPool ich nie zna — bierzemy pool z API launchy
    let padPool: string | null = null;
    if (!pool) {
      try {
        const lr = (await memo("radar:launches", 30_000, async () =>
          (await fetch("https://api.radardex.pro/launches")).json(),
        )) as { launches?: { token?: string; pool?: string }[] };
        padPool =
          (lr.launches ?? []).find((l) => (l.token ?? "").toLowerCase() === token.toLowerCase())?.pool ?? null;
      } catch {
        /* API down: skip */
      }
    }
    let effPool = pool ?? padPool;
    let liquidityUsdc: number | null = null;
    let poolVersion: string | null = effPool ? (pool ? "v3" : "launchpad") : null;
    let launchpadName: string | null = null;
    let radarPrice1m: number | null = null;
    if (effPool) {
      const balHex = await rpc("eth_call", [{ data: SEL.balanceOf + pad32(effPool), to: USDC }, "latest"]).catch(
        () => null,
      );
      if (balHex) liquidityUsdc = Number(toNum(balHex as string)) / 1e6;
    }
    // Uniswap V4 / other pads: canonical factory knows nothing — RadarDex indexes every venue incl. V4
    if (!effPool || (liquidityUsdc ?? 0) < 25) {
      try {
        const rt = (await memo(`radar:token:${token.toLowerCase()}`, 60_000, async () => {
          const r = await fetch(`https://api.radardex.pro/token/${token.toLowerCase()}`, { headers: { Accept: "application/json" } });
          return r.ok ? r.json() : null;
        })) as { pools?: { pool: string; version: string; liquidityUsdc?: number; swaps?: number }[]; liquidityUsdc?: number; price?: number; launchpad?: string } | null;
        if (rt) {
          const best = (rt.pools ?? []).sort((a, b) => (b.liquidityUsdc ?? 0) - (a.liquidityUsdc ?? 0))[0];
          if (best && (best.liquidityUsdc ?? 0) > (liquidityUsdc ?? 0)) {
            effPool = best.pool;
            poolVersion = best.version ?? null;
            liquidityUsdc = best.liquidityUsdc ?? rt.liquidityUsdc ?? null;
          }
          if (typeof rt.price === "number" && rt.price > 0) radarPrice1m = rt.price * 1e6;
          launchpadName = rt.launchpad ?? null;
        }
      } catch {
        /* screener down */
      }
    }

    let clones = 0;
    let radarBadge = false;
    try {
      const tl = (await (await fetch("https://api.radardex.pro/tokenlist.json")).json()) as {
        tokens?: { address?: string; symbol?: string }[];
      };
      const toks = tl.tokens ?? [];
      clones = toks.filter((t) => (t.symbol ?? "").toLowerCase() === symbol.toLowerCase()).length;
      radarBadge = toks.some((t) => (t.address ?? "").toLowerCase() === token.toLowerCase());
    } catch {
      /* metadata API down: skip */
    }

    return {
      clones,
      decimals,
      liquidityUsdc,
      mintable: bytecode.includes("40c10f19"),
      name: decodeString(nameHex as string | null),
      owner,
      pausable: bytecode.includes("8456cb59"),
      launchpad: launchpadName,
      pool: effPool,
      poolVersion,
      price1m: (await quoteToUsdc(token, BigInt(10) ** BigInt(decimals) * 1_000_000n)) ?? radarPrice1m,
      radarBadge,
      renounced,
      symbol,
      totalSupply: (toNum(supplyHex as string | null) / BigInt(10) ** BigInt(decimals)).toString(),
    };
  });

// ---------------- portfolio ----------------

export type Holding = {
  amount: number;
  symbol: string;
  token: string;
  valueUsdc: number | null;
};

let tokenListCache: { address: string; symbol: string }[] | null = null;
let tokenListTs = 0;

export const getPortfolio = createServerFn({ method: "POST" })
  .inputValidator((input: { wallet: string }) => input)
  .handler(async ({ data }): Promise<{ holdings: Holding[]; total: number; usdc: number } | { error: string }> => {
    const wallet = data.wallet.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { error: "That is not a wallet address." };

    if (!tokenListCache || Date.now() - tokenListTs > 10 * 60_000) {
      try {
        const tl = (await (await fetch("https://api.radardex.pro/tokenlist.json")).json()) as {
          tokens?: { address?: string; symbol?: string; decimals?: number }[];
        };
        tokenListCache = (tl.tokens ?? [])
          .filter((t) => t.address)
          .map((t) => ({ address: t.address as string, symbol: t.symbol ?? "?" }));
        tokenListTs = Date.now();
      } catch {
        tokenListCache = tokenListCache ?? [];
      }
    }
    const list = tokenListCache;

    const usdcHex = await rpc("eth_call", [{ data: SEL.balanceOf + pad32(wallet), to: USDC }, "latest"]).catch(
      () => null,
    );
    const usdc = Number(toNum(usdcHex as string | null)) / 1e6;

    const holdings: Holding[] = [];
    const rawBalances: bigint[] = [];

    // primary discovery: the arc-scan indexer lists EVERY erc20 the wallet holds
    let indexed = false;
    try {
      const idx = (await (
        await fetch(`https://api.arc-scan.org/v1/address/${wallet}/tokens`, {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" },
        })
      ).json()) as {
        items?: {
          token?: { address?: string; symbol?: string; decimals?: number };
          balance?: { raw?: string; decimals?: number };
        }[];
      };
      for (const it of idx.items ?? []) {
        const addr = it.token?.address;
        const raw = BigInt(it.balance?.raw ?? "0");
        if (!addr || raw <= 0n || addr.toLowerCase() === USDC.toLowerCase()) continue;
        const dec = it.balance?.decimals ?? it.token?.decimals ?? 18;
        holdings.push({
          amount: Number(raw / 10n ** BigInt(Math.max(0, dec - 6))) / 1e6,
          symbol: it.token?.symbol ?? "?",
          token: addr,
          valueUsdc: null,
        });
        rawBalances.push(raw);
        if (holdings.length >= 100) break;
      }
      indexed = true;
    } catch {
      /* indexer down: fall back to the launch-list sweep below */
    }

    if (!indexed) {
      // fallback: multicall sweep over the RadarDex launch list (arc-scan caps payload: chunk 200)
      const balances = await multicall(
        list.map((t) => ({ data: SEL.balanceOf + pad32(wallet), target: t.address })),
        200,
      );
      list.forEach((t, i) => {
        const bal = toNum(balances[i]);
        if (bal > 0n && holdings.length < 60) {
          holdings.push({
            amount: Number(bal / 10n ** 12n) / 1e6,
            symbol: t.symbol,
            token: t.address,
            valueUsdc: null,
          });
          rawBalances.push(bal);
        }
      });
    }

    // value every holding through the quoter (quoter sims are heavy: small chunks)
    const quotes = await multicall(
      holdings.map((h, i) => ({ data: quoteCalldata(h.token, rawBalances[i]), target: QUOTER_V2 })),
      40,
    );
    holdings.forEach((h, i) => {
      const q = quotes[i];
      h.valueUsdc = q && q.length >= 66 ? Number(BigInt("0x" + q.slice(2, 66))) / 1e6 : null;
    });
    // no canonical V3 quote (pad curve, V4, other pads): fall back per token, a few at a time
    const missing = holdings.map((h, i) => [h, i] as const).filter(([h]) => !h.valueUsdc);
    for (let k = 0; k < missing.length; k += 4) {
      await Promise.all(missing.slice(k, k + 4).map(async ([h, i]) => {
        const v = await quoteToUsdc(h.token, rawBalances[i]).catch(() => null);
        if (v && v > 0) h.valueUsdc = v;
      }));
    }
    holdings.sort((a, b) => (b.valueUsdc ?? 0) - (a.valueUsdc ?? 0));
    const total = usdc + holdings.reduce((s, h) => s + (h.valueUsdc ?? 0), 0);
    return { holdings, total, usdc };
  });

// ---------------- price watch ----------------

export const getPrice1m = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<{ price1m: number | null }> => {
    const token = data.token.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return { price1m: null };
    const decHex = await rpc("eth_call", [{ data: SEL.decimals, to: token }, "latest"]).catch(() => null);
    const dec = Number(toNum(decHex as string | null)) || 18;
    return { price1m: await quoteToUsdc(token, BigInt(10) ** BigInt(dec) * 1_000_000n) };
  });

// ---------------- token explorer: lists per venue ----------------

export type PadToken = {
  /** normalized launch stage across pads: "curve 42%" | "graduated" | "pool" | "instant" */
  stage?: string | null;
  /** RadarDex "OG" flag (ticker registered before Arc mainnet launch) */
  og?: boolean;
  /** V2 DEXes the token trades on (e.g. dyorswap) — from the screener */
  dexes?: string[];
  /** long.supply wrapped stock (custodial IOU on a Robinhood-Chain token) */
  stock?: boolean;
  /** non-USDC quote token of the token's main pool (e.g. a wrapped stock on long.supply) */
  quote?: string;
  quoteSymbol?: string;
  createdAt: string | null;
  logo: string | null;
  mcapUsd: number | null;
  name: string;
  pad: string;
  pool: string | null;
  priceUsd: number | null;
  symbol: string;
  telegram: string | null;
  token: string;
  twitter: string | null;
  venueUrl: string | null;
  volUsd: number | null;
  website: string | null;
};

type RadarLaunch = {
  createdAt?: string;
  icon?: string;
  name?: string;
  pool?: string;
  symbol?: string;
  token?: string;
};

type RadarListToken = {
  address?: string;
  extensions?: { telegram?: string; twitter?: string; website?: string };
  logoURI?: string;
};

type ArcpadCreation = {
  imageURI?: string;
  marketCapUsd?: number;
  name?: string;
  pool?: string;
  price?: number;
  symbol?: string;
  telegram?: string;
  timestamp?: number;
  token?: string;
  twitter?: string;
  website?: string;
};

let warpCache: PadToken[] | null = null;
let warpTs = 0;

function decodeStringAt(data: string, slotIndex: number): string {
  try {
    const body = data.replace(/^0x/, "");
    const off = parseInt(body.slice(slotIndex * 64, slotIndex * 64 + 64), 16) * 2;
    const len = parseInt(body.slice(off, off + 64), 16);
    const raw = body.slice(off + 64, off + 64 + len * 2);
    const bytes = raw.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}

/**
 * Warp writes a JSON metadata blob as the 3rd string of its TokenCreated
 * event: {"image":"ipfs://…","description":"…","twitter":"…"}. That is the
 * ONLY source of Warp artwork (their site ships no public API and the
 * screener indexes just a handful of Warp tokens), so we decode it on chain.
 */
export function ipfsToHttp(uri: string): string | null {
  if (!uri) return null;
  // people paste BBCode / markdown / whitespace into launchpad forms: keep only the URL part
  uri = String(uri).trim().replace(/^[\[(<]*(?:img|url)?[=\]]?\s*/i, "").split(/[\s\[\]<>"']/)[0];
  if (!uri) return null;
  // przez wlasne proxy z cache na brzegu — publiczne bramy IPFS limituja ruch
  if (uri.startsWith("ipfs://")) return `/api/logo/ipfs/${uri.slice(7).replace(/^ipfs\//, "")}`;
  const gw = uri.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/);
  if (gw) return `/api/logo/ipfs/${gw[1]}`;
  if (/^https?:\/\//.test(uri)) return uri;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{20,}/.test(uri)) return `/api/logo/ipfs/${uri}`;
  return null;
}

function warpMeta(data: string): { image: string | null; twitter: string | null; website: string | null } {
  const empty = { image: null, twitter: null, website: null };
  try {
    const raw = decodeStringAt(data, 2);
    if (!raw.trim().startsWith("{")) return empty;
    const j = JSON.parse(raw) as { image?: string; twitter?: string; website?: string; telegram?: string };
    return {
      image: ipfsToHttp(j.image ?? ""),
      twitter: j.twitter || null,
      website: j.website || null,
    };
  } catch {
    return empty;
  }
}

async function warpTokens(): Promise<PadToken[]> {
  if (warpCache && Date.now() - warpTs < 5 * 60_000) return warpCache;
  const head = Number(toNum((await rpc("eth_blockNumber", [])) as string));
  const factory = "0x0dCad158e98bC24455f9e94F46709d8a5F6D1255";
  const topic = "0x0b4cfda446fdf9ec5a85855f088c154869eb62e3e723d7d80319b680f90e0cfd";
  const out: PadToken[] = [];
  const lo = Math.max(0, head - 400_000);
  const chunks: { from: number; to: number }[] = [];
  for (let b = lo; b <= head; b += 10_000) chunks.push({ from: b, to: Math.min(b + 9_999, head) });
  const results = await Promise.all(
    chunks.map((c) =>
      rpc("eth_getLogs", [
        { address: factory, fromBlock: "0x" + c.from.toString(16), toBlock: "0x" + c.to.toString(16), topics: [topic] },
      ]).catch(() => []),
    ),
  );
  for (const logs of results as { data: string; topics: string[] }[][]) {
    for (const l of logs) {
      const token = topicAddr(l.topics[1]);
      const wm = warpMeta(l.data);
      out.push({
        createdAt: null,
        logo: wm.image,
        mcapUsd: null,
        name: decodeStringAt(l.data, 0) || "?",
        pad: "Warp",
        pool: null,
        priceUsd: null,
        symbol: decodeStringAt(l.data, 1) || "?",
        telegram: null,
        token,
        twitter: wm.twitter,
        venueUrl: `https://circlewarp.fun/token/${token}`,
        volUsd: null,
        website: wm.website,
      });
    }
  }
  out.reverse();
  warpCache = out;
  warpTs = Date.now();
  return out;
}

/**
 * Normalise social links from every source into absolute https URLs.
 * Launchpad APIs and creators hand us `x.com/foo`, `t.me/foo`, `@foo`, `foo.xyz`
 * or plain junk; a scheme-less value rendered as <a href> becomes a RELATIVE
 * link and opens arctools.fun/x.com/foo. Returns null for anything unusable.
 */
export function normSocial(kind: "x" | "tg" | "web", raw: string | null | undefined): string | null {
  let v = (raw ?? "").trim();
  if (!v) return null;
  v = v.split(/\s+/)[0].replace(/^["'<]+|["'>),.]+$/g, "");
  if (kind === "x") {
    const m = v.match(/(?:^|\/\/|^www\.)?(?:x\.com|twitter\.com)\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
    if (m) return `https://x.com/${m[1]}`;
    if (/^@?[A-Za-z0-9_]{1,15}$/.test(v)) return `https://x.com/${v.replace(/^@/, "")}`;
    return null;
  }
  if (kind === "tg") {
    const m = v.match(/t\.me\/(\+?[A-Za-z0-9_/-]{3,64})/i);
    if (m) return `https://t.me/${m[1]}`;
    if (/^@?[A-Za-z0-9_]{4,64}$/.test(v)) return `https://t.me/${v.replace(/^@/, "")}`;
    return null;
  }
  // web
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/.*)?$/.test(v) && !/^(x|twitter)\.com|^t\.me/i.test(v)) return `https://${v}`;
  return null;
}

export const listTokens = createServerFn({ method: "POST" })
  .inputValidator((input: { pad: string }) => input)
  .handler(({ data }): Promise<PadToken[]> =>
    memo(`list:${data.pad}`, 20_000, async () =>
      (await withLogos(await listTokensImpl(data.pad))).map((t) => ({
        ...t,
        telegram: normSocial("tg", t.telegram),
        twitter: normSocial("x", t.twitter),
        website: normSocial("web", t.website),
      })), (v) => v.length > 0));

/**
 * Cross-pad logo source. No single index covers Arc: the RadarDex screener
 * ranks only the top ~200 tokens, Tolly and ArcPad each know their own. We
 * merge all three into one address -> icon map, so a token keeps its artwork
 * in EVERY tab (incl. raw Uniswap V3 pools and Warp tokens whose IPFS art
 * failed), and only fall back to the monogram when nobody has a picture.
 */
let iconMap = new Map<string, string>();
let iconTs = 0;

/** Last-resort logo: the project's X avatar (unavatar mirrors profile pictures; content-cached by browsers). */
export function xAvatar(twitter: string | null | undefined): string | null {
  if (!twitter) return null;
  const m = String(twitter).match(/(?:x\.com|twitter\.com)\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/) ?? String(twitter).match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (!m) return null;
  const h = m[1].toLowerCase();
  if (["i", "home", "search", "intent", "share", "hashtag", "explore"].includes(h)) return null;
  return `https://unavatar.io/x/${h}?fallback=false`;
}

export async function screenerIcons(): Promise<Map<string, string>> {
  if (iconMap.size > 0 && Date.now() - iconTs < 300_000) return iconMap;
  const m = new Map<string, string>();
  const put = (addr?: string, icon?: string) => {
    const a = (addr ?? "").toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(a) && icon && !m.has(a)) m.set(a, icon);
  };
  const [radar, tolly, arcpad] = await Promise.all([
    fetch("https://api.radardex.pro/tokens", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .catch(() => ({})) as Promise<{ tokens?: { address?: string; icon?: string; logoURI?: string }[] }>,
    fetch("https://api.tollylabs.com/tokens", {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" },
    })
      .then((r) => r.json())
      .catch(() => ({})) as Promise<{ tokens?: { address?: string; image_uri?: string }[] }>,
    fetch("https://arcpad.meme/api/tokens?limit=200")
      .then((r) => r.json())
      .catch(() => ({})) as Promise<{ creations?: { token?: string; imageURI?: string }[] }>,
  ]);
  for (const t of radar.tokens ?? []) put(t.address, t.icon || t.logoURI);
  for (const t of tolly.tokens ?? []) put(t.address, t.image_uri);
  for (const c of arcpad.creations ?? []) put(c.token, c.imageURI);
  if (m.size > 0) {
    iconMap = m;
    iconTs = Date.now();
  }
  return iconMap;
}

async function withLogos(list: PadToken[]): Promise<PadToken[]> {
  if (!list.some((t) => !t.logo)) return list;
  const icons = await screenerIcons();
  return list.map((t) => (t.logo ? t : { ...t, logo: ipfsToHttp(icons.get((t.token || "").toLowerCase()) ?? "") }));
}

let _headBlock = 0;
export function noteHeadBlock(b: number) { _headBlock = Math.max(_headBlock, b); }
function headBlockGuess(): number { return _headBlock || 20_340_000 + Math.floor((Date.now() / 1000 - 1_789_000_000) / 0.63); }
const INSIDER_API = "https://bot-production-4200.up.railway.app";
const V4_HOOK_PADS: Record<string, string> = {
  "0xa368005ad249fbebcd5baa7396c9e3b3e44e6044": "Arguspad",
  "0x465af15c85ac291d5cffb8d02d8c8e23102fe6e3": "act.fun",
  "0x20eead6db6b3d0a4491e9073119dd0ebff166acc": "UBI.fun",
};

async function listTokensImpl(pad: string): Promise<PadToken[]> {

    if (pad === "Archemist") {
      // archemist.fun: direct Uniswap V3 launches (fee 10000), LP locked; 80% of trading fees to the creator
      const res = (await fetch("https://api.archemist.fun/api/tokens", { headers: { Accept: "application/json" } })
        .then((r) => r.json())
        .catch(() => ({}))) as {
        tokens?: {
          token_address?: string; name?: string; symbol?: string; image_url?: string; twitter?: string; telegram?: string;
          website?: string; created_at?: string; pool_address?: string; network?: string;
          live?: { price?: number; marketCap?: number; volume_24h?: number } | null;
        }[];
      };
      return (res.tokens ?? [])
        .filter((t) => t.token_address && (t.network ?? "mainnet") === "mainnet")
        .map((t) => ({
          createdAt: t.created_at ?? null,
          logo: ipfsToHttp(t.image_url ?? ""),
          mcapUsd: typeof t.live?.marketCap === "number" ? t.live.marketCap : null,
          name: t.name ?? "?",
          pad: "Archemist",
          stage: "pool · locked LP",
          pool: t.pool_address ?? null,
          priceUsd: typeof t.live?.price === "number" ? t.live.price : null,
          symbol: t.symbol ?? "?",
          telegram: t.telegram || null,
          token: t.token_address!,
          twitter: t.twitter || null,
          venueUrl: `/token/${t.token_address}`,
          volUsd: typeof t.live?.volume_24h === "number" ? t.live.volume_24h : null,
          website: t.website || null,
        }));
    }

    if (pad === "Arguspad") {
      // arguspad.io (dyor-api): direct Uniswap V3 launches, locked LP; USDC amounts are reported as 6-dec "wei"
      const res = (await fetch("https://arc-api-production-ef9c.up.railway.app/api/tokens", { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } })
        .then((r) => r.json())
        .catch(() => [])) as {
        token?: string; name?: string; symbol?: string; image?: string; website?: string; x?: string; telegram?: string; created_at?: number;
        pool?: string; marketCapEth?: string; volume24hWei?: string; progressBps?: number; graduated?: boolean; pair_token?: string;
      }[];
      return (Array.isArray(res) ? res : [])
        .filter((t) => t.token && (t.pair_token ?? "").toLowerCase() === USDC)
        .map((t) => ({
          createdAt: t.created_at ? new Date(Number(t.created_at)).toISOString() : null,
          logo: t.image ?? null,
          mcapUsd: t.marketCapEth ? Number(t.marketCapEth) / 1e6 : null,
          name: t.name ?? "?",
          pad: "Arguspad",
          stage: t.graduated ? "graduated" : "pool · locked LP",
          pool: t.pool ?? null,
          priceUsd: null,
          symbol: t.symbol ?? "?",
          telegram: t.telegram || null,
          token: t.token!,
          twitter: t.x || null,
          venueUrl: `/token/${t.token}`,
          volUsd: t.volume24hWei ? Number(t.volume24hWei) / 1e6 : null,
          website: t.website || null,
        }));
    }

    if (pad === "UniswapV4") {
      // every USDC-paired Uniswap V4 pool on Arc from the Arc Insider index (act.fun, Arguspad, UBI.fun, ArcadeSwap...)
      const res = (await fetch(`${INSIDER_API}/api/v4launches?limit=100`, { headers: { Accept: "application/json" } })
        .then((r) => r.json())
        .catch(() => ({}))) as {
        pools?: { token: string; hooks: string | null; symbol: string | null; block: number | null; swaps: number; vol24: number; price1m: number | null; last_ts: number; created_ts?: number | null; supply?: number | null }[];
      };
      const seen = new Set<string>();
      return (res.pools ?? [])
        .filter((p) => p.token && !seen.has(p.token) && seen.add(p.token))
        .map((p) => ({
          createdAt: p.created_ts ? new Date(p.created_ts * 1000).toISOString() : p.block ? new Date(Date.now() - Math.max(0, (headBlockGuess() - p.block)) * 630).toISOString() : null,
          logo: null,
          mcapUsd: p.price1m && p.supply ? (p.price1m / 1e6) * p.supply : null,
          name: p.symbol ?? p.token.slice(0, 8),
          pad: V4_HOOK_PADS[(p.hooks ?? "").toLowerCase()] ?? "UniswapV4",
          stage: "V4 pool",
          pool: null,
          priceUsd: p.price1m ? p.price1m / 1e6 : null,
          symbol: p.symbol ?? "?",
          telegram: null,
          token: p.token,
          twitter: null,
          venueUrl: `/token/${p.token}`,
          volUsd: p.vol24 || null,
          website: null,
        }));
    }

    if (pad === "RadarDex") {
      const [launchesRes, listRes] = await Promise.all([
        fetch("https://api.radardex.pro/launches").then((r) => r.json()).catch(() => ({})),
        fetch("https://api.radardex.pro/tokenlist.json").then((r) => r.json()).catch(() => ({})),
      ]);
      const launches = ((launchesRes as { launches?: RadarLaunch[] }).launches ?? []);
      const listTokensArr = ((listRes as { tokens?: RadarListToken[] }).tokens ?? []);
      const socials = new Map(listTokensArr.map((t) => [(t.address ?? "").toLowerCase(), t]));
      const fromLaunches = launches.map((l) => {
        const s = socials.get((l.token ?? "").toLowerCase());
        return {
          createdAt: l.createdAt ?? null,
          logo: ipfsToHttp(l.icon || s?.logoURI || ""),
          mcapUsd: null,
          name: l.name ?? "?",
          pad: "RadarDex",
          pool: l.pool ?? null,
          priceUsd: null,
          symbol: l.symbol ?? "?",
          telegram: s?.extensions?.telegram ?? null,
          token: l.token ?? "",
          twitter: s?.extensions?.twitter ?? null,
          venueUrl: `https://radardex.pro/#${l.token ?? ""}`,
          volUsd: null,
          website: s?.extensions?.website ?? null,
        };
      });
      // the FULL token list (older / big tokens too), after the fresh launches
      const inLaunches = new Set(fromLaunches.map((t) => t.token.toLowerCase()));
      type RadarFull = RadarListToken & { name?: string; symbol?: string };
      const rest = (listTokensArr as RadarFull[])
        .filter((t) => t.address && !inLaunches.has(t.address.toLowerCase()))
        .map((t) => ({
          createdAt: null,
          logo: ipfsToHttp(t.logoURI ?? ""),
          mcapUsd: null,
          name: t.name ?? "?",
          pad: "RadarDex",
          pool: null,
          priceUsd: null,
          symbol: t.symbol ?? "?",
          telegram: t.extensions?.telegram ?? null,
          token: t.address as string,
          twitter: t.extensions?.twitter ?? null,
          venueUrl: `https://radardex.pro/#${t.address}`,
          volUsd: null,
          website: t.extensions?.website ?? null,
        }));
      return [...fromLaunches, ...rest];
    }

    if (pad === "ArcPad") {
      const res = (await fetch("https://arcpad.meme/api/tokens?limit=200")
        .then((r) => r.json())
        .catch(() => ({}))) as { creations?: (ArcpadCreation & { volume24Usd?: number })[] };
      return (res.creations ?? []).map((c) => ({
        createdAt: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : null,
        logo: ipfsToHttp(c.imageURI ?? ""),
        mcapUsd: c.marketCapUsd ?? null,
        name: c.name ?? "?",
        pad: "ArcPad",
        pool: c.pool ?? null,
        priceUsd: c.price ?? null,
        symbol: c.symbol ?? "?",
        telegram: c.telegram || null,
        token: c.token ?? "",
        twitter: c.twitter || null,
        venueUrl: `https://arcpad.meme/token/${c.token}`,
        volUsd: c.volume24Usd ?? null,
        website: c.website || null,
      }));
    }

    if (pad === "Warp") return warpTokens();

    if (pad === "Tolly") {
      const res = (await fetch("https://api.tollylabs.com/tokens", {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" },
      })
        .then((r) => r.json())
        .catch(() => ({}))) as {
        tokens?: {
          address?: string; symbol?: string; name?: string; image_uri?: string;
          website?: string | null; twitter?: string | null; telegram?: string | null;
          created_ts?: number; marketCap?: number | null; volume24h?: number | null; pool?: string | null;
        }[];
      };
      return (res.tokens ?? [])
        .filter((t) => t.address)
        .map((t) => ({
          createdAt: t.created_ts ? new Date(t.created_ts * 1000).toISOString() : null,
          logo: ipfsToHttp(t.image_uri ?? ""),
          mcapUsd: t.marketCap ?? null,
          name: t.name ?? "?",
          pad: "Tolly",
          pool: t.pool ?? null,
          priceUsd: null,
          symbol: t.symbol ?? "?",
          telegram: t.telegram || null,
          token: t.address as string,
          twitter: t.twitter || null,
          venueUrl: `https://tollylabs.com/token/${t.address}`,
          volUsd: t.volume24h ?? null,
          website: t.website || null,
        }));
    }

    // "Pools": fresh pools on the canonical Uniswap V3 factory (recent window)
    const items = await getNewPairs();
    return items
      .filter((i) => i.pad === "UniswapV3")
      .map((i) => ({
        createdAt: i.createdAt,
        logo: null,
        mcapUsd: null,
        name: i.symbol,
        pad: "UniswapV3",
        pool: null,
        priceUsd: null,
        symbol: i.symbol,
        telegram: null,
        token: i.token,
        twitter: null,
        venueUrl: `https://arc-scan.org/address/${i.token}`,
        volUsd: null,
        website: null,
      }));
}

// ---------------- market caps: cached, batched quoter ----------------

const mcapCache = new Map<string, { mcap: number | null; ts: number }>();

/** Market caps for the requested tokens (1B fixed supply on Arc launchpads):
 * mcap = price(1M tokens) * 1000. Cached 3 min; quotes at most 300 per call. */
export const getMcaps = createServerFn({ method: "POST" })
  .inputValidator((input: { tokens: string[] }) => input)
  .handler(async ({ data }): Promise<Record<string, number | null>> => {
    const now = Date.now();
    const tokens = (data.tokens ?? []).filter((t) => /^0x[0-9a-fA-F]{40}$/.test(t)).slice(0, 600);
    const out: Record<string, number | null> = {};
    const missing: string[] = [];
    for (const t of tokens) {
      const k = t.toLowerCase();
      const c = mcapCache.get(k);
      if (c && now - c.ts < 120_000) out[k] = c.mcap;
      else missing.push(t);
    }
    const toQuote = missing.slice(0, 400);
    if (toQuote.length > 0) {
      try {
        const amount = 10n ** 18n * 1_000_000n;
        const res = await multicall(
          toQuote.map((t) => ({ data: quoteCalldata(t, amount), target: QUOTER_V2 })),
          40, // quoter simulations are heavy: keep chunks under the eth_call gas cap
        );
        toQuote.forEach((t, i) => {
          const q = res[i];
          const price1m = q && q.length >= 66 ? Number(BigInt("0x" + q.slice(2, 66))) / 1e6 : null;
          const mcap = price1m !== null ? price1m * 1000 : null;
          mcapCache.set(t.toLowerCase(), { mcap, ts: now });
          out[t.toLowerCase()] = mcap;
        });
      } catch {
        /* leave missing for the next poll */
      }
    }
    return out;
  });

// ---------------- token chart (from on-chain V3 Swap events) ----------------

const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export type ChartPoint = { block: number; price: number };

export const tokenChart = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; pool?: string | null }) => input)
  .handler(({ data }) =>
    memo(`chart:${data.token.toLowerCase()}:${data.pool ?? ""}`, 60_000, () =>
      tokenChartImpl(data.token, data.pool ?? null),
    ),
  );

async function tokenChartImpl(
  tokenRaw: string,
  poolIn: string | null,
): Promise<{ points: ChartPoint[]; pool: string | null; price1m: number | null }> {
    const token = tokenRaw.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return { points: [], pool: null, price1m: null };
    try {
      let pool = poolIn;
      if (!pool) {
        const poolHex = await rpc("eth_call", [
          { data: SEL.getPool + pad32(token) + pad32(USDC) + padNum(10000n), to: UNIV3_FACTORY },
          "latest",
        ]).catch(() => null);
        pool = poolHex && toNum(poolHex as string) !== 0n ? topicAddr(poolHex as string) : null;
      }
      const price1m = await quoteToUsdc(token, 10n ** 18n * 1_000_000n);
      if (!pool) return { points: [], pool: null, price1m };

      const head = Number(toNum((await rpc("eth_blockNumber", [])) as string));
      const lo = Math.max(0, head - 200_000);
      const chunks: { from: number; to: number }[] = [];
      for (let b = lo; b <= head; b += 10_000) chunks.push({ from: b, to: Math.min(b + 9_999, head) });
      const results: unknown[][] = [];
      // max 3 in flight: stay well under the Worker's subrequest concurrency
      for (let i = 0; i < chunks.length; i += 3) {
        const part = await Promise.all(
          chunks.slice(i, i + 3).map((c) =>
            rpc("eth_getLogs", [
              {
                address: pool,
                fromBlock: "0x" + c.from.toString(16),
                toBlock: "0x" + c.to.toString(16),
                topics: [SWAP_TOPIC],
              },
            ]).catch(() => []),
          ),
        );
        results.push(...part);
      }
      const tokenIsToken0 = BigInt(token.toLowerCase()) < BigInt(USDC.toLowerCase());
      const points: ChartPoint[] = [];
      for (const logs of results as { blockNumber: string; data: string }[][]) {
        for (const l of logs) {
          try {
            const body = l.data.replace(/^0x/, "");
            const sqrt = BigInt("0x" + body.slice(128, 192));
            const s = Number(sqrt) / 2 ** 96;
            const raw = s * s; // token1_raw per token0_raw
            const price = tokenIsToken0 ? raw * 1e12 : (1 / raw) * 1e12; // USDC per whole token
            if (Number.isFinite(price) && price > 0) {
              points.push({ block: Number(toNum(l.blockNumber)), price: price * 1_000_000 });
            }
          } catch {
            /* skip malformed log */
          }
        }
      }
      points.sort((a, b) => a.block - b.block);
      return { points: points.slice(-400), pool, price1m };
    } catch {
      return { points: [], pool: poolIn, price1m: null };
    }
}

// ---------------- batch helpers for the trade terminal ----------------

/** Logos for many tokens at once: merged screener icon index (RadarDex + Tolly + ArcPad) + our pad_meta images. */
export const tokenLogos = createServerFn({ method: "POST" })
  .inputValidator((input: { tokens: string[] }) => input)
  .handler(async ({ data }): Promise<Record<string, string>> => {
    const want = data.tokens.slice(0, 200).map((t) => t.toLowerCase());
    const icons = await screenerIcons().catch(() => new Map<string, string>());
    const out: Record<string, string> = {};
    for (const t of want) {
      const u = ipfsToHttp(icons.get(t) ?? "");
      if (u) out[t] = u;
    }
    try {
      const db = bindings().DB;
      if (db && want.length) {
        const missing = want.filter((t) => !out[t]);
        for (let i = 0; i < missing.length; i += 50) {
          const chunk = missing.slice(i, i + 50);
          const rows = (await db.prepare(`SELECT token FROM pad_meta WHERE image != '' AND token IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all()).results as { token: string }[];
          for (const r of rows) out[r.token.toLowerCase()] = `/api/pad-logo/${r.token.toLowerCase()}`;
        }
      }
    } catch {
      /* D1 unavailable */
    }
    // last resort for raw pools (Uniswap V4/V3, DYORSwap, RadarDex launches): RadarDex per-token metadata
    // (icon, else the project's X avatar). Cached 6 h per token, negatives included, so this costs one call per token per shift.
    const still = want.filter((t) => !out[t]).slice(0, 24);
    await Promise.all(still.map(async (t) => {
      const u = await memo(`logo:radar:${t}`, 6 * 3600_000, async () => {
        try {
          const r = await fetch(`https://api.radardex.pro/token/${t}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" }, signal: AbortSignal.timeout(5000) });
          if (!r.ok) return "";
          const j = (await r.json()) as { icon?: string; logoURI?: string; twitter?: string };
          return ipfsToHttp(String(j.icon ?? j.logoURI ?? "")) || xAvatar(j.twitter) || "";
        } catch { return ""; }
      }).catch(() => "");
      if (u) out[t] = u;
    }));
    return out;
  });

/** Holder concentration per token (GMGN "Top-10 %"): arc-scan holders + on-chain totalSupply. Cached 5 min per token. */
export const holderRisk = createServerFn({ method: "POST" })
  .inputValidator((input: { tokens: string[] }) => input)
  .handler(async ({ data }): Promise<Record<string, { holders: number; top10: number | null; top1: number | null }>> => {
    // arc-scan rate-limits Cloudflare egress; the buybot (Railway) proxies + caches the holder pages for us
    const want = [...new Set(data.tokens.slice(0, 60).map((t) => t.toLowerCase()))];
    if (!want.length) return {};
    try {
      const r = await memo(`hrisk:${want.join(",")}`, 45_000, async () => {
        const j = await fetch(`https://bot-production-4200.up.railway.app/api/holder-risk?tokens=${want.join(",")}`).then((x) => x.json()) as { risk?: Record<string, { holders: number; top10: number | null; top1: number | null }> };
        return j.risk ?? {};
      });
      return r as Record<string, { holders: number; top10: number | null; top1: number | null }>;
    } catch { return {}; }
  });

/** Every source in ONE round-trip for the Terminal: merged + de-duplicated, memoized (memory + KV).
 *  Each source is itself memoized, so a refresh only recomputes what actually expired. */
export const ALL_PADS = ["RadarDex", "ArcPad", "Warp", "Tolly", "UniswapV3", "Archemist", "UniswapV4", "Arguspad"] as const;
export async function listAllTokensImpl(): Promise<PadToken[]> {
  const { padList } = await import("@/lib/arcpad");
  const [pad, ...rest] = await Promise.all([
    padList().then((ps) => ps.map((x) => ({ createdAt: x.createdAt ? new Date(x.createdAt * 1000).toISOString() : null, logo: x.image, mcapUsd: x.pricePer1M > 0 ? x.pricePer1M * 1000 : null, name: x.name, pad: "ArcToolsPad", pool: null, priceUsd: null, symbol: x.symbol, telegram: x.telegram, token: x.token, twitter: x.twitter, venueUrl: `/token/${x.token}`, volUsd: x.volumeUsdc, website: x.website }) as PadToken)).catch(() => [] as PadToken[]),
    ...ALL_PADS.map((p) => listTokens({ data: { pad: p } }).catch(() => [] as PadToken[])),
  ]);
  const seen = new Set<string>();
  // order = priority when the same token appears in several sources
  // launchpad-native lists first so a token keeps its real source label; the RadarDex launch feed (which also
  // mirrors other pads' tokens) and the screener only fill what nobody else listed
  const order = ["ArcPad", "Warp", "Tolly", "Archemist", "Arguspad", "UniswapV4", "UniswapV3", "RadarDex"];
  const byName = new Map(ALL_PADS.map((p, i) => [p, rest[i]]));
  // the RadarDex screener (chain-wide top tokens by activity, with icons + socials + mcap): established tokens such as
  // TOLLY / ARGUS never appear in any launch feed, this is where their metadata comes from
  const screener: PadToken[] = await memo("radar:screener", 60_000, async () => {
    const j = (await fetch("https://api.radardex.pro/tokens", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }).then((r) => r.json())) as { tokens?: Record<string, unknown>[] };
    const padOf = (lp: unknown) => ({ argus: "Arguspad", archemist: "Archemist", tolly: "Tolly", arcpad: "ArcPad", warp: "Warp", arctoolspad: "ArcToolsPad" } as Record<string, string>)[String(lp ?? "").toLowerCase()] ?? "RadarDex";
    return (j.tokens ?? []).filter((t) => /^0x[0-9a-fA-F]{40}$/.test(String(t.address ?? ""))).map((t) => ({
      createdAt: typeof t.deployTs === "number" ? new Date(Number(t.deployTs) * 1000).toISOString() : (typeof t.firstSeen === "number" ? new Date(Number(t.firstSeen) * 1000).toISOString() : null),
      logo: ipfsToHttp(String(t.icon ?? t.logoURI ?? "")), mcapUsd: typeof t.mcap === "number" ? Number(t.mcap) : null, name: String(t.name ?? ""), pad: padOf(t.launchpad) || "RadarDex",
      pool: null, priceUsd: typeof t.price === "number" ? Number(t.price) : null, stage: (t.versions as string[] | undefined)?.includes("v4") ? "V4 pool" : "pool",
      symbol: String(t.symbol ?? ""), telegram: (t.telegram as string) ?? null, token: String(t.address).toLowerCase(), twitter: (t.twitter as string) ?? null,
      venueUrl: `/token/${String(t.address).toLowerCase()}`, volUsd: typeof t.volume24 === "number" ? Number(t.volume24) : null, website: (t.website as string) ?? null,
      og: t.isOG === true, dexes: Array.isArray(t.v2Dexes) ? (t.v2Dexes as string[]).map((d) => String(d).toLowerCase()) : [],
    }) as PadToken);
  }, (v) => v.length > 20).catch(() => [] as PadToken[]);
  // DYORSwap / WarpDex V2 pairs come from our own swap index (no public listing API)
  const v2: PadToken[] = await memo("v2:tokens", 60_000, async () => {
    const j = (await fetch("https://bot-production-4200.up.railway.app/api/venue-tokens?venue=v2", { signal: AbortSignal.timeout(8000) }).then((r) => r.json())) as { rows?: { token: string; symbol: string | null; first_ts: number | null; vol: number | null; price1m: number | null; mcap?: number | null }[] };
    return (j.rows ?? []).filter((r) => /^0x[0-9a-f]{40}$/i.test(r.token)).map((r) => ({
      createdAt: r.first_ts ? new Date(Number(r.first_ts) * 1000).toISOString() : null, logo: null, mcapUsd: r.mcap ?? null, name: r.symbol ?? "", pad: "DYORSwap", pool: null,
      priceUsd: r.price1m ? Number(r.price1m) / 1e6 : null, stage: "V2 pair", symbol: r.symbol ?? "", telegram: null, token: r.token.toLowerCase(), twitter: null,
      venueUrl: `/token/${r.token.toLowerCase()}`, volUsd: r.vol ?? null, website: null, dexes: ["dyor"],
    }) as PadToken);
  }, (v) => v.length > 0).catch(() => [] as PadToken[]);
  // long.supply: memecoins quoted in wrapped stocks + the wrapped stocks themselves (their public API)
  const longs: PadToken[] = await import("@/lib/longsupply").then((m) => m.longSupplyTokens()).catch(() => [] as PadToken[]);
  const all = [...pad, ...longs, ...order.filter((p) => p !== "RadarDex").flatMap((p) => byName.get(p as typeof ALL_PADS[number]) ?? []), ...v2, ...(byName.get("RadarDex") ?? []), ...screener].filter((t) => { const k = t.token.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  // keep the payload small (the Terminal shows 100 rows per tab): newest 600 + top 300 by volume, compact fields
  const ts = (t: PadToken) => (t.createdAt ? Date.parse(t.createdAt) : 0);
  const newest = [...all].sort((a, b) => ts(b) - ts(a)).slice(0, 400);
  const busiest = [...all].sort((a, b) => (b.volUsd ?? 0) - (a.volUsd ?? 0)).slice(0, 200);
  const keep = new Map<string, PadToken>();
  for (const t of [...newest, ...busiest]) keep.set(t.token.toLowerCase(), t);
  // every launchpad list is small — keep them whole so a source chip shows the full pad; only the raw
  // RadarDex launch feed (hundreds of dead pools) is trimmed to newest/busiest
  for (const t of all) if (t.pad !== "RadarDex") keep.set(t.token.toLowerCase(), t);
  for (const t of v2) { const k = t.token.toLowerCase(); const cur = keep.get(k); if (cur && !(cur.dexes ?? []).includes("dyor")) keep.set(k, { ...cur, dexes: [...(cur.dexes ?? []), "dyor"] }); }
  // the screener set (chain-wide most active) is always carried whole
  const scr = new Set(screener.map((t) => t.token.toLowerCase()));
  const scrMeta = new Map(screener.map((t) => [t.token.toLowerCase(), t]));
  // full (uncompacted) list for the client-side explorer / pagination — same compact field shape
  fullListCache = { ts: Date.now(), v: all.map(compactToken) };
  for (const t of all) if (scr.has(t.token.toLowerCase())) keep.set(t.token.toLowerCase(), t);
  // whatever is trending / moving in the last 24 h must carry its metadata into the Terminal rows
  try {
    const tr = await memo("trend:1440", 60_000, async () =>
      (await fetch("https://bot-production-4200.up.railway.app/api/trending?minutes=1440&limit=150", { signal: AbortSignal.timeout(10_000) }).then((r) => r.json())) as { rows?: { token: string }[] },
    (v) => (v.rows?.length ?? 0) > 0);
    const want = new Set((tr.rows ?? []).map((r) => r.token.toLowerCase()));
    for (const t of all) if (want.has(t.token.toLowerCase())) keep.set(t.token.toLowerCase(), t);
  } catch { /* trending API busy: newest + busiest + screener */ }
  const official = all.find((t) => t.token.toLowerCase() === "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52");
  if (official) keep.set(official.token.toLowerCase(), official);
  function compactToken(t: PadToken): PadToken {
    return {
      createdAt: t.createdAt, logo: t.logo, mcapUsd: t.mcapUsd, name: (t.name ?? "").slice(0, 40), pad: t.pad, pool: t.pool, priceUsd: t.priceUsd, stage: t.stage ?? null,
      symbol: (t.symbol ?? "").slice(0, 16), telegram: t.telegram, token: t.token, twitter: t.twitter, venueUrl: t.venueUrl, volUsd: t.volUsd, website: t.website,
      og: t.og || scrMeta.get(t.token.toLowerCase())?.og || false, dexes: t.dexes?.length ? t.dexes : (scrMeta.get(t.token.toLowerCase())?.dexes ?? []),
      ...(t.stock ? { stock: true } : {}), ...(t.quote ? { quote: t.quote, quoteSymbol: t.quoteSymbol } : {}),
    } as PadToken;
  }
  return [...keep.values()].sort((a, b) => ts(b) - ts(a)).map(compactToken);
}
let fullListCache: { ts: number; v: PadToken[] } | null = null;
/** Every token we know (all sources, no compaction) — served to the client after first paint for paging / source chips. */
export async function listFullTokens(): Promise<PadToken[]> {
  if (fullListCache && Date.now() - fullListCache.ts < 30_000) return fullListCache.v;
  return memo("list:__full", 30_000, async () => { await listAllTokensImpl(); return fullListCache?.v ?? []; }, (v) => v.length > 100);
}
export const listAllTokens = createServerFn({ method: "POST" })
  .handler((): Promise<PadToken[]> => memo("list:__all", 15_000, listAllTokensImpl, (v) => v.length > 50));
