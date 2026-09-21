import { useEffect, useState } from "react";
import * as HW from "../lib/arc-hotwallet";
import { api, type Sim } from "../lib/api";
import { usd, num, short } from "../lib/fmt";
import { getPrefs, getToken, getHot, getTrend, setPrefs, toast, useStore } from "../lib/store";
import { buy, quoteBuy, sell, tokenBalanceRaw, tokenDecimals } from "../lib/trade";
import { Icon, Logo, Sheet } from "./ui";
import { Unlock } from "../screens/Wallet";

/** Buy / Sell bottom sheet — the one trade surface for the whole app. */
export function BuySheet({ ca, onClose, side: side0 = "buy" }: { ca: string | null; onClose: () => void; side?: "buy" | "sell" }) {
  const prefs = useStore(getPrefs);
  const [side, setSide] = useState<"buy" | "sell">(side0);
  const [amt, setAmt] = useState<number>(prefs.quickBuy);
  const [pctSell, setPctSell] = useState(100);
  const [bal, setBal] = useState<number | null>(null);
  const [tokBal, setTokBal] = useState<{ raw: bigint; dec: number } | null>(null);
  const [quote, setQuote] = useState<{ out: bigint; label: string } | null | "err">(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [ackTrap, setAckTrap] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const unlocked = HW.isUnlocked(); const addr = HW.hotAddress();
  const t = ca ? getToken(ca) : undefined; const tr = ca ? (getHot(ca) ?? getTrend(ca)) : undefined;
  const sym = t?.symbol || tr?.symbol || (ca ? short(ca) : "");

  useEffect(() => { setSide(side0); setQuote(null); setSim(null); setAckTrap(false); }, [ca, side0]);
  useEffect(() => {
    if (!ca || !addr) return;
    HW.hotBalance(addr).then(setBal).catch(() => undefined);
    Promise.all([tokenBalanceRaw(ca, addr), tokenDecimals(ca)]).then(([raw, dec]) => setTokBal({ raw, dec })).catch(() => undefined);
    api.sim(ca).then(setSim).catch(() => setSim(null));
  }, [ca, addr, busy]);
  // live quote for the buy side
  useEffect(() => {
    if (!ca || side !== "buy" || !(amt > 0)) { setQuote(null); return; }
    let alive = true; setQuote(null);
    quoteBuy(ca, amt).then((q) => alive && setQuote({ out: q.out, label: q.label })).catch(() => alive && setQuote("err"));
    return () => { alive = false; };
  }, [ca, side, amt]);

  if (!ca) return null;
  const dec = tokBal?.dec ?? 18;
  const outHuman = quote && quote !== "err" ? Number(quote.out) / 10 ** dec : null;
  const trap = sim?.verdict === "trap"; const thin = sim?.verdict === "thin"; const noExit = sim?.verdict === "no_route" || sim?.verdict === "unrouted";
  const run = async () => {
    setBusy("…");
    try {
      const h = side === "buy" ? await buy(ca, amt, setBusy) : await sell(ca, pctSell, setBusy);
      toast(side === "buy" ? `Bought ${sym} for ${amt} USDC` : `Sold ${pctSell}% of ${sym}`, "ok", h);
      HW.hotWait(h).then((r) => { if (r.status !== 1) toast(`${sym}: transaction reverted`, "err", h); }).catch(() => undefined);
      onClose();
    } catch (e) { toast(String((e as Error).message || e).slice(0, 160), "err"); } finally { setBusy(null); }
  };

  return (
    <Sheet open={!!ca} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Logo ca={ca} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 17 }}>{sym}</b><div className="muted" style={{ fontSize: 12 }}>{t?.pad ?? tr?.venue ?? ""} · MC {usd(tr?.mcap ?? t?.mcapUsd)}</div></div>
        <div style={{ display: "flex", background: "var(--bg3)", borderRadius: 10, padding: 3 }}>
          {(["buy", "sell"] as const).map((s) => <button key={s} onClick={() => setSide(s)} style={{ padding: "6px 14px", borderRadius: 8, fontWeight: 800, fontSize: 13, background: side === s ? (s === "buy" ? "var(--up)" : "var(--down)") : "transparent", color: side === s ? (s === "buy" ? "#04140a" : "#fff") : "var(--muted)" }}>{s.toUpperCase()}</button>)}
        </div>
      </div>

      {!HW.hasWallet() ? <div className="empty">Create a wallet first (Wallet tab).</div> : !unlocked ? <Unlock /> : (
        <>
          {/* safety, from the sell simulation — where DexScreener sells an ad, we put this */}
          {sim && sim.verdict !== "ok" && sim.verdict !== "error" && (
            <div className="card" style={{ margin: "0 0 12px", padding: 10, borderLeft: `3px solid ${trap || noExit ? "var(--down)" : "var(--amber)"}`, fontSize: 13 }}>
              {trap && <><b className="down">⚠ CANNOT EXIT.</b> Our simulated sell returns far less than the router quotes — the classic honeypot signature.</>}
              {thin && <><b className="amber">THIN POOL.</b> A sell of this size loses {sim.loss_pct?.toFixed(0) ?? "a lot"}% to price impact.</>}
              {noExit && <><b className="down">NO EXIT ROUTE.</b> Our router cannot sell this token right now. You may not be able to get out.</>}
              {(trap || noExit) && side === "buy" && <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={ackTrap} onChange={(e) => setAckTrap(e.target.checked)} /> I understand and still want to buy</label>}
            </div>
          )}

          {side === "buy" ? (
            <>
              <div className="presets">{prefs.presets.map((p) => <button key={p} className={amt === p ? "on" : ""} onClick={() => setAmt(p)}>{p} <span style={{ opacity: 0.6, fontSize: 11 }}>USDC</span></button>)}</div>
              <div style={{ height: 8 }} />
              <div className="field"><span className="muted">USDC</span><input inputMode="decimal" value={String(amt)} onChange={(e) => setAmt(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)} /><span className="muted num" style={{ fontSize: 12 }}>bal {bal == null ? "…" : bal.toFixed(2)}</span></div>
              <div className="kv" style={{ borderTop: 0, marginTop: 6 }}><span>You receive</span><b className="num">{quote === "err" ? <span className="down">no route</span> : outHuman == null ? "…" : `≈ ${num(outHuman)} ${sym}`}</b></div>
              <div className="kv"><span>Route</span><b>{quote && quote !== "err" ? quote.label : "—"}</b></div>
              <div className="kv"><span>Fee</span><b>0.5% → ARCT buyback</b></div>
              <div className="kv"><span>Slippage</span><b>none — buy fills at any price (speed first)</b></div>
              <div style={{ height: 12 }} />
              <button className="btn primary" disabled={!!busy || !(amt > 0) || (bal != null && amt > bal - 0.05) || ((trap || noExit) && !ackTrap) || quote === "err"} onClick={run}>{busy ?? `Buy ${sym} · ${amt} USDC`}</button>
            </>
          ) : (
            <>
              <div className="kv" style={{ borderTop: 0 }}><span>Your {sym}</span><b className="num">{tokBal ? num(Number(tokBal.raw) / 10 ** tokBal.dec) : "…"}</b></div>
              <div className="presets">{[25, 50, 75, 100].map((p) => <button key={p} className={pctSell === p ? "on" : ""} onClick={() => setPctSell(p)}>{p}%</button>)}</div>
              <div className="kv" style={{ marginTop: 6 }}><span>Slippage</span><button className="pill" onClick={() => setSlipOpen((s) => !s)}>{prefs.slippage}% ▾</button></div>
              {slipOpen && <div className="presets" style={{ marginBottom: 8 }}>{[1, 3, 5, 10].map((s) => <button key={s} className={prefs.slippage === s ? "on" : ""} onClick={() => { setPrefs({ slippage: s }); setSlipOpen(false); }}>{s}%</button>)}</div>}
              <div className="kv"><span>Fee</span><b>0.5% → ARCT buyback</b></div>
              <div style={{ height: 12 }} />
              <button className="btn danger" disabled={!!busy || !tokBal || tokBal.raw === 0n} onClick={run}>{busy ?? `Sell ${pctSell}% ${sym}`}</button>
            </>
          )}
        </>
      )}
      <div style={{ height: 6 }} />
      <button className="muted" style={{ width: "100%", padding: 10, fontSize: 13 }} onClick={onClose}><Icon.x className="" style={{ width: 14, verticalAlign: "middle" }} /> close</button>
    </Sheet>
  );
}
