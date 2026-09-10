/**
 * Server-side Arc chain access for the ArcTools site: new-pairs feed, token
 * scanner, portfolio and price watch. Read-only JSON-RPC against the public
 * Arc mainnet node, plus the venues' public metadata APIs.
 */
import { createServerFn } from "@tanstack/react-start";

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
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = RPCS[attempt % RPCS.length];
    try {
      const res = await fetch(url, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)",
        },
        method: "POST",
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "rpc error");
      return json.result;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("rpc failed");
}

// ---------------- tiny per-isolate TTL memo with inflight dedupe ----------------

const memoStore = new Map<string, { ts: number; v: unknown }>();
const memoInflight = new Map<string, Promise<unknown>>();

/** Cache fn() result for ttlMs. Stale-while-revalidate: when the TTL expires,
 *  exactly ONE caller recomputes (and waits); everyone else is served the
 *  previous value instantly, so tail latency never depends on recompute time. */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memoStore.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.v as T;
  const inflight = memoInflight.get(key);
  if (inflight) {
    // refresh already running: serve stale immediately if we have anything
    if (hit) return hit.v as T;
    return inflight as Promise<T>;
  }
  const p = fn()
    .then((v) => {
      memoStore.set(key, { ts: Date.now(), v });
      if (memoStore.size > 500) {
        const oldest = [...memoStore.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 250);
        for (const [k] of oldest) memoStore.delete(k);
      }
      return v;
    })
    .finally(() => memoInflight.delete(key));
  memoInflight.set(key, p);
  return p;
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

async function quoteToUsdc(token: string, amount: bigint): Promise<number | null> {
  if (amount <= 0n) return null;
  try {
    const res = (await rpc("eth_call", [{ data: quoteCalldata(token, amount), to: QUOTER_V2 }, "latest"])) as string;
    return Number(BigInt("0x" + res.slice(2, 66))) / 1e6;
  } catch {
    return null;
  }
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
  renounced: boolean;
  symbol: string;
  totalSupply: string;
};

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
    const effPool = pool ?? padPool;
    let liquidityUsdc: number | null = null;
    if (effPool) {
      const balHex = await rpc("eth_call", [{ data: SEL.balanceOf + pad32(effPool), to: USDC }, "latest"]).catch(
        () => null,
      );
      if (balHex) liquidityUsdc = Number(toNum(balHex as string)) / 1e6;
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
      pool: effPool,
      price1m: await quoteToUsdc(token, BigInt(10) ** BigInt(decimals) * 1_000_000n),
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
      out.push({
        createdAt: null,
        logo: null,
        mcapUsd: null,
        name: decodeStringAt(l.data, 0) || "?",
        pad: "Warp",
        pool: null,
        priceUsd: null,
        symbol: decodeStringAt(l.data, 1) || "?",
        telegram: null,
        token,
        twitter: null,
        venueUrl: `https://circlewarp.fun/token/${token}`,
        volUsd: null,
        website: null,
      });
    }
  }
  out.reverse();
  warpCache = out;
  warpTs = Date.now();
  return out;
}

export const listTokens = createServerFn({ method: "POST" })
  .inputValidator((input: { pad: string }) => input)
  .handler(({ data }): Promise<PadToken[]> => memo(`list:${data.pad}`, 20_000, () => listTokensImpl(data.pad)));

async function listTokensImpl(pad: string): Promise<PadToken[]> {

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
          logo: l.icon || s?.logoURI || null,
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
          logo: t.logoURI ?? null,
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
        logo: c.imageURI ?? null,
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
          logo: t.image_uri ?? null,
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
