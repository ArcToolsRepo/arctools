/** Every network call the app makes, in one place, typed. Reads go through the site's edge cache (/bot) where
 *  the web Terminal already proved it safe; the rest hits the bot directly. */
import { BOT_API, BOT_DIRECT, SITE } from "./bot-api";

export type Trend = {
  token: string; symbol: string | null; txs: number; vol: number; buys: number; sells: number; traders: number;
  p0: number | null; p1: number | null; chg: number | null; first_ts: number | null; ath: number | null;
  supply: number | null; mcap: number | null; ath_mcap: number | null; clone?: boolean; venue?: string | null;
};
export type PadToken = {
  token: string; symbol: string; name: string; pad: string; logo: string | null; createdAt: string | null;
  mcapUsd: number | null; priceUsd: number | null; volUsd: number | null; liqUsd?: number | null; curve?: number | null;
  twitter?: string | null; telegram?: string | null; website?: string | null; stock?: boolean; og?: boolean; quoteSymbol?: string;
};
export type Trade = { tx: string; ts: number; wallet: string; side: "buy" | "sell"; usdc: number; tokens: number; price1m: number; venue?: string };
export type Stats = { price1m: number; vol24: number; buys24: number; sells24: number; traders24?: number; supply?: number | null; mcap?: number | null; liq?: number | null; change?: { "5m"?: number | null; "1h"?: number | null; "6h"?: number | null; "24h"?: number | null } };
export type Risk = {
  dev_pct?: number | null; bundle_pct?: number | null; top10_pct?: number | null; holders?: number | null;
  dev_sold_usd?: number; dev_bought_usd?: number; dev_net_usd?: number; dev_sells?: number; dev_last_sell?: number | null;
  bundle_sold_usd?: number; bundle_net_usd?: number; bundle_sellers?: number; bundlers?: number; dev_rugs?: number; dev_launches?: number;
  score?: number | null; flags?: string[];
};
export type Sim = { verdict: "ok" | "thin" | "trap" | "no_route" | "unrouted" | "error"; loss_pct?: number | null; quote_out?: string | null; sim_out?: string | null; note?: string };
export type Holding = { token: string; symbol: string | null; name?: string; logo?: string | null; amount: number; raw?: string; price?: number | null; valueUsdc: number | null; avgEntry?: number | null; unrealized?: number | null; trades?: number; transferredIn?: boolean; lastTrade?: number };

const j = async <T,>(url: string, ms = 12_000): Promise<T> => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0].split("/").slice(-1)[0]}`);
    return (await r.json()) as T;
  } catch (e) {
    // the edge proxy is a speed-up, never a dependency: if it fails (network, CORS, 5xx) ask the bot directly
    if (url.startsWith(BOT_API)) {
      const r = await fetch(url.replace(BOT_API, BOT_DIRECT), { signal: AbortSignal.timeout(ms) });
      if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0].split("/").slice(-1)[0]}`);
      return (await r.json()) as T;
    }
    throw e;
  }
};

export const api = {
  trending: (minutes: number, limit = 200, sort?: "trend") =>
    j<{ rows: Trend[] }>(`${BOT_API}/api/trending?minutes=${minutes}&limit=${limit}${sort ? `&sort=${sort}` : ""}`).then((r) => r.rows ?? []),
  tokens: (alive = false) => j<{ tokens: PadToken[] }>(`${SITE}/api/tokens?lite=1${alive ? "&alive=1" : ""}`, alive ? 30_000 : 60_000).then((r) => r.tokens ?? []),
  padcounts: () => j<{ rows: { pad: string; n: number; label?: string; logo?: string | null }[] }>(`${SITE}/api/padcounts`).then((r) => r.rows ?? []),
  tokenPage: (ca: string) => j<Record<string, unknown>>(`${SITE}/api/tokenpage?ca=${ca}`),
  trades: (ca: string, limit = 60) => j<{ trades: Trade[] }>(`${BOT_API}/api/trades?token=${ca}&limit=${limit}`).then((r) => r.trades ?? []),
  stats: (ca: string) => j<Stats>(`${BOT_API}/api/token-stats?token=${ca}`),
  ohlc: (ca: string, tf: string, limit = 300) => j<{ candles: { t: number; o: number; h: number; l: number; c: number; v?: number }[] }>(`${BOT_API}/api/ohlc?token=${ca}&tf=${tf}&limit=${limit}`).then((r) => r.candles ?? []),
  risk: (cas: string[]) => j<{ risk: Record<string, Risk> }>(`${BOT_API}/api/holder-risk?tokens=${cas.join(",")}`).then((r) => r.risk ?? {}),
  sim: (ca: string) => j<Sim>(`${BOT_DIRECT}/api/sim?token=${ca}`, 20_000),
  holders: (ca: string) => j<{ items?: unknown[] }>(`https://api.arc-scan.org/v1/tokens/${ca}/holders`).then((r) => r.items ?? []),
  topTraders: (ca: string) => j<Record<string, unknown>>(`${BOT_API}/api/token-traders?token=${ca}&limit=20`),
  bubbles: (ca: string) => j<Record<string, unknown>>(`${BOT_API}/api/bubbles?token=${ca}`),
  swapRoute: (token: string, side: "buy" | "sell", amount: string) =>
    j<{ legs: unknown[]; out: string; single?: { label: string; out: string }[] }>(`${SITE}/api/swaproute?token=${token}&side=${side}&amount=${amount}`, 20_000),
  holdings: (wallet: string) => j<{ holdings: Holding[]; usdc: number; totals?: { tokens: number; equity: number; count: number } }>(`${BOT_DIRECT}/api/holdings?wallet=${wallet}`, 20_000),
  walletTrades: (wallet: string, limit = 50) => j<{ trades: Trade[] & { token: string; symbol?: string }[] }>(`${BOT_DIRECT}/api/wallet-trades?wallet=${wallet}&limit=${limit}`).then((r) => r.trades ?? []),
  /** tokens several ranked insiders are buying right now — the Terminal's "Insider picks" tab */
  insiderPicks: () => j<{ rows?: { token: string }[]; tokens?: { token: string }[] }>(`${BOT_API}/api/clusters?minutes=1440&n=2`).then((r) => (r.rows ?? r.tokens ?? []).map((x) => String(x.token).toLowerCase())),
  insiders: (limit = 100) => j<{ rows: Record<string, unknown>[] }>(`${BOT_API}/api/insiders?limit=${limit}`).then((r) => r.rows ?? []),
  alpha: () => j<{ rows: Record<string, unknown>[] }>(`${BOT_API}/api/alpha`).then((r) => r.rows ?? []),
  feed: (limit = 40) => j<{ rows: Record<string, unknown>[] }>(`${BOT_API}/api/feed?limit=${limit}`).then((r) => r.rows ?? []),
  liq: (cas: string[]) => j<{ liq: Record<string, number> }>(`${BOT_API}/api/liq?tokens=${cas.join(",")}`).then((r) => r.liq ?? {}),
  chain: () => j<{ last_block: number; index_lag_s: number | null; down: boolean }>(`${BOT_API}/api/chain-status`),
  burn: () => j<Record<string, unknown>>(`${BOT_API}/api/arct-burn`),
  buyback: () => j<Record<string, unknown>>(`${BOT_API}/api/buyback-stats`),
  claimsBySender: (wallet: string) => j<{ links: Record<string, unknown>[] }>(`${BOT_DIRECT}/api/claim/by-sender?wallet=${wallet}`, 30_000).then((r) => r.links ?? []),
  tokenMeta: (cas: string[]) => j<{ meta: Record<string, { symbol?: string; name?: string; logo?: string | null; twitter?: string | null; telegram?: string | null; website?: string | null; launchpad?: string | null; launchpad_label?: string | null; deploy_ts?: number | null }> }>(`${BOT_API}/api/token-meta?tokens=${cas.slice(0, 40).join(",")}`).then((r) => r.meta ?? {}),
  padlist: () => j<{ rows?: unknown[] } | unknown[]>(`${SITE}/api/padlist`),
};

export const streamUrl = (token?: string) => token ? `${BOT_DIRECT}/api/stream?token=${token}` : `${BOT_DIRECT}/api/stream?feed=terminal&windows=1440,0`;
