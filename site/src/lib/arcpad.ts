/**
 * ArcPad launchpad server access: on-chain list/token reads + D1 metadata
 * (logo image, socials) keyed by token address.
 */
import { createServerFn } from "@tanstack/react-start";

import { decodeString, memo, multicall, pad32, padNum, quoteUsd, rpc, toNum, topicAddr } from "./arc-api";
import { bindings } from "./bindings.server";
import { ipfsToHttp, normSocial, screenerIcons } from "@/lib/arc-api";

export const PAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE";        // v2 (USDC-only, no graduation)
export const PAD_V3 = "0x2726AeC64D8a9BC41B9940dDA5D21c889458B348";     // v3 (quote tokens, modes, graduation)
const SEL_LAUNCH = "0x214013ca";
const USDC_FACADE = "0x3600000000000000000000000000000000000000";
export const VAULT = "0x48aDA931C2C220B074c39449B7e70860A3B4C277";     // v3 (pad v3 fees + drops)
export const VAULT_V2 = "0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd";  // legacy: v2 fees + old drops, withdraw/claim only
export const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";

// keccak selectors (computed from the deployed ABI)
export const SEL = {
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  balanceOf: "0x70a08231",
  buy: "0xcce7ec13",
  claimDrop: "0x75bf81d6",
  claimRewards: "0xef5cfb8c",
  claimUsdc: "0x1d6ee8eb",
  claimable: "0xd4570c1c",
  claimableDrop: "0x05d45856",
  claimableUsdc: "0x55d2ac86",
  createToken: "0xa3059b23",
  curve: "0x06d8d7db",
  dropCount: "0x66c14e0a",
  drops: "0x5eb39968",
  meta: "0xe021deff",
  name: "0x06fdde03",
  quoteBuy: "0x0d7a94f6",
  quoteSell: "0xd98b2f5c",
  sell: "0x6a272462",
  stake: "0xa694fc3a",
  staked: "0x98807d84",
  symbol: "0x95d89b41",
  tokenCount: "0x9f181b5e",
  tokens: "0x4f64b2be",
  totalStaked: "0x817b1cd2",
  withdraw: "0x2e1a7d4d",
} as const;

export type PadListItem = {
  token: string;
  name: string;
  symbol: string;
  volumeUsdc: number;
  txCount: number;
  usdcReal: number;
  pricePer1M: number;
  createdAt: number | null;
  image: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  pad?: string;
  pool?: string | null;
  graduated?: boolean;
  mode?: "v2" | "curve" | "instant";
  quoteToken?: string | null;
  quoteSymbol?: string;
  quoteUsd?: number;
  targetQuote?: number;
};

const VIRTUAL = 3000;
// tokeny testowe z deployu v3.1 (INST0/INST1) — istnieja on-chain, ale nie pokazujemy ich w listach
const HIDDEN_TOKENS = new Set(["0x15ec9b3df7d76f82029ea88034164b2ee74d5794", "0x49a8aca95c27550fc9f1e1b00ab4dcaa9fb095b5"]);

let described = false;
async function ensureTable() {
  const db = bindings().DB;
  if (!db) return null;
  await db.exec(
    "CREATE TABLE IF NOT EXISTS pad_meta (token TEXT PRIMARY KEY, name TEXT, symbol TEXT, website TEXT, twitter TEXT, telegram TEXT, image TEXT, creator TEXT, created_at INTEGER)",
  );
  if (!described) {
    // description arrived later (ArcOne launch form); ALTER fails once the column exists, which is fine
    try { await db.exec("ALTER TABLE pad_meta ADD COLUMN description TEXT"); } catch { /* already there */ }
    described = true;
  }
  return db;
}

async function metaRows(tokens: string[], lightImage = false): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  try {
    const db = await ensureTable();
    if (!db || tokens.length === 0) return out;
    const qs = tokens.map(() => "?").join(",");
    // W listach nie ciagniemy calego data-URI (24 KB/token!) — tylko flage,
    // a obraz serwuje /api/pad-logo/<token> (cache w przegladarce).
    const cols = lightImage
      ? "token, name, symbol, website, twitter, telegram, creator, created_at, " +
        "CASE WHEN image IS NOT NULL AND image != '' THEN 1 ELSE 0 END AS has_image"
      : "*";
    const res = await db
      .prepare(`SELECT ${cols} FROM pad_meta WHERE token IN (${qs})`)
      .bind(...tokens.map((t) => t.toLowerCase()))
      .all();
    for (const r of res.results ?? []) out.set(String((r as { token: string }).token), r as Record<string, unknown>);
  } catch {
    /* D1 unavailable: metadata degrades gracefully */
  }
  return out;
}

/** All launched tokens with stats + metadata (30s cache). */
let _lastListLen = 0;
const _lastCount = new Map<string, number>();
async function padAddrs(pad: string): Promise<string[]> {
  // a relay hiccup here silently shrinks the launchpad → retry, and never accept fewer tokens than last time (count only grows)
  for (let attempt = 0; attempt < 3; attempt++) {
    const countHex = await rpc("eth_call", [{ data: SEL.tokenCount, to: pad }, "latest"]).catch(() => null);
    const n = Number(toNum(countHex as string | null));
    if (n >= (_lastCount.get(pad) ?? 0) && n > 0) {
      const res = await multicall(Array.from({ length: n }, (_, i) => ({ data: SEL.tokens + padNum(BigInt(i)), target: pad })), 200);
      const addrs = res.map((r) => (r ? topicAddr(r) : null)).filter(Boolean) as string[];
      if (addrs.length === n) { _lastCount.set(pad, n); return addrs; }
    } else if (n === 0 && (_lastCount.get(pad) ?? 0) === 0 && attempt === 2) return [];
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("padAddrs: relay unstable");
}

export const padList = createServerFn({ method: "POST" }).handler(() =>
  memo("padlist", 45_000, async (): Promise<PadListItem[]> => {
    const [a2, a3] = await Promise.all([padAddrs(PAD), padAddrs(PAD_V3)]);
    const owners = [...a2.map((a) => [a, PAD] as const), ...a3.map((a) => [a, PAD_V3] as const)]
      .filter(([a]) => !HIDDEN_TOKENS.has(a.toLowerCase()));
    const addrs = owners.map((o) => o[0]);
    if (addrs.length === 0) return [];

    // a dropped multicall chunk (relay 502) must not produce "?" rows that then get cached: retry any all-null batch once
    const mc = async (calls: { data: string; target: string }[], chunk: number) => {
      let r = await multicall(calls, chunk);
      if (calls.length && r.every((x) => x === null)) { await new Promise((res) => setTimeout(res, 300)); r = await multicall(calls, chunk); }
      return r;
    };
    const [curveRes, nameRes, symRes, launchRes, metas, icons, chainMeta] = await Promise.all([
      mc(owners.map(([a, pad]) => ({ data: SEL.curve + pad32(a), target: pad })), 150),
      mc(addrs.map((a) => ({ data: SEL.name, target: a })), 200),
      mc(addrs.map((a) => ({ data: SEL.symbol, target: a })), 200),
      mc(a3.map((a) => ({ data: SEL_LAUNCH + pad32(a), target: PAD_V3 })), 150),
      metaRows(addrs, true),
      screenerIcons().catch(() => new Map<string, string>()),
      mc(owners.map(([a, pad]) => ({ data: SEL.meta + pad32(a), target: pad })), 100),
    ]);
    // on-chain Meta(token, creator, mktWallet, 3×bps, website, twitter, telegram, createdAt, rewardToken) — fallback when D1 has nothing
    const onchain = (i: number) => {
      const h = chainMeta[i];
      if (!h || h.length < 2 + 64 * 11) return null;
      const w = (j: number) => h.slice(2 + j * 64, 2 + (j + 1) * 64);
      const str = (j: number) => { try { const off = parseInt(w(j), 16) * 2; const len = parseInt(h.slice(2 + off, 2 + off + 64), 16); return Buffer.from(h.slice(2 + off + 64, 2 + off + 64 + len * 2), "hex").toString("utf8"); } catch { return ""; } };
      return { website: str(6), twitter: str(7), telegram: str(8), createdAt: parseInt(w(9), 16) || null, creator: topicAddr(w(1)) };
    };
    // quote tokens (v3): symbol + USD price, once per distinct token
    const launchByAddr = new Map<string, string | null>();
    a3.forEach((a, i) => launchByAddr.set(a.toLowerCase(), launchRes[i] ?? null));
    const quoteOf = (a: string): string | null => {
      const l = launchByAddr.get(a.toLowerCase());
      if (!l || l.length < 2 + 64) return null;
      const q = topicAddr("0x" + l.slice(2, 66));
      return !q || /^0x0{40}$/.test(q) || q.toLowerCase() === USDC_FACADE ? null : q.toLowerCase();
    };
    const quotes = [...new Set(a3.map(quoteOf).filter(Boolean) as string[])];
    const [qSyms, qUsd] = await Promise.all([
      multicall(quotes.map((q) => ({ data: SEL.symbol, target: q })), 50),
      Promise.all(quotes.map((q) => quoteUsd(q))),
    ]);
    const qInfo = new Map(quotes.map((q, i) => [q, { sym: decodeString(qSyms[i]) || "?", usd: qUsd[i] }]));

    return owners.map(([a, pad], i) => {
      const c = curveRes[i];
      let quoteReserve = 0n, tokenReserve = 0n, vol = 0n, txc = 0n;
      if (c && c.length >= 2 + 64 * 4) {
        const w = (j: number) => BigInt("0x" + c.slice(2 + j * 64, 2 + (j + 1) * 64));
        quoteReserve = w(0); tokenReserve = w(1); vol = w(2); txc = w(3);
      }
      const isV3 = pad === PAD_V3;
      const l = isV3 ? launchByAddr.get(a.toLowerCase()) : null;
      const lw = (j: number) => (l && l.length >= 2 + 64 * (j + 1) ? BigInt("0x" + l.slice(2 + j * 64, 2 + (j + 1) * 64)) : 0n);
      const quote = isV3 ? quoteOf(a) : null;
      const qi = quote ? qInfo.get(quote) : undefined;
      const qusd = quote ? (qi?.usd ?? 0) : 1;
      const graduated = isV3 && lw(5) === 1n;
      const pool = isV3 && lw(6) !== 0n ? topicAddr("0x" + l!.slice(2 + 6 * 64, 2 + 7 * 64)) : null;
      const virtualQ = isV3 ? Number(lw(4) / 10n ** 12n) / 1e6 : VIRTUAL;
      const m = metas.get(a.toLowerCase());
      const oc = onchain(i);
      // price in quote units per 1M tokens -> USD
      const price1mQuote = tokenReserve > 0n ? Number((quoteReserve * 1_000_000_000_000n) / tokenReserve) / 1e6 : 0;
      return {
        createdAt: (m ? Number(m.created_at ?? 0) || null : null) ?? oc?.createdAt ?? null,
        graduated,
        image: m?.has_image ? `/api/pad-logo/${a.toLowerCase()}` : ipfsToHttp(icons.get(a.toLowerCase()) ?? ""),
        mode: !isV3 ? "v2" : lw(2) === 1n ? "instant" : "curve",
        name: decodeString(nameRes[i]),
        pad,
        pool,
        pricePer1M: price1mQuote * qusd,
        quoteSymbol: quote ? (qi?.sym ?? "?") : "USDC",
        quoteToken: quote,
        quoteUsd: qusd,
        symbol: decodeString(symRes[i]),
        targetQuote: isV3 ? Number(lw(3) / 10n ** 12n) / 1e6 : 0,
        telegram: normSocial("tg", (m?.telegram as string) || oc?.telegram || null),
        token: a,
        twitter: normSocial("x", (m?.twitter as string) || oc?.twitter || null),
        txCount: Number(txc),
        usdcReal: Math.max(0, (Number(quoteReserve / 10n ** 12n) / 1e6 - virtualQ) * qusd),
        volumeUsdc: (Number(vol / 10n ** 12n) / 1e6) * qusd,
        website: normSocial("web", (m?.website as string) || oc?.website || null),
      };
    });
  // never cache a list where the relay dropped names/symbols ("?") — recompute on the next call instead
  }, (v) => v.length > 0 && v.length >= _lastListLen && v.every((x) => x.symbol !== "?" && x.name !== "?") && !!(_lastListLen = v.length)),
);

export type PadTokenPage = PadListItem & {
  padAddress: string;
  marketingBps: number;
  rewardsBps: number;
  burnBps: number;
  creator: string | null;
};

/** Single token page data (5s cache). */
export const padToken = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<PadTokenPage | { error: string }> => {
    const token = data.token.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return { error: "bad address" };
    return memo(`padtoken:${token.toLowerCase()}`, 5_000, async () => {
      // ktory pad zna ten token? v3 ma wpis w launch(), v2 — niezerowa curve
      const launchHex = (await rpc("eth_call", [{ data: SEL_LAUNCH + pad32(token), to: PAD_V3 }, "latest"]).catch(() => null)) as string | null;
      const isV3 = !!launchHex && launchHex.length >= 2 + 64 * 8 && BigInt("0x" + launchHex.slice(2 + 3 * 64, 2 + 4 * 64)) > 0n;
      const padAddr = isV3 ? PAD_V3 : PAD;
      const [curveHex, metaHex, nameHex, symHex] = await Promise.all([
        rpc("eth_call", [{ data: SEL.curve + pad32(token), to: padAddr }, "latest"]).catch(() => null),
        rpc("eth_call", [{ data: SEL.meta + pad32(token), to: padAddr }, "latest"]).catch(() => null),
        rpc("eth_call", [{ data: SEL.name, to: token }, "latest"]).catch(() => null),
        rpc("eth_call", [{ data: SEL.symbol, to: token }, "latest"]).catch(() => null),
      ]);
      if (!curveHex) return { error: "token not found" };
      const w = (hex: string, j: number) => BigInt("0x" + hex.slice(2 + j * 64, 2 + (j + 1) * 64));
      const usdcReserve = w(curveHex as string, 0);
      const tokenReserve = w(curveHex as string, 1);
      if (tokenReserve === 0n && !isV3) return { error: "not an ArcToolsPad token" };

      let marketingBps = 0;
      let rewardsBps = 0;
      let burnBps = 0;
      let creator: string | null = null;
      if (metaHex && (metaHex as string).length >= 2 + 64 * 10) {
        creator = topicAddr((metaHex as string).slice(2 + 1 * 64, 2 + 2 * 64));
        marketingBps = Number(w(metaHex as string, 3));
        rewardsBps = Number(w(metaHex as string, 4));
        burnBps = Number(w(metaHex as string, 5));
      }
      const metas = await metaRows([token]);
      const m = metas.get(token.toLowerCase());
      return {
        padAddress: padAddr,
        pad: padAddr,
        quoteToken: null, quoteSymbol: "USDC", quoteUsd: 1, graduated: false, pool: null, targetQuote: 0, mode: isV3 ? "curve" : "v2",
        burnBps,
        createdAt: m ? Number(m.created_at ?? 0) || null : null,
        creator,
        image: (m?.image as string) || null,
        marketingBps,
        name: decodeString(nameHex as string | null),
        pricePer1M: tokenReserve > 0n ? Number((usdcReserve * 1_000_000_000_000n) / tokenReserve) / 1e6 : 0,
        rewardsBps,
        symbol: decodeString(symHex as string | null),
        telegram: normSocial("tg", (m?.telegram as string) || null),
        token,
        twitter: normSocial("x", (m?.twitter as string) || null),
        txCount: Number(w(curveHex as string, 3)),
        usdcReal: Math.max(0, Number(usdcReserve / 10n ** 12n) / 1e6 - VIRTUAL),
        volumeUsdc: Number(w(curveHex as string, 2) / 10n ** 12n) / 1e6,
        website: normSocial("web", (m?.website as string) || null),
      };
    });
  });

/** Store metadata for a launched token (called right after creation). */
export const padMetaSet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      token: string;
      name: string;
      symbol: string;
      website?: string;
      twitter?: string;
      telegram?: string;
      image?: string;
      creator?: string;
      description?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const token = (data.token ?? "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(token)) return { ok: false, reason: "bad token" };
    const img = data.image ?? "";
    if (img && (!img.startsWith("data:image/") || img.length > 200_000)) {
      return { ok: false, reason: "bad image" };
    }
    const clean = (s?: string) => (s ?? "").slice(0, 200);
    // verify on-chain: the token must exist on the pad and the submitted
    // creator must match the on-chain creator (metadata is creator-owned)
    try {
      // v3.1 first (current launches), then the legacy v2 pad
      let metaHex = "";
      for (const padAddr of [PAD_V3, PAD]) {
        const h = (await rpc("eth_call", [{ data: SEL.meta + pad32(token), to: padAddr }, "latest"]).catch(() => null)) as string | null;
        if (h && h.length >= 2 + 64 * 2 && topicAddr(h.slice(2, 66)).toLowerCase() === token) { metaHex = h; break; }
      }
      if (!metaHex) return { ok: false, reason: "unknown token" };
      const onchainToken = topicAddr(metaHex.slice(2, 66)).toLowerCase();
      const onchainCreator = topicAddr(metaHex.slice(2 + 64, 2 + 128)).toLowerCase();
      if (onchainToken !== token) return { ok: false, reason: "unknown token" };
      if (clean(data.creator).toLowerCase() !== onchainCreator) {
        return { ok: false, reason: "only the token creator can set metadata" };
      }
    } catch {
      return { ok: false, reason: "chain read failed, try again" };
    }
    try {
      const db = await ensureTable();
      if (!db) return { ok: false, reason: "storage offline" };
      await db
        .prepare(
          "INSERT INTO pad_meta (token,name,symbol,website,twitter,telegram,image,creator,created_at,description) VALUES (?,?,?,?,?,?,?,?,?,?) " +
            "ON CONFLICT(token) DO UPDATE SET website=excluded.website, twitter=excluded.twitter, telegram=excluded.telegram, " +
            "image=CASE WHEN excluded.image != '' THEN excluded.image ELSE pad_meta.image END, " +
            "description=CASE WHEN excluded.description != '' THEN excluded.description ELSE pad_meta.description END",
        )
        .bind(
          token,
          clean(data.name),
          clean(data.symbol),
          // zapisujemy juz znormalizowane absolutne URL-e (tworcy wpisuja "x.com/foo", "t.me/foo")
          normSocial("web", clean(data.website)) ?? "",
          normSocial("x", clean(data.twitter)) ?? "",
          normSocial("tg", clean(data.telegram)) ?? "",
          img,
          clean(data.creator).toLowerCase(),
          Math.floor(Date.now() / 1000),
          (data.description ?? "").slice(0, 280),
        )
        .run();
      return { ok: true };
    } catch {
      return { ok: false, reason: "storage write failed" };
    }
  });

const TRADE_TOPIC = "0x9adcf0ad0cda63c4d50f26a48925cf6405df27d422a39c456b5f03f661c82982";

/** getLogs for one block window with one retry; null = failed (vs [] = empty). */
async function tradeLogs(
  from: number,
  to: number,
  extraTopics: string[] = [],
): Promise<{ topics: string[]; data: string; blockNumber: string }[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await rpc("eth_getLogs", [
        {
          address: PAD,
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
          topics: [TRADE_TOPIC, ...extraTopics],
        },
      ])) as { topics: string[]; data: string; blockNumber: string }[];
    } catch {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  return null;
}

export type PadChartPoint = { block: number; price: number };

/** Price points from the launchpad's Trade events (price of 1M tokens in USDC). */
export const padChart = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(({ data }) =>
    memo(`padchart:${data.token.toLowerCase()}`, 60_000, async (): Promise<PadChartPoint[]> => {
      const token = data.token.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return [];
      const head = Number(toNum((await rpc("eth_blockNumber", [])) as string));
      const lo = Math.max(0, head - 200_000);
      const chunks: { from: number; to: number }[] = [];
      for (let b = lo; b <= head; b += 10_000) chunks.push({ from: b, to: Math.min(b + 9_999, head) });
      const results: unknown[][] = [];
      let failed = 0;
      for (let i = 0; i < chunks.length; i += 4) {
        const part = await Promise.all(
          chunks.slice(i, i + 4).map((c) => tradeLogs(c.from, c.to, ["0x" + pad32(token)])),
        );
        for (const p of part) {
          if (p === null) failed += 1;
          else results.push(p);
        }
      }
      const points: PadChartPoint[] = [];
      for (const logs of results as { blockNumber: string; data: string }[][]) {
        for (const l of logs) {
          try {
            const body = l.data.replace(/^0x/, "");
            const w = (j: number) => BigInt("0x" + body.slice(j * 64, (j + 1) * 64));
            const isBuy = w(0) === 1n;
            const usdc = isBuy ? w(1) : w(2);
            const toks = isBuy ? w(4) : w(3);
            if (usdc > 0n && toks > 0n) {
              const price1m = Number((usdc * 1_000_000_000_000n) / toks) / 1e6;
              if (Number.isFinite(price1m) && price1m > 0) {
                points.push({ block: Number(toNum(l.blockNumber)), price: price1m });
              }
            }
          } catch {
            /* skip */
          }
        }
      }
      // failed windows + nothing found: do NOT cache an empty chart as truth
      if (points.length === 0 && failed > 0) throw new Error("chart scan incomplete");
      points.sort((a, b) => a.block - b.block);
      return points.slice(-400);
    }),
  );

/** Recent buys across the whole launchpad + top-3 trending: the site ticker. */
export const padTicker = createServerFn({ method: "POST" }).handler(() =>
  memo("padticker", 10_000, async () => {
    try {
      const head = Number(toNum((await rpc("eth_blockNumber", [])) as string));
      // eth_getLogs caps the range at 10k blocks: scan the last 30k in 3 chunks
      const chunks = [0, 1, 2].map((i) => ({
        from: Math.max(0, head - (i + 1) * 10_000 + 1),
        to: head - i * 10_000,
      }));
      const parts = await Promise.all(chunks.map((c) => tradeLogs(c.from, c.to)));
      const logs = parts.filter(Boolean).flat() as { topics: string[]; data: string; blockNumber: string }[];
      const buys: { token: string; usdc: number; block: number }[] = [];
      for (const l of logs) {
        const body = l.data.replace(/^0x/, "");
        const w = (j: number) => BigInt("0x" + body.slice(j * 64, (j + 1) * 64));
        if (w(0) !== 1n) continue;
        buys.push({
          block: Number(toNum(l.blockNumber)),
          token: topicAddr(l.topics[1]),
          usdc: Number(w(1) / 10n ** 12n) / 1e6,
        });
      }
      buys.sort((a, b) => b.block - a.block);
      const recent = buys.slice(0, 14);
      const uniq = [...new Set(recent.map((b) => b.token))];
      const syms = await multicall(uniq.map((t) => ({ data: SEL.symbol, target: t })), 40);
      const symMap = new Map(uniq.map((t, i) => [t.toLowerCase(), decodeString(syms[i])]));
      const list = await padList();
      const top = [...list].sort((a, b) => b.volumeUsdc - a.volumeUsdc).slice(0, 3);
      return {
        buys: recent.map((b) => ({
          symbol: symMap.get(b.token.toLowerCase()) ?? "?",
          token: b.token,
          usdc: b.usdc,
        })),
        trending: top.map((t, i) => ({
          mcap: t.pricePer1M * 1000,
          rank: i + 1,
          symbol: t.symbol,
          token: t.token,
        })),
      };
    } catch {
      return { buys: [], trending: [] };
    }
  }),
);

export type PadTrade = {
  side: "buy" | "sell";
  usdc: number;
  tokens: number;
  trader: string;
  block: number;
};

/** Last trades of one token (newest first). */
export const padTrades = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(({ data }) =>
    memo(`padtrades:${data.token.toLowerCase()}`, 10_000, async (): Promise<PadTrade[]> => {
      const token = data.token.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return [];
      try {
        const head = Number(toNum((await rpc("eth_blockNumber", [])) as string));
        const out: PadTrade[] = [];
        // 10k getLogs cap: scan the last 100k blocks in parallel batches of 5
        const windows: { from: number; to: number }[] = [];
        for (let hi = head; hi > Math.max(0, head - 100_000); hi -= 10_000) {
          windows.push({ from: Math.max(0, hi - 9_999), to: hi });
        }
        for (let i = 0; i < windows.length && out.length < 25; i += 5) {
          const parts = await Promise.all(
            windows.slice(i, i + 5).map((c) => tradeLogs(c.from, c.to, ["0x" + pad32(token)])),
          );
          const logs = parts.filter(Boolean).flat() as { topics: string[]; data: string; blockNumber: string }[];
          logs.sort((a, b) => Number(toNum(b.blockNumber)) - Number(toNum(a.blockNumber)));
          for (const l of logs) {
            const body = l.data.replace(/^0x/, "");
            const w = (j: number) => BigInt("0x" + body.slice(j * 64, (j + 1) * 64));
            const isBuy = w(0) === 1n;
            out.push({
              block: Number(toNum(l.blockNumber)),
              side: isBuy ? "buy" : "sell",
              tokens: Number((isBuy ? w(4) : w(3)) / 10n ** 12n) / 1e6,
              trader: topicAddr(l.topics[2]),
              usdc: Number((isBuy ? w(1) : w(2)) / 10n ** 12n) / 1e6,
            });
            if (out.length >= 25) break;
          }
        }
        return out;
      } catch {
        return [];
      }
    }),
  );

/** Holder count + top holders from the arc-scan indexer. */
export const padHolders = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(({ data }) =>
    memo(`padholders:${data.token.toLowerCase()}`, 30_000, async () => {
      const token = data.token.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return { count: 0, top: [] as { address: string; pct: number }[] };
      try {
        const r = (await (
          await fetch(`https://api.arc-scan.org/v1/tokens/${token}/holders`, {
            headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" },
          })
        ).json()) as {
          items?: { address?: { address?: string }; balance?: { raw?: string } }[];
          total?: number;
        };
        const items = r.items ?? [];
        const SUP = 10n ** 27n; // 1B * 1e18
        const top = items.slice(0, 10).map((h) => ({
          address: h.address?.address ?? "?",
          pct: Number((BigInt(h.balance?.raw ?? "0") * 10_000n) / SUP) / 100,
        }));
        return { count: r.total ?? items.length, top };
      } catch {
        return { count: 0, top: [] };
      }
    }),
  );

// ---- gas faucet: first launches on us (capped in D1) ----
const FAUCET_RELAY = "https://rpc-production-ba7a.up.railway.app/faucet";
const MAX_GAS_CLAIMS = 6; // 1 slot zuzyty na test e2e + 5 dla userow

async function claimsTable() {
  const db = bindings().DB;
  if (!db) return null;
  await db.exec(
    "CREATE TABLE IF NOT EXISTS gas_claims (wallet TEXT PRIMARY KEY, tx TEXT, ts INTEGER)",
  );
  return db;
}

/** How many free-gas claims are left + whether this wallet already claimed. */
export const gasStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { wallet?: string }) => input)
  .handler(async ({ data }) => {
    try {
      const db = await claimsTable();
      if (!db) return { claimed: false, left: 0 };
      const n = ((await db.prepare("SELECT COUNT(*) AS n FROM gas_claims").first()) as { n: number }).n;
      let claimed = false;
      if (data.wallet && /^0x[0-9a-fA-F]{40}$/.test(data.wallet)) {
        claimed = !!(await db
          .prepare("SELECT 1 FROM gas_claims WHERE wallet = ?")
          .bind(data.wallet.toLowerCase())
          .first());
      }
      return { claimed, left: Math.max(0, MAX_GAS_CLAIMS - n) };
    } catch {
      return { claimed: false, left: 0 };
    }
  });

/** Send 0.2 USDC launch gas to the wallet (once per wallet, global cap). */
export const gasClaim = createServerFn({ method: "POST" })
  .inputValidator((input: { wallet: string }) => input)
  .handler(async ({ data }) => {
    const wallet = (data.wallet ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { ok: false, reason: "bad wallet" };
    const auth = bindings().FAUCET_AUTH;
    if (!auth) return { ok: false, reason: "faucet offline" };
    const db = await claimsTable();
    if (!db) return { ok: false, reason: "storage offline" };
    const key = wallet.toLowerCase();
    const n = ((await db.prepare("SELECT COUNT(*) AS n FROM gas_claims").first()) as { n: number }).n;
    if (n >= MAX_GAS_CLAIMS) return { ok: false, reason: "all free-gas slots are gone" };
    const dupe = await db.prepare("SELECT 1 FROM gas_claims WHERE wallet = ?").bind(key).first();
    if (dupe) return { ok: false, reason: "this wallet already claimed" };
    // reserve the slot BEFORE sending (no double spends on races)
    await db
      .prepare("INSERT INTO gas_claims (wallet, tx, ts) VALUES (?, '', ?)")
      .bind(key, Math.floor(Date.now() / 1000))
      .run();
    try {
      const r = (await (
        await fetch(FAUCET_RELAY, {
          body: JSON.stringify({ wallet }),
          headers: { "Content-Type": "application/json", "X-Faucet-Auth": auth },
          method: "POST",
        })
      ).json()) as { ok: boolean; tx?: string; reason?: string };
      if (!r.ok) {
        await db.prepare("DELETE FROM gas_claims WHERE wallet = ?").bind(key).run();
        return { ok: false, reason: r.reason ?? "send failed" };
      }
      await db.prepare("UPDATE gas_claims SET tx = ? WHERE wallet = ?").bind(r.tx ?? "", key).run();
      return { ok: true, tx: r.tx };
    } catch {
      await db.prepare("DELETE FROM gas_claims WHERE wallet = ?").bind(key).run();
      return { ok: false, reason: "faucet unreachable" };
    }
  });

// ---- Arc Insider: smart-money leaderboard (data from the buybot API) ----
const INSIDER_API = "https://bot-production-4200.up.railway.app";

export type InsiderRow = {
  wallet: string;
  pnl_total: number;
  pnl_realized: number;
  pnl_unrealized: number;
  pnl_pct: number;
  winrate: number;
  trades: number;
  closed: number;
  open_positions: number;
  volume: number;
  best_symbol: string;
  best_pnl: number;
  last_trade: number;
};

export const insiderBoard = createServerFn({ method: "POST" })
  .inputValidator((input: { range?: string }) => input)
  .handler(({ data }) =>
    memo(`insiders:${data.range ?? "30d"}`, 30_000, async (): Promise<InsiderRow[]> => {
      try {
        const r = (await (
          await fetch(`${INSIDER_API}/api/insiders?range=${encodeURIComponent(data.range ?? "30d")}`, {
            headers: { Accept: "application/json" },
          })
        ).json()) as { rows?: InsiderRow[] };
        return (r.rows ?? []).map((x) => ({
          best_pnl: Number(x.best_pnl ?? 0),
          best_symbol: String(x.best_symbol ?? ""),
          closed: Number(x.closed ?? 0),
          last_trade: Number(x.last_trade ?? 0),
          open_positions: Number(x.open_positions ?? 0),
          pnl_pct: Number(x.pnl_pct ?? 0),
          pnl_realized: Number(x.pnl_realized ?? 0),
          pnl_total: Number(x.pnl_total ?? 0),
          pnl_unrealized: Number(x.pnl_unrealized ?? 0),
          trades: Number(x.trades ?? 0),
          volume: Number(x.volume ?? 0),
          wallet: String(x.wallet ?? ""),
          winrate: Number(x.winrate ?? 0),
        }));
      } catch {
        return [];
      }
    }),
  );

/** Vault stats for the rewards page. */
export const vaultInfo = createServerFn({ method: "POST" })
  .inputValidator((input: { user?: string }) => input)
  .handler(async ({ data }) => {
    const user = data.user && /^0x[0-9a-fA-F]{40}$/.test(data.user) ? data.user : null;
    const calls: { data: string; target: string }[] = [
      { data: SEL.totalStaked, target: VAULT },
      { data: SEL.dropCount, target: VAULT },
      { data: SEL.balanceOf + pad32(VAULT), target: ARCT },
    ];
    if (user) {
      calls.push({ data: SEL.staked + pad32(user), target: VAULT });
      calls.push({ data: SEL.claimableUsdc + pad32(user), target: VAULT });
      calls.push({ data: SEL.balanceOf + pad32(user), target: ARCT });
      calls.push({ data: SEL.staked + pad32(user), target: VAULT_V2 });          // 6 legacy stake
      calls.push({ data: SEL.claimableUsdc + pad32(user), target: VAULT_V2 });   // 7 legacy usdc
    }
    const legacyIdx = calls.length;
    calls.push({ data: SEL.totalStaked, target: VAULT_V2 });   // legacy vault total (still earning v2 fees)
    const res = await multicall(calls, 50);
    const num = (i: number, dec = 18) => (res[i] ? Number(toNum(res[i]) / 10n ** BigInt(dec - 6)) / 1e6 : 0);
    const dropN = res[1] ? Number(toNum(res[1])) : 0;

    // drops list + user claims — from BOTH vaults (legacy v2 drops stay claimable there)
    const drops = [] as { id: number; token: string; amount: number; claimable: number; symbol: string; vault: string; legacy: boolean }[];
    const legacyCountHex = await rpc("eth_call", [{ data: SEL.dropCount, to: VAULT_V2 }, "latest"]).catch(() => null);
    const vaults: [string, number, boolean][] = [[VAULT, dropN, false], [VAULT_V2, legacyCountHex ? Number(toNum(legacyCountHex as string)) : 0, true]];
    for (const [vaddr, count, legacy] of vaults) {
      const n = Math.min(count, 50);
      if (n === 0) continue;
      const dropCalls: { data: string; target: string }[] = [];
      for (let i = 0; i < n; i++) {
        dropCalls.push({ data: SEL.drops + padNum(BigInt(i)), target: vaddr });
        if (user) dropCalls.push({ data: SEL.claimableDrop + padNum(BigInt(i)) + pad32(user), target: vaddr });
      }
      const dropRes = await multicall(dropCalls, 60);
      const per = user ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const d = dropRes[i * per];
        if (!d) continue;
        const w = (j: number) => BigInt("0x" + d.slice(2 + j * 64, 2 + (j + 1) * 64));
        drops.push({
          amount: Number(w(2) / 10n ** 12n) / 1e6,
          claimable: user && dropRes[i * per + 1] ? Number(toNum(dropRes[i * per + 1]) / 10n ** 12n) / 1e6 : 0,
          id: i, legacy, symbol: "", token: topicAddr(d.slice(2, 66)), vault: vaddr,
        });
      }
    }
    if (drops.length > 0) {
      const syms = await multicall(drops.map((d) => ({ data: SEL.symbol, target: d.token })), 60);
      drops.forEach((d, i) => (d.symbol = decodeString(syms[i])));
    }
    return {
      arctInVault: num(2),
      drops,
      legacyClaimableUsdc: user ? num(7) : 0,
      legacyStaked: user ? num(6) : 0,
      legacyTotalStaked: num(legacyIdx),
      totalStaked: num(0),
      userArct: user ? num(5) : 0,
      userClaimableUsdc: user ? num(4) : 0,
      userStaked: user ? num(3) : 0,
    };
  });
