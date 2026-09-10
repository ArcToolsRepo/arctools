/**
 * ArcPad launchpad server access: on-chain list/token reads + D1 metadata
 * (logo image, socials) keyed by token address.
 */
import { createServerFn } from "@tanstack/react-start";

import { decodeString, memo, multicall, pad32, padNum, rpc, toNum, topicAddr } from "./arc-api";
import { bindings } from "./bindings.server";

export const PAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE";
export const VAULT = "0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd";
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
};

const VIRTUAL = 3000;

async function ensureTable() {
  const db = bindings().DB;
  if (!db) return null;
  await db.exec(
    "CREATE TABLE IF NOT EXISTS pad_meta (token TEXT PRIMARY KEY, name TEXT, symbol TEXT, website TEXT, twitter TEXT, telegram TEXT, image TEXT, creator TEXT, created_at INTEGER)",
  );
  return db;
}

async function metaRows(tokens: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  try {
    const db = await ensureTable();
    if (!db || tokens.length === 0) return out;
    const qs = tokens.map(() => "?").join(",");
    const res = await db
      .prepare(`SELECT * FROM pad_meta WHERE token IN (${qs})`)
      .bind(...tokens.map((t) => t.toLowerCase()))
      .all();
    for (const r of res.results ?? []) out.set(String((r as { token: string }).token), r as Record<string, unknown>);
  } catch {
    /* D1 unavailable: metadata degrades gracefully */
  }
  return out;
}

/** All launched tokens with stats + metadata (30s cache). */
export const padList = createServerFn({ method: "POST" }).handler(() =>
  memo("padlist", 15_000, async (): Promise<PadListItem[]> => {
    const countHex = await rpc("eth_call", [{ data: SEL.tokenCount, to: PAD }, "latest"]);
    const n = Number(toNum(countHex as string));
    if (n === 0) return [];
    const idxCalls = Array.from({ length: n }, (_, i) => ({
      data: SEL.tokens + padNum(BigInt(i)),
      target: PAD,
    }));
    const addrRes = await multicall(idxCalls, 200);
    const addrs = addrRes.map((r) => (r ? topicAddr(r) : null)).filter(Boolean) as string[];

    // independent reads in parallel: curve stats, names, symbols, D1 metadata
    const [curveRes, nameRes, symRes, metas] = await Promise.all([
      multicall(addrs.map((a) => ({ data: SEL.curve + pad32(a), target: PAD })), 150),
      multicall(addrs.map((a) => ({ data: SEL.name, target: a })), 200),
      multicall(addrs.map((a) => ({ data: SEL.symbol, target: a })), 200),
      metaRows(addrs),
    ]);

    return addrs.map((a, i) => {
      const c = curveRes[i];
      let usdcReserve = 0n;
      let tokenReserve = 0n;
      let vol = 0n;
      let txc = 0n;
      if (c && c.length >= 2 + 64 * 4) {
        const w = (j: number) => BigInt("0x" + c.slice(2 + j * 64, 2 + (j + 1) * 64));
        usdcReserve = w(0);
        tokenReserve = w(1);
        vol = w(2);
        txc = w(3);
      }
      const m = metas.get(a.toLowerCase());
      const price1m = tokenReserve > 0n ? Number((usdcReserve * 1_000_000_000_000n) / tokenReserve) / 1e6 : 0;
      return {
        createdAt: m ? Number(m.created_at ?? 0) || null : null,
        image: (m?.image as string) || null,
        name: decodeString(nameRes[i]),
        pricePer1M: price1m,
        symbol: decodeString(symRes[i]),
        telegram: (m?.telegram as string) || null,
        token: a,
        twitter: (m?.twitter as string) || null,
        txCount: Number(txc),
        usdcReal: Math.max(0, Number(usdcReserve / 10n ** 12n) / 1e6 - VIRTUAL),
        volumeUsdc: Number(vol / 10n ** 12n) / 1e6,
        website: (m?.website as string) || null,
      };
    });
  }),
);

export type PadTokenPage = PadListItem & {
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
      const [curveHex, metaHex, nameHex, symHex] = await Promise.all([
        rpc("eth_call", [{ data: SEL.curve + pad32(token), to: PAD }, "latest"]).catch(() => null),
        rpc("eth_call", [{ data: SEL.meta + pad32(token), to: PAD }, "latest"]).catch(() => null),
        rpc("eth_call", [{ data: SEL.name, to: token }, "latest"]).catch(() => null),
        rpc("eth_call", [{ data: SEL.symbol, to: token }, "latest"]).catch(() => null),
      ]);
      if (!curveHex) return { error: "token not found" };
      const w = (hex: string, j: number) => BigInt("0x" + hex.slice(2 + j * 64, 2 + (j + 1) * 64));
      const usdcReserve = w(curveHex as string, 0);
      const tokenReserve = w(curveHex as string, 1);
      if (tokenReserve === 0n) return { error: "not an ArcToolsPad token" };

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
        burnBps,
        createdAt: m ? Number(m.created_at ?? 0) || null : null,
        creator,
        image: (m?.image as string) || null,
        marketingBps,
        name: decodeString(nameHex as string | null),
        pricePer1M: tokenReserve > 0n ? Number((usdcReserve * 1_000_000_000_000n) / tokenReserve) / 1e6 : 0,
        rewardsBps,
        symbol: decodeString(symHex as string | null),
        telegram: (m?.telegram as string) || null,
        token,
        twitter: (m?.twitter as string) || null,
        txCount: Number(w(curveHex as string, 3)),
        usdcReal: Math.max(0, Number(usdcReserve / 10n ** 12n) / 1e6 - VIRTUAL),
        volumeUsdc: Number(w(curveHex as string, 2) / 10n ** 12n) / 1e6,
        website: (m?.website as string) || null,
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
      const metaHex = (await rpc("eth_call", [{ data: SEL.meta + pad32(token), to: PAD }, "latest"])) as string;
      if (!metaHex || metaHex.length < 2 + 64 * 2) return { ok: false, reason: "unknown token" };
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
          "INSERT INTO pad_meta (token,name,symbol,website,twitter,telegram,image,creator,created_at) VALUES (?,?,?,?,?,?,?,?,?) " +
            "ON CONFLICT(token) DO UPDATE SET website=excluded.website, twitter=excluded.twitter, telegram=excluded.telegram, " +
            "image=CASE WHEN excluded.image != '' THEN excluded.image ELSE pad_meta.image END",
        )
        .bind(
          token,
          clean(data.name),
          clean(data.symbol),
          clean(data.website),
          clean(data.twitter),
          clean(data.telegram),
          img,
          clean(data.creator).toLowerCase(),
          Math.floor(Date.now() / 1000),
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
    }
    const res = await multicall(calls, 50);
    const num = (i: number, dec = 18) => (res[i] ? Number(toNum(res[i]) / 10n ** BigInt(dec - 6)) / 1e6 : 0);
    const dropN = res[1] ? Number(toNum(res[1])) : 0;

    // drops list + user claims
    const dropCalls: { data: string; target: string }[] = [];
    for (let i = 0; i < Math.min(dropN, 50); i++) {
      dropCalls.push({ data: SEL.drops + padNum(BigInt(i)), target: VAULT });
      if (user) dropCalls.push({ data: SEL.claimableDrop + padNum(BigInt(i)) + pad32(user), target: VAULT });
    }
    const dropRes = dropCalls.length > 0 ? await multicall(dropCalls, 60) : [];
    const per = user ? 2 : 1;
    const drops = [] as { id: number; token: string; amount: number; claimable: number; symbol: string }[];
    for (let i = 0; i < Math.min(dropN, 50); i++) {
      const d = dropRes[i * per];
      if (!d) continue;
      const w = (j: number) => BigInt("0x" + d.slice(2 + j * 64, 2 + (j + 1) * 64));
      drops.push({
        amount: Number(w(2) / 10n ** 12n) / 1e6,
        claimable: user && dropRes[i * per + 1] ? Number(toNum(dropRes[i * per + 1]) / 10n ** 12n) / 1e6 : 0,
        id: i,
        symbol: "",
        token: topicAddr(d.slice(2, 66)),
      });
    }
    if (drops.length > 0) {
      const syms = await multicall(drops.map((d) => ({ data: SEL.symbol, target: d.token })), 60);
      drops.forEach((d, i) => (d.symbol = decodeString(syms[i])));
    }
    return {
      arctInVault: num(2),
      drops,
      totalStaked: num(0),
      userArct: user ? num(5) : 0,
      userClaimableUsdc: user ? num(4) : 0,
      userStaked: user ? num(3) : 0,
    };
  });
