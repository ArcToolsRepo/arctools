import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { holderRisk, listTokens, tokenLogos, type PadToken } from "@/lib/arc-api";
import { padList } from "@/lib/arcpad";
import { ARC_AGGREGATOR, connectWallet, encodeAggregatorSwap, ethCall, getStoredWallet, onWalletChange, p32, sendTx, waitReceipt } from "@/lib/arc-wallet";
import { hotAddress, hotCall, hotSend, hotWait } from "@/lib/arc-hotwallet";
import { WalletPanel } from "@/components/wallet-panel";
import { routeSwap, type RouteResult } from "@/lib/arc-route";
import { quickAmount, setQuickAmount } from "@/components/quick-buy";
import "../arc-site.css";

const API = "https://bot-production-4200.up.railway.app";
const SNIPER = "https://t.me/ArcSniper_bot";

export const Route = createFileRoute("/trade")({
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
type Row = { token: string; symbol: string; name: string; logo: string | null; pad: string; age: number | null; ca: string; mcap: number | null; chg: number | null; athMcap: number | null; liq: number | null; vol: number; txs: number; buys: number; sells: number; traders: number; insiders: number; twitter: string | null; telegram: string | null; website: string | null; price: number | null };
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
const tfLabel = (m: number) => (m < 60 ? `${m}m` : `${m / 60}h`);
const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";
const cell: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 13, padding: "9px 10px 9px 0", verticalAlign: "middle", whiteSpace: "nowrap" };
const hd: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 10, fontWeight: 400, padding: "0 10px 8px 0", textAlign: "left", textTransform: "uppercase" };

// ---------------- page ----------------
function Trade() {
  const [hotAddr, setHotAddr] = useState<string | null>(null);
  // who signs: the in-browser trading wallet (one click) or the connected browser wallet (MetaMask/Rabby — confirm each tx)
  const [signer, setSigner] = useState<"hot" | "browser">("hot");
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
  const [rows, setRows] = useState<PadToken[]>([]);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [tf, setTf] = useState(60);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [liq, setLiq] = useState<Map<string, number>>(new Map());
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [risk, setRisk] = useState<Record<string, { holders: number; top10: number | null; top1: number | null }>>({});
  const [sortKey, setSortKey] = useState<"age" | "mcap" | "vol" | "txs" | "chg">("vol");
  useEffect(() => { setFavs(loadFavs()); }, []);
  const toggleFav = (t: string) => setFavs((f) => { const n = new Set(f); if (n.has(t)) n.delete(t); else n.add(t); try { localStorage.setItem(FAV_KEY, JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API}/api/trending?minutes=${tf}&limit=120`).then((r) => r.json()).then((j) => alive && setTrend(j.rows ?? [])).catch(() => null);
    void load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [tf]);
  useEffect(() => {
    fetch("https://api.radardex.pro/tokens").then((r) => r.json()).then((j: { tokens?: { address?: string; liquidityUsdc?: number }[] }) => {
      setLiq(new Map((j.tokens ?? []).filter((t) => t.address).map((t) => [t.address!.toLowerCase(), Number(t.liquidityUsdc ?? 0)])));
    }).catch(() => null);
  }, []);
  const [clusters, setClusters] = useState<Cluster[]>([]);
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
        const [radar, arcpad, warp, tolly, uni, pad, arch, v4, argus] = await Promise.all(
          ["RadarDex", "ArcPad", "Warp", "Tolly", "UniswapV3", "__pad", "Archemist", "UniswapV4", "Arguspad"].map((p) =>
            p === "__pad" ? padList().then((ps) => ps.map((x) => ({ createdAt: x.createdAt ? new Date(x.createdAt * 1000).toISOString() : null, logo: x.image, mcapUsd: x.pricePer1M > 0 ? x.pricePer1M * 1000 : null, name: x.name, pad: "ArcToolsPad", pool: null, priceUsd: null, symbol: x.symbol, telegram: x.telegram, token: x.token, twitter: x.twitter, venueUrl: `/token/${x.token}`, volUsd: x.volumeUsdc, website: x.website }) as PadToken)).catch(() => [] as PadToken[])
              : listTokens({ data: { pad: p } }).catch(() => [] as PadToken[])),
        );
        const seen = new Set<string>();
        const all = [...pad, ...radar, ...arcpad, ...warp, ...tolly, ...arch, ...argus, ...v4, ...uni].filter((t) => { const k = t.token.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        if (alive) setRows(all);
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

  const byToken = useMemo(() => new Map(rows.map((r) => [r.token.toLowerCase(), r])), [rows]);
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
      void loadPositions();
    } catch (e) { setToast({ ok: false, text: (e as Error).message }); }
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
      void loadPositions();
    } catch (e) { setToast({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  };

  const BuyBtn = ({ token, symbol }: { token: string; symbol: string }) => (
    <button className="arc-mono" disabled={busy === token} onClick={() => void buy(token, symbol)} style={{ background: busy === token ? "transparent" : "var(--arc-up)", border: "1px solid var(--arc-up)", borderRadius: 4, color: busy === token ? "var(--arc-up)" : "#06130b", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 10px", whiteSpace: "nowrap" }} type="button">
      {busy === token ? "…" : `⚡ ${buyAmt} USDC`}
    </button>
  );
  const Logo = ({ t }: { t: { logo?: string | null; symbol: string } }) => (
    <span style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 6, display: "inline-flex", height: 30, justifyContent: "center", marginRight: 8, overflow: "hidden", verticalAlign: "middle", width: 30 }}>
      {t.logo ? <img alt="" height={30} src={t.logo} style={{ objectFit: "cover" }} width={30} /> : <span className="arc-mono" style={{ fontSize: 12 }}>{t.symbol.slice(0, 1)}</span>}
    </span>
  );

  const trendMap = useMemo(() => new Map(trend.map((t) => [t.token.toLowerCase(), t])), [trend]);
  const toRow = (token: string): Row => {
    const k = token.toLowerCase();
    const t = byToken.get(k); const tr = trendMap.get(k); const c = clusterMap.get(k);
    const createdTs = t?.createdAt ? new Date(t.createdAt).getTime() / 1000 : tr?.first_ts ?? null;
    return {
      token: k, symbol: tr?.symbol ?? t?.symbol ?? short(k), name: t?.name ?? tr?.symbol ?? "", logo: t?.logo ?? logos[k] ?? null, pad: t?.pad ?? "",
      age: createdTs, ca: k, mcap: tr?.mcap ?? t?.mcapUsd ?? null, chg: tr?.chg ?? null, athMcap: tr?.ath_mcap ?? null,
      liq: liq.get(k) ?? null, vol: tr?.vol ?? t?.volUsd ?? 0, txs: tr?.txs ?? 0, buys: tr?.buys ?? 0, sells: tr?.sells ?? 0, traders: tr?.traders ?? 0,
      insiders: c?.insiders ?? 0, twitter: t?.twitter ?? null, telegram: t?.telegram ?? null, website: t?.website ?? null,
      price: tr?.p1 ? tr.p1 / 1e6 : t?.priceUsd ?? null,
    };
  };
  const matches = (r: Row) => !q || `${r.name} ${r.symbol} ${r.token}`.toLowerCase().includes(q.toLowerCase());
  const tableRows: Row[] = useMemo(() => {
    let base: Row[];
    if (tab === "new") base = rows.map((t) => toRow(t.token)).sort((a, b) => (b.age ?? 0) - (a.age ?? 0)).slice(0, 100);
    else if (tab === "new15") {
      // survivors: launched 15 min – 24 h ago, still have liquidity and at least one trade — the post-snipe window
      const now = Date.now() / 1000;
      base = rows.map((t) => toRow(t.token)).filter((r) => r.age && now - r.age >= 900 && now - r.age <= 86_400 && (r.liq === null || r.liq > 0))
        .sort((a, b) => (b.age ?? 0) - (a.age ?? 0)).slice(0, 100);
    }
    else if (tab === "trending") base = trend.map((t) => toRow(t.token));
    else if (tab === "insiders") base = clusters.map((c) => toRow(c.token));
    else if (tab === "favs") base = [...favs].map((t) => toRow(t));
    else base = [];
    base = base.filter(matches);
    if ((tab !== "new" && tab !== "new15") || sortKey !== "vol") {
      const key = (tab === "new" || tab === "new15") && sortKey === "vol" ? "age" : sortKey;
      base.sort((a, b) => key === "age" ? (b.age ?? 0) - (a.age ?? 0) : key === "mcap" ? (b.mcap ?? 0) - (a.mcap ?? 0) : key === "txs" ? b.txs - a.txs : key === "chg" ? (b.chg ?? -1e9) - (a.chg ?? -1e9) : b.vol - a.vol);
    }
    return base;
  }, [tab, rows, trend, clusters, favs, q, sortKey, byToken, trendMap, clusterMap, liq, logos]); // eslint-disable-line react-hooks/exhaustive-deps
  // lazy enrich visible rows: logos (screener index) + holder concentration (arc-scan), cached server-side
  useEffect(() => {
    const vis = tableRows.slice(0, 60).map((r) => r.token);
    const needLogo = vis.filter((t) => !logos[t] && !byToken.get(t)?.logo);
    if (needLogo.length) void tokenLogos({ data: { tokens: needLogo } }).then((m) => setLogos((o) => ({ ...o, ...m }))).catch(() => null);
    const needRisk = vis.filter((t) => !risk[t]).slice(0, 40);
    if (needRisk.length) void holderRisk({ data: { tokens: needRisk } }).then((m) => setRisk((o) => ({ ...o, ...m }))).catch(() => null);
  }, [tableRows]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/trade" />
      <section className="arc-section" style={{ maxWidth: 1360, paddingTop: 118 }}>
        <div className="arc-2col" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
          {/* LEFT: terminal */}
          <div>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <h1 style={{ fontSize: 26, margin: 0 }}>Terminal</h1>
              <span style={{ color: "var(--arc-muted)", fontSize: 13 }}>every Arc launchpad · one click · best price across venues · <a href="/profile" style={{ color: "var(--arc-cobalt)" }}>profile & history →</a></span>
            </div>
            {/* quick-buy bar */}
            <div style={{ alignItems: "center", background: "var(--arc-paper)", border: "1px solid var(--arc-line)", display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, padding: "8px 12px" }}>
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
              <input className="arc-mono" onChange={(e) => setQ(e.target.value)} placeholder="filter / paste CA" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 160px", fontSize: 12, marginLeft: "auto", padding: "4px 8px" }} value={q} />
            </div>
            {/* tabs */}
            <div style={{ borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 2, marginBottom: 8 }}>
              {([["new", "New pair"], ["new15", "New >15m"], ["trending", "Trending"], ["insiders", "Insider picks"], ["favs", `★ Watchlist${favs.size ? ` (${favs.size})` : ""}`], ["holdings", `Holdings${positions.length ? ` (${positions.length})` : ""}`]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{ background: "transparent", border: "none", borderBottom: "2px solid " + (tab === k ? "var(--arc-up)" : "transparent"), color: tab === k ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 15, fontWeight: tab === k ? 700 : 400, padding: "8px 14px" }} type="button">{l}</button>
              ))}
              <span style={{ marginLeft: "auto" }}>
                {[1, 5, 60, 360, 1440].map((m) => <button key={m} className="arc-mono" onClick={() => setTf(m)} style={{ background: tf === m ? "rgba(255,255,255,0.08)" : "transparent", border: "1px solid " + (tf === m ? "var(--arc-line)" : "transparent"), borderRadius: 4, color: tf === m ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, marginLeft: 2, padding: "4px 9px" }} type="button">{tfLabel(m)}</button>)}
              </span>
            </div>
            {/* paste CA quick action */}
            {/^0x[0-9a-fA-F]{40}$/.test(q.trim()) && !byToken.has(q.trim().toLowerCase()) && (
              <div style={{ alignItems: "center", background: "var(--arc-paper)", border: "1px solid var(--arc-cobalt)", display: "flex", gap: 10, marginBottom: 8, padding: "8px 12px" }}>
                <span className="arc-mono" style={{ fontSize: 12 }}>{short(q.trim())}</span>
                <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>not in the lists — buy it anyway (router finds the pool)</span>
                <BuyBtn symbol={short(q.trim())} token={q.trim().toLowerCase()} />
                <a className="arc-mono" href={`/token/${q.trim().toLowerCase()}`} style={{ color: "var(--arc-cobalt)", fontSize: 12 }}>chart</a>
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              {tab !== "holdings" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ ...hd, width: 26 }} />
                      <th style={hd}>Token / <button className="arc-mono" onClick={() => setSortKey("age")} style={{ background: "none", border: "none", color: sortKey === "age" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">Age ⇅</button></th>
                      <th style={hd}><button className="arc-mono" onClick={() => setSortKey("mcap")} style={{ background: "none", border: "none", color: sortKey === "mcap" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">MC ⇅</button></th>
                      <th style={hd}>ATH MC</th>
                      <th style={hd}>Liq</th>
                      <th style={hd}><button className="arc-mono" onClick={() => setSortKey("vol")} style={{ background: "none", border: "none", color: sortKey === "vol" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">{tfLabel(tf)} Vol ⇅</button></th>
                      <th style={hd}><button className="arc-mono" onClick={() => setSortKey("txs")} style={{ background: "none", border: "none", color: sortKey === "txs" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, padding: 0, textTransform: "uppercase" }} type="button">{tfLabel(tf)} TXs ⇅</button></th>
                      <th style={hd} title="share of supply held by the 10 largest wallets (LP/launchpad excluded) · holders">Top-10 %</th>
                      <th style={hd}>Insiders</th>
                      <th style={hd} />
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.length === 0 && <tr><td className="arc-mono" colSpan={10} style={{ ...cell, color: "var(--arc-muted)" }}>{tab === "favs" ? "No favourites yet — click ☆ on any row." : tab === "new15" ? "No launches between 15 min and 24 h old with liquidity right now." : tab === "insiders" ? "No token with 2+ insiders in the last 24h." : "Loading…"}</td></tr>}
                    {tableRows.map((r) => (
                      <tr key={r.token} style={{ background: favs.has(r.token) ? "rgba(46,124,255,0.05)" : undefined }}>
                        <td style={{ ...cell, paddingRight: 4 }}><button onClick={() => toggleFav(r.token)} style={{ background: "none", border: "none", color: favs.has(r.token) ? "#f5c542" : "var(--arc-muted)", cursor: "pointer", fontSize: 15, padding: 0 }} title="favourite" type="button">{favs.has(r.token) ? "★" : "☆"}</button></td>
                        <td style={{ ...cell, minWidth: 250 }}>
                          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                            <a href={`/token/${r.token}`} style={{ textDecoration: "none" }}><span style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 8, display: "inline-flex", height: 38, justifyContent: "center", overflow: "hidden", width: 38 }}>{r.logo ? <img alt="" height={38} src={r.logo} style={{ objectFit: "cover" }} width={38} /> : <span className="arc-mono" style={{ fontSize: 14 }}>{r.symbol.slice(0, 1)}</span>}</span></a>
                            <div style={{ lineHeight: 1.25 }}>
                              <div><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)", fontWeight: 700, textDecoration: "none" }}>{r.symbol}</a> <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>{r.name.slice(0, 18)}</span>
                                {r.twitter && <a href={r.twitter} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 6 }} target="_blank">𝕏</a>}
                                {r.telegram && <a href={r.telegram} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 4 }} target="_blank">✈︎</a>}
                                {r.website && <a href={r.website} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 4 }} target="_blank">🌐</a>}
                              </div>
                              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
                                <span style={{ color: UP }}>{r.age ? ago(r.age) : "—"}</span> · {short(r.ca)}
                                <button className="arc-mono" onClick={() => void navigator.clipboard.writeText(r.token)} style={{ background: "none", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "0 4px" }} title="copy CA" type="button">⧉</button>
                                {r.pad && <span style={{ border: "1px solid var(--arc-line)", borderRadius: 3, fontSize: 9, marginLeft: 4, padding: "0 4px" }}>{r.pad}</span>}
                                {r.traders > 0 && <span style={{ marginLeft: 6 }} title="traders in window">👥{r.traders}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="arc-mono" style={cell}><div style={{ color: "var(--arc-cobalt)", fontWeight: 700 }}>{usd(r.mcap)}</div>{r.chg != null && <div style={{ color: r.chg >= 0 ? UP : DOWN, fontSize: 11 }}>{r.chg >= 0 ? "+" : ""}{r.chg.toFixed(1)}%</div>}</td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-cobalt)" }}>{usd(r.athMcap)}</td>
                        <td className="arc-mono" style={cell}>{r.liq != null && r.liq > 0 ? usd(r.liq) : "—"}</td>
                        <td className="arc-mono" style={{ ...cell, color: "#f5c542" }}>{r.vol > 0 ? usd(r.vol) : "—"}</td>
                        <td className="arc-mono" style={cell}><div>{r.txs > 0 ? r.txs.toLocaleString() : "—"}</div>{r.txs > 0 && <div style={{ fontSize: 11 }}><span style={{ color: UP }}>{r.buys}</span> / <span style={{ color: DOWN }}>{r.sells}</span></div>}</td>
                        <td className="arc-mono" style={cell}>{(() => { const k = risk[r.token]; if (!k) return <span style={{ color: "var(--arc-muted)" }}>…</span>; const t10 = k.top10; return <><div style={{ color: t10 == null ? "var(--arc-muted)" : t10 >= 50 ? DOWN : t10 >= 30 ? "#f5c542" : UP, fontWeight: 700 }}>{t10 == null ? "—" : `${t10.toFixed(0)}%`}</div><div style={{ color: "var(--arc-muted)", fontSize: 11 }}>{k.holders ? `${k.holders} holders` : ""}{k.top1 != null ? ` · #1 ${k.top1.toFixed(0)}%` : ""}</div></>; })()}</td>
                        <td className="arc-mono" style={{ ...cell, color: r.insiders ? UP : "var(--arc-muted)" }}>{r.insiders || "—"}</td>
                        <td style={{ ...cell, textAlign: "right" }}><BuyBtn symbol={r.symbol} token={r.token} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "holdings" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr><th style={hd}>token</th><th style={hd}>amount</th><th style={hd}>avg entry</th><th style={hd}>price</th><th style={hd}>value</th><th style={hd}>unrealized</th><th style={hd}>realized</th><th style={hd}>sell</th></tr></thead>
                  <tbody>
                    {!addr && <tr><td className="arc-mono" colSpan={8} style={{ ...cell, color: "var(--arc-muted)" }}>Unlock the trading wallet to see holdings.</td></tr>}
                    {addr && positions.length === 0 && <tr><td className="arc-mono" colSpan={8} style={{ ...cell, color: "var(--arc-muted)" }}>No open positions yet (positions come from your on-chain swaps; new buys appear within seconds).</td></tr>}
                    {positions.map((p) => { const t = byToken.get(p.token.toLowerCase()); const sym = p.symbol ?? t?.symbol ?? short(p.token); return (
                      <tr key={p.token}>
                        <td style={cell}><a href={`/token/${p.token}`} style={{ color: "var(--arc-ink)", textDecoration: "none" }}><Logo t={{ logo: t?.logo, symbol: sym }} /><strong>{sym}</strong></a></td>
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
    </main>
  );
}
