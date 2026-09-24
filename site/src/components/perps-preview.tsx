/** ArcPerps — Hyperliquid-style terminal, UI PREVIEW. Chart, trades and 24h stats are LIVE from our index (the pool the perp
 *  would be marked against); order book, positions, funding and balances illustrate the design. No contracts yet. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TvChart, type Candle } from "@/components/tv-chart";

const BOT = "https://bot-production-4200.up.railway.app";
type Mkt = { sym: string; token: string; kind: "stock" | "arc"; lp: number; pad: string };
export const MARKETS: Mkt[] = [
  { sym: "NVDA", token: "0x6505506540dc99f7366316b10e9cf1a584cbd42a", kind: "stock", lp: 0, pad: "long.supply" }, { sym: "TSLA", token: "0x4d1efa7f5629f89fbdd7950b5ef73403a350ad59", kind: "stock", lp: 0, pad: "long.supply" },
  { sym: "CRCL", token: "0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b", kind: "stock", lp: 0, pad: "long.supply" }, { sym: "GME", token: "0x41b386e03928c70d635606c210717c19dcfc984d", kind: "stock", lp: 0, pad: "long.supply" }, { sym: "HIMS", token: "0x3b26421eb41f42119b021eadfbe3ff687ff7ebd8", kind: "stock", lp: 0, pad: "long.supply" },
  { sym: "ARGUS", token: "0xece5ca8bf9220718e5727754026757512212cb3c", kind: "arc", lp: 4_080_000, pad: "Uniswap V4" }, { sym: "TOLLY", token: "0xbc43ce8dec648ea298c4275559b81d6261c90b67", kind: "arc", lp: 432_000, pad: "Uniswap V4" },
  { sym: "ARCOON", token: "0x4621a0baa0b5d97aae77704cf2a84dabe78a4fed", kind: "arc", lp: 222_800, pad: "peach.ag" }, { sym: "WONK", token: "0x548df4bf91624d8cec46d606211eb13f7492e27e", kind: "arc", lp: 170_200, pad: "wonk.fun" }, { sym: "ARCT", token: "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52", kind: "arc", lp: 131_900, pad: "RadarDex" },
];
type Src = "live" | "after" | "weekend";
function stockSource(now: Date): Src {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })); const d = et.getDay(); const h = et.getHours() + et.getMinutes() / 60;
  if (d >= 1 && d <= 5 && h >= 9.5 && h < 16) return "live";
  if ((d >= 1 && d <= 5) || (d === 0 && h >= 20) || (d === 6 && h < 4)) return "after";
  return "weekend";
}
const lev = (m: Mkt, src: Src) => m.kind === "stock" ? (src === "weekend" ? 2 : 3) : m.lp >= 300_000 ? 3 : 2;
const SRC: Record<Src, string> = { live: "Live market", after: "After-hours feed", weekend: "Own market ±7 %" };
type Stats = { price1m: number | null; change: Record<string, number | null>; vol24: number; buys24: number; sells24: number; traders24: number };
type Trade = { tx: string; ts: number; wallet: string; side: "buy" | "sell"; usdc: number; tokens: number; price1m: number };
const px = (p: number) => p >= 1000 ? p.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : p >= 1 ? p.toFixed(p >= 100 ? 2 : 4) : p.toFixed(Math.min(10, Math.max(5, -Math.floor(Math.log10(p || 1e-9)) + 3)));
const usd = (n: number, d = 2) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v: number | null | undefined) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export function PerpsPreview() {
  const [sel, setSel] = useState(5); const m = MARKETS[sel];
  const [tf, setTf] = useState<(typeof TFS)[number]>("5m");
  const [candles, setCandles] = useState<Candle[]>([]); const [stats, setStats] = useState<Stats | null>(null); const [trades, setTrades] = useState<Trade[]>([]); const [live, setLive] = useState(false);
  const [side, setSide] = useState<"long" | "short">("long"); const [otype, setOtype] = useState<"market" | "limit" | "tpsl">("market");
  const [sizeUsd, setSizeUsd] = useState(250); const [lv, setLv] = useState(3); const [pctSlider, setPctSlider] = useState(25); const [tpsl, setTpsl] = useState(false); const [reduce, setReduce] = useState(false);
  const [tab, setTab] = useState<"pos" | "orders" | "hist" | "fund" | "bal">("pos"); const [bookTab, setBookTab] = useState<"book" | "trades">("trades");
  const [now, setNow] = useState(() => new Date()); const [pick, setPick] = useState(false);
  const [logos, setLogos] = useState<Record<string, string>>({});
  useEffect(() => { fetch(`${BOT}/api/token-meta?tokens=${MARKETS.map((x) => x.token).join(",")}`).then((r) => r.json()).then((j: { meta?: Record<string, { logo?: string | null }> }) => { const o: Record<string, string> = {}; for (const [t, mm] of Object.entries(j.meta ?? {})) if (mm?.logo) o[t.toLowerCase()] = mm.logo; setLogos(o); }).catch(() => null); }, []);
  const Logo = ({ t, size = 28 }: { t: Mkt; size?: number }) => logos[t.token] ? <img alt="" src={logos[t.token]} style={{ background: "#0e1118", border: `1px solid var(--arc-line)`, borderRadius: "50%", height: size, objectFit: "cover", width: size }} /> : <span style={{ alignItems: "center", background: "#0e1118", border: `1px solid var(--arc-line)`, borderRadius: "50%", display: "inline-flex", fontSize: size * 0.45, height: size, justifyContent: "center", width: size }}>{t.sym[0]}</span>;
  const src: Src = m.kind === "stock" ? stockSource(now) : "live"; const maxLev = lev(m, src); const L = Math.min(lv, maxLev);
  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const my = ++reqRef.current;
    const [c, s, t] = await Promise.all([
      fetch(`${BOT}/api/ohlc?token=${m.token}&tf=${tf}&limit=600`).then((r) => r.json()).catch(() => null) as Promise<{ candles?: Candle[] } | null>,
      fetch(`${BOT}/api/token-stats?token=${m.token}`).then((r) => r.json()).catch(() => null) as Promise<Stats | null>,
      fetch(`${BOT}/api/trades?token=${m.token}&limit=40`).then((r) => r.json()).catch(() => null) as Promise<{ trades?: Trade[] } | null>,
    ]);
    if (my !== reqRef.current) return;                       // a slower answer for the previous market must not paint over the new one
    if (c?.candles) setCandles(c.candles); if (s) setStats(s); if (t?.trades) setTrades(t.trades);
  }, [m.token, tf]);
  useEffect(() => { setCandles([]); setStats(null); setTrades([]); void load(); const id = setInterval(load, 15_000); const t = setInterval(() => setNow(new Date()), 1000); return () => { clearInterval(id); clearInterval(t); }; }, [load]);
  // live prints from our index: update the last candle + trades tape
  const stepRef = useRef(300);
  useEffect(() => { stepRef.current = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 }[tf]; }, [tf]);
  useEffect(() => {
    let es: EventSource | null = null; let closed = false;
    const onTrade = (t: Trade) => {
      if (!(t.price1m > 0) || !(t.usdc > 0)) return;
      setTrades((prev) => (prev.some((p) => p.tx === t.tx && p.ts === t.ts) ? prev : [t, ...prev].slice(0, 60)));
      setStats((prev) => (prev ? { ...prev, price1m: t.price1m, vol24: prev.vol24 + t.usdc } : prev));
      const p = t.price1m; const b = Math.floor(t.ts / stepRef.current) * stepRef.current;
      setCandles((prev) => { if (!prev.length) return prev; const last = prev[prev.length - 1]; if (last.c > 0 && (p > last.c * 5 || p < last.c / 5)) return prev;
        if (last.t === b) return [...prev.slice(0, -1), { ...last, c: p, h: Math.max(last.h, p), l: Math.min(last.l, p), v: (last.v ?? 0) + t.usdc, vb: (last.vb ?? 0) + (t.side === "buy" ? t.usdc : 0), n: (last.n ?? 0) + 1 }];
        if (b > last.t) return [...prev, { t: b, o: last.c, h: Math.max(last.c, p), l: Math.min(last.c, p), c: p, v: t.usdc, vb: t.side === "buy" ? t.usdc : 0, n: 1 }]; return prev; });
    };
    const open = () => { if (closed) return; es = new EventSource(`${BOT}/api/stream?token=${m.token}`); es.onopen = () => setLive(true); es.addEventListener("trade", (ev) => { try { onTrade(JSON.parse((ev as MessageEvent).data)); } catch { /* */ } }); es.addEventListener("trades", (ev) => { try { for (const t of JSON.parse((ev as MessageEvent).data) as Trade[]) onTrade(t); } catch { /* */ } }); es.onerror = () => { setLive(false); es?.close(); es = null; if (!closed) setTimeout(open, 5000); }; };
    open(); return () => { closed = true; setLive(false); es?.close(); };
  }, [m.token]);
  const mark = (stats?.price1m ?? (candles.length ? candles[candles.length - 1].c : 0)) / 1e6;
  const notional = sizeUsd * L; const fee = notional * 0.001; const liqMove = (1 / L) * 0.85; const liqPx = side === "long" ? mark * (1 - liqMove) : mark * (1 + liqMove);
  const fundingIn = 3600 - (Math.floor(now.getTime() / 1000) % 3600); const cd = `${String(Math.floor(fundingIn / 60)).padStart(2, "0")}:${String(fundingIn % 60).padStart(2, "0")}`;
  const oiCap = m.kind === "stock" ? 50_000 : Math.round(m.lp * 0.1);
  // synthetic resting book around the mark (illustrative: P2P resting limit orders would live here)
  const book = useMemo(() => { if (!mark) return { asks: [] as [number, number][], bids: [] as [number, number][] }; const tick = mark * 0.0008; const asks: [number, number][] = []; const bids: [number, number][] = []; for (let i = 1; i <= 9; i++) { asks.push([mark + tick * i, Math.round(120 + ((i * 37) % 90) * 3)]); bids.push([mark - tick * i, Math.round(110 + ((i * 53) % 90) * 3)]); } return { asks: asks.reverse(), bids }; }, [mark]);
  const C = { panel: "var(--arc-panel, rgba(255,255,255,0.03))", line: "var(--arc-line)", muted: "var(--arc-muted)", up: "#22c580", down: "#f0534f" };
  const cell: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6 };
  const tabBtn = (on: boolean): React.CSSProperties => ({ background: "transparent", border: 0, borderBottom: on ? "2px solid var(--arc-ink)" : "2px solid transparent", color: on ? "var(--arc-ink)" : C.muted, cursor: "pointer", fontSize: 12, padding: "8px 10px" });
  const seg = (on: boolean, col = "var(--arc-ink)"): React.CSSProperties => ({ background: on ? "rgba(255,255,255,0.06)" : "transparent", border: `1px solid ${on ? col : C.line}`, borderRadius: 4, color: on ? col : C.muted, cursor: "pointer", flex: 1, fontSize: 13, fontWeight: 700, padding: "8px 0" });
  return (
    <div className="arc-mono" style={{ display: "grid", gap: 8, fontSize: 12 }}>
      <div style={{ ...cell, alignItems: "center", background: "rgba(255,176,32,0.10)", borderColor: "#ffb020", display: "flex", gap: 10, padding: "8px 12px" }}>
        <b>PREVIEW</b><span style={{ color: "var(--arc-ink)" }}>Chart, trades and 24h stats are live from the pool this perp would be marked against. Order book, positions, funding and balances illustrate the design. No contracts deployed — nothing here trades.</span>
      </div>
      {/* top bar */}
      <div style={{ ...cell, alignItems: "center", display: "flex", flexWrap: "wrap", gap: 22, padding: "10px 14px", position: "relative" }}>
        <button onClick={() => setPick((v) => !v)} style={{ alignItems: "center", background: "transparent", border: 0, color: "var(--arc-ink)", cursor: "pointer", display: "flex", gap: 10, padding: 0 }} type="button">
          <Logo t={m} />
          <b style={{ fontSize: 18 }}>{m.sym}-USDC</b><span style={{ color: C.muted }}>▾</span>
          <span style={{ background: "rgba(46,124,255,0.16)", border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "2px 6px" }}>{maxLev}x</span>
        </button>
        {pick && (
          <div style={{ ...cell, background: "#0b0e13", left: 0, padding: 8, position: "absolute", top: 46, width: 560, zIndex: 20 }}>
            <div style={{ color: C.muted, display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", padding: "4px 8px" }}><span>Market</span><span>Last</span><span>24h</span><span>Volume</span><span>Source</span></div>
            {MARKETS.map((x, i) => { const s: Src = x.kind === "stock" ? stockSource(now) : "live"; return (
              <button key={x.sym} onClick={() => { setSel(i); setPick(false); setLv(Math.min(lv, lev(x, s))); }} style={{ background: i === sel ? "rgba(255,255,255,0.05)" : "transparent", border: 0, borderRadius: 4, color: "var(--arc-ink)", cursor: "pointer", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", padding: "6px 8px", textAlign: "left", width: "100%" }} type="button">
                <span style={{ alignItems: "center", display: "flex", gap: 8 }}><Logo size={20} t={x} /><b>{x.sym}-USDC</b> <span style={{ color: C.muted }}>{lev(x, s)}x</span></span><span>{i === sel && mark ? px(mark) : "…"}</span><span style={{ color: i === sel && stats?.change?.["24h"] != null ? ((stats.change["24h"] ?? 0) >= 0 ? C.up : C.down) : C.muted }}>{i === sel ? pct(stats?.change?.["24h"]) : "—"}</span><span>{i === sel && stats ? usd(stats.vol24, 0) : "—"}</span><span style={{ color: x.kind === "stock" && s === "weekend" ? "#ffb020" : C.muted }}>{x.kind === "stock" ? SRC[s] : "Pool TWAP"}</span>
              </button>); })}
            <div style={{ color: C.muted, fontSize: 11, padding: "6px 8px" }}>Stocks: tokenized on long.supply · Arc tokens: LP ≥ 100k, leverage by liquidity · list refreshes from the index</div>
          </div>
        )}
        {[["Mark", mark ? px(mark) : "…", undefined], ["Oracle", m.kind === "stock" ? SRC[src] : "Pool TWAP 5m", m.kind === "stock" && src === "weekend" ? "#ffb020" : undefined], ["24h Change", stats ? `${pct(stats.change?.["24h"])}` : "…", stats?.change?.["24h"] != null ? ((stats.change["24h"] ?? 0) >= 0 ? C.up : C.down) : undefined], ["24h Volume", stats ? usd(stats.vol24, 0) : "…", undefined], ["Open Interest", "$0", undefined], ["Funding / Countdown", `0.0100% · ${cd}`, C.up]].map(([k, v, col]) => (
          <div key={k as string}><div style={{ color: C.muted, fontSize: 11 }}>{k}</div><div style={{ color: (col as string) ?? "var(--arc-ink)", fontSize: 13, fontWeight: 600 }}>{v}</div></div>
        ))}
        <span style={{ color: live ? C.up : C.muted, fontSize: 11, marginLeft: "auto" }}>{live ? "● LIVE" : "○ connecting"} · {m.pad}</span>
      </div>
      {/* main grid */}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) 300px 320px" }}>
        <div style={{ ...cell, overflow: "hidden" }}>
          <div style={{ alignItems: "center", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 4, padding: "6px 10px" }}>
            {TFS.map((x) => <button key={x} onClick={() => setTf(x)} style={{ background: tf === x ? "rgba(255,255,255,0.08)" : "transparent", border: 0, borderRadius: 4, color: tf === x ? "var(--arc-ink)" : C.muted, cursor: "pointer", fontSize: 12, padding: "4px 8px" }} type="button">{x}</button>)}
            <span style={{ color: C.muted, marginLeft: "auto" }}>mark = oracle price · pool prints drawn live</span>
          </div>
          {candles.length ? <TvChart candles={candles} height={520} interval={tf} mode="price" scale={1e-6} storageKey={`perps:${m.token}`} symbol={`${m.sym}-USDC PERP`} /> : <div style={{ alignItems: "center", color: C.muted, display: "flex", height: 520, justifyContent: "center" }}>loading candles…</div>}
        </div>
        <div style={{ ...cell, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ borderBottom: `1px solid ${C.line}`, display: "flex" }}><button onClick={() => setBookTab("book")} style={tabBtn(bookTab === "book")} type="button">Order Book</button><button onClick={() => setBookTab("trades")} style={tabBtn(bookTab === "trades")} type="button">Trades</button></div>
          {bookTab === "book" ? (
            <div style={{ fontSize: 11, padding: 8 }}>
              <div style={{ color: C.muted, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2px 4px" }}><span>Price</span><span style={{ textAlign: "right" }}>Size (USDC)</span><span style={{ textAlign: "right" }}>Total</span></div>
              {book.asks.map(([p, s], i) => { const tot = book.asks.slice(i).reduce((a, x) => a + x[1], 0); return <div key={"a" + i} style={{ background: `linear-gradient(270deg, rgba(240,83,79,0.18) ${Math.min(100, tot / 25)}%, transparent 0)`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2px 4px" }}><span style={{ color: C.down }}>{px(p)}</span><span style={{ textAlign: "right" }}>{s}</span><span style={{ textAlign: "right" }}>{tot}</span></div>; })}
              <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", padding: "6px 4px" }}><b style={{ color: C.up, fontSize: 14 }}>{mark ? px(mark) : "…"}</b><span style={{ color: C.muted }}>spread 0.16 %</span></div>
              {book.bids.map(([p, s], i) => { const tot = book.bids.slice(0, i + 1).reduce((a, x) => a + x[1], 0); return <div key={"b" + i} style={{ background: `linear-gradient(270deg, rgba(34,197,128,0.18) ${Math.min(100, tot / 25)}%, transparent 0)`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2px 4px" }}><span style={{ color: C.up }}>{px(p)}</span><span style={{ textAlign: "right" }}>{s}</span><span style={{ textAlign: "right" }}>{tot}</span></div>; })}
              <div style={{ color: C.muted, marginTop: 8 }}>Illustrative. In ArcPerps the book is resting P2P limit orders; market orders fill against them or the insurance fund.</div>
            </div>
          ) : (
            <div style={{ fontSize: 11, padding: 8 }}>
              <div style={{ color: C.muted, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2px 4px" }}><span>Price</span><span style={{ textAlign: "right" }}>Size (USDC)</span><span style={{ textAlign: "right" }}>Time</span></div>
              {trades.slice(0, 28).map((t) => <div key={t.tx + t.ts} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2px 4px" }}><span style={{ color: t.side === "buy" ? C.up : C.down }}>{px(t.price1m / 1e6)}</span><span style={{ textAlign: "right" }}>{t.usdc.toFixed(2)}</span><span style={{ color: C.muted, textAlign: "right" }}>{new Date(t.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>)}
              <div style={{ color: C.muted, marginTop: 8 }}>Real prints from the {m.pad} pool — the market the perp is marked against.</div>
            </div>
          )}
        </div>
        <div style={{ ...cell, padding: 12 }}>
          <div style={{ borderBottom: `1px solid ${C.line}`, display: "flex", marginBottom: 10 }}>{(["market", "limit", "tpsl"] as const).map((k) => <button key={k} onClick={() => setOtype(k)} style={tabBtn(otype === k)} type="button">{k === "tpsl" ? "TP / SL" : k[0].toUpperCase() + k.slice(1)}</button>)}</div>
          <div style={{ display: "flex", gap: 6 }}><button onClick={() => setSide("long")} style={seg(side === "long", C.up)} type="button">Buy / Long</button><button onClick={() => setSide("short")} style={seg(side === "short", C.down)} type="button">Sell / Short</button></div>
          <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", marginTop: 12 }}><span>Available to Trade</span><span style={{ color: "var(--arc-ink)" }}>0.00 USDC</span></div>
          <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", marginTop: 4 }}><span>Current Position</span><span style={{ color: "var(--arc-ink)" }}>0 {m.sym}</span></div>
          {otype === "limit" && <div style={{ ...cell, alignItems: "center", display: "flex", justifyContent: "space-between", marginTop: 10, padding: "8px 10px" }}><span style={{ color: C.muted }}>Price (USDC)</span><span>{mark ? px(mark) : "…"} <span style={{ color: "var(--arc-cobalt)" }}>Mid</span></span></div>}
          <div style={{ ...cell, alignItems: "center", display: "flex", justifyContent: "space-between", marginTop: 10, padding: "8px 10px" }}><span style={{ color: C.muted }}>Size</span><span><input onChange={(e) => setSizeUsd(Math.max(0, Number(e.target.value) || 0))} style={{ background: "transparent", border: 0, color: "var(--arc-ink)", fontSize: 14, textAlign: "right", width: 110 }} value={sizeUsd} /> <span style={{ color: C.muted }}>USDC ▾</span></span></div>
          <input max={100} min={0} onChange={(e) => setPctSlider(Number(e.target.value))} style={{ accentColor: "#22c580", marginTop: 10, width: "100%" }} type="range" value={pctSlider} />
          <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", fontSize: 11 }}><span>0 %</span><span>{pctSlider} %</span><span>100 %</span></div>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginTop: 12 }}><span style={{ color: C.muted }}>Leverage</span><span style={{ ...cell, padding: "2px 8px" }}>{L}x</span></div>
          <input max={maxLev} min={1} onChange={(e) => setLv(Number(e.target.value))} style={{ accentColor: "#2e7cff", marginTop: 6, width: "100%" }} type="range" value={L} />
          <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", fontSize: 11 }}><span>1x</span><span>max {maxLev}x{m.kind === "stock" && src === "weekend" ? " · weekend cap" : ""}</span></div>
          <label style={{ alignItems: "center", display: "flex", gap: 8, marginTop: 12 }}><input checked={reduce} onChange={(e) => setReduce(e.target.checked)} type="checkbox" /> Reduce Only</label>
          <label style={{ alignItems: "center", display: "flex", gap: 8, marginTop: 6 }}><input checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} type="checkbox" /> Take Profit / Stop Loss</label>
          {tpsl && <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}><div style={{ ...cell, color: C.muted, padding: "6px 8px" }}>TP price</div><div style={{ ...cell, color: C.muted, padding: "6px 8px" }}>SL price</div></div>}
          <button className="arc-cta" disabled style={{ background: side === "long" ? C.up : C.down, marginTop: 14, opacity: 0.6, width: "100%" }} type="button">{side === "long" ? "Buy / Long" : "Sell / Short"} — preview</button>
          <div style={{ borderTop: `1px solid ${C.line}`, display: "grid", gap: 6, marginTop: 12, paddingTop: 10 }}>
            {[["Liquidation Price", mark ? `${px(liqPx)} (${side === "long" ? "−" : "+"}${(liqMove * 100).toFixed(0)}%)` : "…"], ["Order Value", usd(notional, 0)], ["Margin Required", usd(sizeUsd, 0)], ["Slippage", otype === "market" ? "Est: 0 % / Max: 1 %" : "—"], ["Fees", `0.10 % (${usd(fee)})`], ["Counterparty", "P2P · insurance fund 0"], ["OI cap / side", usd(oiCap, 0)]].map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.muted }}>{k}</span><span>{v}</span></div>)}
          </div>
        </div>
      </div>
      {/* bottom tabs */}
      <div style={cell}>
        <div style={{ borderBottom: `1px solid ${C.line}`, display: "flex" }}>{([["bal", "Balances"], ["pos", "Positions (2)"], ["orders", "Open Orders (1)"], ["hist", "Trade History"], ["fund", "Funding History"]] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={tabBtn(tab === k)} type="button">{l}</button>)}<span style={{ color: C.muted, marginLeft: "auto", padding: "8px 10px" }}>illustrative rows</span></div>
        <div style={{ overflowX: "auto", padding: 8 }}>
          {tab === "pos" && <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr style={{ color: C.muted, textAlign: "left" }}>{["Coin", "Size", "Position Value", "Entry Price", "Mark Price", "PNL (ROE %)", "Liq. Price", "Margin", "Funding", "TP/SL", ""].map((h) => <th key={h} style={{ fontWeight: 400, padding: "4px 8px" }}>{h}</th>)}</tr></thead><tbody>
            <tr style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: "6px 8px" }}><span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}><Logo size={18} t={MARKETS[0]} /><b>NVDA</b> <span style={{ color: C.up }}>3x</span></span></td><td style={{ color: C.up, padding: "6px 8px" }}>4.01 NVDA</td><td style={{ padding: "6px 8px" }}>$900.00</td><td style={{ padding: "6px 8px" }}>221.10</td><td style={{ padding: "6px 8px" }}>{MARKETS[0] && sel === 0 && mark ? px(mark) : "223.93"}</td><td style={{ color: C.up, padding: "6px 8px" }}>+$11.46 (+3.8 %)</td><td style={{ padding: "6px 8px" }}>158.45</td><td style={{ padding: "6px 8px" }}>$300.00 (isolated)</td><td style={{ padding: "6px 8px" }}>−$0.04</td><td style={{ padding: "6px 8px" }}>240.00 / 205.00</td><td style={{ padding: "6px 14px 6px 8px" }}><button style={{ ...seg(false), padding: "3px 10px" }} type="button">Close</button></td></tr>
            <tr style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: "6px 8px" }}><span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}><Logo size={18} t={MARKETS[5]} /><b>ARGUS</b> <span style={{ color: C.down }}>2x</span></span></td><td style={{ color: C.down, padding: "6px 8px" }}>−21,660 ARGUS</td><td style={{ padding: "6px 8px" }}>$400.00</td><td style={{ padding: "6px 8px" }}>0.01930</td><td style={{ padding: "6px 8px" }}>{sel === 5 && mark ? px(mark) : "0.01850"}</td><td style={{ color: C.down, padding: "6px 8px" }}>−$2.70 (−1.3 %)</td><td style={{ padding: "6px 8px" }}>0.02750</td><td style={{ padding: "6px 8px" }}>$200.00 (isolated)</td><td style={{ padding: "6px 8px" }}>+$0.11</td><td style={{ padding: "6px 8px" }}>— / —</td><td style={{ padding: "6px 8px" }}><button style={{ ...seg(false), padding: "3px 10px" }} type="button">Close</button></td></tr>
          </tbody></table>}
          {tab === "orders" && <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr style={{ color: C.muted, textAlign: "left" }}>{["Time", "Type", "Coin", "Direction", "Size", "Original Size", "Order Value", "Price", "Reduce Only", "Trigger", ""].map((h) => <th key={h} style={{ fontWeight: 400, padding: "4px 8px" }}>{h}</th>)}</tr></thead><tbody><tr style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: "6px 8px" }}>{now.toLocaleTimeString()}</td><td style={{ padding: "6px 8px" }}>Limit</td><td style={{ padding: "6px 8px" }}>TOLLY</td><td style={{ color: C.up, padding: "6px 8px" }}>Long</td><td style={{ padding: "6px 8px" }}>15,000 TOLLY</td><td style={{ padding: "6px 8px" }}>15,000</td><td style={{ padding: "6px 8px" }}>$90.00</td><td style={{ padding: "6px 8px" }}>0.006000</td><td style={{ padding: "6px 8px" }}>No</td><td style={{ padding: "6px 8px" }}>—</td><td style={{ padding: "6px 8px" }}><button style={{ ...seg(false), padding: "3px 10px" }} type="button">Cancel</button></td></tr></tbody></table>}
          {tab === "bal" && <div style={{ color: C.muted, padding: 8 }}>Perps balance 0.00 USDC · Deposit from your trading wallet or connected wallet on Arc (native USDC). Withdrawals are instant; no lock.</div>}
          {tab === "hist" && <div style={{ color: C.muted, padding: 8 }}>No trades yet.</div>}
          {tab === "fund" && <div style={{ color: C.muted, padding: 8 }}>Funding is paid hourly between longs and shorts: the heavier side pays. Rate = clamp((our mark − oracle) / oracle, ±0.05 %) per hour. Stocks: paid only when a feed is live; weekends accrue against the last close.</div>}
        </div>
      </div>
    </div>
  );
}
