import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { api, streamUrl, type Holding, type Sim, type Stats, type Trade } from "../lib/api";
import * as HW from "../lib/arc-hotwallet";
import { usd, num, pct, price, ago, short } from "../lib/fmt";
import { go } from "../lib/router";
import { getToken, getHot, getTrend, isWatched, loadRisk, loadLogos, getRisk, toggleWatch, toast, useStore } from "../lib/store";
import { Header, Icon, Logo } from "../components/ui";
import { openUrl } from "../lib/native";
import { BuySheet } from "../components/BuySheet";

type TabK = "trades" | "holders" | "traders" | "dev" | "info";
const TF = [["1m", "1m"], ["5m", "5m"], ["15m", "15m"], ["1h", "1h"], ["4h", "4h"]] as const;

export default function Token({ ca }: { ca: string }) {
  const t = getToken(ca); const tr = getHot(ca) ?? getTrend(ca);
  const watched = useStore(() => isWatched(ca));
  const rk = useStore(() => getRisk(ca));
  const [stats, setStats] = useState<Stats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sim, setSim] = useState<Sim | null>(null);
  const [tab, setTab] = useState<TabK>("trades");
  const [tf, setTf] = useState<(typeof TF)[number][0]>("5m");
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [holders, setHolders] = useState<unknown[] | null>(null);
  const [traders, setTraders] = useState<Record<string, unknown> | null>(null);
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const [pos, setPos] = useState<Holding | null | undefined>(undefined);   // undefined = loading, null = none
  const [, hotTick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => hotTick((n) => n + 1)); return () => { off(); }; }, []);
  useEffect(() => {
    const a = HW.hotAddress(); if (!a) { setPos(null); return; }
    const load = () => api.holdings(a).then((r) => setPos((r.holdings ?? []).find((h) => h.token.toLowerCase() === ca) ?? null)).catch(() => setPos(null));
    load(); const id = setInterval(load, 20_000); return () => clearInterval(id);
  }, [ca, sheet]);
  const chartBox = useRef<HTMLDivElement>(null); const chart = useRef<IChartApi | null>(null); const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const sym = t?.symbol || tr?.symbol || (meta?.symbol as string) || short(ca);

  const [liq, setLiq] = useState<number | null>(null);
  useEffect(() => {
    void loadRisk([ca]); void loadLogos([ca]);
    api.liq([ca]).then((m) => setLiq(m[ca] ?? null)).catch(() => undefined);
    api.stats(ca).then(setStats).catch(() => undefined);
    api.trades(ca, 80).then(setTrades).catch(() => undefined);
    api.sim(ca).then(setSim).catch(() => undefined);
    api.tokenPage(ca).then(setMeta).catch(() => undefined);
  }, [ca]);
  useEffect(() => { if (tab === "holders" && holders == null) api.holders(ca).then(setHolders).catch(() => setHolders([])); if (tab === "traders" && traders == null) api.topTraders(ca).then(setTraders).catch(() => setTraders({})); }, [tab, ca, holders, traders]);

  // chart
  useEffect(() => {
    if (!chartBox.current) return;
    const c = createChart(chartBox.current, {
      layout: { background: { type: ColorType.Solid, color: "#0a0c10" }, textColor: "#8b93a7", fontSize: 10 },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }, handleScroll: true, handleScale: true, height: 240, width: chartBox.current.clientWidth,
    });
    const s = c.addSeries(CandlestickSeries, { upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444", priceFormat: { type: "price", precision: 8, minMove: 0.00000001 } });
    chart.current = c; series.current = s;
    const ro = new ResizeObserver(() => c.applyOptions({ width: chartBox.current?.clientWidth ?? 360 })); ro.observe(chartBox.current);
    return () => { ro.disconnect(); c.remove(); chart.current = null; series.current = null; };
  }, []);
  useEffect(() => {
    let alive = true;
    api.ohlc(ca, tf, 300).then((cs) => { if (!alive || !series.current) return; series.current.setData(cs.map((k) => ({ time: k.t as UTCTimestamp, open: k.o / 1e6, high: k.h / 1e6, low: k.l / 1e6, close: k.c / 1e6 }))); chart.current?.timeScale().fitContent(); }).catch(() => undefined);
    return () => { alive = false; };
  }, [ca, tf]);
  // live trades
  useEffect(() => {
    let es: EventSource | null = null; let closed = false; let backoff = 1000; let lastBeat = Date.now();
    const onTrade = (x: Trade) => { if (!(x.price1m > 0) || !(x.usdc > 0)) return; setTrades((p) => p.some((q) => q.tx === x.tx && q.ts === x.ts) ? p : [x, ...p].slice(0, 120)); setStats((s) => s ? { ...s, price1m: x.price1m } : s); };
    const open = () => {
      if (closed) return; es = new EventSource(streamUrl(ca)); const beat = () => { lastBeat = Date.now(); };
      es.addEventListener("hello", beat); es.addEventListener("hb", beat);
      es.addEventListener("trade", (e) => { beat(); try { onTrade(JSON.parse((e as MessageEvent).data)); } catch { /* */ } });
      es.addEventListener("trades", (e) => { beat(); try { for (const x of JSON.parse((e as MessageEvent).data)) onTrade(x); } catch { /* */ } });
      es.onerror = () => { es?.close(); es = null; if (!closed) setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15_000); };
    };
    open();
    const pulse = setInterval(() => { if (Date.now() - lastBeat > 40_000) { es?.close(); es = null; if (!closed) open(); } }, 5000);
    const poll = setInterval(() => { api.trades(ca, 80).then(setTrades).catch(() => undefined); api.stats(ca).then(setStats).catch(() => undefined); }, 30_000);
    return () => { closed = true; es?.close(); clearInterval(pulse); clearInterval(poll); };
  }, [ca]);

  const px = stats?.price1m ?? tr?.p1 ?? null; const mcap = stats?.mcap ?? tr?.mcap ?? t?.mcapUsd ?? null;
  const buys = stats?.buys24 ?? tr?.buys ?? 0; const sells = stats?.sells24 ?? tr?.sells ?? 0; const bp = buys + sells ? Math.round(100 * buys / (buys + sells)) : 50;
  const devNet = rk?.dev_net_usd ?? ((rk?.dev_sold_usd ?? 0) - (rk?.dev_bought_usd ?? 0));
  const links = { x: (t?.twitter ?? meta?.twitter) as string | undefined, tg: (t?.telegram ?? meta?.telegram) as string | undefined, web: (t?.website ?? meta?.website) as string | undefined };

  return (
    <div className="has-tradebar">
      <Header title={sym} back right={<>
        <button className="icon-btn" onClick={() => { toggleWatch(ca); toast(watched ? "Removed from watchlist" : "Added to watchlist", "ok"); }} style={{ color: watched ? "var(--amber)" : undefined }}><Icon.star className="" /></button>
        <button className="icon-btn" onClick={() => { navigator.clipboard?.writeText(ca); toast("Address copied", "ok"); }}><Icon.copy className="" /></button>
      </>} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 14px 10px", flexWrap: "wrap" }}>
        <Logo ca={ca} size={48} />
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}><b style={{ fontSize: 22 }} className="num">{price(px)}</b><span className={`num ${(tr?.chg ?? 0) >= 0 ? "up" : "down"}`} style={{ fontWeight: 700 }}>{pct(tr?.chg)}</span></div>
          <div className="muted" style={{ fontSize: 12, display: "flex", gap: 8 }}>{t?.name && <span>{t.name}</span>}{t?.pad && <span>· {t.pad}</span>}<span className="mono">· {short(ca)}</span></div>
        </div>
        <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
          {links.x && <button className="icon-btn" onClick={() => openUrl(`https://x.com/${String(links.x).replace(/^@/, "")}`)} style={{ fontWeight: 800 }}>𝕏</button>}
          {links.tg && <button className="icon-btn" onClick={() => openUrl(`https://t.me/${String(links.tg).replace(/^@/, "")}`)}><Icon.send className="" /></button>}
          {links.web && <button className="icon-btn" onClick={() => openUrl(String(links.web).startsWith("http") ? String(links.web) : `https://${links.web}`)}><Icon.external className="" /></button>}
        </div>
      </div>

      <div className="tiles"><div className="tile"><small>MCAP</small><b className="amber">{usd(mcap)}</b></div><div className="tile"><small>LIQ</small><b>{usd(liq ?? stats?.liq ?? t?.liqUsd)}</b></div><div className="tile"><small>VOL 24H</small><b>{usd(stats?.vol24 ?? tr?.vol)}</b></div><div className="tile"><small>TRADERS</small><b>{num(stats?.traders24 ?? tr?.traders)}</b></div></div>

      <div className="seg" style={{ paddingTop: 0 }}>{TF.map(([k, l]) => <button key={k} className={`chip ${tf === k ? "on" : ""}`} onClick={() => setTf(k)}>{l}</button>)}</div>
      <div ref={chartBox} style={{ height: 240, margin: "0 6px" }} />

      <div className="card" style={{ marginTop: 10, padding: "10px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}><span className="up num">{buys} buys</span><span className="down num">{sells} sells</span></div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--down)", overflow: "hidden" }}><div style={{ width: `${bp}%`, height: "100%", background: "var(--up)" }} /></div>
      </div>

      {/* SAFETY — where DexScreener sells an ad, we put this */}
      <div className="card" style={{ padding: "10px 14px" }}>
        <div className="label" style={{ margin: "0 0 6px" }}>Safety</div>
        <div className="kv" style={{ borderTop: 0 }}><span>Sell simulation</span><b className={sim?.verdict === "ok" ? "up" : sim?.verdict === "thin" ? "amber" : sim ? "down" : "muted"}>{!sim ? <span className="muted">checking…</span> : sim.verdict === "ok" ? "exit OK" : sim.verdict === "thin" ? `thin pool −${sim.loss_pct?.toFixed(0) ?? "?"}%` : sim.verdict === "trap" ? "⚠ CANNOT EXIT" : sim.verdict === "error" ? "—" : "no exit route"}</b></div>
        <div className="kv"><span>Deployer holds</span><b className={rk?.dev_pct != null && rk.dev_pct >= 15 ? "down" : rk?.dev_pct != null && rk.dev_pct >= 5 ? "amber" : "up"}>{rk?.dev_pct != null ? `${rk.dev_pct.toFixed(1)}%` : "—"}</b></div>
        <div className="kv"><span>Dev net 24h</span><b className={devNet > 50 ? "down" : devNet < -50 ? "up" : "muted"} style={{ textAlign: "right" }}>{rk && (rk.dev_sold_usd || rk.dev_bought_usd) ? <>{devNet > 0 ? "−" : "+"}{usd(Math.abs(devNet))}<div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>sold {usd(rk.dev_sold_usd)} · bought {usd(rk.dev_bought_usd)}</div></> : "nothing"}</b></div>
        <div className="kv"><span>Launch-block wallets</span><b className={rk?.bundle_pct != null && rk.bundle_pct >= 25 ? "down" : "muted"}>{rk?.bundle_pct != null ? `${rk.bundle_pct.toFixed(0)}% (${rk.bundlers ?? 0} wallets)` : "—"}</b></div>
        <div className="kv"><span>Top-10 hold</span><b className={rk?.top10_pct != null && rk.top10_pct >= 50 ? "down" : "muted"}>{rk?.top10_pct != null ? `${rk.top10_pct.toFixed(0)}%` : "—"}</b></div>
        {rk?.dev_rugs ? <div className="kv"><span>Deployer history</span><b className="down">{rk.dev_rugs} dumped of {rk.dev_launches ?? "?"} launches</b></div> : null}
      </div>

      {pos && pos.amount > 0 && (
        <div className="card" style={{ padding: "10px 14px", borderLeft: "3px solid var(--up)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Your position</div><b className="num" style={{ fontSize: 16 }}>{num(pos.amount)} {sym}</b></div>
            <div style={{ textAlign: "right" }}><b className="num" style={{ fontSize: 16 }}>{usd(pos.valueUsdc, 2)}</b>{pos.unrealized != null && <div className={`num ${pos.unrealized >= 0 ? "up" : "down"}`} style={{ fontSize: 12.5, fontWeight: 700 }}>{pos.unrealized >= 0 ? "+" : "−"}{usd(Math.abs(pos.unrealized), 2)}{pos.avgEntry && pos.price ? ` (${pct((pos.price / pos.avgEntry - 1) * 100)})` : ""}</div>}</div>
          </div>
          <div className="presets" style={{ marginTop: 8, gridTemplateColumns: "repeat(4, 1fr)" }}>{[25, 50, 75, 100].map((p) => <button key={p} className="pill red" style={{ height: 32, justifyContent: "center" }} onClick={() => setSheet("sell")}>Sell {p}%</button>)}</div>
        </div>
      )}
      <div className="seg">{(["trades", "holders", "traders", "dev", "info"] as TabK[]).map((k) => <button key={k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{k === "traders" ? "top traders" : k === "dev" ? "dev tokens" : k}</button>)}</div>
      {tab === "trades" && (trades.length === 0 ? <div className="empty">No trades yet</div> : trades.slice(0, 60).map((x) => (
        <div key={x.tx + x.ts} className="trade-row"><span className="muted num">{ago(x.ts)}</span><b className={x.side === "buy" ? "up" : "down"}>{x.side.toUpperCase()}</b><span className="num">{usd(x.usdc, 2)}</span><span className="num muted">{num(x.tokens)}</span><button className="mono muted" style={{ fontSize: 12 }} onClick={() => go(`/profile/${x.wallet}`)}>{short(x.wallet, 3)}</button></div>
      )))}
      {tab === "holders" && (holders == null ? <div className="empty">Loading…</div> : holders.length === 0 ? <div className="empty">No holder data</div> : (
        <>
          <div className="list-h"><span>#</span><span>wallet</span><span>balance</span><span>share</span></div>
          {(holders as { rank?: number; address?: { address?: string; label?: string | null; tag?: string | null; is_contract?: boolean | null }; balance?: { formatted?: string }; share?: string | number }[]).slice(0, 60).map((h, i) => {
            const a = h.address?.address ?? ""; const lbl = h.address?.label || h.address?.tag || (a.endsWith("dead") ? "burn" : a === ca ? "token contract" : "");
            const share = h.share != null ? Number(h.share) * 100 : null;
            return (
              <div key={a + i} className="trade-row" style={{ gridTemplateColumns: "28px 1fr auto 56px" }}>
                <span className="muted num">{h.rank ?? i + 1}</span>
                <button className="mono" style={{ textAlign: "left", fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} onClick={() => go(`/profile/${a}`)}>{short(a, 5)}{lbl && <span className="pill">{lbl}</span>}{h.address?.is_contract && !lbl && <span className="pill">contract</span>}</button>
                <span className="num">{num(Number(h.balance?.formatted ?? 0))}</span>
                <b className={`num ${share != null && share >= 10 ? "down" : ""}`} style={{ textAlign: "right" }}>{share != null ? `${share.toFixed(1)}%` : ""}</b>
              </div>
            );
          })}
        </>
      ))}
      {tab === "traders" && (traders == null ? <div className="empty">Loading…</div> : (
        <>
          <div className="list-h"><span>wallet</span><span>bought · sold</span><span>PnL</span></div>
          {(((traders as { traders?: Record<string, unknown>[] }).traders ?? []) as { wallet: string; bought: number; sold: number; pnl: number; buys: number; sells: number; dev?: boolean; insider_rank?: number | null; tok?: number }[]).slice(0, 40).map((x) => (
            <div key={x.wallet} className="trade-row" style={{ gridTemplateColumns: "1fr auto auto" }} onClick={() => go(`/profile/${x.wallet}`)}>
              <div><span className="mono" style={{ fontSize: 12.5 }}>{short(x.wallet, 5)}</span>{x.dev && <span className="pill red" style={{ marginLeft: 6 }}>dev</span>}{x.insider_rank ? <span className="pill green" style={{ marginLeft: 6 }}>insider #{x.insider_rank}</span> : null}<div className="muted num" style={{ fontSize: 11.5 }}>{x.buys}↑ {x.sells}↓{x.tok ? ` · holds ${num(x.tok)}` : ""}</div></div>
              <div className="num muted" style={{ fontSize: 12, textAlign: "right" }}><span className="up">{usd(x.bought)}</span><br /><span className="down">{usd(x.sold)}</span></div>
              <b className={`num ${x.pnl >= 0 ? "up" : "down"}`}>{x.pnl >= 0 ? "+" : "−"}{usd(Math.abs(x.pnl))}</b>
            </div>
          ))}
        </>
      ))}
      {tab === "dev" && <div className="empty">{rk?.dev_launches ? `Deployer launched ${rk.dev_launches} tokens, ${rk.dev_rugs ?? 0} dumped.` : "No deployer history."}</div>}
      {tab === "info" && <div className="card"><div className="kv" style={{ borderTop: 0 }}><span>Contract</span><b className="mono" style={{ fontSize: 12 }}>{short(ca, 8)}</b></div><div className="kv"><span>Launchpad</span><b>{t?.pad ?? "—"}</b></div><div className="kv"><span>Created</span><b>{t?.createdAt ? ago(Date.parse(t.createdAt) / 1000) + " ago" : "—"}</b></div><div className="kv"><span>Supply</span><b className="num">{num(stats?.supply ?? tr?.supply)}</b></div><div className="kv"><span>ATH mcap</span><b>{usd(tr?.ath_mcap)}</b></div><button className="kv" style={{ width: "100%" }} onClick={() => openUrl(`https://arc-scan.org/token/${ca}`)}><span>Explorer</span><b style={{ color: "var(--cobalt)" }}>arc-scan ↗</b></button></div>}

      <div className="tradebar">
        <button className="btn primary" onClick={() => setSheet("buy")}>Buy</button>
        <button className="btn danger" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      <BuySheet ca={sheet ? ca : null} side={sheet ?? "buy"} onClose={() => setSheet(null)} />
    </div>
  );
}
