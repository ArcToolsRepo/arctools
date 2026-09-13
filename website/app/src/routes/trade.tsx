import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { holderRisk, listAllTokens, tokenLogos, xAvatar, type PadToken } from "@/lib/arc-api";
import { ARC_AGGREGATOR, connectWallet, encodeAggregatorSwap, ethCall, getStoredWallet, onWalletChange, p32, sendTx, waitReceipt } from "@/lib/arc-wallet";
import { hotAddress, hotCall, hotSend, hotWait } from "@/lib/arc-hotwallet";
import { TokenLogo } from "@/components/token-logo";
import { TradeToasts } from "@/components/trade-toasts";
import { ChainSearch } from "@/components/chain-search";
import { ScoreBadge, type Risk } from "@/components/risk";
import { creditRef } from "@/lib/arc-ref";
import { WalletPanel } from "@/components/wallet-panel";
import { routeSwap, type RouteResult } from "@/lib/arc-route";
import { quickAmount, setQuickAmount } from "@/components/quick-buy";
import "../arc-site.css";

const API = "https://bot-production-4200.up.railway.app";
const SNIPER = "https://t.me/ArcSniper_bot";

export const Route = createFileRoute("/trade")({
  // SSR: the first paint already contains the table (lists come from the KV-backed memo — milliseconds)
  loader: async () => {
    const [rows, trend] = await Promise.all([
      listAllTokens().catch(() => [] as PadToken[]),
      fetch(`${API}/api/trending?minutes=0&limit=120`).then((r) => r.json()).then((j) => (j.rows ?? []) as Trend[]).catch(() => [] as Trend[]),
    ]);
    return { rows, trend };
  },
  staleTime: 10_000,
  head: () => ({
    meta: [
      { title: "ArcTools Terminal: one-click buys on every Arc launchpad" },
      { content: "GMGN-style terminal for Arc: new pairs, trending, insider picks, one-click buy and sell from an in-browser wallet, best price across every venue.", name: "description" },
    ],
  }),
  component: Trade,
});

type Mover = { token: string; n: number; vol: number; p1: number; chg: number; symbol: string | null };
type Trend = { token: string; symbol: string | null; txs: number; vol: number; buys: number; sells: number; traders: number; p1: number | null; chg: number | null; first_ts: number | null; ath: number | null; txs_all: number; supply: number | null; mcap: number | null; ath_mcap: number | null };
type Smart = { token: string; net: number; bought: number; sold: number; buyers: number; sellers: number; best_rank: number | null; last_ts: number };
type Row = { token: string; symbol: string; name: string; logo: string | null; pad: string; og: boolean; stock: boolean; smart: Smart | null; quoteSymbol: string | null; dexes: string[]; age: number | null; ca: string; mcap: number | null; chg: number | null; athMcap: number | null; liq: number | null; vol: number; txs: number; buys: number; sells: number; traders: number; insiders: number; twitter: string | null; telegram: string | null; website: string | null; price: number | null };
const FAV_KEY = "arctools_favs";
const loadFavs = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]")); } catch { return new Set(); } };
type Cluster = { token: string; symbol: string | null; insiders: number; usd: number; ranks: string; last_ts: number };
type Position = { token: string; symbol: string | null; net: number; avg: number; price: number | null; value: number | null; unrealized: number | null; realized: number; cost: number; n: number; last_ts: number };

const usd = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
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

function Trade() {
  const navigate = useNavigate();
  // whole row is clickable: one click = token page with chart + swap; buttons/links inside keep their own action
  const rowClick = (token: string) => (e: React.MouseEvent<HTMLTableRowElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest("button, a, input")) return;
    // phones: a whole-row tap target makes scrolling/mis-taps open token pages — only the token cell navigates there
    if (typeof window !== "undefined" && window.innerWidth <= 760 && !el.closest(".arc-tokcell")) return;
    void navigate({ to: "/token/$ca", params: { ca: token } });
  };
  const [hotAddr, setHotAddr] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState<"" | "settings" | "filters">("");
  // who signs: the in-browser trading wallet (one click) or the connected browser wallet (MetaMask/Rabby — confirm each tx)
  const [signer, setSigner] = useState<"hot" | "browser">("hot");
  const [toastsOn, setToastsOn] = useState(true);
  // feed-style filters: launchpad / source, market-cap band, min volume (all persisted in the URL-free local state)
  const [padF, setPadF] = useState<string>("all");
  const PAGE = 50;
  const [page, setPage] = useState(1);
  const [minMc, setMinMc] = useState(""); const [maxMc, setMaxMc] = useState(""); const [minVol, setMinVol] = useState("");
  const PADS: [string, string][] = [["all", "All sources"], ["ArcToolsPad", "ArcToolsPad"], ["ArcPad", "ArcPad"], ["RadarDex", "RadarDex"], ["Warp", "Warp"], ["Tolly", "Tolly"], ["Archemist", "Archemist"], ["Arguspad", "Arguspad"], ["UniswapV4", "Uniswap V4"], ["UniswapV3", "Uniswap V3 pools"], ["long.supply", "📈 Stock pairs"], ["Stocks", "📈 Stocks"], ["DYORSwap", "DYORSwap · V2"], ["UBI.fun", "UBI.fun"]];
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
  const [tab, setTab] = useState<"new" | "new15" | "trending" | "insiders" | "favs" | "holdings">("trending");
  const initial = Route.useLoaderData();
  const [rows, setRows] = useState<PadToken[]>(initial?.rows ?? []);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [trend, setTrend] = useState<Trend[]>(initial?.trend ?? []);
  const [tf, setTf] = useState(0);   // 0 = all-time (default): every token shows its full volume / txs / change
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [liq, setLiq] = useState<Map<string, number>>(new Map());
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [risk, setRisk] = useState<Record<string, Risk>>({});
  const [sortKey, setSortKey] = useState<"age" | "mcap" | "vol" | "txs" | "chg" | "smart">("vol");
  useEffect(() => { setFavs(loadFavs()); }, []);
  const toggleFav = (t: string) => setFavs((f) => { const n = new Set(f); if (n.has(t)) n.delete(t); else n.add(t); try { localStorage.setItem(FAV_KEY, JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  useEffect(() => {
    let alive = true;
    // never replace a good trending set with an empty/failed fetch (that is what made vol/txs/ATH blink to "—")
    const load = () => fetch(`${API}/api/trending?minutes=${tf}&limit=120`).then((r) => r.json()).then((j) => { if (alive && Array.isArray(j.rows) && j.rows.length) setTrend(j.rows); }).catch(() => null);
    void load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [tf]);
  // on-chain USDC-side liquidity for the visible rows (own index API: V3/pad pool balances + V4 slot0/liquidity)
  const liqReq = useRef<Set<string>>(new Set());
  const fetchLiq = useCallback((tokens: string[]) => {
    const need = tokens.map((t) => t.toLowerCase()).filter((t) => !liqReq.current.has(t)).slice(0, 120);
    if (!need.length) return;
    need.forEach((t) => liqReq.current.add(t));
    fetch(`${API}/api/liq?tokens=${need.join(",")}`).then((r) => r.json()).then((j: { liq?: Record<string, number> }) => {
      setLiq((m) => { const n = new Map(m); for (const [k, v] of Object.entries(j.liq ?? {})) n.set(k, v); return n; });
    }).catch(() => { need.forEach((t) => liqReq.current.delete(t)); });
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
  const [q, setQ] = useState("");
  const lastRoute = useRef<Map<string, RouteResult>>(new Map());
  const buyAmt = custom && Number(custom) > 0 ? Number(custom) : amount;
  useEffect(() => { setQuickAmount(buyAmt); }, [buyAmt]);
  useEffect(() => {
    const a = quickAmount();
    if ([1, 5, 20, 100].includes(a)) setAmount(a); else setCustom(String(a));
    const ca = new URLSearchParams(window.location.search).get("buy");
    if (ca && /^0x[0-9a-fA-F]{40}$/.test(ca)) setQ(ca);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const all = await fetch("/api/tokens?full=1").then((r) => r.json()).then((j: { tokens?: PadToken[] }) => (j.tokens?.length ?? 0) > 100 ? j.tokens! : null).catch(() => null) ?? await listAllTokens();
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
                    <button className="arc-mono" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: page <= 1 ? "var(--arc-line)" : "var(--arc-ink)", cursor: page <= 1 ? "default" : "pointer", fontSize: 12, padding: "5px 10px" }} type="button">← prev</button>
                    {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2).reduce<(number | "…")[]>((acc, n) => { const last = acc[acc.length - 1]; if (typeof last === "number" && n - last > 1) acc.push("…"); acc.push(n); return acc; }, []).map((n, i) => n === "…" ? <span key={`e${i}`} style={{ color: "var(--arc-muted)", padding: "0 4px" }}>…</span> : (
                      <button className="arc-mono" key={n} onClick={() => setPage(n)} style={{ background: n === page ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (n === page ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 4, color: n === page ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, minWidth: 32, padding: "5px 8px" }} type="button">{n}</button>
                    ))}
                    <button className="arc-mono" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: page >= pages ? "var(--arc-line)" : "var(--arc-ink)", cursor: page >= pages ? "default" : "pointer", fontSize: 12, padding: "5px 10px" }} type="button">next →</button>
                    <span style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>{tableRows.length} tokens · page {page}/{pages}</span>
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
  const trendMap = useMemo(() => {
    const m = new Map<string, Trend>(Object.entries(extraStats));
    for (const t of trend) m.set(t.token.toLowerCase(), t);
    if (!m.has(OFFICIAL_TOKEN) && offStats) {
      const supply = 1e9; const px = offStats.price1m ? offStats.price1m / 1e6 : null;
      m.set(OFFICIAL_TOKEN, { token: OFFICIAL_TOKEN, symbol: "ARCT", txs: offStats.buys24 + offStats.sells24, vol: offStats.vol24, buys: offStats.buys24, sells: offStats.sells24, traders: offStats.traders24, p1: offStats.price1m, chg: null, first_ts: null, ath: null, txs_all: 0, supply, mcap: px ? px * supply : null, ath_mcap: null });
    }
    return m;
  }, [trend, offStats, extraStats]);
  const toRow = (token: string): Row => {
    const k = token.toLowerCase();
    const t = byToken.get(k); const tr = trendMap.get(k); const c = clusterMap.get(k);
    const createdTs = t?.createdAt ? new Date(t.createdAt).getTime() / 1000 : tr?.first_ts ?? null;
    return {
      token: k, symbol: tr?.symbol ?? t?.symbol ?? short(k), name: t?.name ?? tr?.symbol ?? "", logo: t?.logo ?? logos[k] ?? xAvatar(t?.twitter) ?? null, pad: t?.pad ?? "", og: !!t?.og, stock: !!t?.stock, quoteSymbol: t?.quoteSymbol ?? null, dexes: t?.dexes ?? [],
      age: createdTs, ca: k, mcap: (t?.quoteSymbol ? (t?.mcapUsd ?? tr?.mcap) : (tr?.mcap ?? t?.mcapUsd)) ?? null, chg: tr?.chg ?? null, athMcap: tr?.ath_mcap ?? null,
      liq: liq.get(k) ?? t?.liqUsd ?? null, vol: tr?.vol ?? t?.volUsd ?? 0, txs: tr?.txs ?? 0, buys: tr?.buys ?? 0, sells: tr?.sells ?? 0, traders: tr?.traders ?? 0,
      insiders: c?.insiders ?? 0, smart: smartMap.get(k) ?? null, twitter: t?.twitter ?? null, telegram: t?.telegram ?? null, website: t?.website ?? null,
      price: tr?.p1 ? tr.p1 / 1e6 : t?.priceUsd ?? null,
    };
  };
  useEffect(() => { setPage(1); }, [tab, padF, q, sortKey, minMc, maxMc, minVol]);
  const matches = (r: Row) => !q || `${r.name} ${r.symbol} ${r.token}`.toLowerCase().includes(q.toLowerCase());
  const tableRows: Row[] = useMemo(() => {
    let base: Row[];
    if (tab === "new") base = rows.map((t) => toRow(t.token)).sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    else if (tab === "new15") {
      // freshest launches: under 15 minutes old — the snipe window
      const now = Date.now() / 1000;
      base = rows.map((t) => toRow(t.token)).filter((r) => r.age && now - r.age < 900)
        .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    }
    else if (tab === "trending") base = trend.map((t) => toRow(t.token));
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
    base = base.filter(matches);
    const lo = Number(minMc) || 0, hi = Number(maxMc) || 0, mv = Number(minVol) || 0;
    if (lo) base = base.filter((r) => (r.mcap ?? 0) >= lo);
    if (hi) base = base.filter((r) => (r.mcap ?? 0) > 0 && (r.mcap ?? 0) <= hi);
    if (mv) base = base.filter((r) => r.vol >= mv);
    if ((tab !== "new" && tab !== "new15" && padF === "all") || sortKey !== "vol") {
      const key = ((tab === "new" || tab === "new15") || padF !== "all") && sortKey === "vol" ? "age" : sortKey;
      base.sort((a, b) => key === "age" ? (b.age ?? 0) - (a.age ?? 0) : key === "mcap" ? (b.mcap ?? 0) - (a.mcap ?? 0) : key === "txs" ? b.txs - a.txs : key === "chg" ? (b.chg ?? -1e9) - (a.chg ?? -1e9) : key === "smart" ? (b.smart?.net ?? -1e9) - (a.smart?.net ?? -1e9) : b.vol - a.vol);
    }
    // pin the official token on top (every tab except Holdings), regardless of sort / filter
    if (tab !== "holdings" && (!q || matches(toRow(OFFICIAL_TOKEN)))) {
      base = [toRow(OFFICIAL_TOKEN), ...base.filter((r) => r.token.toLowerCase() !== OFFICIAL_TOKEN)];
    }
    return base;
  }, [tab, rows, trend, clusters, favs, q, sortKey, byToken, trendMap, clusterMap, liq, logos, padF, minMc, maxMc, minVol]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(tableRows.length / PAGE));
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
      fetch(`${API}/api/stats?tokens=${want.join(",")}&minutes=${tf}`).then((r) => r.json()).then((j: { rows?: Trend[] }) => {
        if (!alive || !j.rows) return;
        setExtraStats((o) => { const n = { ...o }; for (const r of j.rows!) n[r.token.toLowerCase()] = r; return n; });
      }).catch(() => null);
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
    const vis = pageRows.map((r) => r.token);
    const needLogo = vis.filter((t) => !logos[t] && !byToken.get(t)?.logo);
    if (needLogo.length) void tokenLogos({ data: { tokens: needLogo } }).then((m) => setLogos((o) => ({ ...o, ...m }))).catch(() => null);
    fetchLiq(vis);
    const needRisk = vis.filter((t) => !risk[t]).slice(0, 40);
    if (needRisk.length) void holderRisk({ data: { tokens: needRisk } }).then((m) => setRisk((o) => ({ ...o, ...(m as Record<string, Risk>) }))).catch(() => null);
    // dev / bundle sells must show up while you watch: refresh the visible rows' risk every 60 s
    const id = setInterval(() => { if (document.hidden) return; void holderRisk({ data: { tokens: vis.slice(0, 40) } }).then((m) => setRisk((o) => ({ ...o, ...(m as Record<string, Risk>) }))).catch(() => null); }, 60_000);
    return () => clearInterval(id);
  }, [pageRows]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/trade" />
      <section className="arc-section" style={{ maxWidth: 1360, paddingTop: 118 }}>
        <div className="arc-2col" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
          {/* LEFT: terminal */}
          <div>
            <div className="arc-title" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <h1 style={{ fontSize: 26, margin: 0 }}>Terminal</h1>
              <span style={{ color: "var(--arc-muted)", fontSize: 13 }}>every Arc launchpad · one click · best price across venues · <a href="/profile" style={{ color: "var(--arc-cobalt)" }}>profile & history →</a></span>
            </div>
            {/* quick-buy bar */}
            <button className="arc-mono arc-mobile-bar" onClick={() => setMobileOpen((o) => (o === "settings" ? "" : "settings"))} type="button">
              <span>⚡ {buyAmt} USDC · slip {slip}% · {signer === "hot" ? (addr ? "trading wallet" : "no wallet") : "browser wallet"}</span><span style={{ color: "var(--arc-muted)" }}>{mobileOpen === "settings" ? "hide ▴" : "settings ▾"}</span>
            </button>
            <div className={`arc-controls${mobileOpen === "settings" ? " arc-mobile-open" : ""}`} style={{ alignItems: "center", background: "var(--arc-paper)", border: "1px solid var(--arc-line)", display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, padding: "8px 12px" }}>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>SIGN WITH</span>
              {(["hot", "browser"] as const).map((k) => (
                <button className="arc-mono" key={k} onClick={() => { setSigner(k); if (k === "browser" && !browserAddr) void connectWallet().then(setBrowserAddr).catch(() => null); }} style={{ background: signer === k ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (signer === k ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 4, color: signer === k ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "4px 8px" }} title={k === "hot" ? "In-browser trading wallet: one click, no popups" : "MetaMask / Rabby: confirm every transaction"} type="button">
                  {k === "hot" ? "⚡ trading" : browserAddr && signer === "browser" ? `🦊 ${browserAddr.slice(0, 6)}…` : "🦊 browser"}
                </button>
              ))}
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 6 }}>QUICK BUY</span>
              {[1, 5, 20, 100].map((a) => <button key={a} className="arc-mono" onClick={() => { setAmount(a); setCustom(""); }} style={{ background: amount === a && !custom ? "rgba(34,197,128,0.18)" : "transparent", border: "1px solid " + (amount === a && !custom ? UP : "var(--arc-line)"), color: amount === a && !custom ? UP : "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "4px 10px" }} type="button">{a} USDC</button>)}
              <input className="arc-mono" inputMode="decimal" onChange={(e) => setCustom(e.target.value)} placeholder="custom" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "4px 8px", width: 80 }} value={custom} />
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>SLIPPAGE</span>
              {[1, 5, 15, 30].map((s) => <button key={s} className="arc-mono" onClick={() => setSlip(s)} style={{ background: slip === s ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (slip === s ? "var(--arc-cobalt)" : "var(--arc-line)"), color: slip === s ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 8px" }} type="button">{s}%</button>)}
              <input className="arc-mono" onChange={(e) => setQ(e.target.value)} placeholder="search any Arc token · name / symbol / CA" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 160px", fontSize: 12, marginLeft: "auto", padding: "4px 8px" }} value={q} />
            </div>
            {/* tabs */}
            <button className="arc-mono arc-mobile-bar" onClick={() => setMobileOpen((o) => (o === "filters" ? "" : "filters"))} type="button">
              <span>Sources & filters{padF !== "all" ? ` · ${padF}` : ""}</span><span style={{ color: "var(--arc-muted)" }}>{mobileOpen === "filters" ? "hide ▴" : "show ▾"}</span>
            </button>
            <div className={`arc-filters${mobileOpen === "filters" ? " arc-mobile-open" : ""}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, margin: "2px 0 8px" }}>
              <div className="arc-chips" style={{ display: "contents" }}>
              {PADS.map(([k, l]) => <button className="arc-mono" key={k} onClick={() => setPadF(k)} style={{ background: padF === k ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (padF === k ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 999, color: padF === k ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 10px" }} type="button">{l}</button>)}
              </div>
              <span style={{ flex: 1 }} />
              {[["min MC $", minMc, setMinMc], ["max MC $", maxMc, setMaxMc], ["min vol $", minVol, setMinVol]].map(([ph, v, set]) => (
                <input className="arc-mono" inputMode="numeric" key={ph as string} onChange={(e) => (set as (x: string) => void)(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={ph as string} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-ink)", fontSize: 11, padding: "4px 8px", width: 84 }} value={v as string} />
              ))}
              <select className="arc-mono" onChange={(e) => setSortKey(e.target.value as typeof sortKey)} style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-ink)", fontSize: 11, padding: "4px 6px" }} value={sortKey}>
                <option value="vol">Sort: volume</option><option value="age">Sort: newest</option><option value="mcap">Sort: market cap</option><option value="txs">Sort: trades</option><option value="chg">Sort: % change</option><option value="smart">Sort: smart money</option>
              </select>
              {(padF !== "all" || minMc || maxMc || minVol || q) && <button className="arc-mono" onClick={() => { setPadF("all"); setMinMc(""); setMaxMc(""); setMinVol(""); setQ(""); }} style={{ background: "transparent", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, textDecoration: "underline" }} type="button">clear</button>}
            </div>
            <div className="arc-tabs" style={{ borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 2, marginBottom: 8 }}>
              {([["new", "New pair"], ["new15", "New <15m"], ["trending", "Trending"], ["insiders", "Insider picks"], ["favs", `★ Watchlist${favs.size ? ` (${favs.size})` : ""}`], ["holdings", `Holdings${positions.length ? ` (${positions.length})` : ""}`]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{ background: "transparent", border: "none", borderBottom: "2px solid " + (tab === k ? "var(--arc-up)" : "transparent"), color: tab === k ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 15, fontWeight: tab === k ? 700 : 400, padding: "8px 14px" }} type="button">{l}</button>
              ))}
              <span style={{ marginLeft: "auto" }}>
                {[1, 5, 60, 360, 1440, 0].map((m) => <button key={m} className="arc-mono" onClick={() => setTf(m)} style={{ background: tf === m ? "rgba(255,255,255,0.08)" : "transparent", border: "1px solid " + (tf === m ? "var(--arc-line)" : "transparent"), borderRadius: 4, color: tf === m ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, marginLeft: 2, padding: "4px 9px" }} type="button">{tfLabel(m)}</button>)}
                <button className="arc-mono" onClick={toggleToasts} style={{ background: toastsOn ? "rgba(34,197,128,0.12)" : "transparent", border: "1px solid " + (toastsOn ? "var(--arc-up)" : "var(--arc-line)"), borderRadius: 4, color: toastsOn ? "var(--arc-up)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginLeft: 8, padding: "3px 8px" }} title="Live buy/sell pop-ups for the tokens on screen" type="button">{toastsOn ? "🔔 live" : "🔕 live"}</button>
              </span>
            </div>
            {/* chain-wide search: every ERC-20 on Arc by name / symbol / address (shows when the query is not an address; addresses use the quick action below) */}
            {q.trim().length >= 2 && !/^0x[0-9a-fA-F]{40}$/.test(q.trim()) && (
              <ChainSearch q={q} hide={new Set(tableRows.map((r) => r.token.toLowerCase()))} renderBuy={(h) => <BuyBtn symbol={h.symbol ?? short(h.token)} token={h.token} />} />
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
              {tab !== "holdings" && (
                <><table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ ...hd, width: 26 }} />
                      <th style={hd}>Token / <button className="arc-mono" onClick={() => setSortKey("age")} style={{ background: "none", border: "none", color: sortKey === "age" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">Age ⇅</button></th>
                      <th style={hd}><button className="arc-mono" onClick={() => setSortKey("mcap")} style={{ background: "none", border: "none", color: sortKey === "mcap" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">MC ⇅</button></th>
                      <th className="arc-col-ath" style={hd}>ATH MC</th>
                      <th className="arc-col-liq" style={hd}>Liq</th>
                      <th className="arc-col-vol" style={hd}><button className="arc-mono" onClick={() => setSortKey("vol")} style={{ background: "none", border: "none", color: sortKey === "vol" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">{tfLabel(tf)} Vol ⇅</button></th>
                      <th className="arc-col-txs" style={hd}><button className="arc-mono" onClick={() => setSortKey("txs")} style={{ background: "none", border: "none", color: sortKey === "txs" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">{tfLabel(tf)} TXs ⇅</button></th>
                      <th style={hd} title="Token Score 0-100: deployer share, bundle, whale concentration, dev / bundle selling, deployer rug history, holders. Hover a badge for the flags. ☠ = deployer dumped a token before">Score</th>
                      <th className="arc-col-dev" style={hd} title="Dev: deployer wallet's share of supply · Bundle: supply held by wallets that bought within 2 s of the first trade">Dev / bundle</th>
                      <th className="arc-col-ins" style={hd} title={`Smart money: net USDC flow of the top-100 insiders (buys − sells) in the ${tfLabel(tf)} window · distinct insiders buying/selling`}><button className="arc-mono" onClick={() => setSortKey("smart")} style={{ background: "none", border: "none", color: sortKey === "smart" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", font: "inherit", padding: 0 }}>Smart ⇅</button></th>
                      <th style={hd} />
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.length === 0 && <tr><td className="arc-mono" colSpan={11} style={{ ...cell, color: "var(--arc-muted)" }}>{tab === "favs" ? "No favourites yet — click ☆ on any row." : tab === "new15" ? "No launch younger than 15 minutes right now — watch New pair." : (padF !== "all" || minMc || maxMc || minVol) ? "Nothing matches these filters."  : tab === "insiders" ? "No token with 2+ insiders in the last 24h." : "Loading…"}</td></tr>}
                    {pageRows.map((r) => (
                      <tr className="arc-row-link" key={r.token} onClick={rowClick(r.token)} onMouseEnter={() => { void import("@/lib/arc-api").then((m) => m.tokenPage({ data: { token: r.token } })).catch(() => null); }} style={{ background: r.token.toLowerCase() === OFFICIAL_TOKEN ? "rgba(46,124,255,0.09)" : favs.has(r.token) ? "rgba(46,124,255,0.05)" : undefined, cursor: "pointer" }}>
                        <td style={{ ...cell, paddingRight: 4 }}><button onClick={() => toggleFav(r.token)} style={{ background: "none", border: "none", color: favs.has(r.token) ? "#f5c542" : "var(--arc-muted)", cursor: "pointer", fontSize: 15, padding: 0 }} title="favourite" type="button">{favs.has(r.token) ? "★" : "☆"}</button></td>
                        <td className="arc-tokcell" style={{ ...cell, minWidth: 230 }}>
                          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                            <Link params={{ ca: r.token }} preload="intent" style={{ textDecoration: "none" }} to="/token/$ca"><TokenLogo fallback={xAvatar(r.twitter)} src={r.logo} symbol={r.symbol} /></Link>
                            <div style={{ lineHeight: 1.25 }}>
                              <div><Link params={{ ca: r.token }} preload="intent" style={{ color: "var(--arc-ink)", fontWeight: 700, textDecoration: "none" }} to="/token/$ca">{r.symbol}</Link>{r.token.toLowerCase() === OFFICIAL_TOKEN && <span className="arc-mono" style={{ background: "rgba(46,124,255,0.18)", border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "#fff", fontSize: 10, marginLeft: 6, padding: "1px 6px", verticalAlign: "middle" }}>⭐ OFFICIAL</span>}{r.og && <span className="arc-mono" style={{ background: "rgba(245,197,66,0.15)", border: "1px solid #f5c542", borderRadius: 4, color: "#f5c542", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title="OG ticker: registered on RadarDex before Arc mainnet launch">OG</span>}{r.stock && <span className="arc-mono" style={{ background: "rgba(124,196,255,0.14)", border: "1px solid #7cc4ff", borderRadius: 4, color: "#7cc4ff", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title="Wrapped stock minted by long.supply: a custodial IOU on a Robinhood-Chain token held in their vault. Not a share, no shareholder rights, redemptions depend on the team.">📈 STOCK · IOU</span>}{!r.stock && r.quoteSymbol && <span className="arc-mono" style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", fontSize: 10, marginLeft: 6, padding: "1px 5px", verticalAlign: "middle" }} title={`Quoted in ${r.quoteSymbol} (long.supply wrapped stock), USD price derived through the stock price`}>/{r.quoteSymbol}</span>} <span className="arc-name" style={{ color: "var(--arc-muted)", fontSize: 12 }}>{r.name.slice(0, 12)}</span>
                                {r.twitter && <a className="arc-tokmeta" href={r.twitter} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 6 }} target="_blank">𝕏</a>}
                                {r.telegram && <a className="arc-tokmeta" href={r.telegram} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 4 }} target="_blank">✈︎</a>}
                                {r.website && <a className="arc-tokmeta" href={r.website} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 4 }} target="_blank">🌐</a>}
                              </div>
                              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
                                <span style={{ color: UP }}>{r.age ? ago(r.age) : "—"}</span> · {short(r.ca)}
                                <button className="arc-mono" onClick={() => void navigator.clipboard.writeText(r.token)} style={{ background: "none", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "0 4px" }} title="copy CA" type="button">⧉</button>
                                {r.pad && <span className="arc-tokmeta" style={{ border: "1px solid var(--arc-line)", borderRadius: 3, fontSize: 9, marginLeft: 4, padding: "0 4px" }}>{r.pad}</span>}
                                {r.traders > 0 && <span className="arc-tokmeta" style={{ marginLeft: 6 }} title="traders in window">👥{r.traders}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="arc-mono" style={cell}><div style={{ color: "var(--arc-cobalt)", fontWeight: 700 }}>{usd(r.mcap)}</div>{r.chg != null && <div style={{ color: r.chg >= 0 ? UP : DOWN, fontSize: 11 }}>{r.chg >= 0 ? "+" : ""}{r.chg.toFixed(1)}%</div>}</td>
                        <td className="arc-mono arc-col-ath" style={{ ...cell, color: "var(--arc-cobalt)" }}>{usd(r.athMcap)}</td>
                        <td className="arc-mono arc-col-liq" style={cell}>{r.liq != null && r.liq > 0 ? usd(r.liq) : "—"}</td>
                        <td className="arc-mono arc-col-vol" style={{ ...cell, color: "#f5c542" }}>{r.vol > 0 ? usd(r.vol) : "—"}</td>
                        <td className="arc-mono arc-col-txs" style={cell}><div>{r.txs > 0 ? r.txs.toLocaleString() : "—"}</div>{r.txs > 0 && <div style={{ fontSize: 11 }}><span style={{ color: UP }}>{r.buys}</span> / <span style={{ color: DOWN }}>{r.sells}</span></div>}</td>
                        <td className="arc-mono" style={cell}>{(() => { if (r.stock) return <span className="arc-mono" style={{ border: "1px solid #7cc4ff", borderRadius: 5, color: "#7cc4ff", fontSize: 11, padding: "3px 6px" }} title="Custodial IOU — score not applicable; risk = trust in long.supply's vault and Robinhood's token">IOU</span>; const k = risk[r.token]; if (!k) return <span style={{ color: "var(--arc-muted)" }}>…</span>; const t10 = k.top10; return <><ScoreBadge risk={k} /><div style={{ color: "var(--arc-muted)", fontSize: 10.5, marginTop: 3 }} title={`${k.holders ?? "?"} holders · top-10 hold ${t10 != null ? t10.toFixed(0) : "?"}%`}>{k.holders ? `${k.holders >= 1000 ? (k.holders / 1000).toFixed(1) + "k" : k.holders}h` : ""}{t10 != null && r.token.toLowerCase() !== OFFICIAL_TOKEN ? ` · t10 ${t10.toFixed(0)}%` : ""}</div></>; })()}</td>
                        <td className="arc-mono arc-col-dev" style={cell}>{(() => { if (r.stock) return <span style={{ color: "var(--arc-muted)", fontSize: 11 }} title="Wrapped stock: supply is minted/burned by the long.supply custodian, so deployer and bundle metrics do not apply">custodian-minted</span>; const k = risk[r.token]; if (!k) return <span style={{ color: "var(--arc-muted)" }}>…</span>; const dv = k.dev_pct, bd = k.bundle_pct; const c = (v: number | null | undefined, warn: number, bad: number) => v == null ? "var(--arc-muted)" : v >= bad ? DOWN : v >= warn ? "#f5c542" : UP; const ds = k.dev_sold_usd ?? 0, bs = k.bundle_sold_usd ?? 0; return <><div style={{ color: c(dv, 5, 15), fontWeight: 700 }} title="Deployer wallet's share of supply (top-50 holders)">{dv == null ? "—" : `${dv.toFixed(dv < 1 ? 1 : 0)}%`}{ds > 0 && <span style={{ background: "rgba(240,83,79,0.16)", border: "1px solid #f0534f", borderRadius: 4, color: "#f0534f", display: "inline-block", fontSize: 9, lineHeight: "13px", marginLeft: 5, padding: "0 4px", verticalAlign: "middle" }} title={`Deployer sold ${usd(ds)} in the last 24 h (${k.dev_sells} sell${k.dev_sells === 1 ? "" : "s"}, last ${ago(k.dev_last_sell ?? null)} ago)`}>DEV −{usd(ds)}</span>}</div><div style={{ color: c(bd, 10, 25), fontSize: 11 }} title={`Bundled: supply held by wallets that bought within 2 s of the first trade (${k.bundlers ?? 0} wallets)`}>{bd == null ? "" : `bundle ${bd.toFixed(bd < 1 ? 1 : 0)}%`}{bs > 0 && <span style={{ color: "#f0534f", fontSize: 10, marginLeft: 4 }} title={`${k.bundle_sellers} launch-block wallet${k.bundle_sellers === 1 ? "" : "s"} sold ${usd(bs)} in the last 24 h (last ${ago(k.bundle_last_sell ?? null)} ago)`}>−{usd(bs)}</span>}</div></>; })()}</td>
                        <td className="arc-mono arc-col-ins" style={{ ...cell, minWidth: 72, paddingRight: 8 }}>{r.smart ? (r.smart.buyers + r.smart.sellers === 0 ? <span style={{ color: "var(--arc-muted)" }} title={`no top-100 insider trades in the ${tfLabel(tf)} window`}>0</span> : <div title={`top-100 insiders (${tfLabel(tf)}): bought ${usd(r.smart.bought)} · sold ${usd(r.smart.sold)} · ${r.smart.buyers} buying / ${r.smart.sellers} selling${r.smart.best_rank ? ` · best rank #${r.smart.best_rank}` : ""}`}><div style={{ color: r.smart.net >= 0 ? UP : DOWN, fontWeight: 700 }}>{r.smart.net >= 0 ? "+" : "−"}{usd(Math.abs(r.smart.net))}</div><div style={{ color: "var(--arc-muted)", fontSize: 10.5 }}>{r.smart.buyers}↑ {r.smart.sellers}↓</div></div>) : <span style={{ color: "var(--arc-muted)" }}>…</span>}</td>
                        <td style={{ ...cell, textAlign: "right" }}><BuyBtn symbol={r.symbol} token={r.token} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
              )}
              {tab === "holdings" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr><th style={hd}>token</th><th style={hd}>amount</th><th style={hd}>avg entry</th><th style={hd}>price</th><th style={hd}>value</th><th style={hd}>unrealized</th><th style={hd}>realized</th><th style={hd}>sell</th></tr></thead>
                  <tbody>
                    {!addr && <tr><td className="arc-mono" colSpan={8} style={{ ...cell, color: "var(--arc-muted)" }}>Unlock the trading wallet to see holdings.</td></tr>}
                    {addr && positions.length === 0 && <tr><td className="arc-mono" colSpan={8} style={{ ...cell, color: "var(--arc-muted)" }}>No open positions yet (positions come from your on-chain swaps; new buys appear within seconds).</td></tr>}
                    {positions.map((p) => { const t = byToken.get(p.token.toLowerCase()); const sym = p.symbol ?? t?.symbol ?? short(p.token); return (
                      <tr key={p.token}>
                        <td style={cell}><Link params={{ ca: p.token }} preload="intent" style={{ color: "var(--arc-ink)", textDecoration: "none" }} to="/token/$ca"><Logo t={{ logo: t?.logo, symbol: sym }} /><strong>{sym}</strong></Link></td>
                        <td className="arc-mono" style={cell}>{num(p.net)}</td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-muted)" }}>{priceStr(p.avg || null)}</td>
                        <td className="arc-mono" style={cell}>{priceStr(p.price)}</td>
                        <td className="arc-mono" style={{ ...cell, fontWeight: 700 }}>{usd(p.value)}</td>
                        <td className="arc-mono" style={{ ...cell, color: (p.unrealized ?? 0) >= 0 ? UP : DOWN }}>{p.unrealized != null ? `${p.unrealized >= 0 ? "+" : "−"}${usd(Math.abs(p.unrealized))}${p.avg && p.price ? ` (${(((p.price - p.avg) / p.avg) * 100).toFixed(0)}%)` : ""}` : "—"}</td>
                        <td className="arc-mono" style={{ ...cell, color: p.realized >= 0 ? UP : DOWN }}>{p.realized >= 0 ? "+" : "−"}{usd(Math.abs(p.realized))}</td>
                        <td style={cell}>{[25, 50, 100].map((pc) => <button key={pc} className="arc-mono" disabled={busy === p.token} onClick={() => void sell(p, pc)} style={{ background: "transparent", border: "1px solid " + DOWN, borderRadius: 4, color: DOWN, cursor: "pointer", fontSize: 11, marginRight: 4, padding: "3px 7px" }} type="button">{pc}%</button>)}</td>
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
            <WalletPanel onReady={setAddr} />
            {toast && (
              <div style={{ background: "var(--arc-paper)", border: "1px solid " + (toast.ok ? UP : DOWN), fontSize: 13, padding: 12 }}>
                <p style={{ margin: 0 }}>{toast.text}</p>
                {toast.tx && <a className="arc-mono" href={`https://arc-scan.org/tx/${toast.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">{toast.tx.slice(0, 18)}… ↗</a>}
              </div>
            )}
            <div style={{ background: "var(--arc-paper)", border: "1px solid var(--arc-line)", fontSize: 12, padding: 12 }}>
              <p style={{ fontWeight: 700, margin: "0 0 6px" }}>How it works</p>
              <ol style={{ color: "var(--arc-muted)", margin: 0, paddingLeft: 18 }}>
                <li>Create a trading wallet (key stays in this browser, encrypted with your passcode).</li>
                <li>Deposit USDC on Arc to its address, or <a href="/bridge" style={{ color: "var(--arc-cobalt)" }}>bridge</a> from another chain.</li>
                <li>Pick an amount, hit ⚡ on any row. The aggregator finds the best venue; the tx signs locally, no popup.</li>
                <li>Sell 25/50/100% from Holdings. Withdraw or export the key any time.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>
          <TradeToasts enabled={toastsOn} insiders={Object.fromEntries(Object.entries(risk).map(([t, k]) => [t, { dev: k.dev ?? null, bundle: k.bundle_wallets ?? [] }]))} logos={Object.fromEntries([...tableRows.map((r) => [r.token, r.logo] as const), ...trend.map((t) => [t.token.toLowerCase(), logos[t.token.toLowerCase()] ?? byToken.get(t.token.toLowerCase())?.logo ?? null] as const)])} tokens={[...new Set([...trend.map((t) => t.token), ...tableRows.map((r) => r.token)])]} />
    </main>
  );
}
