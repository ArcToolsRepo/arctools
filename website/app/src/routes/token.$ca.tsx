import { createFileRoute, Link } from "@tanstack/react-router";
import { BOT_API, BOT_ORIGIN } from "@/lib/bot-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { usePrefs } from "@/lib/i18n";
import { SocialCheck } from "@/components/social-check";
import { SmartFollowers } from "@/components/smart-followers";
import { RiskCard, StockCard, Tags, useWalletLabels } from "@/components/risk";
import { TokenLogo } from "@/components/token-logo";
import { TvChart, type Candle } from "@/components/tv-chart";
import { TvAdvanced, advancedAvailable } from "../components/tv-advanced";
import { DevTokens, KolMentions, MarkerLegend, MyPosition, TopTraders, useTokenEvents } from "@/components/token-intel";
import { ARC_V4_ROUTER, SWAP_FEE_ROUTER, tokenPage, venueData, type PadToken, type TokenPageInfo, type VenueData } from "@/lib/arc-api";
import { creditRef } from "@/lib/arc-ref";
import { routeSwap, type RouteResult } from "@/lib/arc-route";
import { hotAddress, hotSend, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { QuickBuy } from "@/components/quick-buy";
import { ORDER_COLORS, OrdersPanel, type OrderRow } from "@/components/orders-panel";
import { BubbleMap } from "@/components/bubble-map";
import { ARC_AGGREGATOR, encodeAggregatorSwap } from "@/lib/arc-wallet";
import { padHolders } from "@/lib/arcpad";
import {
  FN, FN3, PAD, connectWallet, ethCall, fmt, nativeBalance, onWalletChange, p32, pnum, sendTx, tokenBalance, waitReceipt,
} from "@/lib/arc-wallet";
import "../arc-site.css";

function TokenSkeleton({ lite }: { lite?: PadToken | null } = {}) {
  const money = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/trade" />
      <section className="arc-section" style={{ maxWidth: 1360, paddingTop: 118 }}>
        {lite && (
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
            <TokenLogo size={56} radius={12} src={lite.logo} symbol={lite.symbol} />
            <div>
              <h1 style={{ fontSize: 26, margin: 0 }}>{lite.name || lite.symbol} <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 14 }}>${lite.symbol}</span></h1>
              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, marginTop: 4 }}>{lite.pad}{lite.stage ? ` · ${lite.stage}` : ""}{lite.mcapUsd ? ` · MC ${money(lite.mcapUsd)}` : ""} · loading chart, trades and risk…</div>
            </div>
          </div>
        )}
        {!lite && <div style={{ alignItems: "center", display: "flex", gap: 14, marginBottom: 18 }}>
          <div className="arc-skel" style={{ height: 56, width: 56 }} />
          <div style={{ display: "grid", gap: 8 }}><div className="arc-skel" style={{ height: 26, width: 220 }} /><div className="arc-skel" style={{ height: 14, width: 320 }} /></div>
        </div>}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>{[0, 1, 2, 3].map((i) => <div className="arc-skel" key={i} style={{ height: 64 }} />)}</div>
        <div className="arc-2col" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
          <div className="arc-skel" style={{ height: 420 }} />
          <div className="arc-skel" style={{ height: 420 }} />
        </div>
      </section>
    </main>
  );
}

export const Route = createFileRoute("/token/$ca")({
  pendingComponent: TokenSkeleton,
  pendingMs: 80,
  staleTime: 15_000,
  preloadStaleTime: 15_000,
  loader: async ({ params }) => {
    // Cached pages answer in ms. A cold page can take several seconds of upstream calls: never hold the
    // HTML for that — after 900 ms ship the shell and let the client finish (the server keeps computing
    // in the background, so the client's call lands on the same in-flight result).
    // client-side navigation from the Terminal: the row is already in memory → render NOW, fetch the rest in the background
    if (typeof window !== "undefined") {
      const c = (globalThis as unknown as { __arcLite?: Map<string, PadToken> }).__arcLite?.get(params.ca.toLowerCase());
      if (c) return { info: null, error: null, pending: true as const, lite: c };
    }
    const p = tokenPage({ data: { token: params.ca } });
    // the cached Terminal row (name, symbol, logo, MC, pool, socials) is fetched in PARALLEL: if the full page is not in
    // cache within 450 ms we ship the shell with that row and the client renders the whole page from it immediately
    const { listFullTokens } = await import("@/lib/arc-api");
    const litePromise = listFullTokens().then((l) => l.find((t) => t.token.toLowerCase() === params.ca.toLowerCase()) ?? null).catch(() => null);
    // a rejected compute (relay down) is treated exactly like a slow one: ship the shell, the client renders from the list row
    const r = await Promise.race([p.catch(() => "__slow" as const), new Promise<"__slow">((res) => setTimeout(() => res("__slow"), 450))]);
    if (r === "__slow") {
      void p.catch(() => null);
      const lite = await Promise.race([litePromise, new Promise<null>((res) => setTimeout(() => res(null), 350))]);
      return { info: null, error: null, pending: true as const, lite };
    }
    if ("error" in r && !/No token contract/.test(r.error)) {
      // "does not expose name/symbol" after a relay hiccup: fall back to the list row rather than a dead end
      const lite = await Promise.race([litePromise, new Promise<null>((res) => setTimeout(() => res(null), 350))]);
      if (lite) return { info: null, error: null, pending: true as const, lite };
    }
    return { info: "error" in r ? null : r, error: "error" in r ? r.error : null, pending: false as const, lite: null };
  },
  head: ({ loaderData }) => {
    const i = loaderData?.info ?? ((loaderData as { lite?: PadToken | null } | undefined)?.lite ? { symbol: (loaderData as { lite: PadToken }).lite.symbol, name: (loaderData as { lite: PadToken }).lite.name } : null);
    return {
      meta: [
        { title: i ? `${i.symbol} · ${i.name} on Arc: chart, trades, swap` : "Token on Arc" },
        { name: "description", content: i ? `Live chart, trades, holders and one-click swap for ${i.name} (${i.symbol}) on Arc.` : "Arc token page" },
      ],
    };
  },
  component: TokenPage,
});

const USDC = "0x3600000000000000000000000000000000000000";
const QUOTER_V2 = "0x7dfd4f31be6814d2906bde155c3e1b146eac1468";
const SWAP_ROUTER02 = "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77";
const SEL_EXACT_INPUT_SINGLE = "0x04e45aaf"; // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
const SEL = {
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  quoteExactInputSingle: "0xc6a5026a",
  routerBuy: "0xa0328eb2",
  routerSell: "0x7dfcb0d3",
  v4SwapExactIn: "0xa71e60ec",
};
const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const TF_SEC: Record<string, number> = { "1d": 86400, "1h": 3600, "1m": 60, "4h": 14400, "5m": 300, "15m": 900 };

/** Buduje swiece z listy swapow (fallback, gdy zaden indeks nie ma jeszcze OHLC). */
function candlesFromSwaps(swaps: { ts: number; price1m: number; usdc: number }[], tf: string): Candle[] {
  const step = TF_SEC[tf] ?? 300;
  const byB = new Map<number, Candle>();
  for (const s of [...swaps].sort((a, b) => a.ts - b.ts)) {
    if (!(s.price1m > 0)) continue;
    const b = Math.floor(s.ts / step) * step;
    const k = byB.get(b);
    if (!k) byB.set(b, { c: s.price1m, h: s.price1m, l: s.price1m, n: 1, o: s.price1m, t: b, v: s.usdc, vb: 0 });
    else { k.c = s.price1m; k.h = Math.max(k.h, s.price1m); k.l = Math.min(k.l, s.price1m); k.v += s.usdc; k.n += 1; }
  }
  const out = [...byB.values()].sort((a, b) => a.t - b.t);
  for (let i = 1; i < out.length; i++) { out[i].o = out[i - 1].c; out[i].h = Math.max(out[i].h, out[i].o); out[i].l = Math.min(out[i].l, out[i].o); }
  return out;
}
type TF = (typeof TFS)[number];

type Stats = {
  price1m: number | null;
  change: Record<"5m" | "1h" | "6h" | "24h", number | null>;
  vol24: number; buys24: number; sells24: number; traders24: number; txns_all: number; vol_all: number;
};
type Trade = {
  tx: string; ts: number; wallet: string; side: "buy" | "sell"; usdc: number; tokens: number; price1m: number;
  venue: string; insider_rank: number | null; insider_pnl: number | null;
};

const money = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : `$${fmt(v, d)}`);
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const ago = (ts: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const priceFromP1m = (p1m: number | null) => (p1m === null ? null : p1m / 1e6);

function Cell({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <div style={{ background: "var(--arc-panel, #0e1118)", border: "1px solid var(--arc-line)", padding: "8px 10px" }}>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, letterSpacing: 0.6, margin: 0 }}>{k}</p>
      <p className="arc-mono" style={{ color: tone === "up" ? "#22c580" : tone === "down" ? "#f0534f" : "var(--arc-ink)", fontSize: 14, margin: "3px 0 0" }}>{v}</p>
    </div>
  );
}

/** Degraded page info built from the cached Terminal row — enough for header, chart, trades and the swap panel while the
 *  full on-chain page computes (or when the public RPCs are down). */
function fromLite(t: PadToken): TokenPageInfo {
  const V3_PADS = new Set(["Lift", "eve.fun", "ArcPad", "Archemist", "RadarDex", "UniswapV3", "Arguspad V3", "Tolly", "Ellipse", "long.supply"]);
  const isPad = t.pad === "ArcToolsPad";
  return {
    token: t.token, name: t.name || t.symbol, symbol: t.symbol, decimals: 18, supply: 1e9, venue: isPad ? "pad" : t.pad === "UniswapV4" || t.pad === "Arguspad" || t.pad === "act.fun" || t.pad === "UBI.fun" ? "v4" : V3_PADS.has(t.pad) ? "v3" : "external",
    v4Key: null, curveAddress: null, pool: t.pool ?? null, poolFee: 10000, liquidityUsdc: t.liqUsd ?? null, price1m: t.priceUsd != null ? t.priceUsd * 1e6 : null, mcapUsd: t.mcapUsd ?? null,
    logo: t.logo ?? null, website: t.website ?? null, twitter: t.twitter ?? null, telegram: t.telegram ?? null, launchpad: t.pad, venueUrl: t.venueUrl ?? null, holders: null, createdAt: t.createdAt ?? null, deployer: null,
    padAddress: null, quoteToken: t.quote ?? null, quoteSymbol: t.quoteSymbol ?? "USDC", quoteUsd: 1, graduated: false, padMode: null, targetQuote: null, stock: null, longPool: null,
  };
}

function AutoRetry() {
  useEffect(() => { const id = setTimeout(() => window.location.reload(), 7000); return () => clearTimeout(id); }, []);
  return null;
}

function TokenPage() {
  const { t: tr_ } = usePrefs();
  const loaded = Route.useLoaderData();
  const params = Route.useParams();
  const [late, setLate] = useState<{ info: TokenPageInfo | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!loaded.pending) { setLate(null); return; }
    let alive = true;
    const lite = (loaded as { lite?: PadToken | null }).lite ?? null;
    // the full page needs ~10 RPC round-trips; when the public RPCs are down we still have everything the chart, trades and
    // swap panel need from the cached Terminal row + our own index → render a degraded page instead of a skeleton forever
    const go = async (attempt: number) => {
      const r = await tokenPage({ data: { token: params.ca } }).catch(() => null);
      if (!alive) return;
      if (r && !("error" in r)) setLate({ info: r, error: null });
      else if (r && "error" in r && !lite && /No token contract/.test(r.error)) setLate({ info: null, error: r.error });   // only a genuinely empty address is "not found"
      else if (r && "error" in r && !lite) { if (attempt < 2) setTimeout(() => void go(attempt + 1), 2500); else setLate({ info: null, error: r.error }); }
      else if (attempt < 1 && !lite) setTimeout(() => void go(attempt + 1), 1500);
      else if (lite) { setLate({ info: fromLite(lite), error: null }); if (attempt < 2) setTimeout(() => void go(attempt + 1), 8000); }   // degraded now, upgrade when RPC answers
      else setLate({ info: null, error: "Could not load this token right now — try again in a moment." });
    };
    void go(0);
    return () => { alive = false; };
  }, [loaded.pending, params.ca]);
  const liteRow = (loaded as { lite?: PadToken | null }).lite ?? null;
  // render NOW from the cached Terminal row (header, chart, trades, swap); the full on-chain info replaces it when it lands
  const info = loaded.pending ? (late?.info ?? (liteRow ? fromLite(liteRow) : null)) : loaded.info;
  const error = loaded.pending ? late?.error ?? null : loaded.error;
  const stillLoading = loaded.pending && !late && !liteRow;
  const [tf, setTf] = useState<TF>("5m");
  const [adv, setAdv] = useState(false);
  // horizontal layout: swap-panel width (drag the splitter) or full-width chart (double-click / ⤢ button)
  const [sideW, setSideW] = useState<number>(() => { try { const v = Number(localStorage.getItem("arc_side_w")); return v >= 280 && v <= 560 ? v : 360; } catch { return 360; } });
  const [wide, setWide] = useState<boolean>(() => { try { return localStorage.getItem("arc_chart_wide") === "1"; } catch { return false; } });
  const gridRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<{ x0: number; w0: number } | null>(null);
  const onSplitDown = (e: React.PointerEvent) => { splitRef.current = { x0: e.clientX, w0: sideW }; (e.target as HTMLElement).setPointerCapture(e.pointerId); };
  const onSplitMove = (e: React.PointerEvent) => { const d = splitRef.current; if (!d) return; setSideW(Math.max(280, Math.min(560, d.w0 - (e.clientX - d.x0)))); };
  const onSplitUp = () => { splitRef.current = null; };
  useEffect(() => { try { localStorage.setItem("arc_side_w", String(sideW)); localStorage.setItem("arc_chart_wide", wide ? "1" : "0"); } catch { /* ignore */ } }, [sideW, wide]);
  useEffect(() => { void advancedAvailable().then((ok) => setAdv(ok)); }, []);
  const [mode, setMode] = useState<"price" | "mcap">("mcap");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [holders, setHolders] = useState<{ count: number; top: { address: string; pct: number }[] } | null>(null);
  const [venue, setVenue] = useState<VenueData | null>(null);
  const [tab, setTab] = useState<"trades" | "positions" | "holders" | "bubbles" | "traders" | "dev" | "info">("trades");
  const [copied, setCopied] = useState(false);

  // ---- swap state
  const [wallet, setWallet] = useState<string | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  // deep links from position lists elsewhere: /token/<ca>?side=sell (or ?buy=1) preselect the swap panel
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const want = sp.get("side") === "sell" ? "sell" : sp.get("side") === "buy" || sp.get("buy") ? "buy" : null;
      if (want) { setSide(want); setTimeout(() => document.querySelector(".arc-swap-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300); }
    } catch { /* ignore */ }
  }, []);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<number | null>(null);
  const [slippage, setSlippage] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [balUsdc, setBalUsdc] = useState<number | null>(null);
  const [balTok, setBalTok] = useState<number | null>(null);

  const ca = info?.token ?? "";
  const { markers: chartMarkers, avatars: chartAvatars, data: eventsData } = useTokenEvents(ca || null, 14, candles[0]?.t ?? 0);
  const [markersVisible, setMarkersVisible] = useState<number | null>(null);
  const dec = info?.decimals ?? 18;
  const padAddr = info?.padAddress ?? PAD;
  const quoteTok = info?.quoteToken ?? null;         // null = native USDC
  const qSym = info?.quoteSymbol ?? "USDC";
  // the pair the token actually trades in: pad quote token, or the long.supply stock pool (LONG/CRCL), else USDC
  // main market pair: pad quote token, or the long.supply stock pool when it is the deeper market (LONG/CRCL $496K vs LONG/USDC $123K), else USDC
  const stockIsMain = !!info?.longPool && !info.stock && (info.venue === "external" || (info.longPool.liquidityUsd ?? 0) > (info.liquidityUsdc ?? 0));
  const pairSym = (info?.quoteSymbol && info.quoteSymbol !== "USDC") ? info.quoteSymbol : stockIsMain ? info!.longPool!.pairSymbol : "USDC";
  const altPair = stockIsMain && info?.venue !== "external" ? "USDC" : (!stockIsMain && info?.longPool && !info.stock) ? info.longPool.pairSymbol : null;
  const qUsd = info?.quoteUsd ?? 1;
  // long.supply launches whose only market is a stock-quoted V3 pool: ArcAggregatorV2 routes USDC -> stock -> token in one tx
  const viaHop = !!info && ((info.venue === "external" && !!info.longPool && !info.stock) || (info.venue === "pad" && !!info.quoteToken && !info.graduated));
  const canTrade = info?.venue === "pad" || (info?.venue === "v3" && info.poolFee !== null) || (info?.venue === "v4" && !!info.v4Key) || (info?.venue === "curve" && !!info.curveAddress) || viaHop;
  // aggregator handles every USDC-paired venue (V3 tiers, V4 pools, ArcToolsPad USDC curves) with best-price + split routing
  const useAgg = !!info && ((info.venue === "v3" && !info.quoteToken) || info.venue === "v4" || info.venue === "curve" || info.venue === "pad" || viaHop);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [myOrders, setMyOrders] = useState<OrderRow[]>([]);
  const [tradeMode, setTradeMode] = useState<"market" | "limit" | "tp" | "sl">("market");
  const orderLines = useMemo(() => myOrders.filter((o) => o.status === "open").map((o) => ({ price: o.trigger_price, color: ORDER_COLORS[o.kind], title: `${o.kind === "limit" ? "LIMIT BUY" : o.kind === "tp" ? "TP" : "SL"} ${o.is_buy ? `${(Number(o.amount_in) / 1e18).toFixed(0)} USDC` : `${Math.round(Number(o.amount_in) / 1e18).toLocaleString()}`}` })), [myOrders]);
  const [hot, setHot] = useState(false);          // sign with the in-browser trading wallet instead of the connected wallet
  const [hotOk, setHotOk] = useState(false);
  useEffect(() => { setHotOk(isUnlocked()); setHot(isUnlocked()); const off = onHotChange(() => { setHotOk(isUnlocked()); if (!isUnlocked()) setHot(false); }); return () => { off(); }; }, []);
  // graduowany token v3 w parze z innym tokenem (np. BTOLLY/TOLLY): pula jest token/quote, nie token/USDC
  const v3Quote = info?.venue === "v3" && !!info.quoteToken;

  // ---- data loaders (bot API, CORS open)
  const loadCandles = useCallback(async () => {
    if (!ca) return;
    try {
      const r = (await (await fetch(`${BOT_API}/api/ohlc?token=${ca}&tf=${tf}&limit=600`)).json()) as { candles?: Candle[] };
      // a proxy/upstream hiccup returns {error} — never wipe a chart that already has data
      if (Array.isArray(r.candles) && (r.candles.length > 0 || candles.length === 0)) setCandles(r.candles);
    } catch { /* keep old */ }
  }, [ca, tf, candles.length]);
  const loadSide = useCallback(async () => {
    if (!ca) return;
    try {
      const [s, t] = await Promise.all([
        fetch(`${BOT_API}/api/token-stats?token=${ca}`).then((r) => r.json()) as Promise<Stats>,
        fetch(`${BOT_API}/api/trades?token=${ca}&limit=60`).then((r) => r.json()) as Promise<{ trades: Trade[] }>,
      ]);
      if (s && typeof s === "object" && "price1m" in s) setStats(s);
      if (Array.isArray(t.trades) && t.trades.length) setTrades(t.trades);
    } catch { /* keep old */ }
  }, [ca]);

  // ---- LIVE: every swap the indexer writes arrives here within ~1 s over SSE (direct to the bot origin: no proxy
  //      buffering). It updates the trade list, the last price and the open candle in place; polling stays as a slow
  //      safety net (30 s) while the stream is up, and speeds up to 5 s when it is not.
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  useEffect(() => {
    if (!ca || typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null; let closed = false; let backoff = 1000;
    const step = TF_SEC[tf] ?? 300;
    const open = () => {
      if (closed) return;
      es = new EventSource(`${BOT_ORIGIN}/api/stream?token=${ca}`);
      es.addEventListener("hello", () => { backoff = 1000; liveRef.current = true; setLive(true); });
      es.addEventListener("trade", (ev) => {
        try {
          const t = JSON.parse((ev as MessageEvent).data) as Trade & { log_index?: number };
          setTrades((prev) => (prev.some((p) => p.tx === t.tx && p.ts === t.ts && p.usdc === t.usdc) ? prev : [{ ...t, insider_rank: null, insider_pnl: null }, ...prev].slice(0, 80)));
          setStats((prev) => (prev ? { ...prev, price1m: t.price1m, vol24: prev.vol24 + t.usdc, buys24: prev.buys24 + (t.side === "buy" ? 1 : 0), sells24: prev.sells24 + (t.side === "sell" ? 1 : 0), txns_all: prev.txns_all + 1, vol_all: prev.vol_all + t.usdc } : prev));
          const px = t.price1m / 1e6; const b = Math.floor(t.ts / step) * step;
          setCandles((prev) => {
            if (!prev.length) return prev;
            const last = prev[prev.length - 1];
            if (last.t === b) return [...prev.slice(0, -1), { ...last, c: px, h: Math.max(last.h, px), l: Math.min(last.l, px), v: (last.v ?? 0) + t.usdc, vb: (last.vb ?? 0) + (t.side === "buy" ? t.usdc : 0), n: (last.n ?? 0) + 1 }];
            if (b > last.t) return [...prev, { t: b, o: last.c, h: Math.max(last.c, px), l: Math.min(last.c, px), c: px, v: t.usdc, vb: t.side === "buy" ? t.usdc : 0, n: 1 }];
            return prev;
          });
        } catch { /* malformed event */ }
      });
      es.onerror = () => { liveRef.current = false; setLive(false); es?.close(); es = null; if (!closed) setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15_000); };
    };
    open();
    return () => { closed = true; liveRef.current = false; es?.close(); };
  }, [ca, tf]);
  useEffect(() => {
    void loadCandles();
    const id = setInterval(() => { if (!liveRef.current || document.visibilityState === "visible") void loadCandles(); }, liveRef.current ? 30_000 : 5_000);
    return () => clearInterval(id);
  }, [loadCandles, live]);
  // a pool we know but our swap index never saw (brand-new launchpad pool whose first swaps hit an RPC hiccup):
  // ask the indexer to backfill it right away, then the chart fills in on the next candle poll
  const indexAsked = useRef(false);
  useEffect(() => {
    if (indexAsked.current || !info?.pool || candles.length > 0 || !stats || (stats.txns_all ?? 0) > 0) return;
    indexAsked.current = true;
    const since = info.createdAt ? Math.floor(Date.parse(info.createdAt) / 1000) : "";
    fetch(`${BOT_API}/api/index-pool?pool=${info.pool}&since=${since}`).catch(() => null);
    const t = setTimeout(() => { void loadCandles(); void loadSide(); }, 12_000);
    return () => clearTimeout(t);
  }, [info?.pool, candles.length, stats]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void loadSide();
    const id = setInterval(loadSide, liveRef.current ? 30_000 : 5_000);
    return () => clearInterval(id);
  }, [loadSide, live]);
  useEffect(() => {
    if (!ca) return;
    const load = () => venueData({ data: { launchpad: info?.launchpad ?? null, token: ca } }).then(setVenue).catch(() => null);
    void load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [ca, info?.launchpad]);
  useEffect(() => {
    if (!ca) return;
    padHolders({ data: { token: ca } }).then(setHolders).catch(() => null);
  }, [ca]);

  // ---- wallet
  const refreshBalances = useCallback(async (addr: string | null) => {
    if (hot && isUnlocked() && hotAddress()) addr = hotAddress();
    if (!addr || !ca) return;
    try {
      const [u, t] = await Promise.all([quoteTok ? tokenBalance(quoteTok, addr).then((b) => Number(b / 10n ** 12n) / 1e6) : nativeBalance(addr), tokenBalance(ca, addr)]);
      setBalUsdc(u);
      setBalTok(Number(t / BigInt(10) ** BigInt(Math.max(0, dec - 6))) / 1e6);
    } catch { /* ignore */ }
  }, [ca, dec, quoteTok, hot]);
  useEffect(() => { void refreshBalances(wallet); }, [hot, refreshBalances, wallet]);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("arctools_wallet"); } catch { /* ignore */ }
    setWallet(saved);
    void refreshBalances(saved);
    return onWalletChange((a) => { setWallet(a); void refreshBalances(a); });
  }, [refreshBalances]);

  // ---- quote (debounced)
  useEffect(() => {
    const n = Number(amount);
    if (!info || !n || n <= 0 || !canTrade) { setQuote(null); return; }
    const id = setTimeout(async () => {
      try {
        if (useAgg) {
          // buy: msg.value = spend + 1.5% fee -> spend = n / 1.015 ; sell: fee on output
          const wei = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
          const spend = side === "buy" ? (wei * 1000n) / 1015n : BigInt(Math.round(n * 1e6)) * BigInt(10) ** BigInt(Math.max(0, dec - 6));
          const r = await routeSwap({ data: { token: ca, side, amount: spend.toString() } });
          setRoute(r);
          if (r.error || r.legs.length === 0) { setQuote(null); return; }
          if (r.unquoted) { setQuote(0); return; }   // venue known, quoter unreachable (RPC busy): market buy with minOut 0
          const out = BigInt(r.out);
          setQuote(side === "buy"
            ? Number(out / BigInt(10) ** BigInt(Math.max(0, dec - 6))) / 1e6
            : (Number(out / 10n ** 12n) / 1e6) * 0.985);
          return;
        }
        setRoute(null);
        if (info.venue === "pad") {
          const wei = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
          const r = await ethCall(padAddr, (side === "buy" ? FN.quoteBuy : FN.quoteSell) + p32(ca) + pnum(wei));
          setQuote(r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : null);
        } else {
          // V3: 1% service fee is taken from USDC before the swap (buy) / after (sell)
          const fee = BigInt(info.poolFee ?? 10000);
          if (info.venue === "v4") {
            // V4: no on-chain quoter — estimate from the last indexed price (1% router fee on the USDC side)
            const px = (info.price1m ?? 0) / 1e6;
            if (!(px > 0)) { setQuote(null); return; }
            setQuote(side === "buy" ? (n * 0.99) / px : n * px * 0.99);
            return;
          }
          if (v3Quote && info.quoteToken) {
            // para token/quote (18 dec po obu stronach), bez fee routera
            const amountIn = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
            const [tin, tout] = side === "buy" ? [info.quoteToken, ca] : [ca, info.quoteToken];
            const r = await ethCall(QUOTER_V2, SEL.quoteExactInputSingle + p32(tin) + p32(tout) + pnum(amountIn) + pnum(fee) + pnum(0n));
            if (!r || r === "0x") { setQuote(null); return; }
            setQuote(Number(BigInt("0x" + r.slice(2, 66)) / 10n ** 12n) / 1e6);
            return;
          }
          const amountIn = side === "buy"
            ? (BigInt(Math.round(n * 1e6)) * 99n) / 100n
            : BigInt(Math.round(n * 1e6)) * BigInt(10) ** BigInt(Math.max(0, dec - 6));
          const [tin, tout] = side === "buy" ? [USDC, ca] : [ca, USDC];
          const data = SEL.quoteExactInputSingle + p32(tin) + p32(tout) + pnum(amountIn) + pnum(fee) + pnum(0n);
          const r = await ethCall(QUOTER_V2, data);
          if (!r || r === "0x") { setQuote(null); return; }
          const out = BigInt("0x" + r.slice(2, 66));
          setQuote(side === "buy"
            ? Number(out / BigInt(10) ** BigInt(Math.max(0, dec - 6))) / 1e6
            : (Number(out) / 1e6) * 0.99);
        }
      } catch { setQuote(null); }
    }, 350);
    return () => clearTimeout(id);
  }, [amount, side, ca, info, canTrade, dec, padAddr, v3Quote, useAgg]);

  const setPctAmount = (p: number) => {
    const bal = side === "buy" ? balUsdc : balTok;
    if (bal === null) return;
    const v = side === "buy" ? Math.max(0, bal - 0.05) * p : bal * p; // leave gas on full USDC
    setAmount(v > 0 ? v.toFixed(6).replace(/\.?0+$/, "") : "0");
  };

  const swap = async () => {
    setMsg(null); setErr(null);
    try {
      if (!info) return;
      const useHotNow = hot && useAgg && isUnlocked() && !!hotAddress();
      const from = useHotNow ? hotAddress()! : (wallet ?? (await connectWallet()));
      if (!useHotNow) setWallet(from);
      const send = useHotNow
        ? (tx: { to: string; data: string; value?: bigint; from: string }) => hotSend({ to: tx.to, data: tx.data, value: tx.value })
        : sendTx;
      const n = Number(amount);
      if (!n || n <= 0) throw new Error("Enter an amount.");
      if (quote === null) throw new Error("No quote yet.");
      if (quote === 0 && !(useAgg && route?.unquoted && side === "buy")) throw new Error("No quote yet.");
      setBusy("Confirm in wallet...");
      let hash: string;
      let feeUsdForRef = 0;
      if (useAgg && route && route.legs.length > 0) {
        const legs = route.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
        if (side === "buy") {
          const spend = legs.reduce((s, l) => s + BigInt(l.amount), 0n);
          const value = spend + (spend * 15n) / 1000n;
          feeUsdForRef = Number(spend) / 1e18 * 0.015;
          const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * BigInt(10) ** BigInt(Math.max(0, dec - 6));
          hash = await send({ data: encodeAggregatorSwap("buy", ca, legs, minOut, from, 150), from, to: ARC_AGGREGATOR, value });
        } else {
          const tokIn = legs.reduce((s, l) => s + BigInt(l.amount), 0n);
          const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * 10n ** 12n;   // post-fee native USDC
          const al = await ethCall(ca, SEL.allowance + p32(from) + p32(ARC_AGGREGATOR));
          if (!al || BigInt(al) < tokIn) {
            setBusy(`Approve ${info.symbol}...`);
            await waitReceipt(await send({ data: SEL.approve + p32(ARC_AGGREGATOR) + "f".repeat(64), from, to: ca }));
            setBusy("Confirm in wallet...");
          }
          feeUsdForRef = (quote ?? 0) * 0.015 / 0.985;   // quote is post-fee USDC out
          hash = await send({ data: encodeAggregatorSwap("sell", ca, legs, minOut, from, 150), from, to: ARC_AGGREGATOR });
        }
      } else if (info.venue === "pad") {
        const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * 10n ** 12n;
        const amt = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
        if (side === "buy") {
          if (info.quoteToken) {
            // v3, ERC-20 quote (e.g. TOLLY): approve once, then buyToken pulls it
            const al = await ethCall(info.quoteToken, SEL.allowance + p32(from) + p32(padAddr));
            if (!al || BigInt(al) < amt) {
              setBusy(`Approve ${qSym}...`);
              await waitReceipt(await sendTx({ data: SEL.approve + p32(padAddr) + "f".repeat(64), from, to: info.quoteToken }));
              setBusy("Confirm in wallet...");
            }
            hash = await sendTx({ data: FN3.buyToken + p32(ca) + pnum(amt) + pnum(minOut), from, to: padAddr });
          } else {
            hash = await sendTx({ data: FN.buy + p32(ca) + pnum(minOut), from, to: padAddr, value: amt });
          }
        } else {
          hash = await sendTx({ data: FN.sell + p32(ca) + pnum(amt) + pnum(minOut), from, to: padAddr });
        }
      } else if (info.venue === "v4" && info.v4Key) {
        // ArcV4Router.swapExactIn(PoolKey, zeroForOne, amountIn, minOut, recipient, feeBps=100)
        const k = info.v4Key;
        const usdcSide = k.currency0.toLowerCase() === ca.toLowerCase() ? k.currency1 : k.currency0;
        const native = /^0x0{40}$/.test(usdcSide);
        const uDec = native ? 18 : 6;
        const key = p32(k.currency0) + p32(k.currency1) + pnum(BigInt(k.fee)) + pnum(BigInt.asUintN(256, BigInt(k.tick_spacing))) + p32(k.hooks);
        if (side === "buy") {
          const amountIn = BigInt(Math.round(n * 1e6)) * 10n ** BigInt(uDec - 6);
          const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * BigInt(10) ** BigInt(Math.max(0, dec - 6));
          const zeroForOne = k.currency0.toLowerCase() !== ca.toLowerCase();
          if (!native) {
            const al = await ethCall(USDC, SEL.allowance + p32(from) + p32(ARC_V4_ROUTER));
            if (!al || BigInt(al) < amountIn) {
              setBusy("Approve USDC...");
              await waitReceipt(await sendTx({ data: SEL.approve + p32(ARC_V4_ROUTER) + "f".repeat(64), from, to: USDC }));
              setBusy("Confirm in wallet...");
            }
          }
          hash = await sendTx({
            data: SEL.v4SwapExactIn + key + pnum(zeroForOne ? 1n : 0n) + pnum(amountIn) + pnum(minOut) + p32(from) + pnum(100n),
            from, to: ARC_V4_ROUTER, ...(native ? { value: amountIn } : {}),
          });
        } else {
          const tokIn = BigInt(Math.round(n * 1e6)) * BigInt(10) ** BigInt(Math.max(0, dec - 6));
          const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * 10n ** BigInt(uDec - 6);
          const zeroForOne = k.currency0.toLowerCase() === ca.toLowerCase();
          const al = await ethCall(ca, SEL.allowance + p32(from) + p32(ARC_V4_ROUTER));
          if (!al || BigInt(al) < tokIn) {
            setBusy(`Approve ${info.symbol}...`);
            await waitReceipt(await sendTx({ data: SEL.approve + p32(ARC_V4_ROUTER) + "f".repeat(64), from, to: ca }));
            setBusy("Confirm in wallet...");
          }
          hash = await sendTx({
            data: SEL.v4SwapExactIn + key + pnum(zeroForOne ? 1n : 0n) + pnum(tokIn) + pnum(minOut) + p32(from) + pnum(100n),
            from, to: ARC_V4_ROUTER,
          });
        }
      } else if (v3Quote && info.quoteToken) {
        // SwapRouter02 exactInputSingle: quote -> token (buy) lub token -> quote (sell), 18 dec
        const fee = BigInt(info.poolFee ?? 10000);
        const amt = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
        const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * 10n ** 12n;
        const tin = side === "buy" ? info.quoteToken : ca;
        const tout = side === "buy" ? ca : info.quoteToken;
        const al = await ethCall(tin, SEL.allowance + p32(from) + p32(SWAP_ROUTER02));
        if (!al || BigInt(al) < amt) {
          setBusy(`Approve ${side === "buy" ? qSym : info.symbol}...`);
          await waitReceipt(await sendTx({ data: SEL.approve + p32(SWAP_ROUTER02) + "f".repeat(64), from, to: tin }));
          setBusy("Confirm in wallet...");
        }
        hash = await sendTx({
          data: SEL_EXACT_INPUT_SINGLE + p32(tin) + p32(tout) + pnum(fee) + p32(from) + pnum(amt) + pnum(minOut) + pnum(0n),
          from, to: SWAP_ROUTER02,
        });
      } else {
        const fee = BigInt(info.poolFee ?? 10000);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
        if (side === "buy") {
          const usdcIn = BigInt(Math.round(n * 1e6));
          const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * BigInt(10) ** BigInt(Math.max(0, dec - 6));
          const al = await ethCall(USDC, SEL.allowance + p32(from) + p32(SWAP_FEE_ROUTER));
          if (!al || BigInt(al) < usdcIn) {
            setBusy("Approve USDC...");
            await waitReceipt(await sendTx({ data: SEL.approve + p32(SWAP_FEE_ROUTER) + "f".repeat(64), from, to: USDC }));
            setBusy("Confirm in wallet...");
          }
          hash = await sendTx({ data: SEL.routerBuy + p32(ca) + pnum(fee) + pnum(usdcIn) + pnum(minOut) + pnum(deadline), from, to: SWAP_FEE_ROUTER });
        } else {
          const tokIn = BigInt(Math.round(n * 1e6)) * BigInt(10) ** BigInt(Math.max(0, dec - 6));
          const minOut = BigInt(Math.round((quote / 0.99) * (1 - slippage / 100) * 1e6)); // router checks pre-fee USDC
          const al = await ethCall(ca, SEL.allowance + p32(from) + p32(SWAP_FEE_ROUTER));
          if (!al || BigInt(al) < tokIn) {
            setBusy(`Approve ${info.symbol}...`);
            await waitReceipt(await sendTx({ data: SEL.approve + p32(SWAP_FEE_ROUTER) + "f".repeat(64), from, to: ca }));
            setBusy("Confirm in wallet...");
          }
          hash = await sendTx({ data: SEL.routerSell + p32(ca) + pnum(fee) + pnum(tokIn) + pnum(minOut) + pnum(deadline), from, to: SWAP_FEE_ROUTER });
        }
      }
      setBusy("Waiting for confirmation...");
      const r = await waitReceipt(hash);
      if (Number(r.status) !== 1) throw new Error("Transaction reverted (slippage?).");
      setMsg(`${side === "buy" ? "Bought" : "Sold"} ${info.symbol} — confirmed.`);
      if (feeUsdForRef > 0) creditRef(from, hash, feeUsdForRef);
      setAmount("");
      void refreshBalances(from);
      setTimeout(() => { void loadSide(); void loadCandles(); }, 2500);
    } catch (e) {
      setErr((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  // ---- derived: nasz indeks pierwszy, dane venue (RadarDex/Tolly) gdy indeks jeszcze cienki
  const ownThin = !stats || stats.txns_all < 5;
  const vs = venue?.stats ?? null;
  const eff = {
    buys24: ownThin && vs ? vs.buys24 : (stats?.buys24 ?? 0),
    change: ownThin && vs ? vs.change : (stats?.change ?? { "1h": null, "24h": null, "5m": null, "6h": null }),
    sells24: ownThin && vs ? vs.sells24 : (stats?.sells24 ?? 0),
    traders24: ownThin && vs ? vs.traders24 : (stats?.traders24 ?? 0),
    txns: ownThin && vs ? vs.txns24 : (stats?.txns_all ?? 0),
    vol24: ownThin && vs ? vs.vol24 : (stats?.vol24 ?? 0),
    volAll: stats?.vol_all ?? null,
  };
  const lastP1m = (!ownThin ? stats?.price1m : null) ?? vs?.price1m ?? info?.price1m ?? stats?.price1m ?? null;
  const price = priceFromP1m(lastP1m);
  const mcap = info && lastP1m !== null ? (lastP1m / 1e6) * info.supply : (vs?.mcap ?? info?.mcapUsd ?? null);
  const liquidity = info?.liquidityUsdc && info.liquidityUsdc > 0 ? info.liquidityUsdc : (vs?.liquidityUsdc ?? info?.liquidityUsdc ?? null);
  // arc-scan zwraca max 50 wierszy (rozmiar strony), screener ma prawdziwy licznik — bierzemy najwiekszy
  const holderCount = Math.max(holders?.count ?? 0, vs?.holders ?? 0, info?.holders ?? 0) || null;
  // MCap mode needs a supply; a brand-new token may not have one yet → derive it from mcap/price, else fall back to price
  // mode instead of drawing a flat-zero (blank) chart
  const supplyForChart = info?.supply || (info?.mcapUsd && info?.price1m ? info.mcapUsd / (info.price1m / 1e6) : null);
  const scale = useMemo(() => (mode === "mcap" && supplyForChart ? supplyForChart / 1e6 : 1e-6), [mode, supplyForChart]);
  const effMode: "price" | "mcap" = mode === "mcap" && supplyForChart ? "mcap" : "price";
  const buys = eff.buys24;
  const sells = eff.sells24;
  const buyPct = buys + sells > 0 ? (buys / (buys + sells)) * 100 : 50;
  const effTrades: Trade[] = trades.length >= 5 || !venue
    ? trades
    : [...trades, ...venue.swaps.filter((s) => !trades.some((t) => t.tx === s.tx)).map((s) => ({
        block: 0, insider_pnl: null, insider_rank: null, price1m: s.price1m, side: s.side, tokens: s.price1m > 0 ? (s.usdc / s.price1m) * 1e6 : 0,
        ts: s.ts, tx: s.tx, usdc: s.usdc, venue: s.venue, wallet: s.wallet,
      }))].sort((a, b) => b.ts - a.ts);
  const walletLabels = useWalletLabels(effTrades.slice(0, 60).map((t) => t.wallet), ca);
  const effCandles: Candle[] = useMemo(() => {
    if (candles.length >= 5) return candles;
    if (venue?.candles.length) {
      // Tolly daje swiece godzinowe; dla krotszych interwalow i tak lepsze niz pustka
      const vc = venue.candles.map((c) => ({ ...c, n: 0, vb: 0 }));
      return vc.length > candles.length ? vc : candles;
    }
    const src = venue?.swaps.length ? venue.swaps : trades.length ? trades : [];
    if (src.length) {
      // 50 ostatnich swapow to zwykle <1h historii — przy grubszym interwale wyszloby 2-3 swiece
      let fromSwaps = candlesFromSwaps(src, tf);
      if (fromSwaps.length < 8) fromSwaps = candlesFromSwaps(src, "1m");
      return fromSwaps.length > candles.length ? fromSwaps : candles;
    }
    return candles;
  }, [candles, venue, tf, trades]);

  if (!info && stillLoading) return <TokenSkeleton lite={(loaded as { lite?: PadToken | null }).lite ?? null} />;
  if (!info) {
    return (
      <main className="arc-site" style={{ minHeight: "100dvh" }}>
        <ArcNav active="/trade" />
        <section className="arc-section" style={{ paddingTop: 130 }}>
          {/No token contract/.test(error ?? "") ? (
            <>
              <h1 className="arc-h2">Token not found</h1>
              <p className="arc-body">{error}</p>
            </>
          ) : (
            <>
              <h1 className="arc-h2">Arc RPC is busy right now</h1>
              <p className="arc-body">We could not read this token from the chain in time. The page retries automatically every few seconds — or search it in the Terminal, where the cached data still shows.</p>
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>{error ?? ""}</p>
              <button className="arc-mono" onClick={() => window.location.reload()} style={{ background: "var(--arc-up)", border: "none", borderRadius: 6, color: "#06130b", cursor: "pointer", fontWeight: 700, marginTop: 8, padding: "8px 14px" }} type="button">Retry now</button>
              <AutoRetry />
            </>
          )}
        </section>
      </main>
    );
  }

  const copyCa = () => {
    void navigator.clipboard?.writeText(ca);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/trade" />
      <section className="arc-section arc-token" style={{ maxWidth: 1440, paddingTop: 112 }}>
        <Link className="arc-mono" preload="intent" style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", display: "inline-flex", fontSize: 12, gap: 8, letterSpacing: "0.04em", marginBottom: 12, padding: "7px 12px", textDecoration: "none" }} to="/trade">
          <span aria-hidden style={{ color: "var(--arc-up)", fontSize: 15, lineHeight: 1 }}>←</span> Back to Terminal
        </Link>
        {/* ---------- header ---------- */}
        <div className="arc-token__head">
          <div style={{ alignItems: "center", display: "flex", gap: 14, minWidth: 0 }}>
            <TokenLogo radius={12} size={56} src={info.logo} symbol={info.symbol || "?"} />
            <div style={{ minWidth: 0 }}>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                <h1 className="arc-h3" style={{ margin: 0 }}>{info.name}</h1>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 13 }}>${info.symbol}</span>
                <span className="arc-mono" title={info.stock ? "Custodial IOU of a stock (long.supply) — trades against USDC" : `Trading pair: ${info.symbol}/${pairSym}${pairSym !== "USDC" ? " — quoted in a wrapped stock, routed USDC → " + pairSym + " → " + info.symbol : ""}`} style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: pairSym !== "USDC" ? "#7cc4ff" : "var(--arc-muted)", fontSize: 10.5, padding: "2px 6px" }}>
                  {info.symbol}/{info.stock ? "USDC · IOU" : pairSym}
                </span>
                {altPair && <span className="arc-mono" title={`Secondary market: ${info.symbol}/${altPair}. The aggregator quotes both and takes the better fill.`} style={{ color: "var(--arc-muted)", fontSize: 10.5 }}>+ /{altPair}</span>}
                {info.launchpad && (
                  <span className="arc-mono" style={{ background: info.venue === "pad" ? "var(--arc-cobalt)" : "transparent", border: "1px solid var(--arc-cobalt)", color: info.venue === "pad" ? "var(--arc-on-accent)" : "var(--arc-cobalt)", fontSize: 10, padding: "2px 7px", textTransform: "uppercase" }}>
                    {info.launchpad}
                  </span>
                )}
                {info.website && <a className="arc-mono" href={info.website} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 12 }} target="_blank">web</a>}
                {info.twitter && <a className="arc-mono" href={info.twitter} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 12 }} target="_blank">𝕏</a>}
                {info.telegram && <a className="arc-mono" href={info.telegram} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 12 }} target="_blank">✈︎</a>}
              </div>
              <div className="arc-mono" style={{ alignItems: "center", color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 11, gap: 10, marginTop: 4 }}>
                <span>Arc</span>
                <button className="arc-mono" onClick={copyCa} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "1px 7px" }} type="button">
                  {copied ? "copied" : `${ca.slice(0, 6)}…${ca.slice(-4)} ⧉`}
                </button>
                <a href={`https://arc-scan.org/token/${ca}`} rel="noreferrer" style={{ color: "var(--arc-muted)" }} target="_blank">explorer ↗</a>
                {info.createdAt && <span>{ago(Math.floor(new Date(info.createdAt).getTime() / 1000))} ago</span>}
              </div>
            </div>
          </div>
          <div className="arc-token__kpis">
            <div><p className="arc-mono arc-token__k">{tr_("MCAP")}</p><p className="arc-mono arc-token__v">{mcap !== null ? money(mcap, 0) : "—"}</p></div>
            <div><p className="arc-mono arc-token__k">{tr_("PRICE")}</p><p className="arc-mono arc-token__v">{price !== null ? `$${price < 0.01 ? price.toFixed(8) : price.toFixed(5)}` : "—"}</p></div>
            <div><p className="arc-mono arc-token__k">{tr_("LIQUIDITY")}</p><p className="arc-mono arc-token__v">{money(liquidity, 0)}</p></div>
            <div><p className="arc-mono arc-token__k">24H</p><p className="arc-mono arc-token__v" style={{ color: (eff.change["24h"] ?? 0) >= 0 ? "#22c580" : "#f0534f" }}>{pct(eff.change["24h"])}</p></div>
          </div>
        </div>

        {/* ---------- main grid ---------- */}
        <div className={"arc-token__grid" + (wide ? " arc-token__grid--wide" : "")} ref={gridRef} style={{ ["--arc-side-w" as string]: `${sideW}px` }}>
          {!wide && (
            <div className="arc-col-splitter" onDoubleClick={() => setWide(true)} onPointerDown={onSplitDown} onPointerMove={onSplitMove} onPointerUp={onSplitUp} onPointerCancel={onSplitUp}
              style={{ left: `calc(100% - ${sideW}px - 6px)` }} title="drag to widen the chart · double-click for full width"><span /></div>
          )}
          <div style={{ border: "1px solid var(--arc-line)", minWidth: 0 }}>
            <div className="arc-mono" style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 4, padding: "8px 10px" }}>
              {TFS.map((t) => (
                <button className="arc-mono" key={t} onClick={() => setTf(t)} style={{ background: tf === t ? "rgba(46,124,255,0.18)" : "transparent", border: "none", borderBottom: tf === t ? "2px solid var(--arc-cobalt)" : "2px solid transparent", color: tf === t ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "5px 9px" }} type="button">{t}</button>
              ))}
              <span style={{ flex: 1 }} />
              <button className="arc-mono" onClick={() => setWide((v) => !v)} style={{ background: wide ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid var(--arc-line)", borderRadius: 6, color: wide ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, marginRight: 6, padding: "4px 9px" }} title={wide ? "restore the side panel" : "full-width chart (swap panel moves below)"} type="button">{wide ? "⤡ split" : "⤢ wide"}</button>
              {(["price", "mcap"] as const).map((m) => (
                <button className="arc-mono" key={m} onClick={() => setMode(m)} style={{ background: "transparent", border: "none", borderBottom: mode === m ? "2px solid var(--arc-cobalt)" : "2px solid transparent", color: mode === m ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "5px 9px", textTransform: "capitalize" }} type="button">{m === "mcap" ? "MCap" : "Price"}</button>
              ))}
            </div>
            <div className="arc-mono" style={{ borderBottom: "1px solid var(--arc-line)", color: "var(--arc-muted)", fontSize: 11, padding: "6px 10px" }}>
              <span style={{ color: live ? "#22c580" : "var(--arc-muted)", marginRight: 8 }} title={live ? "live: every swap arrives over the stream within a second" : "polling every 5 s"}>{live ? "● LIVE" : "○ polling"}</span>
              {info.symbol}/{info.stock ? "USDC" : pairSym} · {effMode === "mcap" ? "Market Cap" : "Price"} · {tf} · {info.venue === "pad" ? `ArcToolsPad curve (${qSym} pair)` : info.venue === "v3" ? `Uniswap V3 ${((info.poolFee ?? 0) / 10000).toFixed(2)}%${info.graduated ? " · graduated from ArcToolsPad" : ""}` : info.venue === "v4" ? `Uniswap V4${info.launchpad && info.launchpad !== "Uniswap V4" ? ` · ${info.launchpad}` : " · hookless pool"}` : info.venue === "curve" ? "Warp bonding curve" : (info.launchpad ?? "external pool")}
              {candles.length < 5 && effCandles.length > 0 && <span style={{ marginLeft: 10, opacity: 0.7 }}>· venue data (own index syncing)</span>}
            </div>
            {adv ? (
              <TvAdvanced height={Math.max(460, Number((typeof localStorage !== "undefined" && localStorage.getItem("arc_chart_h")) || 520))} interval={tf} light={typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light"} mode={mode} onFail={() => setAdv(false)} token={params.ca.toLowerCase()} />
            ) : (
              <TvChart avatars={chartAvatars} candles={effCandles} interval={tf} markers={chartMarkers} mode={effMode} onVisible={setMarkersVisible} orderLines={orderLines} scale={scale} storageKey={params.ca} symbol={info ? `${info.symbol}/${pairSym}` : undefined} />
            )}
            <MarkerLegend data={eventsData} visible={markersVisible} />
          </div>

          {/* ---------- swap panel ---------- */}
          <aside className="arc-swap-panel" style={{ border: "1px solid var(--arc-line)", padding: 14 }}>
            <div className="arc-token__stats">
              <Cell k="MCAP" v={mcap !== null ? money(mcap, 0) : "—"} />
              <Cell k="LIQ" v={money(liquidity, 0)} />
              <Cell k="VOL 24H" v={money(eff.vol24, 0)} />
              <Cell k={ownThin && vs ? "TXNS 24H" : "TXNS"} v={String(eff.txns)} />
              <Cell k="TRADERS 24H" v={String(eff.traders24)} />
              <Cell k="HOLDERS" v={holderCount ? String(holderCount) : "—"} />
            </div>
            <div className="arc-token__stats" style={{ marginTop: 8 }}>
              {(["5m", "1h", "6h", "24h"] as const).map((k) => (
                <Cell k={k.toUpperCase()} key={k} tone={(eff.change[k] ?? 0) >= 0 ? "up" : "down"} v={pct(eff.change[k])} />
              ))}
            </div>
            {info.venue === "pad" && info.padMode === "curve" && info.targetQuote ? (
              <div style={{ marginTop: 14 }}>
                <div className="arc-mono" style={{ display: "flex", fontSize: 11, justifyContent: "space-between" }}>
                  <span style={{ color: "var(--arc-muted)" }}>bonding curve → Uniswap</span>
                  <span style={{ color: "var(--arc-cobalt)" }}>
                    {Math.min(100, ((liquidity ?? 0) / (info.targetQuote * (qUsd || 1))) * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ background: "#0e1118", border: "1px solid var(--arc-line)", height: 6, marginTop: 4 }}>
                  <div style={{ background: "var(--arc-cobalt)", height: "100%", width: `${Math.min(100, ((liquidity ?? 0) / (info.targetQuote * (qUsd || 1))) * 100)}%` }} />
                </div>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "4px 0 0" }}>
                  ${fmt(liquidity ?? 0, 0)} of ${fmt(info.targetQuote * (qUsd || 1), 0)} · at target the reserve + tokens move to a Uniswap V3 pool, LP burned
                </p>
              </div>
            ) : null}
            <div className="arc-mono" style={{ fontSize: 11, margin: "16px 0 6px" }}>
              <span style={{ color: "#22c580" }}>{buys} buys</span> <span style={{ color: "var(--arc-muted)" }}>·</span> <span style={{ color: "#f0534f" }}>{sells} sells</span>
              <span style={{ color: "var(--arc-muted)", float: "right" }}>24H</span>
            </div>
            <div style={{ background: "#f0534f", borderRadius: 2, height: 4, overflow: "hidden" }}>
              <div style={{ background: "#22c580", height: "100%", width: `${buyPct}%` }} />
            </div>

            {canTrade && (
              <div className="arc-mono" style={{ borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 2, margin: "14px 0 0" }}>
                {([["market", "Market"], ["limit", "Limit"], ["tp", "Take profit"], ["sl", "Stop loss"]] as const).map(([k, label]) => (
                  <button className="arc-mono" key={k} onClick={() => setTradeMode(k)} style={{ background: "transparent", border: "none", borderBottom: tradeMode === k ? `2px solid ${k === "market" ? "var(--arc-cobalt)" : ORDER_COLORS[k]}` : "2px solid transparent", color: tradeMode === k ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "7px 10px" }} type="button">{label}</button>
                ))}
                <span style={{ color: "var(--arc-muted)", fontSize: 10, marginLeft: "auto", padding: "9px 4px 0" }} title="Orders are a signature + an allowance; funds stay in your wallet and the contract can only fill at your price or better.">{tradeMode === "market" ? "" : "non-custodial"}</span>
              </div>
            )}
            {canTrade && tradeMode !== "market" ? (
              <OrdersPanel balTok={balTok} balUsdc={balUsdc} kind={tradeMode} onOrdersChange={setMyOrders} price={price} supply={info.supply ?? null} symbol={info.symbol} token={ca} />
            ) : canTrade ? (
              <>
                <div style={{ display: "flex", gap: 8, margin: "16px 0 10px" }}>
                  {(["buy", "sell"] as const).map((s) => (
                    <button className="arc-mono" key={s} onClick={() => { setSide(s); setAmount(""); }} style={{ background: side === s ? (s === "buy" ? "#22c580" : "#f0534f") : "transparent", border: `1px solid ${s === "buy" ? "#22c580" : "#f0534f"}`, color: side === s ? "#06090f" : (s === "buy" ? "#22c580" : "#f0534f"), cursor: "pointer", flex: 1, fontSize: 12, fontWeight: 700, padding: "8px 0", textTransform: "uppercase" }} type="button">{s}</button>
                  ))}
                </div>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "0 0 4px" }}>{tr_("YOU PAY")}</p>
                <div style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", display: "flex", gap: 8, padding: "8px 10px" }}>
                  <input className="arc-mono" inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="0.0" style={{ background: "transparent", border: "none", color: "var(--arc-ink)", flex: 1, fontSize: 20, minWidth: 0, outline: "none" }} value={amount} />
                  <span className="arc-mono" style={{ border: "1px solid var(--arc-line)", borderRadius: 14, fontSize: 12, marginRight: 4, padding: "3px 10px" }}>{side === "buy" ? (info.venue === "pad" || v3Quote ? qSym : "USDC") : info.symbol}</span>
                </div>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "4px 0 6px" }}>
                  balance {side === "buy" ? (balUsdc !== null ? `${fmt(balUsdc, 4)} ${info.venue === "pad" || v3Quote ? qSym : "USDC"}` : "—") : (balTok !== null ? `${fmt(balTok)} ${info.symbol}` : "—")}
                  {info.venue === "pad" && quoteTok !== null && qUsd > 0 && Number(amount) > 0 ? ` · ≈ $${fmt(Number(amount) * (side === "buy" ? qUsd : 1), 2)}` : ""}
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  {[0.25, 0.5, 0.75, 1].map((p) => (
                    <button className="arc-mono" key={p} onClick={() => setPctAmount(p)} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", flex: 1, fontSize: 11, padding: "7px 0" }} type="button">{p === 1 ? "Max" : `${p * 100}%`}</button>
                  ))}
                </div>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "12px 0 4px" }}>{tr_("TO (ESTIMATED)")}</p>
                <div style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", display: "flex", gap: 8, padding: "8px 10px" }}>
                  <span className="arc-mono" style={{ flex: 1, fontSize: 20 }}>{quote !== null ? fmt(quote, side === "buy" ? 2 : 4) : "0.0"}</span>
                  <span className="arc-mono" style={{ border: "1px solid var(--arc-line)", borderRadius: 14, fontSize: 12, marginRight: 4, padding: "3px 10px" }}>{side === "buy" ? info.symbol : (info.venue === "pad" || v3Quote ? qSym : "USDC")}</span>
                </div>
                {useAgg && route && route.legs.length > 0 && (
                  <div className="arc-mono" style={{ border: "1px solid var(--arc-line)", fontSize: 10, margin: "6px 0 0", padding: "6px 8px" }}>
                    <div style={{ color: "var(--arc-up)", marginBottom: 3 }}>
                      {route.split ? "SPLIT ROUTE · best price across venues" : `ROUTE · ${route.legs[0].label}`}
                    </div>
                    {route.legs.length > 1 && route.legs.map((l, i) => {
                      const total = route.legs.reduce((s, x) => s + Number(x.amount), 0);
                      return <div key={i} style={{ color: "var(--arc-muted)" }}>{Math.round((Number(l.amount) / total) * 100)}% via {l.label}</div>;
                    })}
                    {route.single.length > 1 && (
                      <div style={{ color: "var(--arc-muted)", marginTop: 3 }}>
                        {route.single.slice(0, 3).map((s, i) => {
                          const best = Number(route.single[0].out);
                          const d = best > 0 ? ((Number(s.out) - best) / best) * 100 : 0;
                          return <span key={i} style={{ marginRight: 10 }}>{s.label}{i > 0 ? ` ${d.toFixed(1)}%` : " ✓"}</span>;
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div className="arc-mono" style={{ alignItems: "center", color: "var(--arc-muted)", display: "flex", fontSize: 11, justifyContent: "space-between", margin: "8px 0" }}>
                  <span>slippage</span>
                  <span>
                    {[1, 5, 15].map((s) => (
                      <button className="arc-mono" key={s} onClick={() => setSlippage(s)} style={{ background: slippage === s ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid var(--arc-line)", color: slippage === s ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginLeft: 4, padding: "2px 7px" }} type="button">{s}%</button>
                    ))}
                  </span>
                </div>
                {err && <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 11 }}>{err}</p>}
                {msg && <p className="arc-mono" style={{ color: "#22c580", fontSize: 11 }}>{msg}</p>}
                {useAgg && (
                  <div className="arc-mono" style={{ alignItems: "center", display: "flex", fontSize: 11, gap: 8, justifyContent: "space-between", margin: "2px 0 6px" }}>
                    <span style={{ color: "var(--arc-muted)" }}>sign with</span>
                    <span>
                      <button className="arc-mono" onClick={() => setHot(false)} style={{ background: !hot ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (!hot ? "var(--arc-cobalt)" : "var(--arc-line)"), color: !hot ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "2px 8px" }} type="button">connected wallet</button>
                      {hotOk
                        ? <button className="arc-mono" onClick={() => setHot(true)} style={{ background: hot ? "rgba(34,197,128,0.18)" : "transparent", border: "1px solid " + (hot ? "var(--arc-up)" : "var(--arc-line)"), color: hot ? "var(--arc-up)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginLeft: 4, padding: "2px 8px" }} type="button">⚡ trading wallet</button>
                        : <a className="arc-mono" href={`/trade?buy=${ca}`} style={{ color: "var(--arc-up)", fontSize: 11, marginLeft: 8 }}>⚡ trading wallet ↗</a>}
                    </span>
                  </div>
                )}
                <button className="arc-cta" disabled={!!busy} onClick={() => void swap()} style={{ background: side === "buy" ? "#22c580" : "#f0534f", border: "none", color: "#06090f", cursor: busy ? "wait" : "pointer", fontWeight: 700, marginTop: 4, width: "100%" }} type="button">
                  {busy ?? (hot && hotOk && useAgg ? `⚡ ${side === "buy" ? "Buy" : "Sell"} ${info.symbol} · no popup` : wallet ? `${side === "buy" ? "Buy" : "Sell"} ${info.symbol}` : "Connect & trade")}
                </button>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 8 }}>
                  {info.venue === "pad" ? `1% platform fee, 10% of it to ARCT stakers.${info.padMode === "curve" && info.targetQuote ? ` Graduates to Uniswap at ${fmt(info.targetQuote)} ${qSym} real reserve.` : ""}` : v3Quote ? `Uniswap V3 pool ${info.symbol}/${qSym}, swapped directly (pool fee 1%, no service fee).` : "1.5% platform fee, best price across every venue (V3, V4, curves)."} Limit buy, take profit and stop loss: set them below — non-custodial, filled 24/7 by our keeper.
                </p>
              </>
            ) : (
              <div style={{ marginTop: 16 }}>
                <p className="arc-body" style={{ fontSize: 13 }}>
                  This token trades on {info.launchpad ?? "another venue"}'s own pool, which the site router cannot reach yet. You can still trade it from our sniper bot (all Arc launchpads supported) or on the venue.
                </p>
                <a className="arc-cta" href={`https://t.me/ArcSniper_bot?start=ca_${ca.slice(2)}`} rel="noreferrer" style={{ display: "block", textAlign: "center", textDecoration: "none" }} target="_blank">Trade in @ArcSniper_bot</a>
                {info.venueUrl && <a className="arc-mono" href={info.venueUrl} rel="noreferrer" style={{ color: "var(--arc-muted)", display: "block", fontSize: 12, marginTop: 10, textAlign: "center" }} target="_blank">open on {info.launchpad ?? "venue"} ↗</a>}
              </div>
            )}
            {tradeMode === "market" && <OrdersPanel balTok={balTok} balUsdc={balUsdc} kind="list" onOrdersChange={setMyOrders} price={price} supply={info.supply ?? null} symbol={info.symbol} token={ca} />}
          </aside>
        </div>

        {/* ---------- social check: who is behind the token ---------- */}
        {info.venue === "pad" && info.padAddress && (
          <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 10 }}>
            ArcToolsPad launch · <Link params={{ ca }} style={{ color: "var(--arc-cobalt)" }} to="/pad/$ca">curve details & creator tools (logo, socials) →</Link>
          </div>
        )}
        {info.stock ? <StockCard stock={info.stock} token={ca} /> : <RiskCard official={ca.toLowerCase() === "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52"} token={ca} />}
        {info.longPool && !info.stock && (
          <section style={{ border: "1px solid var(--arc-line)", marginTop: 14, padding: "10px 14px" }}>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em" }}>MAIN MARKET · long.supply</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Quoted in <b>{info.longPool.pairSymbol}</b> (a wrapped-stock IOU trading at ${info.longPool.pairUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} on Arc) on a Uniswap V3 pool
              {info.longPool.liquidityUsd != null ? <> with <b>${Math.round(info.longPool.liquidityUsd).toLocaleString()}</b> liquidity</> : null}. USD price = pool price × what the IOU actually trades for on Arc (its deepest USDC pool), not the NYSE quote.
              {info.venue !== "external" ? " Our aggregator quotes both the USDC pool and the two-hop route through the stock and takes the better fill." : ` No USDC pool — our aggregator buys ${info.longPool.pairSymbol} with your USDC and swaps it into the token in one transaction (1.5% fee).`}
              {" "}<a href={`https://long.supply/${ca.toLowerCase()}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">open on long.supply ↗</a>
            </div>
          </section>
        )}
        <SocialCheck deployer={info.deployer} tg={info.telegram} token={ca} web={info.website} x={info.twitter} />
        <SmartFollowers x={info.twitter} />
        <KolMentions token={ca} />

        {/* ---------- tabs ---------- */}
        <div style={{ border: "1px solid var(--arc-line)", marginTop: 14 }}>
          <div style={{ borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 2, padding: "0 8px" }}>
            {(["trades", "positions", "holders", "bubbles", "traders", "dev", "info"] as const).map((t) => (
              <button className="arc-mono" key={t} onClick={() => setTab(t)} style={{ background: "transparent", border: "none", borderBottom: tab === t ? "2px solid var(--arc-cobalt)" : "2px solid transparent", color: tab === t ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "10px 12px", textTransform: "uppercase" }} type="button">{({ trades: "Trades", positions: "My position", holders: `Holders${holderCount ? ` ${holderCount}` : ""}`, bubbles: "Bubble map", traders: "Top traders", dev: "Dev tokens", info: "Info" } as const)[t]}</button>
            ))}
          </div>
          {tab === "trades" && (
            <div style={{ maxHeight: 460, overflow: "auto" }}>
              <table className="arc-mono arc-token__table">
                <thead><tr><th>age</th><th>side</th><th>USDC</th><th>{info.symbol}</th><th>price</th><th>wallet</th><th>tx</th></tr></thead>
                <tbody>
                  {effTrades.map((t) => (
                    <tr key={t.tx + t.ts}>
                      <td style={{ color: "var(--arc-muted)" }}>{ago(t.ts)}</td>
                      <td style={{ color: t.side === "buy" ? "#22c580" : "#f0534f", textTransform: "uppercase" }}>{t.side}</td>
                      <td>${fmt(t.usdc, 2)}</td>
                      <td>{fmt(t.tokens, 0)}</td>
                      <td style={{ color: "var(--arc-muted)" }}>${(t.price1m / 1e6).toFixed(8)}</td>
                      <td>
                        <a href={`https://arc-scan.org/address/${t.wallet}`} rel="noreferrer" style={{ color: "var(--arc-ink)", textDecoration: "none" }} target="_blank">{t.wallet.slice(0, 6)}…{t.wallet.slice(-4)}</a>
                        <Tags labels={walletLabels} wallet={t.wallet} />
                        {t.insider_rank && t.insider_rank <= 50 && !walletLabels[t.wallet.toLowerCase()]?.some((l) => l.kind === "insider") && (
                          <a href="/insiders" style={{ background: "rgba(46,124,255,0.18)", border: "1px solid var(--arc-cobalt)", color: "var(--arc-cobalt)", fontSize: 10, marginLeft: 8, padding: "2px 7px", textDecoration: "none", whiteSpace: "nowrap" }} title={`Insider #${t.insider_rank} · 30d PnL $${fmt(t.insider_pnl ?? 0, 0)}`}>INSIDER #{t.insider_rank}</a>
                        )}
                      </td>
                      <td><a href={`https://arc-scan.org/tx/${t.tx}`} rel="noreferrer" style={{ color: "var(--arc-muted)" }} target="_blank">↗</a></td>
                    </tr>
                  ))}
                  {effTrades.length === 0 && <tr><td colSpan={7} style={{ color: "var(--arc-muted)", padding: 18, textAlign: "center" }}>No trades indexed yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {tab === "positions" && (
            <MyPosition onSell={(pct) => { setSide("sell"); if (balTok != null) setAmount(String(Math.floor((balTok * pct) / 100 * 1e6) / 1e6)); window.scrollTo({ behavior: "smooth", top: 0 }); }} onchainBalance={balTok} symbol={info.symbol} token={ca} wallet={hot && isUnlocked() ? hotAddress() : wallet} />
          )}
          {tab === "traders" && <TopTraders symbol={info.symbol} token={ca} />}
          {tab === "dev" && <DevTokens current={ca} dev={info.deployer} />}
          {tab === "bubbles" && <BubbleMap deployer={(info as { deployer?: string | null }).deployer ?? null} token={ca} />}
          {tab === "holders" && (
            <div style={{ padding: 12 }}>
              {holders && holders.top.length > 0 ? holders.top.map((h, i) => (
                <div className="arc-mono" key={h.address} style={{ alignItems: "center", display: "flex", fontSize: 12, gap: 10, padding: "6px 0" }}>
                  <span style={{ color: "var(--arc-muted)", width: 26 }}>{i + 1}</span>
                  <a href={`https://arc-scan.org/address/${h.address}`} rel="noreferrer" style={{ color: "var(--arc-ink)", textDecoration: "none", width: 130 }} target="_blank">{h.address.slice(0, 6)}…{h.address.slice(-4)}</a>
                  <span style={{ background: "#0e1118", flex: 1, height: 6 }}><span style={{ background: "var(--arc-cobalt)", display: "block", height: "100%", width: `${Math.min(100, h.pct)}%` }} /></span>
                  <span style={{ width: 60, textAlign: "right" }}>{h.pct.toFixed(2)}%</span>
                </div>
              )) : <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>Holder data unavailable.</p>}
            </div>
          )}
          {tab === "info" && (
            <div className="arc-mono" style={{ display: "grid", fontSize: 12, gap: 8, gridTemplateColumns: "160px 1fr", padding: 14 }}>
              <span style={{ color: "var(--arc-muted)" }}>contract</span><span>{ca}</span>
              <span style={{ color: "var(--arc-muted)" }}>pool</span><span>{info.pool ?? "—"}</span>
              <span style={{ color: "var(--arc-muted)" }}>venue</span><span>{info.venue === "pad" ? "ArcToolsPad bonding curve" : info.venue === "v3" ? `Uniswap V3, fee tier ${((info.poolFee ?? 0) / 10000).toFixed(2)}%` : info.venue === "v4" ? `Uniswap V4 (${info.launchpad && info.launchpad !== "Uniswap V4" ? info.launchpad : "no hook"}), ${info.v4Key?.usdc_dec === 6 ? "USDC facade" : "native USDC"} pair` : `${info.launchpad ?? "external"} pool`}</span>
              <span style={{ color: "var(--arc-muted)" }}>supply</span><span>{fmt(info.supply, 0)} {info.symbol}</span>
              <span style={{ color: "var(--arc-muted)" }}>decimals</span><span>{info.decimals}</span>
              <span style={{ color: "var(--arc-muted)" }}>all-time volume</span><span>{money(eff.volAll, 0)} over {stats?.txns_all ?? "—"} indexed trades</span>
              {info.venue === "pad" && (<><span style={{ color: "var(--arc-muted)" }}>creator tools</span><a href={`/pad/${ca}`} style={{ color: "var(--arc-cobalt)" }}>edit logo & socials, claim rewards →</a></>)}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
