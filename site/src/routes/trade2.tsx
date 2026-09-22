import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { loadMeta, peekBirthdays } from "@/lib/token-meta";
import { BOT_API, BOT_ORIGIN } from "@/lib/bot-api";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { DsRail } from "@/components/ds-rail";
import { usePrefs } from "@/lib/i18n";
import { holderRisk, listAllTokens, listFirstPaint, tokenLogos, type PadToken, xAvatar } from "@/lib/arc-api";
import { rememberRows } from "@/lib/lite-cache";
import { ARC_AGGREGATOR, connectWallet, encodeAggregatorSwap, ethCall, getStoredWallet, onWalletChange, p32, sendTx, waitReceipt } from "@/lib/arc-wallet";
import { hasWallet, hotAddress, hotCall, hotSend, hotWait } from "@/lib/arc-hotwallet";
import { TokenLogo } from "@/components/token-logo";
import { QuickBuy } from "@/components/quick-buy";
import { TradeToasts } from "@/components/trade-toasts";
import { ArcFeed } from "@/components/arc-feed";
import { ChainSearch } from "@/components/chain-search";
import { ScoreBadge, type Risk } from "@/components/risk";
import { creditRef } from "@/lib/arc-ref";
import { WalletPanel } from "@/components/wallet-panel";
import { routeSwap, type RouteResult } from "@/lib/arc-route";
import { quickAmount, setQuickAmount } from "@/components/quick-buy";
import "../arc-site.css";

const API = BOT_API;
const SNIPER = "https://t.me/ArcSniper_bot";

export const Route = createFileRoute("/trade2")({
  // SSR: the first paint already contains the table (lists come from the KV-backed memo — milliseconds)
  loader: async () => {
    // never hold the HTML for a cold compute: whatever is ready within 1.5 s ships, the client fills the rest.
    // (a 20 s+ SSR here is what produced the "This page didn't load" screen when the Worker hit its limits)
    const within = <T,>(p: Promise<T>, ms: number, fb: T) => Promise.race([p.catch(() => fb), new Promise<T>((res) => setTimeout(() => res(fb), ms))]);
    const rowsP = listFirstPaint();   // ~120 KB, not the 3 MB full list — the client fetches that after hydration
    const trendP = fetch(`${API}/api/trending?minutes=0&limit=400`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then((j) => (j.rows ?? []) as Trend[]);
    // the default tab is Trending and it reads `hot` (sort=trend, 24 h) — without this the first paint showed the
    // all-time list and the table re-sorted itself 0.5 s later. Same for the risk column: it arrived as "…" and
    // filled in row by row. Both are edge-cached now, so shipping them in the HTML costs the SSR ~nothing.
    const hotP = fetch(`${API}/api/trending?minutes=1440&limit=200&sort=trend`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then((j) => (j.rows ?? []) as Trend[]);
    const HOLD = 800;
    const riskFrom = (list: Trend[]) => {
      const page = list.slice(0, 50).map((t) => t.token.toLowerCase());
      return page.length
        ? fetch(`${API}/api/holder-risk?tokens=${page.join(",")}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json()).then((j) => (j.risk ?? {}) as Record<string, unknown>).catch(() => ({} as Record<string, unknown>))
        : Promise.resolve({} as Record<string, unknown>);
    };
    const riskP = hotP.then(riskFrom).catch(() => ({} as Record<string, unknown>));
    const [rowsAll, trendAll, hotAll, risk0] = await Promise.all([
      within(rowsP, HOLD, [] as PadToken[]), within(trendP, HOLD, [] as Trend[]), within(hotP, HOLD, [] as Trend[]),
      within(riskP, HOLD, {} as Record<string, unknown>),
    ]);
    if (typeof window === "undefined") { try { const { keepAlive } = await import("@/lib/memo-kv"); keepAlive(rowsP.catch(() => null)); keepAlive(trendP.catch(() => null)); } catch { /* no runtime */ } }
    // ship only what the first paint needs (Trending top-120 + 80 newest for the New tabs): the full 7k-row list
    // (4 MB of HTML!) arrives from /api/tokens?full=1 right after hydration. Search / other tabs use that list.
    const trend = trendAll.slice(0, 120);
    const keep = new Set(trend.map((t) => t.token.toLowerCase()));
    const byTs = (t: PadToken) => (t.createdAt ? Date.parse(t.createdAt) : 0);
    const newest = [...rowsAll].sort((a, b) => byTs(b) - byTs(a)).slice(0, 80);
    for (const t of newest) keep.add(t.token.toLowerCase());
    keep.add("0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52");
    const rows = rowsAll.filter((t) => keep.has(t.token.toLowerCase()));
    for (const t of hotAll.slice(0, 60)) keep.add(t.token.toLowerCase());
    // only the fields the first paint reads — the full records arrive with /api/tokens?lite=1 after hydration
    const slim = (t: PadToken): PadToken => ({
      token: t.token, symbol: t.symbol, name: t.name, pad: t.pad, logo: t.logo, createdAt: t.createdAt,
      mcapUsd: t.mcapUsd, priceUsd: t.priceUsd, volUsd: t.volUsd, liqUsd: t.liqUsd, curve: t.curve,
      twitter: t.twitter, telegram: t.telegram, website: t.website, stock: t.stock, og: t.og, quoteSymbol: t.quoteSymbol,
    } as PadToken);
    const slimT = (t: Trend): Trend => ({ token: t.token, symbol: t.symbol, txs: t.txs, vol: t.vol, buys: t.buys, sells: t.sells, traders: t.traders,
      p1: t.p1, chg: t.chg, first_ts: t.first_ts, mcap: t.mcap, ath_mcap: t.ath_mcap, clone: (t as { clone?: boolean }).clone } as unknown as Trend);
    return { rows: rowsAll.filter((t) => keep.has(t.token.toLowerCase())).map(slim), trend: trend.map(slimT), hot: hotAll.slice(0, 60).map(slimT), risk0, partial: true };
  },
  staleTime: 10_000,
  head: () => ({
    meta: [
      { title: "ArcTools Terminal: one-click buys on every Arc launchpad" },
      { content: "Pro trading terminal for Arc: new pairs, trending, insider picks, one-click buy and sell from an in-browser wallet, best price across every venue.", name: "description" },
    ],
  }),
  component: Trade,
});

type Mover = { token: string; n: number; vol: number; p1: number; chg: number; symbol: string | null };
type Trend = { token: string; symbol: string | null; txs: number; vol: number; buys: number; sells: number; traders: number; p1: number | null; chg: number | null; first_ts: number | null; ath: number | null; txs_all: number; supply: number | null; mcap: number | null; ath_mcap: number | null };
type Smart = { token: string; net: number; bought: number; sold: number; buyers: number; sellers: number; best_rank: number | null; last_ts: number };
type Row = { curve: number | null; token: string; symbol: string; name: string; logo: string | null; pad: string; og: boolean; stock: boolean; smart: Smart | null; quoteSymbol: string | null; dexes: string[]; age: number | null; ca: string; mcap: number | null; chg: number | null; athMcap: number | null; liq: number | null; vol: number; txs: number; buys: number; sells: number; traders: number; insiders: number; twitter: string | null; telegram: string | null; website: string | null; price: number | null };
const FAV_KEY = "arctools_favs";
const loadFavs = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]")); } catch { return new Set(); } };
type Cluster = { token: string; symbol: string | null; insiders: number; usd: number; ranks: string; last_ts: number };
type Position = { token: string; symbol: string | null; net: number; avg: number; price: number | null; value: number | null; unrealized: number | null; realized: number; cost: number; n: number; last_ts: number };

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v) || v < 0) return "—";
  if (v >= 1e13) return "—";                                   // nonsense (decimals bug upstream) — never print 3.99e+26
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1000) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
};
const num = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (iso: string | null | number) => {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso * 1000 : new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const priceStr = (p: number | null) => (p == null ? "—" : p >= 1 ? `$${p.toFixed(4)}` : `$${p.toFixed(Math.max(2, -Math.floor(Math.log10(p)) + 3))}`);

const SEL = { balanceOf: "0x70a08231", allowance: "0xdd62ed3e", approve: "0x095ea7b3" };
const tfLabel = (m: number) => (m === 0 ? "All" : m < 60 ? `${m}m` : `${m / 60}h`);
const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";
const cell: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 12.5, padding: "8px 6px 8px 0", verticalAlign: "middle", whiteSpace: "nowrap" };
const hd: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 10, fontWeight: 400, padding: "0 8px 8px 0", textAlign: "left", textTransform: "uppercase", whiteSpace: "nowrap" };

// ---------------- page ----------------
/** The official ArcTools token — pinned on top of every Terminal tab, same as on the feed. */
const OFFICIAL_TOKEN = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";
const OFFICIAL_META: PadToken = { createdAt: "2026-09-09T10:12:53.699Z", logo: "https://i.ibb.co/xSh1WBWy/hf-20260909-062713-c61f9f46-e827-41b1-82e0-bb565b9c05b3.png", mcapUsd: null, name: "ArcTools", pad: "RadarDex", pool: "0xf89005ccf237a59eeee1521e74b15c7d8d022ab7", priceUsd: null, symbol: "ARCT", telegram: "https://t.me/ArcToolsPortal", token: OFFICIAL_TOKEN, twitter: "https://x.com/ArcToolsBackup", venueUrl: `/token/${OFFICIAL_TOKEN}`, volUsd: null, website: "https://arctools.fun" };


/** Chain-wide readout above the list: what the whole of Arc did today, from our own index. */
function DsChainStrip() {
  const [s, setS] = useState<{ vol?: number; txns?: number; block?: number; age?: number }>({});
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [t, c] = await Promise.all([
          fetch(`${BOT_API}/api/trending?minutes=1440&limit=400`).then((r) => r.json()) as Promise<{ rows?: { vol: number; txs: number }[] }>,
          fetch(`${BOT_API}/api/chain-status`).then((r) => r.json()) as Promise<{ last_block?: number; stale_s?: number }>,
        ]);
        if (!alive) return;
        const rows = t.rows ?? [];
        setS({
          age: c.stale_s,
          block: c.last_block,
          txns: rows.reduce((a, r) => a + (r.txs || 0), 0),
          vol: rows.reduce((a, r) => a + (r.vol || 0), 0),
        });
      } catch { /* the list works without the strip */ }
    };
    void pull();
    const id = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const usd = (v?: number) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);
  return (
    <div className="arc-dss">
      <div><span>24H VOLUME</span><b>{usd(s.vol)}</b></div>
      <div><span>24H TXNS</span><b>{s.txns != null ? s.txns.toLocaleString("en-US") : "—"}</b></div>
      <div><span>LATEST BLOCK</span><b>{s.block ? s.block.toLocaleString("en-US") : "—"}<i>{s.age != null ? `${s.age}s ago` : ""}</i></b></div>
    </div>
  );
}

function Trade() {
  const { t: tr_ } = usePrefs();
  const navigate = useNavigate();
  // whole row is clickable: one click = token page with chart + swap; buttons/links inside keep their own action
  const rowClick = (token: string) => (e: React.MouseEvent<HTMLTableRowElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest("button, a, input")) return;
    // phones: a whole-row tap target makes scrolling/mis-taps open token pages — only the token cell navigates there
    if (typeof window !== "undefined" && window.innerWidth <= 760 && !el.closest(".arc-tokcell")) return;
    void navigate({ to: "/token2/$ca", params: { ca: token } });
  };
  const [hotAddr, setHotAddr] = useState<string | null>(null);
  const [pendingBuy, setPendingBuy] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState<"" | "settings" | "filters">("");
  // who signs: the in-browser trading wallet (one click) or the connected browser wallet (MetaMask/Rabby — confirm each tx)
  const [signer, setSigner] = useState<"hot" | "browser">("hot");
  const [toastsOn, setToastsOn] = useState(true);
  // Row flash: every buy/sell that lands on a listed token lights its row for a moment (green buy, red sell), so
  // the table shows trade flow without opening a token page. Off by default only if the user turned it off before.
  const [flashOn, setFlashOn] = useState(true);
  const [flash, setFlash] = useState<Record<string, { side: "buy" | "sell"; at: number; usdc: number }>>({});
  const flashOnRef = useRef(true);
  // Only trades worth real money should light a row — at $1 the table would strobe on spray-bot dust all day.
  const FLASH_STEPS = [100, 500, 1_000, 5_000, 25_000] as const;
  const [flashMin, setFlashMin] = useState<number>(1_000);
  const flashMinRef = useRef(1_000);
  useEffect(() => {
    try {
      setFlashOn(localStorage.getItem("arctools_flash") !== "0");
      const m = Number(localStorage.getItem("arctools_flash_min"));
      if (Number.isFinite(m) && m > 0) setFlashMin(m);
    } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    flashMinRef.current = flashMin;
    try { localStorage.setItem("arctools_flash_min", String(flashMin)); } catch { /* private mode */ }
  }, [flashMin]);
  useEffect(() => {
    flashOnRef.current = flashOn;
    try { localStorage.setItem("arctools_flash", flashOn ? "1" : "0"); } catch { /* private mode */ }
    if (!flashOn) setFlash({});
  }, [flashOn]);
  useEffect(() => {
    if (!flashOn) return;
    const id = setInterval(() => {                 // drop expired marks so rows do not stay lit
      const now = Date.now();
      setFlash((f) => {
        const keep = Object.entries(f).filter(([, v]) => now - v.at < 1600);
        return keep.length === Object.keys(f).length ? f : Object.fromEntries(keep);
      });
    }, 700);
    return () => clearInterval(id);
  }, [flashOn]);
  // feed-style filters: launchpad / source, market-cap band, min volume (all persisted in the URL-free local state)
  const [padF, setPadF] = useState<string>("all");
  // four windows side by side, like the reference. One call per window, refreshed together, cached by the bot.
  const [chgWin, setChgWin] = useState<Record<string, { m5: number | null; h1: number | null; h6: number | null; h24: number | null }>>({});
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const wins: [keyof typeof out[string], number][] = [["m5", 5], ["h1", 60], ["h6", 360], ["h24", 1440]];
      const out: Record<string, { m5: number | null; h1: number | null; h6: number | null; h24: number | null }> = {};
      await Promise.all(wins.map(async ([key, minutes]) => {
        try {
          const j = (await (await fetch(`${API}/api/trending?minutes=${minutes}&limit=400`)).json()) as { rows?: { token: string; chg: number | null }[] };
          for (const r of j.rows ?? []) {
            const k = r.token.toLowerCase();
            out[k] = out[k] ?? { h1: null, h24: null, h6: null, m5: null };
            out[k][key] = r.chg ?? null;
          }
        } catch { /* one window missing just leaves a dash */ }
      }));
      if (alive && Object.keys(out).length) setChgWin(out);
    };
    void pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  // 28 source chips in one row is a wall: show the handful people actually filter by and keep the rest one click away
  const [padsOpen, setPadsOpen] = useState(false);
  // launchpads the indexer knows that are not on the hand-typed list below (a new pad shows up here the day it launches)
  const [extraPads, setExtraPads] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/padcounts").then((r) => r.json()).then((j: { rows?: { pad: string; n: number }[] }) => {
      if (alive && j.rows) setExtraPads(j.rows.map((r) => r.pad).filter((x) => !!x && x !== "UniswapV3"));
    }).catch(() => null);
    return () => { alive = false; };
  }, []);
  // ?pad=Minara — what the rail links to. Without this the link navigated but the list stayed unfiltered.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const want = qs.get("pad");
    if (want) {
      const hit = PADS.find(([k]) => norm(k) === norm(want)) ?? PADS.find(([, l]) => norm(l) === norm(want));
      setPadF(hit ? hit[0] : want);
    }
    // the rail also links to tabs and sorts; without this they navigated and changed nothing
    const wantTab = qs.get("tab");
    const TABS: Record<string, typeof tab> = {
      all: "all", alpha: "alpha", favs: "favs", holdings: "holdings", insiders: "insiders",
      new: "new", new15: "new15", topvol: "topvol", trending: "trending",
    };
    if (wantTab && TABS[wantTab]) setTab(TABS[wantTab]);
    const wantSort = qs.get("sort");
    if (wantSort && ["age", "chg", "liq", "mcap", "txs", "vol"].includes(wantSort)) setSortKey(wantSort as typeof sortKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const PAGE = 50;
  const [page, setPage] = useState(1);
  const [minMc, setMinMc] = useState(""); const [maxMc, setMaxMc] = useState(""); const [minVol, setMinVol] = useState("");
  const PAD_PRIMARY = ["all", "ArcToolsPad", "UniswapV4", "Hopium", "Minara", "Stocks"];
  const PADS_BASE: [string, string][] = [["all", tr_("All sources")], ["ArcToolsPad", "ArcToolsPad"], ["ArcPad", "ArcPad"], ["RadarDex", "RadarDex"], ["Warp", "Warp"], ["Tolly", "Tolly"], ["Archemist", "Archemist"], ["Arguspad", "Arguspad"], ["UniswapV4", "Uniswap V4"], ["UniswapV3", "Uniswap V3 pools"], ["Lift", "Lift"], ["eve.fun", "eve.fun"], ["Ellipse", "Ellipse"], ["Sashimi", "Sashimi"], ["aka.fun", "aka.fun"], ["long.supply", "📈 Stock pairs"], ["Stocks", "📈 Stocks"], ["DYORSwap", "DYORSwap · V2"], ["UBI.fun", "UBI.fun"], ["Klik", "Klik"], ["Minara", "Minara"], ["faze.fun", "faze.fun"], ["sharc.fun", "sharc.fun"], ["creo.family", "creo.family"], ["peach.ag", "peach.ag"], ["pools.trade", "pools.trade"], ["Hopium", "Hopium"]];
  const PADS: [string, string][] = useMemo(() => {
    const normK = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const seen = new Set(PADS_BASE.map(([k]) => normK(k)));
    const out = [...PADS_BASE];
    for (const x of extraPads) if (!seen.has(normK(x))) { seen.add(normK(x)); out.push([x, x]); }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraPads]);
  useEffect(() => { try { setToastsOn(localStorage.getItem("arctools_toasts") !== "0"); } catch { /* ignore */ } }, []);
  const toggleToasts = () => setToastsOn((v) => { try { localStorage.setItem("arctools_toasts", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const [browserAddr, setBrowserAddr] = useState<string | null>(null);
  useEffect(() => { setBrowserAddr(getStoredWallet()); return onWalletChange(setBrowserAddr); }, []);
  const addr = signer === "hot" ? hotAddr : browserAddr;
  const setAddr = setHotAddr;
  const send = async (tx: { to: string; data: string; value?: bigint; gasLimit?: bigint }) =>
    signer === "hot" ? hotSend(tx) : sendTx({ to: tx.to, data: tx.data, value: tx.value, from: addr! });
  const wait = async (h: string) => signer === "hot" ? hotWait(h) : waitReceipt(h, 90_000).then((r) => ({ status: Number(r.status) }));
  const call = async (to: string, data: string) => signer === "hot" ? hotCall(to, data) : ethCall(to, data);
  const [amount, setAmount] = useState(5);
  const [custom, setCustom] = useState("");
  const [slip, setSlip] = useState(5);
  const [tab, setTab] = useState<"all" | "new" | "new15" | "trending" | "insiders" | "favs" | "holdings" | "alpha" | "topvol">("trending");
  // Top vol ranks by volume since the token's first trade, so it answers "what are the biggest markets on Arc"
  // instead of "what is hot in the last hour" — Trending already covers the second question. Its own fetch, its
  // own cache: opening the tab never disturbs the live list.
  const [volAll, setVolAll] = useState<Trend[]>([]);
  useEffect(() => {
    if (tab !== "topvol" || volAll.length) return;
    let alive = true;
    fetch(`${API}/api/trending?minutes=0&limit=400`)
      .then((r) => r.json())
      .then((j: { rows?: Trend[] }) => { if (alive && j.rows?.length) setVolAll(j.rows); })
      .catch(() => null);
    return () => { alive = false; };
  }, [tab, volAll.length]);
  // ---- ⚡ Alpha: composite screener from our own data (smart money, clusters, buyer acceleration, KOLs, clean risk).
  // Top 3 visible to everyone; the full list unlocks for ARCT stakers (same gate as /insiders).
  type AlphaRow = { mode?: string; token: string; symbol: string | null; score: number; reasons: string[]; age_s: number | null; vol_6h: number; buyers_30m: number; sm_wallets: number; sm_usd: number; cluster: number; liq: number | null; price1m: number | null; mcap: number | null; first_ts: number | null; first_score: number | null; first_mcap: number | null; since_call: number | null };
  const [alphaMode, setAlphaMode] = useState<"fresh" | "accum" | "revival">("fresh");
  const [alpha, setAlpha] = useState<Record<string, AlphaRow[]>>({});
  const [alphaLoading, setAlphaLoading] = useState(false);
  const [alphaUnlocked, setAlphaUnlocked] = useState(false);
  const alphaTouched = useRef(false);
  const ALPHA_GATE = 10_000;
  useEffect(() => {
    if (tab !== "alpha") return;
    let alive = true;
    const load = () => {
      setAlphaLoading(true);
      // the other two modes are fetched in the background as well: on first open jump to whichever has picks
      // (fresh is empty most of the day by design — it only fires when smart money enters a < 1 h token)
      void Promise.all([fetch(`${API}/api/alpha?mode=all&limit=40`).then((r) => r.json()).then((j: { rows?: AlphaRow[] }) => { const by: Record<string, AlphaRow[]> = { accum: [], fresh: [], revival: [] }; for (const row of j.rows ?? []) (by[row.mode as string] ??= []).push(row); return ["all", by] as const; }).catch(() => ["all", { accum: [], fresh: [], revival: [] } as Record<string, AlphaRow[]>] as const)])
        .then((all) => {
          if (!alive) return;
          // one request now scores every play in a single pass over the same six hours of swaps — three separate
          // calls each re-loaded that window and the tab timed out into an empty state
          const next: Record<string, AlphaRow[]> = all[0][1];
          setAlpha(next);
          if (!alphaTouched.current && !(next[alphaMode] ?? []).length) { const best = (["accum", "revival", "fresh"] as const).find((m) => (next[m] ?? []).length); if (best) setAlphaMode(best); }
        }).finally(() => { if (alive) setAlphaLoading(false); });
    };
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 45_000);
    return () => { alive = false; clearInterval(id); };
  }, [tab, alphaMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const w = browserAddr ?? hotAddr;
    if (!w) { setAlphaUnlocked(false); return; }
    ethCall("0x48aDA931C2C220B074c39449B7e70860A3B4C277", "0x98807d84" + p32(w)).then((r) => {
      const staked = r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : 0;
      setAlphaUnlocked(staked >= ALPHA_GATE);
    }).catch(() => setAlphaUnlocked(false));
  }, [browserAddr, hotAddr]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = Route.useLoaderData();
  const [rows, setRows] = useState<PadToken[]>(initial?.rows ?? []);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [trend, setTrend] = useState<Trend[]>(initial?.trend ?? []);
  const [hot, setHot] = useState<Trend[]>((initial as { hot?: Trend[] } | undefined)?.hot ?? []);
  // ---- LIVE: every swap on Arc (≥ $1) arrives over SSE in 300 ms frames → the row's vol / txs / buys-sells / price / MC
  //      move the moment the block lands; toasts get the same feed via a window event. Polling stays as fallback.
  const [liveFeed, setLiveFeed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null; let closed = false; let backoff = 1000;
    type LiveT = { tx: string; log_index?: number; ts: number; token: string; wallet?: string; side: "buy" | "sell"; usdc: number; price1m: number };
    const apply = (batch: LiveT[]) => {
      const ok = batch.filter((t) => Number(t.price1m) > 0 && Number(t.usdc) > 0);
      if (!ok.length) return;
      window.dispatchEvent(new CustomEvent("arc-live-trades", { detail: ok }));
      setTrend((prev) => {
        if (!prev.length) return prev;
        const idx = new Map(prev.map((r, i) => [r.token.toLowerCase(), i]));
        let next: Trend[] | null = null;
        if (flashOnRef.current) {
          const big = ok.filter((t) => (t.usdc ?? 0) >= flashMinRef.current);
          if (big.length) {
            const now = Date.now();
            setFlash((f) => {
              const n = { ...f };
              for (const t of big) n[t.token.toLowerCase()] = { at: now, side: t.side, usdc: t.usdc };
              return n;
            });
          }
        }
        for (const t of ok) {
          const i = idx.get(t.token.toLowerCase()); if (i == null) continue;
          if (!next) next = [...prev];
          const r = next[i]; const p1 = t.price1m;
          const mcap = r.supply && p1 > 0 ? (p1 / 1e6) * r.supply : r.mcap;
          next[i] = { ...r, txs: r.txs + 1, txs_all: r.txs_all + 1, vol: r.vol + t.usdc, buys: r.buys + (t.side === "buy" ? 1 : 0), sells: r.sells + (t.side === "sell" ? 1 : 0),
            p1, mcap, ath: r.ath != null ? Math.max(r.ath, p1) : r.ath, ath_mcap: r.ath_mcap != null && mcap != null ? Math.max(r.ath_mcap, mcap) : r.ath_mcap };
        }
        return next ?? prev;
      });
    };
    const open = () => {
      if (closed) return;
      es = new EventSource(`${BOT_ORIGIN}/api/stream`);
      es.addEventListener("hello", () => { backoff = 1000; setLiveFeed(true); });
      es.addEventListener("trade", (ev) => { try { apply([JSON.parse((ev as MessageEvent).data)]); } catch { /* malformed */ } });
      es.addEventListener("trades", (ev) => { try { apply(JSON.parse((ev as MessageEvent).data)); } catch { /* malformed */ } });
      es.onerror = () => { setLiveFeed(false); es?.close(); es = null; if (!closed) setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15_000); };
    };
    open();
    return () => { closed = true; es?.close(); };
  }, []);
  // one pushed connection replaces the trend / hot / volAll pollers. While it is alive those timers only run as a
  // 2-minute safety net; if it drops, they go back to their old cadence. (14 timers -> ~26 requests a minute per
  // tab, each a Cloudflare -> Railway trip and a full table re-render: that was the "lag".)
  const pushAlive = useRef(false);
  const [tf, setTf] = useState(0);
  const tfRef = useRef(0);
  useEffect(() => { tfRef.current = tf; }, [tf]);   // 0 = all-time (default): every token shows its full volume / txs / change
  const [, setPushTick] = useState(0);
  const lastFrame = useRef(0);          // when the LAST trending frame for the current window arrived
  // The stream carries the windows it is asked for. It used to ask for "1440,0" only, so on any other timeframe
  // (5m/15m/1h/6h) no trending frame ever arrived while `pushAlive` still throttled the pollers to 120 s — market
  // caps froze for two minutes at a time. Now the stream follows the timeframe and reconnects when it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let es: EventSource | null = null; let closed = false; let backoff = 2000;
    const mins = tf === 0 ? 1440 : tf;
    const wins = Array.from(new Set([String(tf), String(mins), "1440"])).join(",");
    lastFrame.current = 0;
    const open = () => {
      if (closed) return;
      es = new EventSource(`${API}/api/stream?feed=terminal&windows=${wins}`);
      es.addEventListener("hello", () => { pushAlive.current = true; backoff = 2000; setPushTick((n) => n + 1); });
      es.addEventListener("trending", (ev) => {
        try {
          const q = (ev as MessageEvent).lastEventId || "";
          const j = JSON.parse((ev as MessageEvent).data) as { rows?: Trend[] };
          if (!Array.isArray(j.rows) || !j.rows.length) return;
          if (q === `minutes=${tf}&limit=400`) { setTrend(j.rows); lastFrame.current = Date.now(); if (tf === 0) setVolAll(j.rows); }
          else if (q === "minutes=0&limit=400") setVolAll(j.rows);
          else if (q === `minutes=${mins}&limit=200&sort=trend`) { setHot(j.rows); lastFrame.current = Date.now(); }
        } catch { /* a bad frame is not worth a broken table */ }
      });
      es.onerror = () => { pushAlive.current = false; setPushTick((n) => n + 1); es?.close(); es = null; if (!closed) setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15_000); };
    };
    open();
    return () => { closed = true; es?.close(); };
  }, [tf]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** push is only "alive" for throttling purposes if it actually delivered a frame recently */
  const pushFresh = () => pushAlive.current && Date.now() - lastFrame.current < 45_000;
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [liq, setLiq] = useState<Map<string, number>>(new Map());
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [risk, setRisk] = useState<Record<string, Risk>>(((initial as { risk0?: Record<string, Risk> } | undefined)?.risk0) ?? {});
  const riskMiss = useRef<Set<string>>(new Set());   // tokens the risk index has no data for (render "—", not "…")
  const riskRef = useRef<Record<string, Risk>>(((initial as { risk0?: Record<string, Risk> } | undefined)?.risk0) ?? {});   // latest risk map for the pollers (avoids stale closures)
  const [, setRiskTick] = useState(0);
  useEffect(() => { const id = setInterval(() => { riskMiss.current.clear(); }, 300_000); return () => clearInterval(id); }, []);
  const [sortKey, setSortKey] = useState<"age" | "mcap" | "vol" | "txs" | "chg" | "smart">("vol");
  // Venue-supplied numbers (DYORSwap & co.) arrive as strings, nulls or absurd values when a pool has broken
  // decimals. A NaN volume made Array.sort leave the row wherever it happened to be — a 16-minute-old $14-liquidity
  // token sat at #2 of a volume-sorted table. Everything numeric from outside our index goes through fin().
  const fin = (n: unknown): number => { const v = Number(n); return Number.isFinite(v) && Math.abs(v) < 1e12 ? v : 0; };
  const finN = (n: unknown): number | null => { const v = Number(n); return Number.isFinite(v) && v > 0 && v < 1e12 ? v : null; };
  useEffect(() => { setFavs(loadFavs()); }, []);
  const toggleFav = (t: string) => setFavs((f) => { const n = new Set(f); if (n.has(t)) n.delete(t); else n.add(t); try { localStorage.setItem(FAV_KEY, JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  useEffect(() => {
    let alive = true;
    // never replace a good trending set with an empty/failed fetch (that is what made vol/txs/ATH blink to "—")
    const load = () => fetch(`${API}/api/trending?minutes=${tf}&limit=400`).then((r) => r.json()).then((j) => { if (alive && Array.isArray(j.rows) && j.rows.length) setTrend(j.rows); }).catch(() => null);
    void load();
    const id = setInterval(() => { if (!pushFresh() || document.hidden) load(); }, 15_000);
    const slow = setInterval(() => { if (pushFresh() && !document.hidden) load(); }, 120_000);   // safety net
    return () => { alive = false; clearInterval(id); clearInterval(slow); };
  }, [tf]);
  // Trending is a momentum ranking, not the volume list: many traders, buying, accelerating; wash-looking rows filtered
  // server-side. "All time" has no momentum, so the tab falls back to the 24 h window.
  useEffect(() => {
    let alive = true;
    const mins = tf === 0 ? 1440 : tf;
    const load = () => fetch(`${API}/api/trending?minutes=${mins}&limit=200&sort=trend`).then((r) => r.json()).then((j) => { if (alive && Array.isArray(j.rows) && j.rows.length) setHot(j.rows); }).catch(() => null);
    void load();
    const id = setInterval(() => { if (!pushFresh() || document.hidden) load(); }, 20_000);
    const slow2 = setInterval(() => { if (pushFresh() && !document.hidden) load(); }, 120_000);
    return () => { alive = false; clearInterval(id); clearInterval(slow2); };
  }, [tf]);
  // on-chain USDC-side liquidity for the visible rows (own index API: V3/pad pool balances + V4 slot0/liquidity)
  const liqReq = useRef<Set<string>>(new Set());
  const fetchLiq = useCallback((tokens: string[], attempt = 0) => {
    const need = tokens.map((t) => t.toLowerCase()).filter((t) => !liqReq.current.has(t)).slice(0, 120);
    if (!need.length) return;
    need.forEach((t) => liqReq.current.add(t));
    fetch(`${API}/api/liq?tokens=${need.join(",")}`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).then((j: { liq?: Record<string, number> }) => {
      setLiq((m) => { const n = new Map(m); for (const [k, v] of Object.entries(j.liq ?? {})) n.set(k, v); return n; });
      // tokens the index could not price right now (relay hiccup) are retried on the next pass
      const got = new Set(Object.keys(j.liq ?? {}));
      need.filter((t) => !got.has(t)).forEach((t) => liqReq.current.delete(t));
    }).catch(() => { need.forEach((t) => liqReq.current.delete(t)); if (attempt < 2) setTimeout(() => fetchLiq(need, attempt + 1), 4000 * (attempt + 1)); });
  }, []);
  useEffect(() => { const id = setInterval(() => { liqReq.current.clear(); }, 60_000); return () => clearInterval(id); }, []);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [smart, setSmart] = useState<Smart[]>([]);
  const smartMap = useMemo(() => new Map(smart.map((x) => [x.token.toLowerCase(), x])), [smart]);
  // smart-money flow is window-scoped: on every timeframe change drop the old numbers and reload for that window
  useEffect(() => {
    let alive = true;
    setSmart([]);
    const load = () => fetch(`${API}/api/smart-flow?minutes=${tf}&limit=400`).then((r) => r.json()).then((j: { rows?: Smart[] }) => { if (alive && Array.isArray(j.rows)) setSmart((o) => { const m = new Map(o.map((x) => [x.token.toLowerCase(), x])); for (const r of j.rows!) m.set(r.token.toLowerCase(), r); return [...m.values()]; }); }).catch(() => null);
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [tf]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const [qRaw, setQ] = useState("");
  const q = useDeferredValue(qRaw);
  const lastRoute = useRef<Map<string, RouteResult>>(new Map());
  const buyAmt = custom && Number(custom) > 0 ? Number(custom) : amount;
  useEffect(() => { setQuickAmount(buyAmt); }, [buyAmt]);
  useEffect(() => {
    const a = quickAmount();
    if ([1, 5, 20, 100].includes(a)) setAmount(a); else setCustom(String(a));
    // ?q= — what the rail's search box sends here
    const wantQ = new URLSearchParams(window.location.search).get("q");
    if (wantQ) setQ(wantQ);
    const ca = new URLSearchParams(window.location.search).get("buy");
    if (ca && /^0x[0-9a-fA-F]{40}$/.test(ca)) { setQ(ca); setPendingBuy(ca.toLowerCase()); }
  }, []);
  // ?buy=<ca>: if the token is not in any of our lists once they loaded, the token page is the right place (it has the swap panel)
  useEffect(() => {
    if (!pendingBuy || rows.length === 0) return;
    const t = setTimeout(() => { if (!rows.some((r) => r.token.toLowerCase() === pendingBuy)) void navigate({ to: "/token2/$ca", params: { ca: pendingBuy } }); setPendingBuy(null); }, 1500);
    return () => clearTimeout(t);
  }, [pendingBuy, rows]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const all = await fetch("/api/tokens?lite=1").then((r) => r.json()).then((j: { tokens?: PadToken[] }) => (j.tokens?.length ?? 0) > 100 ? j.tokens! : null).catch(() => null) ?? await listAllTokens();
        // merge: a refresh that lost a field upstream (logo, name, mcap…) must not blank a cell that was fine a second ago
        if (alive) setRows((prev) => {
          const pm = new Map(prev.map((r) => [r.token.toLowerCase(), r]));
          return all.map((r) => {
            const o = pm.get(r.token.toLowerCase());
            if (!o) return r;
            const m: PadToken = { ...r };
            for (const k of ["logo", "name", "symbol", "mcapUsd", "priceUsd", "volUsd", "twitter", "telegram", "website", "createdAt", "stage"] as const) {
              const nv = (m as Record<string, unknown>)[k], ov = (o as Record<string, unknown>)[k];
              if ((nv == null || nv === "" || nv === "?") && ov != null && ov !== "" && ov !== "?") (m as Record<string, unknown>)[k] = ov;
            }
            return m;
          });
        });
      } catch { /* ignore */ }
      fetch(`${API}/api/movers?minutes=1440`).then((r) => r.json()).then((j) => alive && setMovers(j.rows ?? [])).catch(() => null);
      fetch(`${API}/api/clusters?minutes=1440&n=2`).then((r) => r.json()).then((j) => alive && setClusters(j.rows ?? [])).catch(() => null);
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const loadPositions = useCallback(async () => {
    if (!addr) { setPositions([]); return; }
    const j = await fetch(`${API}/api/positions?wallet=${addr.toLowerCase()}`).then((r) => r.json()).catch(() => null);
    setPositions((j?.positions ?? []).filter((p: Position) => p.net > 0));
  }, [addr]);
  useEffect(() => { void loadPositions(); const id = setInterval(loadPositions, 20_000); return () => clearInterval(id); }, [loadPositions]);

  // client-side nav to a token page renders from these rows instantly; warm the chart chunks while the user browses

  useEffect(() => { rememberRows(rows as PadToken[]); }, [rows]);

  const router = useRouter();
  useEffect(() => {
    // warm everything a token click needs: the route's code chunk, the chart component and the chart library
    const t = setTimeout(() => {
      void import("../components/tv-chart"); void import("lightweight-charts");
      const first = (rows as PadToken[])[0]?.token;
      if (first) void router.preloadRoute({ to: "/token2/$ca", params: { ca: first } }).catch(() => null);
    }, 1200);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const byToken = useMemo(() => { const m = new Map(rows.map((r) => [r.token.toLowerCase(), r])); if (!m.has(OFFICIAL_TOKEN)) m.set(OFFICIAL_TOKEN, OFFICIAL_META); return m; }, [rows]);
  const clusterMap = useMemo(() => new Map(clusters.map((c) => [c.token.toLowerCase(), c])), [clusters]);

  // ---- one-click buy / sell through the aggregator, signed by the hot wallet
  const buy = async (token: string, symbol: string) => {
    if (!addr) { setToast({ ok: false, text: signer === "hot" ? "Create or unlock the trading wallet first." : "Connect your browser wallet first." }); return; }
    setBusy(token); setToast(null);
    try {
      const spend = (BigInt(Math.round(buyAmt * 1e6)) * 10n ** 12n * 1000n) / 1015n;
      const r = await routeSwap({ data: { token, side: "buy", amount: spend.toString() } });
      if (r.error || r.legs.length === 0) throw new Error(r.error === "no venue" ? "No pool found for this token yet." : r.error ?? "No route.");
      lastRoute.current.set(token, r);
      const minOut = (BigInt(r.out) * BigInt(100 - slip)) / 100n;
      const legs = r.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      const value = spend + (spend * 15n) / 1000n;
      const h = await send({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("buy", token, legs, minOut, addr, 150), value });
      setToast({ ok: true, text: `Buying ${symbol} for ${buyAmt} USDC via ${r.legs.map((l) => l.label).join(" + ")}…`, tx: h });
      const rc = await wait(h);
      setToast({ ok: rc.status === 1, text: rc.status === 1 ? `Bought ${symbol} for ${buyAmt} USDC.` : `Buy of ${symbol} reverted (slippage?).`, tx: h });
      if (rc.status === 1) creditRef(addr, h, Number(spend) / 1e18 * 0.015);
      void loadPositions();
    } catch (e) {
      const m = (e as Error).message;
      setToast({ ok: false, text: /OutOfFunds|insufficient funds/i.test(m) ? `Not enough USDC in the trading wallet: this buy needs ${buyAmt} USDC + ~0.02 gas. Deposit or top up below.` : /no liquidity/i.test(m) ? "Quote failed — the pool did not answer (RPC busy or empty pool). Try again in a second." : m });
    }
    setBusy(null);
  };
  const sell = async (p: Position, pct: number) => {
    if (!addr) return;
    setBusy(p.token); setToast(null);
    try {
      const balHex = await call(p.token, SEL.balanceOf + p32(addr));
      const bal = BigInt(balHex || "0x0");
      const amt = (bal * BigInt(pct)) / 100n;
      if (amt <= 0n) throw new Error("Nothing to sell.");
      const r = await routeSwap({ data: { token: p.token, side: "sell", amount: amt.toString() } });
      if (r.error || r.legs.length === 0) throw new Error("No route to sell.");
      const al = BigInt((await call(p.token, SEL.allowance + p32(addr) + p32(ARC_AGGREGATOR))) || "0x0");
      if (al < amt) {
        setToast({ ok: true, text: `Approving ${p.symbol ?? short(p.token)}…` });
        await wait(await send({ to: p.token, data: SEL.approve + p32(ARC_AGGREGATOR) + "f".repeat(64), gasLimit: 80_000n }));
      }
      const minOut = (BigInt(r.out) * 985n * BigInt(100 - slip)) / 100_000n;   // post-fee native USDC
      const legs = r.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      const h = await send({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("sell", p.token, legs, minOut, addr, 150) });
      setToast({ ok: true, text: `Selling ${pct}% of ${p.symbol ?? short(p.token)}…`, tx: h });
      const rc = await wait(h);
      setToast({ ok: rc.status === 1, text: rc.status === 1 ? `Sold ${pct}% of ${p.symbol ?? short(p.token)}.` : "Sell reverted (slippage?).", tx: h });
      if (rc.status === 1) creditRef(addr, h, Number(r.out) / 1e18 * 0.015);
      void loadPositions();
    } catch (e) { setToast({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  };

  const pager = (pos: "top" | "bottom") => tableRows.length > PAGE && (
                  <div className="arc-pager arc-mono" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", padding: pos === "top" ? "0 0 8px" : "12px 0 4px" }}>
                    <button className="arc-mono" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: page <= 1 ? "var(--arc-line)" : "var(--arc-ink)", cursor: page <= 1 ? "default" : "pointer", fontSize: 12, padding: "5px 10px" }} type="button">{tr_("← prev")}</button>
                    {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2).reduce<(number | "…")[]>((acc, n) => { const last = acc[acc.length - 1]; if (typeof last === "number" && n - last > 1) acc.push("…"); acc.push(n); return acc; }, []).map((n, i) => n === "…" ? <span key={`e${i}`} style={{ color: "var(--arc-muted)", padding: "0 4px" }}>…</span> : (
                      <button className="arc-mono" key={n} onClick={() => setPage(n)} style={{ background: n === page ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (n === page ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 4, color: n === page ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, minWidth: 32, padding: "5px 8px" }} type="button">{n}</button>
                    ))}
                    <button className="arc-mono" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: page >= pages ? "var(--arc-line)" : "var(--arc-ink)", cursor: page >= pages ? "default" : "pointer", fontSize: 12, padding: "5px 10px" }} type="button">{tr_("next →")}</button>
                    <span style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>{tableRows.length} {tr_("tokens · page")} {page}/{pages}</span>
                  </div>
  );
  const BuyBtn = ({ token, symbol }: { token: string; symbol: string }) => (
    <button className="arc-mono" disabled={busy === token} onClick={() => void buy(token, symbol)} style={{ background: busy === token ? "transparent" : "var(--arc-up)", border: "1px solid var(--arc-up)", borderRadius: 4, color: busy === token ? "var(--arc-up)" : "#06130b", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 10px", whiteSpace: "nowrap" }} type="button">
      {busy === token ? "…" : <>⚡ {buyAmt}<span className="arc-buyunit"> USDC</span></>}
    </button>
  );
  const Logo = ({ t }: { t: { logo?: string | null; symbol: string } }) => (
    <span style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 6, display: "inline-flex", height: 30, justifyContent: "center", marginRight: 8, overflow: "hidden", verticalAlign: "middle", width: 30 }}>
      {t.logo ? <img alt="" height={30} src={t.logo} style={{ objectFit: "cover" }} width={30} /> : <span className="arc-mono" style={{ fontSize: 12 }}>{t.symbol.slice(0, 1)}</span>}
    </span>
  );

  // official token: 24h stats from the index so the pinned row never shows dashes when it is quiet in the 1h window
  const [offStats, setOffStats] = useState<{ price1m: number | null; vol24: number; buys24: number; sells24: number; traders24: number } | null>(null);
  useEffect(() => {
    const load = () => fetch(`${API}/api/token-stats?token=${OFFICIAL_TOKEN}`).then((r) => r.json()).then((j) => setOffStats(j?.token ? j : null)).catch(() => null);
    void load(); const id = setInterval(load, 30_000); return () => clearInterval(id);
  }, []);
  // per-row stats for tokens outside the trending top-N (so vol / txs / chg / ATH never show as "—" just because a token is quiet)
  const [extraStats, setExtraStats] = useState<Record<string, Trend>>({});
  // window-scoped: dropped whenever the timeframe changes, otherwise rows outside the trend list keep showing the
  // volume of the previous window and the timeframe buttons look dead
  const [winLoading, setWinLoading] = useState(false);
  useEffect(() => { setExtraStats({}); setWinLoading(true); }, [tf]);
  useEffect(() => { if (Object.keys(extraStats).length || trend.length) setWinLoading(false); }, [extraStats, trend]);
  const trendMap = useMemo(() => {
    const m = new Map<string, Trend>(Object.entries(extraStats));
    for (const t of trend) m.set(t.token.toLowerCase(), t);
    // the momentum list carries the same window stats; a token only the momentum ranking knows must still get its numbers
    for (const t of hot) if (!m.has(t.token.toLowerCase())) m.set(t.token.toLowerCase(), t);
    // the Top volume tab ranks by volume since launch, so it must also display those numbers
    if (tab === "topvol") for (const t of volAll) m.set(t.token.toLowerCase(), t);
    if (!m.has(OFFICIAL_TOKEN) && offStats) {
      const supply = 1e9; const px = offStats.price1m ? offStats.price1m / 1e6 : null;
      m.set(OFFICIAL_TOKEN, { token: OFFICIAL_TOKEN, symbol: "ARCT", txs: offStats.buys24 + offStats.sells24, vol: offStats.vol24, buys: offStats.buys24, sells: offStats.sells24, traders: offStats.traders24, p1: offStats.price1m, chg: null, first_ts: null, ath: null, txs_all: 0, supply, mcap: px ? px * supply : null, ath_mcap: null });
    }
    return m;
  }, [trend, hot, offStats, extraStats, tab, volAll]);
  // real mint times, fetched once per batch of addresses and cached at module scope (never component state:
  // a remounting component turned the same lookup into 826 requests in 17 s once already)
  const [birthdays, setBirthdays] = useState<Map<string, number>>(new Map());
  const visibleRef = useRef<string>("");
  useEffect(() => {
    const want = rows.slice(0, 120).map((t) => t.token.toLowerCase());
    const key = want.join(",");
    if (!want.length || key === visibleRef.current) return;
    visibleRef.current = key;
    void loadMeta(want).then(() => setBirthdays(peekBirthdays(want)));
  }, [rows]);

  const cloneSet = useMemo(() => {
    const m = new Set<string>();
    for (const t of trend) if ((t as { clone?: boolean }).clone) m.add(t.token.toLowerCase());
    for (const t of hot) if ((t as { clone?: boolean }).clone) m.add(t.token.toLowerCase());
    return m;
  }, [trend, hot]);

  const toRow = (token: string): Row => {
    const k = token.toLowerCase();
    const t = byToken.get(k); const tr = trendMap.get(k); const c = clusterMap.get(k);
    // the explorer's mint time wins over our own first sighting, which only dates the token from the day we saw it
    const born = birthdays.get(k);
    // a token cannot be younger than its first swap we indexed: the explorer's mint lookup is paginated and sometimes
    // returns a later transfer as "oldest" (an ARGUS clone read 5.0 d deployed vs 5.5 d first traded). Oldest date wins.
    const seenTs = t?.createdAt ? new Date(t.createdAt).getTime() / 1000 : tr?.first_ts ?? null;
    const createdTs = born != null && seenTs != null ? Math.min(born, seenTs) : born ?? seenTs;
    return {
      token: k, symbol: tr?.symbol ?? t?.symbol ?? short(k), name: t?.name ?? tr?.symbol ?? "", logo: t?.logo ?? logos[k] ?? xAvatar(t?.twitter) ?? null, pad: t?.pad ?? "", og: !!t?.og, stock: !!t?.stock, quoteSymbol: t?.quoteSymbol ?? null, dexes: t?.dexes ?? [],
      age: createdTs, ca: k, mcap: finN(t?.stock ? (t?.mcapUsd ?? tr?.mcap) : (tr?.mcap ?? t?.mcapUsd)), chg: Number.isFinite(Number(tr?.chg)) ? tr?.chg ?? null : null, athMcap: finN(tr?.ath_mcap),
      liq: finN(liq.get(k) ?? t?.liqUsd), vol: fin(tr?.vol ?? (tf === 0 || tab === "topvol" ? t?.volUsd : 0)), txs: fin(tr?.txs),
      curve: typeof t?.curve === "number" && t.curve >= 0 && t.curve <= 100 ? t.curve : null, buys: tr?.buys ?? 0, sells: tr?.sells ?? 0, traders: tr?.traders ?? 0,
      insiders: c?.insiders ?? 0, smart: smartMap.get(k) ?? null, twitter: t?.twitter ?? null, telegram: t?.telegram ?? null, website: t?.website ?? null,
      price: tr?.p1 ? tr.p1 / 1e6 : t?.priceUsd ?? null,
    };
  };
  useEffect(() => { setPage(1); }, [tab, padF, q, sortKey, minMc, maxMc, minVol]);
  const matches = (r: Row) => !q || `${r.name} ${r.symbol} ${r.token}`.toLowerCase().includes(q.toLowerCase());
  const tableRows: Row[] = useMemo(() => {
    let base: Row[];
    if (tab === "all") base = (tf !== 0 && padF === "all" ? trend : rows).map((t) => toRow(t.token));   // with a window selected the server-ranked window list is the honest candidate set
    else if (tab === "new") base = rows.map((t) => toRow(t.token)).sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    else if (tab === "new15") {
      // freshest launches: under 15 minutes old — the snipe window
      const now = Date.now() / 1000;
      base = rows.map((t) => toRow(t.token)).filter((r) => r.age && now - r.age < 900)
        .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    }
    else if (tab === "trending") base = (hot.length ? hot : trend).map((t) => toRow(t.token));
    else if (tab === "topvol") base = [...volAll].sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).map((t) => toRow(t.token));
    else if (tab === "insiders") base = clusters.map((c) => toRow(c.token));
    else if (tab === "favs") base = [...favs].map((t) => toRow(t));
    else base = [];
    // a source chip turns the table into that launchpad's explorer: every token we know from that source,
    // with the tab acting only as an extra filter (fresh / watchlist / insiders)
    if (padF !== "all" && tab !== "holdings") {
      const src = rows.filter((t) => padF === "Stocks" ? !!t.stock : padF === "long.supply" ? (t.pad === "long.supply" && !t.stock) : padF === "DYORSwap" ? (t.pad === "DYORSwap" || (t.dexes ?? []).some((d) => d.includes("dyor"))) : (t.pad || "").toLowerCase() === padF.toLowerCase()).map((t) => toRow(t.token));
      const now = Date.now() / 1000;
      if (tab === "new15") base = src.filter((r) => r.age && now - r.age < 900);
      else if (tab === "favs") base = src.filter((r) => favs.has(r.token));
      else if (tab === "insiders") base = src.filter((r) => clusterMap.has(r.token));
      else base = src;
    }
    // a spam farm minting one name across dozens of contracts owned every sort: same rows under every tab,
    // every source chip and every window. Hidden unless you go looking for them (search, or that launchpad).
    if (padF === "all" && !q) base = base.filter((r) => !cloneSet.has(r.token.toLowerCase()));
    base = base.filter(matches);
    const lo = Number(minMc) || 0, hi = Number(maxMc) || 0, mv = Number(minVol) || 0;
    if (lo) base = base.filter((r) => (r.mcap ?? 0) >= lo);
    if (hi) base = base.filter((r) => (r.mcap ?? 0) > 0 && (r.mcap ?? 0) <= hi);
    if (mv) base = base.filter((r) => r.vol >= mv);
    if (tab !== "topvol" && !(tab === "trending" && sortKey === "vol") && ((tab !== "new" && tab !== "new15" && (padF === "all" || tab === "all")) || sortKey !== "vol")) {
      const key = ((tab === "new" || tab === "new15") || (padF !== "all" && tab !== "all")) && sortKey === "vol" ? "age" : sortKey;
      base.sort((a, b) => key === "age" ? fin(b.age) - fin(a.age) : key === "mcap" ? fin(b.mcap) - fin(a.mcap) : key === "txs" ? fin(b.txs) - fin(a.txs) : key === "chg" ? (Number.isFinite(Number(b.chg)) ? Number(b.chg) : -1e9) - (Number.isFinite(Number(a.chg)) ? Number(a.chg) : -1e9) : key === "smart" ? fin(b.smart?.net) - fin(a.smart?.net) : fin(b.vol) - fin(a.vol));
    }
    // pin the official token on top (every tab except Holdings and the volume leaderboard, where a pinned row
    // would break the ranking), regardless of sort / filter
    if (tab === "trending" && padF === "all" && !q && sortKey === "vol" && !minMc && !maxMc && !minVol) {
      base = [toRow(OFFICIAL_TOKEN), ...base.filter((r) => r.token.toLowerCase() !== OFFICIAL_TOKEN)];
    }
    return base;
  }, [tab, rows, trend, hot, volAll, clusters, favs, q, sortKey, byToken, trendMap, clusterMap, liq, logos, padF, minMc, maxMc, minVol, tf, cloneSet]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(tableRows.length / PAGE));
  // Top-10 ranking tint. Only meaningful while the table is actually ordered by volume and we are on page 1;
  // 1-3 get medal hues, 4-10 fade out in the house cobalt. Tints stay under 10% alpha so ticker, numbers and
  // chips keep their contrast — the row is marked, never shaded over.
  const RANK_HUE: Record<number, [number, number, number]> = {
    1: [245, 196, 81], 2: [203, 213, 225], 3: [205, 127, 66],
  };
  const rankOf = (i: number): number | null => (sortKey === "vol" && page === 1 && i < 10 ? i + 1 : null);
  // tradability flags: the bot replays a 1 USDC buy+sell round trip against live state for every active token,
  // so a row can warn BEFORE the click. Only failures travel (a few hundred entries), never the whole list.
  const [simFlags, setSimFlags] = useState<Record<string, [string, number]>>({});
  useEffect(() => {
    let alive = true;
    const pull = () => fetch(`${BOT_API}/api/sim-flags`).then((r) => r.json())
      .then((j) => { if (alive && j?.flags) setSimFlags(j.flags as Record<string, [string, number]>); })
      .catch(() => { /* the warning is a bonus; the table must render without it */ });
    pull();
    const id = setInterval(pull, 300_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const simOf = (t: string) => simFlags[t.toLowerCase()];

  const rankTint = (rank: number): { accent: string; bg: string; ink: string } => {
    const [r, g, b] = RANK_HUE[rank] ?? [46, 124, 255];
    const fade = rank <= 3 ? 1 : Math.max(0.18, 1 - (rank - 3) / 8);          // 4th strongest of the tail, 10th barely there
    return {
      accent: `rgba(${r},${g},${b},${(rank <= 3 ? 0.9 : 0.55 * fade).toFixed(3)})`,
      bg: `rgba(${r},${g},${b},${((rank <= 3 ? 0.085 : 0.05) * fade).toFixed(3)})`,
      ink: `rgba(${r},${g},${b},${(rank <= 3 ? 0.95 : 0.75).toFixed(2)})`,
    };
  };

  const pageRows = useMemo(() => tableRows.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE), [tableRows, page, pages]);
  // lazy enrich visible rows: logos (screener index) + holder concentration (arc-scan), cached server-side
  // stats for every visible row (batch, 30 s) — the trending feed only covers the busiest tokens of the timeframe
  useEffect(() => {
    const vis = pageRows.map((r) => r.token.toLowerCase());
    if (!vis.length) return;
    let alive = true;
    const load = () => {
      const want = vis.filter((t) => !trend.some((x) => x.token.toLowerCase() === t));
      if (!want.length) return;
      const stats = (attempt: number) => fetch(`${API}/api/stats?tokens=${want.join(",")}&minutes=${tf}`, { signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).then((j: { rows?: Trend[] }) => {
        if (!alive || !j.rows) return;
        setExtraStats((o) => { const n = { ...o }; for (const r of j.rows!) n[r.token.toLowerCase()] = r; return n; });
      }).catch(() => { if (alive && attempt < 2) setTimeout(() => stats(attempt + 1), 3000); });
      stats(0);
      // smart-money flow for exactly the visible rows (incl. negative net — insiders selling)
      fetch(`${API}/api/smart-flow?tokens=${vis.join(",")}&minutes=${tf}&limit=${vis.length}`).then((r) => r.json()).then((j: { rows?: Smart[] }) => {
        if (!alive || !Array.isArray(j.rows)) return;
        setSmart((o) => { const m = new Map(o.map((x) => [x.token.toLowerCase(), x])); const got = new Set(j.rows!.map((r) => r.token.toLowerCase())); for (const r of j.rows!) m.set(r.token.toLowerCase(), r); for (const t of vis) if (!got.has(t)) m.set(t, { token: t, net: 0, bought: 0, sold: 0, buyers: 0, sellers: 0, best_rank: null, last_ts: 0 }); return [...m.values()]; });
      }).catch(() => null);
    };
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRows.map((r) => r.token).join(","), tf, trend.length]);
  useEffect(() => {
    const vis = pageRows.map((r) => r.token.toLowerCase());
    const needLogo = vis.filter((t) => !logos[t] && !byToken.get(t)?.logo);
    if (needLogo.length) void tokenLogos({ data: { tokens: needLogo } }).then((m) => setLogos((o) => ({ ...o, ...m }))).catch(() => null);
    fetchLiq(vis);
    const liqId = setInterval(() => { if (!document.hidden) fetchLiq(vis); }, 30_000);   // refill anything still missing / refresh
    // risk for EVERY visible row, in chunks of 12 so the first rows render fast; retried 3× (relay/arc-scan hiccups),
    // and tokens the index does not know get an explicit "no data" marker instead of an endless "…"
    let alive = true;
    // the index answers with what it has cached and computes the rest in the background → keep polling every 4 s
    // (up to ~60 s) until every visible row has its Score; only then mark the leftovers as "no data"
    // straight to the index (CORS open, ~300 ms); the Worker round-trip is only the fallback — one slow edge hop
    // used to leave whole pages of rows on "…"
    const riskDirect = async (tokens: string[]): Promise<Record<string, Risk>> => {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
        const j = (await (await fetch(`${API}/api/holder-risk?tokens=${tokens.join(",")}`, { signal: ctl.signal })).json()) as { risk?: Record<string, Risk | null> };
        clearTimeout(tm);
        const out: Record<string, Risk> = {};
        for (const [k, v] of Object.entries(j.risk ?? {})) if (v && (v as Risk).score != null) out[k.toLowerCase()] = v as Risk;
        return out;
      } catch {
        try { return (await holderRisk({ data: { tokens } })) as Record<string, Risk>; } catch { return {}; }
      }
    };
    const pull = async (tokens: string[], attempt = 0) => {
      const need = tokens.filter((t) => !riskRef.current[t] && !riskMiss.current.has(t));
      if (!need.length || !alive) return;
      const got = await riskDirect(need);
      if (!alive) return;
      const have = Object.keys(got).filter((k) => got[k]);
      if (have.length) setRisk((o) => { const n = { ...o, ...got }; riskRef.current = n; return n; });
      const missing = need.filter((t) => !got[t]);
      if (missing.length && attempt < 15) { setTimeout(() => void pull(missing, attempt + 1), 4000); }
      else if (missing.length) { missing.forEach((t) => riskMiss.current.add(t)); setRiskTick((n) => n + 1); }
    };
    for (let i = 0; i < vis.length; i += 12) void pull(vis.slice(i, i + 12));
    // dev / bundle sells must show up while you watch: refresh the visible rows' risk every 60 s
    const id = setInterval(() => { if (document.hidden) return; for (let i = 0; i < vis.length; i += 20) void riskDirect(vis.slice(i, i + 20)).then((m) => { if (Object.keys(m).length) setRisk((o) => { const n = { ...o, ...m }; riskRef.current = n; return n; }); }); }, 60_000);
    return () => { alive = false; clearInterval(id); clearInterval(liqId); };
    // keyed on the visible TOKEN LIST, not on the pageRows array identity: liq/logo/trend updates rebuild pageRows every
    // few seconds, and re-running this effect cancelled every in-flight risk pull (alive=false) → endless "…"
  }, [pageRows.map((r) => r.token).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="arc-dsp">
      <DsRail active={padF !== "all" ? padF : null} />
      <section className="arc-dsp__body">
        <DsChainStrip />
        {/* the four steps belong next to the wallet they describe, not buried under the table */}
        <div className="arc-dsp__start">
          <details className="arc-dsp__wallet" id="wallet" open={!hasWallet()}>
            <summary>{hasWallet() ? "Trading wallet · unlock or manage" : "Trading wallet · create one to trade in one click"}</summary>
            <WalletPanel onReady={setAddr} />
          </details>
          <div className="arc-dsp__howto">
            <p style={{ fontWeight: 700, margin: "0 0 6px" }}>How it works</p>
            <ol style={{ color: "var(--arc-muted)", margin: 0, paddingLeft: 18 }}>
              <li>Create a trading wallet (key stays in this browser, encrypted with your passcode).</li>
              <li>Deposit USDC on Arc to its address, or <a href="/bridge2" style={{ color: "var(--arc-cobalt)" }}>bridge</a> from another chain.</li>
              <li>Pick an amount, hit ⚡ on any row. The aggregator finds the best venue; the tx signs locally, no popup.</li>
              <li>Sell 25/50/100% from Holdings. Withdraw or export the key any time.</li>
            </ol>
          </div>
        </div>
        <div className="arc-2col" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
          {/* LEFT: terminal */}
          <div>
            <div className="arc-title" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <h1 style={{ fontSize: 26, margin: 0 }}>Terminal</h1>
              <span style={{ color: "var(--arc-muted)", fontSize: 13 }}>{tr_("every Arc launchpad · one click · best price across venues · ")}<a href="/profile2" style={{ color: "var(--arc-cobalt)" }}>{tr_("profile & history →")}</a></span>
            </div>
            {/* quick-buy bar */}
            <button className="arc-mono arc-mobile-bar" onClick={() => setMobileOpen((o) => (o === "settings" ? "" : "settings"))} type="button">
              <span>⚡ {buyAmt} USDC · slip {slip}% · {signer === "hot" ? (addr ? "trading wallet" : "no wallet") : "browser wallet"}</span><span style={{ color: "var(--arc-muted)" }}>{mobileOpen === "settings" ? "hide ▴" : "settings ▾"}</span>
            </button>
            <div className={`arc-controls${mobileOpen === "settings" ? " arc-mobile-open" : ""}`} style={{ alignItems: "center", background: "var(--arc-paper)", border: "1px solid var(--arc-line)", display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, padding: "8px 12px" }}>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{tr_("SIGN WITH")}</span>
              {(["hot", "browser"] as const).map((k) => (
                <button className="arc-mono" key={k} onClick={() => { setSigner(k); if (k === "browser" && !browserAddr) void connectWallet().then(setBrowserAddr).catch(() => null); }} style={{ background: signer === k ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (signer === k ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 4, color: signer === k ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "4px 8px" }} title={k === "hot" ? "In-browser trading wallet: one click, no popups" : "MetaMask / Rabby: confirm every transaction"} type="button">
                  {k === "hot" ? "⚡ trading" : browserAddr && signer === "browser" ? `🦊 ${browserAddr.slice(0, 6)}…` : "🦊 browser"}
                </button>
              ))}
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 6 }}>{tr_("QUICK BUY")}</span>
              {[1, 5, 20, 100].map((a) => <button key={a} className="arc-mono" onClick={() => { setAmount(a); setCustom(""); }} style={{ background: amount === a && !custom ? "rgba(34,197,128,0.18)" : "transparent", border: "1px solid " + (amount === a && !custom ? UP : "var(--arc-line)"), color: amount === a && !custom ? UP : "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "4px 10px" }} type="button">{a} USDC</button>)}
              <input className="arc-mono" inputMode="decimal" onChange={(e) => setCustom(e.target.value)} placeholder="custom" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "4px 8px", width: 80 }} value={custom} />
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>{tr_("SLIPPAGE")}</span>
              {[1, 5, 15, 30].map((s) => <button key={s} className="arc-mono" onClick={() => setSlip(s)} style={{ background: slip === s ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (slip === s ? "var(--arc-cobalt)" : "var(--arc-line)"), color: slip === s ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 8px" }} type="button">{s}%</button>)}
              <div className={"arc-laser" + (q ? " is-typing" : "")}>
                <input className="arc-mono" onChange={(e) => setQ(e.target.value)} placeholder={tr_("search any Arc token · name / symbol / CA")} style={{ background: "var(--arc-paper-deep)", color: "var(--arc-ink)", fontSize: 12, padding: "5px 9px" }} value={qRaw} />
              </div>
            </div>
            {/* tabs */}
            <button className="arc-mono arc-mobile-bar" onClick={() => setMobileOpen((o) => (o === "filters" ? "" : "filters"))} type="button">
              <span>Sources & filters{padF !== "all" ? ` · ${padF}` : ""}</span><span style={{ color: "var(--arc-muted)" }}>{mobileOpen === "filters" ? "hide ▴" : "show ▾"}</span>
            </button>
            <div className={`arc-filters${mobileOpen === "filters" ? " arc-mobile-open" : ""}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, margin: "2px 0 8px" }}>
              <div className="arc-chips" style={{ display: "contents" }}>
              {(padsOpen ? PADS : PADS.filter(([k]) => PAD_PRIMARY.includes(k) || k === padF)).map(([k, l]) => <button className="arc-mono" key={k} onClick={() => setPadF(k)} style={{ background: padF === k ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (padF === k ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 999, color: padF === k ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 10px" }} type="button">{l}</button>)}
                <button
                  className="arc-mono"
                  onClick={() => setPadsOpen((v) => !v)}
                  style={{ background: "transparent", border: "1px dashed var(--arc-line)", borderRadius: 999, color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: "3px 10px" }}
                  title={padsOpen ? "Show only the main sources" : "Show every launchpad and venue we index"}
                  type="button"
                >
                  {padsOpen ? tr_("Fewer sources") : `+${Math.max(0, PADS.length - PADS.filter(([k]) => PAD_PRIMARY.includes(k) || k === padF).length)} ${tr_("more")}`}
                </button>
              </div>
              <span style={{ flex: 1 }} />
              {[[tr_("min MC $"), minMc, setMinMc], [tr_("max MC $"), maxMc, setMaxMc], [tr_("min vol $"), minVol, setMinVol]].map(([ph, v, set]) => (
                <input className="arc-mono" inputMode="numeric" key={ph as string} onChange={(e) => (set as (x: string) => void)(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={ph as string} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-ink)", fontSize: 11, padding: "4px 8px", width: 84 }} value={v as string} />
              ))}
              <select className="arc-mono" onChange={(e) => setSortKey(e.target.value as typeof sortKey)} style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-ink)", fontSize: 11, padding: "4px 6px" }} value={sortKey}>
                <option value="vol">{tr_("Sort: volume")}</option><option value="age">{tr_("Sort: newest")}</option><option value="mcap">{tr_("Sort: market cap")}</option><option value="txs">{tr_("Sort: trades")}</option><option value="chg">{tr_("Sort: % change")}</option><option value="smart">{tr_("Sort: smart money")}</option>
              </select>
              {(padF !== "all" || minMc || maxMc || minVol || q) && <button className="arc-mono" onClick={() => { setPadF("all"); setMinMc(""); setMaxMc(""); setMinVol(""); setQ(""); }} style={{ background: "transparent", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, textDecoration: "underline" }} type="button">clear</button>}
            </div>
            <div className="arc-tabs" style={{ display: "flex", gap: 4, marginBottom: 10, padding: 4, border: "1px solid var(--arc-line)", borderRadius: 12, background: "rgba(255,255,255,0.025)", alignItems: "center" }}>
              {([["all", padF === "all" ? tr_("All") : `${tr_("All")} · ${PADS.find(([k]) => k === padF)?.[1] ?? padF}`], ["new", tr_("New pair")], ["new15", tr_("New <15m")], ["trending", tr_("Trending")], ["topvol", tr_("Top volume")], ["alpha", "⚡ Alpha"], ["insiders", tr_("Insider picks")], ["favs", `${tr_("★ Watchlist")}${favs.size ? ` (${favs.size})` : ""}`], ["holdings", `${tr_("Holdings")}${positions.length ? ` (${positions.length})` : ""}`]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{ background: tab === k ? "linear-gradient(180deg, rgba(34,197,94,0.22), rgba(34,197,94,0.10))" : "transparent", border: "1px solid " + (tab === k ? "rgba(34,197,94,0.55)" : "transparent"), borderRadius: 9, boxShadow: tab === k ? "0 0 0 1px rgba(34,197,94,0.15) inset, 0 2px 10px rgba(34,197,94,0.15)" : "none", color: tab === k ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 15, fontWeight: tab === k ? 700 : 500, padding: "7px 14px", transition: "background .15s, color .15s" }} type="button">{l}</button>
              ))}
              <span style={{ marginLeft: "auto" }}>
                {[1, 5, 60, 360, 1440, 0].map((m) => <button key={m} className="arc-mono" onClick={() => setTf(m)} style={{ background: tf === m ? "rgba(255,255,255,0.08)" : "transparent", border: "1px solid " + (tf === m ? "var(--arc-line)" : "transparent"), borderRadius: 4, color: tf === m ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, marginLeft: 2, padding: "4px 9px" }} type="button">{tfLabel(m)}</button>)}
                <button className="arc-mono" onClick={() => setFlashOn((v) => !v)} style={{ background: flashOn ? "rgba(34,197,128,0.12)" : "transparent", border: "1px solid " + (flashOn ? "var(--arc-up)" : "var(--arc-line)"), borderRadius: 6, borderBottomRightRadius: flashOn ? 0 : 6, borderTopRightRadius: flashOn ? 0 : 6, color: flashOn ? "var(--arc-up)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginRight: flashOn ? 0 : 6, padding: "3px 8px" }} title="Flash a row green on a buy and red on a sell, live" type="button">flash {flashOn ? "on" : "off"}</button>
                {flashOn && (
                  <button className="arc-mono" onClick={() => setFlashMin((m) => FLASH_STEPS[(FLASH_STEPS.indexOf(m as typeof FLASH_STEPS[number]) + 1) % FLASH_STEPS.length])}
                    style={{ background: "rgba(34,197,128,0.06)", border: "1px solid var(--arc-up)", borderLeft: "none", borderRadius: 6, borderBottomLeftRadius: 0, borderTopLeftRadius: 0, color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginRight: 6, padding: "3px 8px" }}
                    title="Minimum trade size that lights a row — click to change" type="button">≥ {flashMin >= 1000 ? `$${flashMin / 1000}K` : `$${flashMin}`}</button>
                )}
                <button className="arc-mono" onClick={toggleToasts} style={{ background: toastsOn ? "rgba(34,197,128,0.12)" : "transparent", border: "1px solid " + (toastsOn ? "var(--arc-up)" : "var(--arc-line)"), borderRadius: 4, color: toastsOn ? "var(--arc-up)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginLeft: 8, padding: "3px 8px" }} title="Live buy/sell pop-ups for the tokens on screen" type="button">{toastsOn ? (liveFeed ? "● live" : "🔔 live") : "🔕 live"}</button>
              </span>
            </div>
            {/* chain-wide search: every ERC-20 on Arc by name / symbol / address (shows when the query is not an address; addresses use the quick action below) */}
            {q.trim().length >= 2 && (
              <ChainSearch autoOpen={/^0x[0-9a-fA-F]{40}$/.test(q.trim())} q={q} hide={new Set(tableRows.map((r) => r.token.toLowerCase()))} renderBuy={(h) => <BuyBtn symbol={h.symbol ?? short(h.token)} token={h.token} />} />
            )}
            {/* paste CA quick action */}
            {/^0x[0-9a-fA-F]{40}$/.test(q.trim()) && !byToken.has(q.trim().toLowerCase()) && (
              <div style={{ alignItems: "center", background: "var(--arc-paper)", border: "1px solid var(--arc-cobalt)", display: "flex", gap: 10, marginBottom: 8, padding: "8px 12px" }}>
                <span className="arc-mono" style={{ fontSize: 12 }}>{short(q.trim())}</span>
                <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>not in the lists — buy it anyway (router finds the pool)</span>
                <BuyBtn symbol={short(q.trim())} token={q.trim().toLowerCase()} />
                <a className="arc-mono" href={`/token/${q.trim().toLowerCase()}`} style={{ color: "var(--arc-cobalt)", fontSize: 12 }}>chart</a>
              </div>
            )}

            {tab !== "holdings" && pager("top")}
            <div className="arc-tablewrap" style={{ overflowX: "auto" }}>
              {tab !== "holdings" && tab !== "alpha" && (
                <><table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th className="arc-th" style={{ width: 26  }} />
                      <th className="arc-th">Token / <button className="arc-mono" onClick={() => setSortKey("age")} style={{ background: "none", border: "none", color: sortKey === "age" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">Age ⇅</button></th>
                      <th className="arc-th"><button className="arc-mono" onClick={() => setSortKey("mcap")} style={{ background: "none", border: "none", color: sortKey === "mcap" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">MC ⇅</button></th>
                      <th className="arc-col-ath arc-th">{tr_("ATH MC")}</th>
                      <th className="arc-col-liq arc-th">{tr_("LIQ")}</th>
                      <th className="arc-col-vol arc-th"><button className="arc-mono" onClick={() => setSortKey("vol")} style={{ background: "none", border: "none", color: sortKey === "vol" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">{tab === "topvol" ? "ALL" : tfLabel(tf)} Vol{winLoading && tab !== "topvol" ? " …" : ""} ⇅</button></th>
                      <th className="arc-col-txs arc-th"><button className="arc-mono" onClick={() => setSortKey("txs")} style={{ background: "none", border: "none", color: sortKey === "txs" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">{tab === "topvol" ? "ALL" : tfLabel(tf)} TXs ⇅</button></th>
                      <th className="arc-col-price arc-th">{tr_("PRICE")}</th>
                      <th className="arc-col-trd arc-th">{tr_("TRADERS")}</th>
                      {(["5M", "1H", "6H", "24H"] as const).map((w) => <th className="arc-col-win arc-th" key={w} style={{ textAlign: "right"  }}>{w}</th>)}
                      <th className="arc-th" title="Token Score 0-100: deployer share, bundle, whale concentration, dev / bundle selling, deployer rug history, holders. Hover a badge for the flags. ☠ = deployer dumped a token before">{tr_("SCORE")}</th>
                      <th className="arc-col-dev arc-th" title="Dev: deployer wallet's share of supply · Bundle: supply held by wallets that bought within 2 s of the first trade">{tr_("DEV / BUNDLE")}</th>
                      <th className="arc-col-ins arc-th" title={`Smart money: net USDC flow of the top-100 insiders (buys − sells) in the ${tfLabel(tf)} window · distinct insiders buying/selling`}><button className="arc-mono" onClick={() => setSortKey("smart")} style={{ background: "none", border: "none", color: sortKey === "smart" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", font: "inherit", padding: 0 }}>Smart ⇅</button></th>
                      <th className="arc-th" />
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.length === 0 && <tr><td className="arc-mono arc-td" colSpan={11} style={{ color: "var(--arc-muted)"  }}>{q.trim() ? `Nothing in the ${tab} list matches “${q.trim()}” — see “Search all of Arc” above.` : tab === "favs" ? "No favourites yet — click ☆ on any row." : tab === "new15" ? "No launch younger than 15 minutes right now — watch New pair." : (padF !== "all" || minMc || maxMc || minVol) ? "Nothing matches these filters."  : tab === "insiders" ? "No token with 2+ insiders in the last 24h." : "Loading…"}</td></tr>}
                    {pageRows.map((r, ri) => (
                      <tr className="arc-row-link" key={r.token} onClick={rowClick(r.token)} onMouseEnter={() => { void import("@/lib/arc-api").then((m) => m.tokenPage({ data: { token: r.token } })).catch(() => null); }} style={{ background: simOf(r.token)?.[0] === "t" ? "rgba(240,83,79,0.16)" : flash[r.token.toLowerCase()] ? (flash[r.token.toLowerCase()].side === "buy" ? "rgba(34,197,128,0.20)" : "rgba(240,83,79,0.20)") : rankOf(ri) ? rankTint(rankOf(ri) as number).bg : r.token.toLowerCase() === OFFICIAL_TOKEN ? "rgba(46,124,255,0.09)" : favs.has(r.token) ? "rgba(46,124,255,0.05)" : undefined, boxShadow: simOf(r.token)?.[0] === "t" ? "inset 3px 0 0 0 #f0534f" : flash[r.token.toLowerCase()] ? `inset 3px 0 0 0 ${flash[r.token.toLowerCase()].side === "buy" ? "#22c580" : "#f0534f"}` : rankOf(ri) ? `inset 3px 0 0 0 ${rankTint(rankOf(ri) as number).accent}` : undefined, cursor: "pointer", transition: "background 380ms ease-out" }}>
                        <td className="arc-td" style={{ paddingRight: 4  }}>{rankOf(ri) ? (
                          <span className="arc-mono" style={{ color: rankTint(rankOf(ri) as number).ink, display: "inline-block", fontSize: 10, minWidth: 12, textAlign: "right" }} title={`#${rankOf(ri)} by volume`}>{rankOf(ri)}</span>
                        ) : null}<button onClick={() => toggleFav(r.token)} style={{ background: "none", border: "none", color: favs.has(r.token) ? "#f5c542" : "var(--arc-muted)", cursor: "pointer", fontSize: 15, padding: 0 }} title="favourite" type="button">{favs.has(r.token) ? "★" : "☆"}</button></td>
                        <td className="arc-tokcell arc-td" style={{ minWidth: 230  }}>
                          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                            <Link params={{ ca: r.token }} preload="intent" style={{ textDecoration: "none" }} to="/token2/$ca"><TokenLogo fallback={xAvatar(r.twitter)} src={r.logo} symbol={r.symbol} /></Link>
                            <div style={{ lineHeight: 1.25 }}>
                              <div><Link data-notranslate params={{ ca: r.token }} preload="intent" style={{ color: "var(--arc-ink)", fontWeight: 700, textDecoration: "none" }} to="/token2/$ca">{r.symbol}</Link>{r.token.toLowerCase() === OFFICIAL_TOKEN && <span className="arc-mono" style={{ background: "rgba(46,124,255,0.18)", border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "#fff", fontSize: 10, marginLeft: 6, padding: "1px 6px", verticalAlign: "middle" }}>⭐ OFFICIAL</span>}{simOf(r.token) && (
                                simOf(r.token)![0] === "t"
                                  ? <span className="arc-mono" style={{ background: "rgba(240,83,79,0.18)", border: "1px solid var(--arc-down)", borderRadius: 4, color: "#ff8f8b", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title={`Sell test failed: we bought 1 USDC of this token and tried to sell it back in the same call. The sale either reverted or paid far less than the router quoted for it — a blocked exit or a hidden tax. Re-checked every 6 hours.`}>⚠ CANNOT EXIT</span>
                                  : <span className="arc-mono" style={{ background: "rgba(245,197,66,0.14)", border: "1px solid #f5c542", borderRadius: 4, color: "#f5c542", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title={`Thin pool: the sell works and pays what the router quotes, but 1 USDC moves the price so much that a round trip returns ${(simOf(r.token)![1] / 100).toFixed(0)}%. Liquidity warning, not a scam warning.`}>THIN POOL</span>
                              )}{r.og && <span className="arc-mono" style={{ background: "rgba(245,197,66,0.15)", border: "1px solid #f5c542", borderRadius: 4, color: "#f5c542", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title="OG ticker: registered on RadarDex before Arc mainnet launch">OG</span>}{r.stock && <span className="arc-mono" style={{ background: "rgba(124,196,255,0.14)", border: "1px solid #7cc4ff", borderRadius: 4, color: "#7cc4ff", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title="Wrapped stock minted by long.supply: a custodial IOU on a Robinhood-Chain token held in their vault. Not a share, no shareholder rights, redemptions depend on the team.">📈 STOCK · IOU</span>}{!r.stock && r.quoteSymbol && <span className="arc-mono" style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title={`Quoted in ${r.quoteSymbol} (long.supply wrapped stock), USD price derived through the stock price`}>/{r.quoteSymbol}</span>} <span className="arc-name" style={{ color: "var(--arc-muted)", fontSize: 12 }}>{r.name.slice(0, 12)}</span>
                                {r.twitter && <a className="arc-tokmeta" href={r.twitter} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 6 }} target="_blank">𝕏</a>}
                                {r.telegram && <a className="arc-tokmeta" href={r.telegram} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 4 }} target="_blank">✈︎</a>}
                                {r.website && <a className="arc-tokmeta" href={r.website} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 4 }} target="_blank">🌐</a>}
                              </div>
                              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
                                <span style={{ color: UP }}>{r.age ? ago(r.age) : "—"}</span> · {short(r.ca)}
                                <button className="arc-mono" onClick={() => void navigator.clipboard.writeText(r.token)} style={{ background: "none", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "0 4px" }} title="copy CA" type="button">⧉</button>
                                {r.pad && <span className="arc-tokmeta" style={{ border: "1px solid var(--arc-line)", borderRadius: 3, fontSize: 9, marginLeft: 4, padding: "0 4px" }}>{r.pad}</span>}
                                {r.traders > 0 && <span className="arc-tokmeta" style={{ marginLeft: 6 }} title="traders in window">👥{r.traders}</span>}
                                {flash[r.token.toLowerCase()] && (
                                  <span className="arc-mono arc-flashpill" style={{
                                    background: flash[r.token.toLowerCase()].side === "buy" ? "rgba(34,197,128,0.22)" : "rgba(240,83,79,0.22)",
                                    border: "1px solid " + (flash[r.token.toLowerCase()].side === "buy" ? "#22c580" : "#f0534f"),
                                    borderRadius: 4, color: flash[r.token.toLowerCase()].side === "buy" ? UP : DOWN, fontSize: 9,
                                    marginLeft: 6, padding: "0 5px",
                                  }}>{flash[r.token.toLowerCase()].side === "buy" ? "BUY" : "SELL"} {usd(flash[r.token.toLowerCase()].usdc)}</span>
                                )}
                                {r.curve !== null && (
                                  // bonding curve: how full the raise is. On a curve pad this beats market cap — it is the
                                  // distance to graduation into a locked pool. Rendered only when the pad reports it.
                                  <span className="arc-tokmeta" style={{ alignItems: "center", display: "inline-flex", gap: 5, marginLeft: 6 }} title={`bonding curve ${r.curve.toFixed(1)}% filled — graduates into a locked pool at 100%`}>
                                    <span style={{ background: "rgba(255,255,255,0.14)", borderRadius: 3, display: "inline-block", height: 5, overflow: "hidden", verticalAlign: "middle", width: 46 }}>
                                      <span style={{ background: r.curve >= 80 ? UP : "var(--arc-cobalt)", borderRadius: 3, display: "block", height: "100%", width: `${Math.max(2, Math.min(100, r.curve))}%` }} />
                                    </span>
                                    <span style={{ color: r.curve >= 80 ? UP : "var(--arc-muted)", fontSize: 10 }}>{r.curve >= 10 ? r.curve.toFixed(0) : r.curve.toFixed(1)}%</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="arc-mono arc-td"><div style={{ color: "var(--arc-cobalt)", fontWeight: 700 }}>{usd(r.mcap)}</div>{r.chg != null && Math.abs(r.chg) <= 99_999 && <div title={r.age && Date.now() / 1000 - r.age < tf * 60 ? `${r.chg.toFixed(1)}% since this token's first trade: it is younger than the ${tfLabel(tf)} window` : `${r.chg.toFixed(1)}% over the ${tfLabel(tf)} window, measured from the first trade above $1`} style={{ color: r.chg >= 0 ? UP : DOWN, fontSize: 11 }}>{r.chg >= 0 ? "+" : ""}{r.chg.toFixed(1)}%</div>}</td>
                        <td className="arc-mono arc-col-ath arc-td" style={{ color: "var(--arc-cobalt)"  }}>{usd(r.athMcap)}</td>
                        <td className="arc-mono arc-col-liq arc-td">{r.liq != null && r.liq > 0 ? usd(r.liq) : "—"}</td>
                        <td className="arc-mono arc-col-vol arc-td" style={{ color: "#f5c542"  }}>{r.vol > 0 ? usd(r.vol) : "—"}</td>
                        <td className="arc-mono arc-col-txs arc-td"><div>{r.txs > 0 ? r.txs.toLocaleString() : "—"}</div>{r.txs > 0 && <div style={{ fontSize: 11 }}><span style={{ color: UP }}>{r.buys}</span> / <span style={{ color: DOWN }}>{r.sells}</span></div>}</td>
                        <td className="arc-mono arc-col-price arc-td">{r.price != null && r.price > 0 ? (r.price < 0.01 ? `$${r.price.toFixed(8)}` : `$${r.price.toFixed(5)}`) : "—"}</td>
                        <td className="arc-mono arc-col-trd arc-td">{r.traders > 0 ? r.traders.toLocaleString() : "—"}</td>
                        {(["m5", "h1", "h6", "h24"] as const).map((w) => {
                          const v = chgWin[r.token.toLowerCase()]?.[w];
                          return (
                            <td className="arc-mono arc-col-win arc-td" key={w} style={{ color: v == null ? "var(--arc-muted)" : v >= 0 ? "var(--arc-up)" : "#f0534f", textAlign: "right"  }}>
                              {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(v >= 100 || v <= -100 ? 0 : 1)}%`}
                            </td>
                          );
                        })}
                        <td className="arc-mono arc-td">{(() => { if (r.stock) return <span className="arc-mono" style={{ border: "1px solid #7cc4ff", borderRadius: 5, color: "#7cc4ff", fontSize: 11, padding: "3px 6px" }} title="Custodial IOU — score not applicable; risk = trust in long.supply's vault and Robinhood's token">IOU</span>; const k = risk[r.token.toLowerCase()]; if (!k) return <span style={{ color: "var(--arc-muted)" }} title={riskMiss.current.has(r.token.toLowerCase()) ? "no holder data yet (token has not traded on an indexed venue)" : "loading"}>{riskMiss.current.has(r.token.toLowerCase()) ? "—" : "…"}</span>; const t10 = k.top10; return <><ScoreBadge risk={k} /><div style={{ color: "var(--arc-muted)", fontSize: 10.5, marginTop: 3 }} title={`${k.holders ?? "?"} holders · top-10 hold ${t10 != null ? t10.toFixed(0) : "?"}%`}>{k.holders ? `${k.holders >= 1000 ? (k.holders / 1000).toFixed(1) + "k" : k.holders}h` : ""}{t10 != null && r.token.toLowerCase() !== OFFICIAL_TOKEN ? ` · t10 ${t10.toFixed(0)}%` : ""}</div></>; })()}</td>
                        <td className="arc-mono arc-col-dev arc-td">{(() => { if (r.stock) return <span style={{ color: "var(--arc-muted)", fontSize: 11 }} title="Wrapped stock: supply is minted/burned by the long.supply custodian, so deployer and bundle metrics do not apply">custodian-minted</span>; const k = risk[r.token.toLowerCase()]; if (!k) return <span style={{ color: "var(--arc-muted)" }}>{riskMiss.current.has(r.token.toLowerCase()) ? "—" : "…"}</span>; const dv = k.dev_pct, bd = k.bundle_pct; const c = (v: number | null | undefined, warn: number, bad: number) => v == null ? "var(--arc-muted)" : v >= bad ? DOWN : v >= warn ? "#f5c542" : UP; const ds = k.dev_net_usd ?? ((k.dev_sold_usd ?? 0) - (k.dev_bought_usd ?? 0)), bs = k.bundle_net_usd ?? ((k.bundle_sold_usd ?? 0) - (k.bundle_bought_usd ?? 0)); return <><div style={{ color: c(dv, 5, 15), fontWeight: 700 }} title="Deployer wallet's share of supply (top-50 holders)">{dv == null ? "—" : `${dv.toFixed(dv < 1 ? 1 : 0)}%`}{ds > 0 && <span style={{ background: "rgba(240,83,79,0.16)", border: "1px solid #f0534f", borderRadius: 4, color: "#f0534f", display: "inline-block", fontSize: 9, lineHeight: "13px", marginLeft: 5, padding: "0 4px", verticalAlign: "middle" }} title={`Deployer took ${usd(ds)} out in the last 24 h — sold ${usd(k.dev_sold_usd ?? 0)} across ${k.dev_sells} sell${k.dev_sells === 1 ? "" : "s"}, bought back ${usd(k.dev_bought_usd ?? 0)}, last sell ${ago(k.dev_last_sell ?? null)} ago`}>DEV −{usd(ds)}</span>}</div><div style={{ color: c(bd, 10, 25), fontSize: 11 }} title={`Bundled: supply held by wallets that bought within 2 s of the first trade (${k.bundlers ?? 0} wallets)`}>{bd == null ? "" : `bundle ${bd.toFixed(bd < 1 ? 1 : 0)}%`}{bs > 0 && <span style={{ color: "#f0534f", fontSize: 10, marginLeft: 4 }} title={`${k.bundle_sellers} launch-block wallet${k.bundle_sellers === 1 ? "" : "s"} took ${usd(bs)} out in the last 24 h — sold ${usd(k.bundle_sold_usd ?? 0)}, bought back ${usd(k.bundle_bought_usd ?? 0)}, last sell ${ago(k.bundle_last_sell ?? null)} ago`}>−{usd(bs)}</span>}</div></>; })()}</td>
                        <td className="arc-mono arc-col-ins arc-td" style={{ minWidth: 72, paddingRight: 8  }}>{r.smart ? (r.smart.buyers + r.smart.sellers === 0 ? <span style={{ color: "var(--arc-muted)" }} title={`no top-100 insider trades in the ${tfLabel(tf)} window`}>0</span> : <div title={`top-100 insiders (${tfLabel(tf)}): bought ${usd(r.smart.bought)} · sold ${usd(r.smart.sold)} · ${r.smart.buyers} buying / ${r.smart.sellers} selling${r.smart.best_rank ? ` · best rank #${r.smart.best_rank}` : ""}`}><div style={{ color: r.smart.net >= 0 ? UP : DOWN, fontWeight: 700 }}>{r.smart.net >= 0 ? "+" : "−"}{usd(Math.abs(r.smart.net))}</div><div style={{ color: "var(--arc-muted)", fontSize: 10.5 }}>{r.smart.buyers}↑ {r.smart.sellers}↓</div></div>) : <span style={{ color: "var(--arc-muted)" }}>…</span>}</td>
                        <td className="arc-td" style={{ textAlign: "right"  }}><BuyBtn symbol={r.symbol} token={r.token} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
              )}
              {tab === "alpha" && (() => {
                const rows = alpha[alphaMode] ?? [];
                const ageS = (a: number | null) => a == null ? "—" : a < 3600 ? `${Math.floor(a / 60)}m` : a < 86400 ? `${Math.floor(a / 3600)}h` : `${Math.floor(a / 86400)}d`;
                const modeCopy: Record<string, [string, string]> = {
                  fresh: ["Fresh alpha", "tokens under 1 h old where smart capital is already entering"],
                  accum: ["Accumulation", "older tokens where top-100 wallets keep buying for hours while the price has not run yet"],
                  revival: ["Revival", "a token that went quiet for hours and is waking up on real volume from several wallets"],
                };
                return (
                  <div>
                    <div style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 10px" }}>
                      {(["fresh", "accum", "revival"] as const).map((m) => (
                        <button className="arc-mono" key={m} onClick={() => { alphaTouched.current = true; setAlphaMode(m); }} style={{ background: alphaMode === m ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (alphaMode === m ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 8, color: alphaMode === m ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "5px 11px" }} type="button">{modeCopy[m][0]}</button>
                      ))}
                      <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>{modeCopy[alphaMode][1]}</span>
                      <span className="arc-mono" style={{ alignItems: "center", color: "var(--arc-muted)", display: "inline-flex", fontSize: 11, gap: 8, marginLeft: "auto" }}>
                        {alphaLoading && <span aria-label="loading" className="arc-alpha-bar" />}
                        {rows.length ? `${rows.length} candidates · refresh 45 s` : alphaLoading ? "" : "0 candidates"}
                      </span>
                    </div>
                    <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "8px 10px 0" }}>
                      Score 0–100 from our own index: top-100 wallets buying, insider clusters, unique-buyer acceleration, buy flow, KOL mentions, clean dev/bundle. Screener, not advice — most memecoins go to zero. Every pick shows <b>why</b>.
                    </p>
                    {!alphaUnlocked && rows.length > 3 && (
                      <div className="arc-mono" style={{ background: "rgba(46,124,255,0.08)", border: "1px solid var(--arc-cobalt)", borderRadius: 10, margin: "10px 10px 0", padding: "14px 16px", textAlign: "center" }}>
                        <div style={{ color: "var(--arc-ink)", fontSize: 14, fontWeight: 700 }}>🔒 {rows.length - 3} more picks for ARCT stakers</div>
                        <div style={{ color: "var(--arc-muted)", fontSize: 12, marginTop: 4 }}>Top 3 are free for everyone. Stake {ALPHA_GATE.toLocaleString()} ARCT to see the full list, all three modes, 45 s refresh.</div>
                        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 10 }}>
                          <a className="arc-cta" href="/rewards2" style={{ fontSize: 12, padding: "8px 14px" }}>Stake ARCT →</a>
                          {!(browserAddr ?? hotAddr) && <button className="arc-mono" onClick={() => void connectWallet().then(setBrowserAddr).catch(() => null)} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "8px 14px" }} type="button">Connect wallet to check stake</button>}
                        </div>
                      </div>
                    )}
                    {rows.length === 0 && !alphaLoading && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "18px 10px" }}>Nothing qualifies right now — the gate is strict on purpose (dev ≤ 25 %, bundle ≤ 20 %, no dev selling, real volume).</p>}
                    <div style={{ display: "grid", gap: 8, padding: 10 }}>
                      {rows.map((a, i) => {
                        const gated = !alphaUnlocked && i >= 3;
                        const t = byToken.get(a.token.toLowerCase());
                        const col = a.score >= 75 ? "var(--arc-up)" : a.score >= 55 ? "#f5c542" : "var(--arc-muted)";
                        const strip = !alphaUnlocked && i === 3 ? (
                          <div className="arc-mono" key="strip" style={{ alignItems: "center", background: "rgba(46,124,255,0.10)", border: "1px dashed var(--arc-cobalt)", borderRadius: 8, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", padding: "8px 12px" }}>
                            <span style={{ color: "var(--arc-ink)", fontSize: 12 }}>🔒 {rows.length - 3} more picks below are for ARCT stakers</span>
                            <a className="arc-cta" href="/rewards2" style={{ fontSize: 11, padding: "4px 10px" }}>Stake 10,000 ARCT →</a>
                          </div>
                        ) : null;
                        return (<>
                          {strip}
                          <div key={a.token} style={{ alignItems: "center", background: i < 3 ? "rgba(46,124,255,0.06)" : "transparent", border: "1px solid var(--arc-line)", borderRadius: 10, display: "grid", filter: gated ? "blur(6px)" : "none", gap: 12, gridTemplateColumns: "64px minmax(0, 1fr) auto", padding: "10px 12px", pointerEvents: gated ? "none" : "auto", userSelect: gated ? "none" : "auto" }}>
                            <div className="arc-mono" style={{ textAlign: "center" }}>
                              <div style={{ color: col, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{a.score}</div>
                              <div style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 3 }}>#{i + 1}</div>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                                <Link params={{ ca: a.token }} preload="intent" style={{ alignItems: "center", color: "var(--arc-ink)", display: "inline-flex", fontWeight: 700, gap: 8, textDecoration: "none" }} to="/token2/$ca">
                                  <TokenLogo fallback={xAvatar(t?.twitter)} src={t?.logo ?? null} symbol={a.symbol ?? t?.symbol ?? "?"} />{a.symbol ?? t?.symbol ?? a.token.slice(0, 8)}
                                </Link>
                                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{t?.pad ?? ""} · age {ageS(a.age_s)} · <b style={{ color: "var(--arc-ink)" }}>MC {usd(a.mcap ?? toRow(a.token).mcap)}</b> · vol 6h {usd(a.vol_6h)}{a.liq != null ? ` · liq ${usd(a.liq)}` : ""}</span>
                                {a.first_mcap != null && a.first_ts != null && (() => {
                                  const agoS = Math.max(0, Math.floor(Date.now() / 1000) - a.first_ts);
                                  const ago = agoS < 120 ? "just now" : agoS < 3600 ? `${Math.floor(agoS / 60)}m ago` : agoS < 86400 ? `${Math.floor(agoS / 3600)}h ago` : `${Math.floor(agoS / 86400)}d ago`;
                                  const ch = a.since_call;
                                  return (
                                    <span className="arc-mono" style={{ background: "rgba(46,124,255,0.10)", border: "1px solid rgba(46,124,255,0.40)", borderRadius: 6, color: "var(--arc-ink)", fontSize: 11, padding: "2px 8px" }} title={`First time this token entered the Alpha list (${modeCopy[alphaMode][0]}): score ${a.first_score ?? "—"} at MC ${usd(a.first_mcap)}`}>
                                      first call {usd(a.first_mcap)} · {ago}{ch != null && agoS >= 120 ? <b style={{ color: ch >= 0 ? "var(--arc-up)" : "var(--arc-down)", marginLeft: 6 }}>{ch >= 0 ? "+" : ""}{(ch * 100).toFixed(0)}%</b> : null}
                                    </span>
                                  );
                                })()}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                                {a.reasons.map((r, k) => <span className="arc-mono" key={k} style={{ background: "rgba(34,197,128,0.10)", border: "1px solid rgba(34,197,128,0.35)", borderRadius: 6, color: "var(--arc-ink)", fontSize: 11, padding: "2px 8px" }}>{r}</span>)}
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <QuickBuy compact symbol={a.symbol ?? "?"} token={a.token} />
                              <a className="arc-mono" href={`https://t.me/ArcSniper_bot?start=ca_${a.token.slice(2)}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11, textAlign: "center", textDecoration: "none" }} target="_blank">snipe ↗</a>
                            </div>
                          </div>
                        </>);
                      })}
                    </div>
                  </div>
                );
              })()}
              {tab === "holdings" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr><th className="arc-th">token</th><th className="arc-th">amount</th><th className="arc-th">avg entry</th><th className="arc-th">price</th><th className="arc-th">value</th><th className="arc-th">unrealized</th><th className="arc-th">realized</th><th className="arc-th">sell</th></tr></thead>
                  <tbody>
                    {!addr && <tr><td className="arc-mono arc-td" colSpan={8} style={{ color: "var(--arc-muted)"  }}>Unlock the trading wallet to see holdings.</td></tr>}
                    {addr && positions.length === 0 && <tr><td className="arc-mono arc-td" colSpan={8} style={{ color: "var(--arc-muted)"  }}>No open positions yet (positions come from your on-chain swaps; new buys appear within seconds).</td></tr>}
                    {positions.map((p) => { const t = byToken.get(p.token.toLowerCase()); const sym = p.symbol ?? t?.symbol ?? short(p.token); return (
                      <tr key={p.token}>
                        <td className="arc-td"><Link params={{ ca: p.token }} preload="intent" style={{ color: "var(--arc-ink)", textDecoration: "none" }} to="/token2/$ca"><Logo t={{ logo: t?.logo, symbol: sym }} /><strong>{sym}</strong></Link></td>
                        <td className="arc-mono arc-td">{num(p.net)}</td>
                        <td className="arc-mono arc-td" style={{ color: "var(--arc-muted)"  }}>{priceStr(p.avg || null)}</td>
                        <td className="arc-mono arc-td">{priceStr(p.price)}</td>
                        <td className="arc-mono arc-td" style={{ fontWeight: 700  }}>{usd(p.value)}</td>
                        <td className="arc-mono arc-td" style={{ color: (p.unrealized ?? 0) >= 0 ? UP : DOWN  }}>{p.unrealized != null ? `${p.unrealized >= 0 ? "+" : "−"}${usd(Math.abs(p.unrealized))}${p.avg && p.price ? ` (${(((p.price - p.avg) / p.avg) * 100).toFixed(0)}%)` : ""}` : "—"}</td>
                        <td className="arc-mono arc-td" style={{ color: p.realized >= 0 ? UP : DOWN  }}>{p.realized >= 0 ? "+" : "−"}{usd(Math.abs(p.realized))}</td>
                        <td className="arc-td">{[25, 50, 100].map((pc) => <button key={pc} className="arc-mono" disabled={busy === p.token} onClick={() => void sell(p, pc)} style={{ background: "transparent", border: "1px solid " + DOWN, borderRadius: 4, color: DOWN, cursor: "pointer", fontSize: 11, marginRight: 4, padding: "3px 7px" }} type="button">{pc}%</button>)}</td>
                      </tr>); })}
                  </tbody>
                </table>
              )}
            </div>
            {tab !== "holdings" && pager("bottom")}
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 14 }}>
              Buys route through ArcAggregator (Uniswap V3 tiers, V4 pools, ArcToolsPad and Warp curves, split when it wins) with a 1.5% platform fee, 10% of it to $ARCT stakers. Need TP/SL, limit orders or copy-trade? <a href={SNIPER} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">Sniper bot</a>. Not financial advice.
            </p>
          </div>

          {/* RIGHT: wallet + toast */}
          <div className="arc-aside" style={{ display: "grid", gap: 12, height: "fit-content", position: "sticky", top: 96 }}>
            {toast && (
              <div style={{ background: "var(--arc-paper)", border: "1px solid " + (toast.ok ? UP : DOWN), fontSize: 13, padding: 12 }}>
                <p style={{ margin: 0 }}>{toast.text}</p>
                {toast.tx && <a className="arc-mono" href={`https://arc-scan.org/tx/${toast.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">{toast.tx.slice(0, 18)}… ↗</a>}
              </div>
            )}
            {/* Arc voices on X + crypto headlines; a post naming an Arc token buys it with the amount above */}
            <ArcFeed buyAmount={buyAmt} onBuy={(token) => void buy(token, byToken.get(token.toLowerCase())?.symbol || "")} />
          </div>
        </div>
      </section>
          <TradeToasts symbols={Object.fromEntries([...tableRows.map((r) => [r.token, r.symbol] as const), ...rows.map((r) => [r.token.toLowerCase(), r.symbol] as const)])} enabled={toastsOn} insiders={Object.fromEntries(Object.entries(risk).map(([t, k]) => [t, { dev: k.dev ?? null, bundle: k.bundle_wallets ?? [] }]))} logos={Object.fromEntries([...tableRows.map((r) => [r.token, r.logo] as const), ...trend.map((t) => [t.token.toLowerCase(), logos[t.token.toLowerCase()] ?? byToken.get(t.token.toLowerCase())?.logo ?? null] as const)])} tokens={[...new Set([...trend.map((t) => t.token), ...tableRows.map((r) => r.token)])]} />
    </main>
  );
}
