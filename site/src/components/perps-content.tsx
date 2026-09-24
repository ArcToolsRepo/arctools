/** ArcPerps — Hyperliquid-style terminal on the live ArcPerps contract (0xCB39…4291).
 *  Chart, tape and 24h stats stream from our index (the pool the perp is marked against); mark = operator-signed price
 *  the trader attaches to their own transaction; positions from the bot's event index + on-chain equity. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TvChart, type Candle } from "@/components/tv-chart";
import { WalletPanel } from "@/components/wallet-panel";
import { hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { ARC_PERPS, encodeClose, encodeLpWithdraw, encodeOpen, equityOf, fetchPerpsState, fetchPositions, fetchSignedPrice, liqPriceLocal, liveEquity, lpInfo, openValue, SEL, type PerpMarket, type PerpPosition, type PerpsState, type SignedPrice } from "@/lib/arc-perps";
import { connectWallet, getStoredWallet, nativeBalance, onWalletChange, sendTx, waitReceipt } from "@/lib/arc-wallet";
import { BOT_API, BOT_ORIGIN } from "@/lib/bot-api";

type Stats = { price1m: number | null; change: Record<string, number | null>; vol24: number; buys24: number; sells24: number; traders24: number };
type Trade = { tx: string; ts: number; wallet: string; side: "buy" | "sell"; usdc: number; tokens: number; price1m: number };
const px = (p: number) => p >= 1000 ? p.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : p >= 1 ? p.toFixed(p >= 100 ? 2 : 4) : p.toFixed(Math.min(10, Math.max(5, -Math.floor(Math.log10(p || 1e-9)) + 3)));
const usd = (n: number, d = 2) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v: number | null | undefined) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const SRC_LABEL = (m: PerpMarket, p?: SignedPrice | null) => m.kind === 1 ? (p ? (p.feedLive ? "Live equity feed" : "Own market · ±7 %") : "…") : "Pool TWAP 5m";

export function PerpsContent() {
  const [st, setSt] = useState<PerpsState | null>(null); const markets = st?.markets ?? [];
  const [sel, setSel] = useState(5); const m = markets[sel] ?? markets[0];
  const [tf, setTf] = useState<(typeof TFS)[number]>("5m"); const [candles, setCandles] = useState<Candle[]>([]); const [stats, setStats] = useState<Stats | null>(null); const [trades, setTrades] = useState<Trade[]>([]); const [live, setLive] = useState(false);
  const [sp, setSp] = useState<SignedPrice | null>(null); const [logos, setLogos] = useState<Record<string, string>>({});
  const [side, setSide] = useState<"long" | "short">("long"); const [margin, setMargin] = useState(10); const [lv, setLv] = useState(2);
  const [addr, setAddr] = useState<string | null>(null); const [useHot, setUseHot] = useState(false); const [bal, setBal] = useState<number | null>(null);
  const [positions, setPositions] = useState<PerpPosition[]>([]); const [eq, setEq] = useState<Record<number, { equity: bigint; pnl: bigint; funding: bigint }>>({});
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [tab, setTab] = useState<"pos" | "hist" | "fund" | "info">("pos"); const [sideTab, setSideTab] = useState<"oi" | "trades">("trades");
  const [pick, setPick] = useState(false); const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [lp, setLp] = useState<{ shares: bigint; totalShares: bigint; fund: bigint; unlockAt: number } | null>(null); const [lpAmt, setLpAmt] = useState(50);
  const say = (ok: boolean, t: string) => { setMsg({ ok, t }); setTimeout(() => setMsg(null), 9000); };

  // wallet (same convention as Predict: unlocked trading wallet first, else connected browser wallet)
  useEffect(() => {
    const sync = () => { const h = isUnlocked() && hotAddress(); setUseHot(!!h); setAddr(h || getStoredWallet()); };
    sync(); const a = onHotChange(sync); const b = onWalletChange(sync); return () => { a(); b(); };
  }, []);
  useEffect(() => { if (!addr) { setBal(null); return; } const f = () => nativeBalance(addr).then(setBal).catch(() => null); f(); const t = setInterval(f, 15_000); return () => clearInterval(t); }, [addr]);
  // state + logos
  useEffect(() => { const f = () => fetchPerpsState().then(setSt).catch(() => null); f(); const t = setInterval(f, 15_000); const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => { clearInterval(t); clearInterval(c); }; }, []);
  useEffect(() => { if (!markets.length || Object.keys(logos).length) return; fetch(`${BOT_API}/api/token-meta?tokens=${markets.map((x) => x.token).join(",")}`).then((r) => r.json()).then((j: { meta?: Record<string, { logo?: string | null }> }) => { const o: Record<string, string> = {}; for (const [t, mm] of Object.entries(j.meta ?? {})) if (mm?.logo) o[t.toLowerCase()] = mm.logo; setLogos(o); }).catch(() => null); }, [markets.length]);
  // signed price for the selected market
  useEffect(() => { if (!m) return; let alive = true; const f = () => fetchSignedPrice(m.id).then((p) => alive && p?.sig && setSp(p)).catch(() => null); setSp(null); f(); const t = setInterval(f, 8000); return () => { alive = false; clearInterval(t); }; }, [m?.id]);
  // chart data
  const reqRef = useRef(0);
  const load = useCallback(async () => {
    if (!m) return; const my = ++reqRef.current;
    const [c, s, t] = await Promise.all([
      fetch(`${BOT_API}/api/ohlc?token=${m.token}&tf=${tf}&limit=600`).then((r) => r.json()).catch(() => null) as Promise<{ candles?: Candle[] } | null>,
      fetch(`${BOT_API}/api/token-stats?token=${m.token}`).then((r) => r.json()).catch(() => null) as Promise<Stats | null>,
      fetch(`${BOT_API}/api/trades?token=${m.token}&limit=40`).then((r) => r.json()).catch(() => null) as Promise<{ trades?: Trade[] } | null>]);
    if (my !== reqRef.current) return;
    if (c?.candles) setCandles(c.candles); if (s) setStats(s); if (t?.trades) setTrades(t.trades);
  }, [m?.token, tf]);
  useEffect(() => { setCandles([]); setStats(null); setTrades([]); void load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);
  const stepRef = useRef(300); useEffect(() => { stepRef.current = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 }[tf]; }, [tf]);
  useEffect(() => {
    if (!m) return; let es: EventSource | null = null; let closed = false;
    const onTrade = (t: Trade) => {
      if (!(t.price1m > 0) || !(t.usdc > 0)) return;
      setTrades((prev) => (prev.some((p) => p.tx === t.tx && p.ts === t.ts) ? prev : [t, ...prev].slice(0, 60))); setStats((prev) => (prev ? { ...prev, price1m: t.price1m, vol24: prev.vol24 + t.usdc } : prev));
      const p = t.price1m; const b = Math.floor(t.ts / stepRef.current) * stepRef.current;
      setCandles((prev) => { if (!prev.length) return prev; const last = prev[prev.length - 1]; if (last.c > 0 && (p > last.c * 5 || p < last.c / 5)) return prev;
        if (last.t === b) return [...prev.slice(0, -1), { ...last, c: p, h: Math.max(last.h, p), l: Math.min(last.l, p), v: (last.v ?? 0) + t.usdc, vb: (last.vb ?? 0) + (t.side === "buy" ? t.usdc : 0), n: (last.n ?? 0) + 1 }];
        if (b > last.t) return [...prev, { t: b, o: last.c, h: Math.max(last.c, p), l: Math.min(last.c, p), c: p, v: t.usdc, vb: t.side === "buy" ? t.usdc : 0, n: 1 }]; return prev; });
    };
    const open = () => { if (closed) return; es = new EventSource(`${BOT_ORIGIN}/api/stream?token=${m.token}`); es.onopen = () => setLive(true); es.addEventListener("trade", (ev) => { try { onTrade(JSON.parse((ev as MessageEvent).data)); } catch { /* */ } }); es.addEventListener("trades", (ev) => { try { for (const t of JSON.parse((ev as MessageEvent).data) as Trade[]) onTrade(t); } catch { /* */ } }); es.onerror = () => { setLive(false); es?.close(); es = null; if (!closed) setTimeout(open, 5000); }; };
    open(); return () => { closed = true; setLive(false); es?.close(); };
  }, [m?.token]);
  // positions + on-chain equity
  const loadPositions = useCallback(async () => {
    if (!addr) { setPositions([]); return; }
    const ps = await fetchPositions(addr).catch(() => [] as PerpPosition[]); setPositions(ps);
    const open = ps.filter((p) => !p.closed_ts).slice(0, 20); const out: Record<number, { equity: bigint; pnl: bigint; funding: bigint }> = {};
    await Promise.all(open.map(async (p) => { try { const e = await equityOf(p.id); out[p.id] = e; } catch { /* */ } })); setEq(out);
    if (addr) lpInfo(addr).then(setLp).catch(() => null);
  }, [addr]);
  useEffect(() => { void loadPositions(); const t = setInterval(loadPositions, 12_000); return () => clearInterval(t); }, [loadPositions]);

  const mark = sp?.priceUsd ?? (m?.mark ?? 0); const maxLev = m ? (sp ? (sp.feedLive ? m.levLive : m.levOff) : m.levLive) : 1; const L = Math.min(lv, maxLev);
  const notional = margin * L; const fee = notional * 0.001; const liq = mark ? liqPriceLocal(mark, margin, notional, side === "long") : 0;
  const ms = m ? (st?.markets.find((x) => x.id === m.id) ?? m) : null; const longOI = ms?.longOI ?? 0, shortOI = ms?.shortOI ?? 0; const fund = st?.fund ?? 0;
  const capSide = m ? Math.max(0, Math.min((m.oiCap - (side === "long" ? longOI : shortOI)), (side === "long" ? Math.max(0, shortOI - longOI) : Math.max(0, longOI - shortOI)) + fund * 0.5)) : 0;
  const fundingIn = ms?.lastFunding ? Math.max(0, 3600 - (now - ms.lastFunding) % 3600) : 3600 - (now % 3600); const cd = `${String(Math.floor(fundingIn / 60)).padStart(2, "0")}:${String(fundingIn % 60).padStart(2, "0")}`;
  const skew = longOI + shortOI > 0 ? (longOI - shortOI) / Math.max(longOI, shortOI) : 0; const fundingRate = skew * 0.05;   // % per hour, heavier side pays

  const send = async (data: string, value: bigint) => {
    if (!addr) throw new Error("Connect a wallet or unlock the trading wallet");
    const h = useHot ? await hotSend({ to: ARC_PERPS, data, value }) : await sendTx({ to: ARC_PERPS, data, value, from: addr });
    const rc = useHot ? await hotWait(h) : await waitReceipt(h); if (rc.status !== 1) throw new Error("transaction reverted"); return h;
  };
  const doOpen = async () => {
    if (!m || !sp) return; if (!(margin >= 1)) { say(false, "Minimum margin 1 USDC"); return; }
    if (notional > capSide + 1e-9) { say(false, `Not enough counterparty capacity for ${usd(notional, 0)} — max ${usd(capSide, 0)} on this side right now`); return; }
    setBusy("Opening…");
    try { const fresh = await fetchSignedPrice(m.id); const mw = BigInt(Math.round(margin * 1e6)) * 10n ** 12n; await send(encodeOpen(m.id, side === "long", L, fresh), openValue(mw, L)); say(true, `${side === "long" ? "Long" : "Short"} ${m.name.split("-")[0]} ${L}x opened`); setTimeout(loadPositions, 2500); }
    catch (e) { say(false, String((e as Error).message ?? e).slice(0, 120)); }
    setBusy(null);
  };
  const doClose = async (p: PerpPosition) => {
    setBusy(`Closing #${p.id}…`);
    try { const fresh = await fetchSignedPrice(p.market); await send(encodeClose(p.id, fresh), 0n); say(true, `Position #${p.id} closed`); setTimeout(loadPositions, 2500); } catch (e) { say(false, String((e as Error).message ?? e).slice(0, 120)); }
    setBusy(null);
  };
  const doLp = async (dep: boolean) => {
    setBusy(dep ? "Depositing…" : "Withdrawing…");
    try {
      if (dep) await send(SEL.lpDeposit, BigInt(Math.round(lpAmt * 1e6)) * 10n ** 12n);
      else { if (!lp) throw new Error("no LP data"); const sh = lp.fund > 0n ? (BigInt(Math.round(lpAmt * 1e6)) * 10n ** 12n * lp.totalShares) / lp.fund : 0n; await send(encodeLpWithdraw(sh > lp.shares ? lp.shares : sh), 0n); }
      say(true, dep ? `Deposited ${lpAmt} USDC into the fund` : "Withdrawn"); setTimeout(loadPositions, 2500);
    } catch (e) { say(false, String((e as Error).message ?? e).slice(0, 120)); }
    setBusy(null);
  };

  const C = { panel: "var(--arc-panel, rgba(255,255,255,0.03))", line: "var(--arc-line)", muted: "var(--arc-muted)", up: "#22c580", down: "#f0534f" };
  const cell: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6 };
  const tabBtn = (on: boolean): React.CSSProperties => ({ background: "transparent", border: 0, borderBottom: on ? "2px solid var(--arc-ink)" : "2px solid transparent", color: on ? "var(--arc-ink)" : C.muted, cursor: "pointer", fontSize: 12, padding: "8px 10px" });
  const seg = (on: boolean, col = "var(--arc-ink)"): React.CSSProperties => ({ background: on ? "rgba(255,255,255,0.06)" : "transparent", border: `1px solid ${on ? col : C.line}`, borderRadius: 4, color: on ? col : C.muted, cursor: "pointer", flex: 1, fontSize: 13, fontWeight: 700, padding: "8px 0" });
  const Logo = ({ t, size = 28 }: { t: PerpMarket; size?: number }) => logos[t.token] ? <img alt="" src={logos[t.token]} style={{ background: "#0e1118", border: `1px solid ${C.line}`, borderRadius: "50%", height: size, objectFit: "cover", width: size }} /> : <span style={{ alignItems: "center", background: "#0e1118", border: `1px solid ${C.line}`, borderRadius: "50%", display: "inline-flex", fontSize: size * 0.45, height: size, justifyContent: "center", width: size }}>{t.name[0]}</span>;
  const openPos = positions.filter((p) => !p.closed_ts); const hist = positions.filter((p) => p.closed_ts);
  if (!m) return <div className="arc-mono" style={{ color: C.muted, padding: 40, textAlign: "center" }}>Loading ArcPerps…</div>;
  return (
    <div className="arc-mono" style={{ display: "grid", gap: 8, fontSize: 12 }}>
      {st?.paused && <div style={{ ...cell, background: "rgba(240,83,79,0.12)", borderColor: C.down, padding: "8px 12px" }}><b>Paused.</b> New positions are disabled (fund protection). Closing works.</div>}
      {msg && <div style={{ ...cell, background: msg.ok ? "rgba(34,197,128,0.12)" : "rgba(240,83,79,0.12)", borderColor: msg.ok ? C.up : C.down, padding: "8px 12px" }}>{msg.t}</div>}
      {!addr && <div style={{ ...cell, padding: 12 }}><div style={{ color: C.muted, marginBottom: 6 }}>Trade with the in-browser trading wallet (no popups) or connect MetaMask / Rabby on the right.</div><div style={{ maxWidth: 560 }}><WalletPanel onReady={(a) => setAddr(a)} /></div></div>}
      {/* top bar */}
      <div style={{ ...cell, alignItems: "center", display: "flex", flexWrap: "wrap", gap: 22, padding: "10px 14px", position: "relative" }}>
        <button onClick={() => setPick((v) => !v)} style={{ alignItems: "center", background: "transparent", border: 0, color: "var(--arc-ink)", cursor: "pointer", display: "flex", gap: 10, padding: 0 }} type="button">
          <Logo t={m} /><b style={{ fontSize: 18 }}>{m.name}</b><span style={{ color: C.muted }}>▾</span>
          <span style={{ background: "rgba(46,124,255,0.16)", border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "2px 6px" }}>{maxLev}x</span>
        </button>
        {pick && (
          <div style={{ ...cell, background: "#0b0e13", left: 0, padding: 8, position: "absolute", top: 46, width: 620, zIndex: 20 }}>
            <div style={{ color: C.muted, display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr", padding: "4px 8px" }}><span>Market</span><span>Mark</span><span>Long OI</span><span>Short OI</span><span>Source</span></div>
            {markets.map((x, i) => <button key={x.id} onClick={() => { setSel(i); setPick(false); setLv(Math.min(lv, x.levLive)); }} style={{ background: i === sel ? "rgba(255,255,255,0.05)" : "transparent", border: 0, borderRadius: 4, color: "var(--arc-ink)", cursor: "pointer", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr", padding: "6px 8px", textAlign: "left", width: "100%" }} type="button">
              <span style={{ alignItems: "center", display: "flex", gap: 8 }}><Logo size={20} t={x} /><b>{x.name}</b> <span style={{ color: C.muted }}>{x.feedLive === false ? x.levOff : x.levLive}x</span></span><span>{x.mark ? px(x.mark) : "…"}</span><span style={{ color: C.up }}>{usd(x.longOI ?? 0, 0)}</span><span style={{ color: C.down }}>{usd(x.shortOI ?? 0, 0)}</span><span style={{ color: x.kind === 1 && x.feedLive === false ? "#ffb020" : C.muted }}>{x.kind === 1 ? (x.feedLive === false ? "Own market ±7 %" : "Equity feed") : "Pool TWAP"}</span>
            </button>)}
            <div style={{ color: C.muted, fontSize: 11, padding: "6px 8px" }}>Tokenized stocks (long.supply) and Arc tokens with LP ≥ 100k · leverage by liquidity and feed status · contract {ARC_PERPS.slice(0, 8)}…</div>
          </div>
        )}
        {[["Mark", mark ? px(mark) : "…", undefined], ["Oracle", SRC_LABEL(m, sp), m.kind === 1 && sp && !sp.feedLive ? "#ffb020" : undefined], ["24h Change", stats ? pct(stats.change?.["24h"]) : "…", stats?.change?.["24h"] != null ? ((stats.change["24h"] ?? 0) >= 0 ? C.up : C.down) : undefined], ["24h Volume", stats ? usd(stats.vol24, 0) : "…", undefined], ["Open Interest", `${usd(longOI, 0)} / ${usd(shortOI, 0)}`, undefined], ["Funding / Countdown", `${fundingRate >= 0 ? "" : "−"}${Math.abs(fundingRate).toFixed(4)}% · ${cd}`, skew > 0 ? C.down : C.up], ["Fund", st?.fund != null ? usd(st.fund, 0) : "…", undefined]].map(([k, v, col]) => (
          <div key={k as string}><div style={{ color: C.muted, fontSize: 11 }}>{k}</div><div style={{ color: (col as string) ?? "var(--arc-ink)", fontSize: 13, fontWeight: 600 }}>{v}</div></div>
        ))}
        <span style={{ color: live ? C.up : C.muted, fontSize: 11, marginLeft: "auto" }}>{live ? "● LIVE" : "○ connecting"}{sp ? ` · price ${now - sp.ts}s` : ""}</span>
      </div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) 280px 330px" }}>
        <div style={{ ...cell, overflow: "hidden" }}>
          <div style={{ alignItems: "center", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 4, padding: "6px 10px" }}>
            {TFS.map((x) => <button key={x} onClick={() => setTf(x)} style={{ background: tf === x ? "rgba(255,255,255,0.08)" : "transparent", border: 0, borderRadius: 4, color: tf === x ? "var(--arc-ink)" : C.muted, cursor: "pointer", fontSize: 12, padding: "4px 8px" }} type="button">{x}</button>)}
            <span style={{ color: C.muted, marginLeft: "auto" }}>{sp ? sp.source : "…"}</span>
          </div>
          {candles.length ? <TvChart candles={candles} height={520} interval={tf} mode="price" scale={1e-6} storageKey={`perps:${m.token}`} symbol={`${m.name} PERP`} orderLines={openPos.filter((p) => p.market === m.id).map((p) => ({ price: liqPriceLocal(Number(BigInt(p.entry_price)) / 1e8, Number(BigInt(p.margin)) / 1e18, Number(BigInt(p.notional)) / 1e18, p.is_long), color: "#f0534f", title: `LIQ #${p.id}` }))} /> : <div style={{ alignItems: "center", color: C.muted, display: "flex", height: 520, justifyContent: "center" }}>loading candles…</div>}
        </div>
        <div style={{ ...cell, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ borderBottom: `1px solid ${C.line}`, display: "flex" }}><button onClick={() => setSideTab("oi")} style={tabBtn(sideTab === "oi")} type="button">Open Interest</button><button onClick={() => setSideTab("trades")} style={tabBtn(sideTab === "trades")} type="button">Trades</button></div>
          {sideTab === "oi" ? (
            <div style={{ fontSize: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.up }}>Longs</span><b>{usd(longOI, 0)}</b></div>
              <div style={{ background: C.line, borderRadius: 4, height: 8, margin: "6px 0", overflow: "hidden" }}><div style={{ background: C.up, height: "100%", width: `${longOI + shortOI ? (longOI / (longOI + shortOI)) * 100 : 50}%` }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.down }}>Shorts</span><b>{usd(shortOI, 0)}</b></div>
              <div style={{ borderTop: `1px solid ${C.line}`, color: C.muted, lineHeight: 1.8, marginTop: 10, paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>OI cap / side</span><span style={{ color: "var(--arc-ink)" }}>{usd(m.oiCap, 0)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Room for {side}s now</span><span style={{ color: "var(--arc-ink)" }}>{usd(capSide, 0)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Fund (counterparty)</span><span style={{ color: "var(--arc-ink)" }}>{usd(fund, 0)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Funding / h</span><span style={{ color: skew > 0 ? C.down : C.up }}>{skew > 0 ? "longs pay" : skew < 0 ? "shorts pay" : "balanced"} {Math.abs(fundingRate).toFixed(4)} %</span></div>
              </div>
              <p style={{ color: C.muted, marginTop: 10 }}>Peer-to-pool: your counterparty is the other side plus the fund, which may back up to 50 % of the imbalance. When the room is gone, wait for the other side or a fund deposit.</p>
            </div>
          ) : (
            <div style={{ fontSize: 11, padding: 8 }}>
              <div style={{ color: C.muted, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2px 4px" }}><span>Price</span><span style={{ textAlign: "right" }}>Size (USDC)</span><span style={{ textAlign: "right" }}>Time</span></div>
              {trades.slice(0, 28).map((t) => <div key={t.tx + t.ts} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2px 4px" }}><span style={{ color: t.side === "buy" ? C.up : C.down }}>{px(t.price1m / 1e6)}</span><span style={{ textAlign: "right" }}>{t.usdc.toFixed(2)}</span><span style={{ color: C.muted, textAlign: "right" }}>{new Date(t.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>)}
              <div style={{ color: C.muted, marginTop: 8 }}>Spot prints from the pool this perp is marked against.</div>
            </div>
          )}
        </div>
        <div style={{ ...cell, padding: 12 }}>
          <div style={{ borderBottom: `1px solid ${C.line}`, display: "flex", marginBottom: 10 }}><button style={tabBtn(true)} type="button">Market</button><button disabled style={{ ...tabBtn(false), opacity: 0.5 }} type="button">Limit · soon</button><button disabled style={{ ...tabBtn(false), opacity: 0.5 }} type="button">TP / SL · soon</button></div>
          <div style={{ display: "flex", gap: 6 }}><button onClick={() => setSide("long")} style={seg(side === "long", C.up)} type="button">Buy / Long</button><button onClick={() => setSide("short")} style={seg(side === "short", C.down)} type="button">Sell / Short</button></div>
          <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", marginTop: 12 }}><span>Available to Trade</span><span style={{ color: "var(--arc-ink)" }}>{bal != null ? `${bal.toFixed(2)} USDC` : addr ? "…" : "—"}</span></div>
          <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", marginTop: 4 }}><span>Wallet</span><span style={{ color: "var(--arc-ink)" }}>{addr ? `${useHot ? "⚡ " : ""}${addr.slice(0, 6)}…${addr.slice(-4)}` : "not connected"}</span></div>
          <div style={{ ...cell, alignItems: "center", display: "flex", justifyContent: "space-between", marginTop: 10, padding: "8px 10px" }}><span style={{ color: C.muted }}>Margin</span><span><input inputMode="decimal" onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} style={{ background: "transparent", border: 0, color: "var(--arc-ink)", fontSize: 14, textAlign: "right", width: 110 }} value={margin} /> <span style={{ color: C.muted }}>USDC</span></span></div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>{[25, 50, 75, 100].map((p) => <button key={p} onClick={() => bal && setMargin(Math.floor(Math.max(0, bal - 0.3) * p / 100 * 100) / 100)} style={{ ...seg(false), padding: "4px 0", fontSize: 11, fontWeight: 400 }} type="button">{p}%</button>)}</div>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginTop: 12 }}><span style={{ color: C.muted }}>Leverage</span><span style={{ ...cell, padding: "2px 8px" }}>{L}x</span></div>
          <input max={maxLev} min={1} onChange={(e) => setLv(Number(e.target.value))} style={{ accentColor: "#2e7cff", marginTop: 6, width: "100%" }} type="range" value={L} />
          <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", fontSize: 11 }}><span>1x</span><span>max {maxLev}x{m.kind === 1 && sp && !sp.feedLive ? " · no live feed" : ""}</span></div>
          {!addr ? <button className="arc-cta" onClick={() => connectWallet().then(setAddr).catch((e) => say(false, String(e.message ?? e)))} style={{ marginTop: 14, width: "100%" }} type="button">Connect wallet</button>
            : <button className="arc-cta" disabled={!!busy || !sp || !!st?.paused || !(margin >= 1)} onClick={() => void doOpen()} style={{ background: side === "long" ? C.up : C.down, marginTop: 14, width: "100%" }} type="button">{busy ?? (side === "long" ? `Buy / Long ${L}x` : `Sell / Short ${L}x`)}</button>}
          <div style={{ borderTop: `1px solid ${C.line}`, display: "grid", gap: 6, marginTop: 12, paddingTop: 10 }}>
            {[["Liquidation Price", mark ? `${px(liq)} (${side === "long" ? "−" : "+"}${(85 / L).toFixed(0)}%)` : "…"], ["Order Value", usd(notional, 2)], ["Margin", usd(margin, 2)], ["Fee 0.10 %", usd(fee, 4)], ["You send", usd(margin + fee, 4)], ["Room on this side", usd(capSide, 0)]].map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.muted }}>{k}</span><span>{v}</span></div>)}
          </div>
          <p style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Market orders only in v1. The price you get is the operator-signed mark attached to your transaction (≤ 8 s old). Liquidation at 15 % of margin left; 0.5 % of notional to the liquidator.</p>
        </div>
      </div>
      {/* bottom */}
      <div style={cell}>
        <div style={{ borderBottom: `1px solid ${C.line}`, display: "flex" }}>{([["pos", `Positions (${openPos.length})`], ["hist", `History (${hist.length})`], ["fund", "Fund / LP"], ["info", "How it works"]] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={tabBtn(tab === k)} type="button">{l}</button>)}</div>
        <div style={{ overflowX: "auto", padding: 8 }}>
          {tab === "pos" && (openPos.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>{addr ? "No open positions." : "Connect a wallet to see positions."}</div> : <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr style={{ color: C.muted, textAlign: "left" }}>{["Market", "Side", "Size", "Margin", "Entry", "Mark", "Liq.", "Funding", "PnL (ROE)", ""].map((h) => <th key={h} style={{ fontWeight: 400, padding: "4px 8px" }}>{h}</th>)}</tr></thead><tbody>
            {openPos.map((p) => { const mk = markets.find((x) => x.id === p.market); const markUsd = mk?.id === m.id && sp ? sp.priceUsd : (mk?.mark ?? p.mark); const e = eq[p.id]; const le = liveEquity(p, markUsd, e?.funding ?? 0n); const lev = Number(BigInt(p.notional)) / Number(BigInt(p.margin)); return (
              <tr key={p.id} style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: "6px 8px" }}>{mk && <span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}><Logo size={18} t={mk} /><b>{mk.name}</b></span>} <span style={{ color: C.muted }}>#{p.id}</span></td><td style={{ color: p.is_long ? C.up : C.down, padding: "6px 8px" }}>{p.is_long ? "LONG" : "SHORT"} {lev.toFixed(0)}x</td><td style={{ padding: "6px 8px" }}>{usd(Number(BigInt(p.notional)) / 1e18)}</td><td style={{ padding: "6px 8px" }}>{usd(Number(BigInt(p.margin)) / 1e18)}</td><td style={{ padding: "6px 8px" }}>{px(Number(BigInt(p.entry_price)) / 1e8)}</td><td style={{ padding: "6px 8px" }}>{markUsd ? px(markUsd) : "…"}</td><td style={{ color: C.down, padding: "6px 8px" }}>{px(liqPriceLocal(Number(BigInt(p.entry_price)) / 1e8, Number(BigInt(p.margin)) / 1e18, Number(BigInt(p.notional)) / 1e18, p.is_long))}</td><td style={{ padding: "6px 8px" }}>{e ? `${Number(e.funding) > 0 ? "−" : "+"}${(Math.abs(Number(e.funding)) / 1e18).toFixed(4)}` : "…"}</td><td style={{ color: le.pnl >= 0 ? C.up : C.down, padding: "6px 8px" }}>{le.pnl >= 0 ? "+" : ""}{le.pnl.toFixed(2)} ({le.roe >= 0 ? "+" : ""}{le.roe.toFixed(1)} %)</td><td style={{ padding: "6px 14px 6px 8px" }}><button disabled={!!busy} onClick={() => void doClose(p)} style={{ ...seg(false), padding: "3px 10px" }} type="button">Close</button></td></tr>); })}
          </tbody></table>)}
          {tab === "hist" && (hist.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No closed positions yet.</div> : <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr style={{ color: C.muted, textAlign: "left" }}>{["Closed", "Market", "Side", "Size", "Entry", "Exit", "PnL", "Funding", "Fees", "Payout", ""].map((h) => <th key={h} style={{ fontWeight: 400, padding: "4px 8px" }}>{h}</th>)}</tr></thead><tbody>
            {hist.map((p) => { const mk = markets.find((x) => x.id === p.market); const pnl = Number(BigInt(p.pnl ?? "0")) / 1e18; return <tr key={p.id} style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: "6px 8px" }}>{new Date((p.closed_ts ?? 0) * 1000).toLocaleString()}</td><td style={{ padding: "6px 8px" }}><b>{mk?.name ?? p.market}</b> <span style={{ color: C.muted }}>#{p.id}</span></td><td style={{ color: p.is_long ? C.up : C.down, padding: "6px 8px" }}>{p.is_long ? "LONG" : "SHORT"}</td><td style={{ padding: "6px 8px" }}>{usd(Number(BigInt(p.notional)) / 1e18)}</td><td style={{ padding: "6px 8px" }}>{px(Number(BigInt(p.entry_price)) / 1e8)}</td><td style={{ padding: "6px 8px" }}>{p.close_price ? px(Number(BigInt(p.close_price)) / 1e8) : "—"}</td><td style={{ color: pnl >= 0 ? C.up : C.down, padding: "6px 8px" }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(4)}</td><td style={{ padding: "6px 8px" }}>{(Number(BigInt(p.funding ?? "0")) / 1e18).toFixed(4)}</td><td style={{ padding: "6px 8px" }}>{(Number(BigInt(p.fee ?? "0")) / 1e18).toFixed(4)}</td><td style={{ padding: "6px 8px" }}>{usd(Number(BigInt(p.payout ?? "0")) / 1e18, 4)}</td><td style={{ padding: "6px 8px" }}>{p.liquidated ? <span style={{ color: C.down }}>liquidated</span> : ""}{p.close_tx && <a href={`https://arc-scan.org/tx/${p.close_tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", marginLeft: 8 }} target="_blank">tx ↗</a>}</td></tr>; })}
          </tbody></table>)}
          {tab === "fund" && (
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", padding: 8 }}>
              <div style={{ fontSize: 12, lineHeight: 1.9 }}>
                <b>The fund</b> is the counterparty for the imbalance between longs and shorts (up to 50 % of it) and earns 70 % of every fee plus what liquidations leave behind. It can also lose when traders net win. LP shares track the fund pro-rata; 24-hour lock after each deposit.
                <div style={{ color: C.muted, display: "flex", justifyContent: "space-between", marginTop: 6 }}><span>Fund</span><span style={{ color: "var(--arc-ink)" }}>{st?.fund != null ? usd(st.fund) : "…"}</span></div>
                <div style={{ color: C.muted, display: "flex", justifyContent: "space-between" }}><span>Your share</span><span style={{ color: "var(--arc-ink)" }}>{lp && lp.totalShares > 0n ? `${usd(Number(lp.shares * lp.fund / lp.totalShares) / 1e18)} (${(Number(lp.shares) / Number(lp.totalShares) * 100).toFixed(2)} %)` : "—"}</span></div>
                <div style={{ color: C.muted, display: "flex", justifyContent: "space-between" }}><span>Unlocks</span><span style={{ color: "var(--arc-ink)" }}>{lp?.unlockAt ? (lp.unlockAt <= now ? "unlocked" : new Date(lp.unlockAt * 1000).toLocaleString()) : "—"}</span></div>
              </div>
              <div>
                <div style={{ ...cell, alignItems: "center", display: "flex", justifyContent: "space-between", padding: "8px 10px" }}><span style={{ color: C.muted }}>Amount</span><span><input inputMode="decimal" onChange={(e) => setLpAmt(Math.max(0, Number(e.target.value) || 0))} style={{ background: "transparent", border: 0, color: "var(--arc-ink)", fontSize: 14, textAlign: "right", width: 110 }} value={lpAmt} /> USDC</span></div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button className="arc-cta" disabled={!!busy || !addr || lpAmt < 1} onClick={() => void doLp(true)} style={{ flex: 1 }} type="button">Deposit</button><button disabled={!!busy || !addr || !lp || lp.shares === 0n || lp.unlockAt > now} onClick={() => void doLp(false)} style={{ ...seg(false), flex: 1, padding: "10px 0" }} type="button">Withdraw</button></div>
                <p style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Withdrawals are limited while the fund is needed to back open imbalance. Treasury seeded {st?.seed ?? 800} USDC at launch.</p>
              </div>
            </div>
          )}
          {tab === "info" && <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.8, padding: 8 }}>
            <p><b style={{ color: "var(--arc-ink)" }}>Price.</b> Arc tokens: 5-minute USDC-weighted TWAP of the pool from our index, spikes rejected. Tokenized stocks: Nasdaq + CNBC quotes (regular and extended hours) when fresh and agreeing → 3x; otherwise the pool TWAP clamped to ±7 % of the last live price → 2x. The operator signs the price; you attach the signature to your own transaction. Signatures expire after 120 s.</p>
            <p><b style={{ color: "var(--arc-ink)" }}>Counterparty.</b> Longs and shorts settle against each other; the fund covers an imbalance of at most 50 % of its size. Per-market OI caps. No admin withdrawal exists.</p>
            <p><b style={{ color: "var(--arc-ink)" }}>Funding.</b> Hourly, the heavier side pays up to 0.05 %/h of notional to the lighter side, proportional to the skew.</p>
            <p><b style={{ color: "var(--arc-ink)" }}>Liquidation.</b> When equity falls to 15 % of the initial margin: 3x ≈ −28 % move, 2x ≈ −43 %. Keeper (or anyone) liquidates with a fresh price and earns 0.5 % of notional; what remains of the margin goes to the fund.</p>
            <p><b style={{ color: "var(--arc-ink)" }}>Fees.</b> 0.10 % of notional on open and on close: 70 % to the fund, 30 % to the ArcTools treasury (ARCT buyback and burn). Contract {ARC_PERPS} · verified on arc-scan.</p>
          </div>}
        </div>
      </div>
    </div>
  );
}
