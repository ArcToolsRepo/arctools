import { useEffect, useMemo, useState } from "react";
import * as HW from "../lib/arc-hotwallet";
import { num, usd, isAddr, short } from "../lib/fmt";
import { allTokens, getToken, getHot, getTrend, loadList, useStore, toast, getPrefs } from "../lib/store";
import { quoteBuy, quoteSell, buy, sell, tokenBalanceRaw, tokenDecimals } from "../lib/trade";
import { Header, Icon, Logo, Sheet } from "../components/ui";
import { Unlock } from "./Wallet";

const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";

/** Swap: USDC ⇄ any Arc token through the aggregator. Same engine as the Buy sheet, laid out as a swap card. */
export default function Swap({ token }: { token?: string }) {
  const [tok, setTok] = useState<string>(token ?? ARCT);
  const [side, setSide] = useState<"buy" | "sell">("buy");        // buy = USDC → token, sell = token → USDC
  const [amt, setAmt] = useState(""); const [pick, setPick] = useState(false); const [q, setQ] = useState("");
  const [usdc, setUsdc] = useState<number | null>(null); const [tb, setTb] = useState<{ raw: bigint; dec: number } | null>(null);
  const [quote, setQuote] = useState<{ out: bigint; label: string } | "err" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  useStore(allTokens); useEffect(() => { void loadList(); }, []);
  const addr = HW.hotAddress(); const t = getToken(tok); const tr = getHot(tok) ?? getTrend(tok);
  const sym = t?.symbol || tr?.symbol || short(tok);
  useEffect(() => { if (!addr) return; HW.hotBalance(addr).then(setUsdc).catch(() => undefined); Promise.all([tokenBalanceRaw(tok, addr), tokenDecimals(tok)]).then(([raw, dec]) => setTb({ raw, dec })).catch(() => undefined); }, [addr, tok, busy]);
  useEffect(() => {
    const a = Number(amt); if (!(a > 0)) { setQuote(null); return; }
    let alive = true; setQuote(null);
    const p = side === "buy" ? quoteBuy(tok, a) : quoteSell(tok, BigInt(Math.round(a * 1e6)) * 10n ** BigInt(Math.max(0, (tb?.dec ?? 18) - 6)));
    const id = setTimeout(() => p.then((r) => alive && setQuote({ out: r.out, label: r.label })).catch(() => alive && setQuote("err")), 350);
    return () => { alive = false; clearTimeout(id); };
  }, [amt, side, tok, tb?.dec]);
  const list = useMemo(() => { const s = q.trim().toLowerCase(); if (isAddr(s)) return [s]; return allTokens().filter((x) => !s || x.symbol?.toLowerCase().includes(s) || x.name?.toLowerCase().includes(s)).sort((a, b) => (b.volUsd ?? 0) - (a.volUsd ?? 0)).slice(0, 80).map((x) => x.token.toLowerCase()); }, [q]);
  const outHuman = quote && quote !== "err" ? (side === "buy" ? Number(quote.out) / 10 ** (tb?.dec ?? 18) : Number(quote.out) / 1e18) : null;
  const tokHuman = tb ? Number(tb.raw) / 10 ** tb.dec : 0;
  const run = async () => {
    const a = Number(amt); setBusy("…");
    try {
      const h = side === "buy" ? await buy(tok, a, setBusy) : await sell(tok, Math.min(100, (a / tokHuman) * 100), setBusy);
      toast(side === "buy" ? `Swapped ${a} USDC → ${sym}` : `Swapped ${num(a)} ${sym} → USDC`, "ok", h); setAmt("");
    } catch (e) { toast(String((e as Error).message || e).slice(0, 160), "err"); } finally { setBusy(null); }
  };
  const Box = ({ label, symbol, bal, value, onValue, isTok }: { label: string; symbol: string; bal: string; value: string; onValue?: (v: string) => void; isTok: boolean }) => (
    <div className="card" style={{ margin: "0 14px 6px", padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }} className="muted"><span>{label}</span><span className="num">bal {bal}</span></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
        <input inputMode="decimal" placeholder="0" value={value} readOnly={!onValue} onChange={(e) => onValue?.(e.target.value.replace(/[^0-9.]/g, ""))} style={{ flex: 1, background: "none", border: 0, color: "var(--ink)", fontSize: 28, fontWeight: 700, outline: "none", minWidth: 0 }} />
        <button className="chip on" style={{ padding: "8px 10px" }} onClick={() => isTok && setPick(true)} disabled={!isTok}>{isTok ? <Logo ca={tok} size={20} /> : <span style={{ width: 20, height: 20, borderRadius: 10, background: "#2775ca", display: "inline-block" }} />}{symbol}{isTok && " ▾"}</button>
      </div>
      {onValue && <div style={{ display: "flex", gap: 6, marginTop: 8 }}>{(isTok ? [25, 50, 100] : getPrefs().presets).map((p) => <button key={p} className="pill" onClick={() => onValue(isTok ? (tokHuman * p / 100).toString() : String(p))}>{isTok ? `${p}%` : `${p} USDC`}</button>)}</div>}
    </div>
  );
  return (
    <>
      <Header title="Swap" />
      {!HW.hasWallet() ? <div className="empty">Create a wallet first.</div> : !HW.isUnlocked() ? <Unlock /> : (
        <>
          {side === "buy"
            ? <><Box label="You pay" symbol="USDC" bal={usdc == null ? "…" : usdc.toFixed(2)} value={amt} onValue={setAmt} isTok={false} /><div style={{ textAlign: "center", margin: "-2px 0 4px" }}><button className="icon-btn" onClick={() => { setSide("sell"); setAmt(""); }}><Icon.swap className="" /></button></div><Box label="You receive" symbol={sym} bal={num(tokHuman)} value={outHuman == null ? (quote === "err" ? "no route" : amt ? "…" : "") : num(outHuman)} isTok /></>
            : <><Box label="You pay" symbol={sym} bal={num(tokHuman)} value={amt} onValue={setAmt} isTok /><div style={{ textAlign: "center", margin: "-2px 0 4px" }}><button className="icon-btn" onClick={() => { setSide("buy"); setAmt(""); }}><Icon.swap className="" /></button></div><Box label="You receive" symbol="USDC" bal={usdc == null ? "…" : usdc.toFixed(2)} value={outHuman == null ? (quote === "err" ? "no route" : amt ? "…" : "") : outHuman.toFixed(4)} isTok={false} /></>}
          <div className="card" style={{ padding: "6px 14px" }}>
            <div className="kv" style={{ borderTop: 0 }}><span>Route</span><b>{quote && quote !== "err" ? quote.label : "—"}</b></div>
            <div className="kv"><span>Fee</span><b>0.5% → ARCT buyback & burn</b></div>
            <div className="kv"><span>Slippage</span><b>{side === "buy" ? "none (fills at any price)" : `${getPrefs().slippage}%`}</b></div>
            <div className="kv"><span>MC {sym}</span><b className="amber">{usd(tr?.mcap ?? t?.mcapUsd)}</b></div>
          </div>
          <div style={{ padding: "4px 14px" }}><button className={`btn ${side === "buy" ? "primary" : "danger"}`} disabled={!!busy || !(Number(amt) > 0) || quote === "err" || quote == null} onClick={run}>{busy ?? (side === "buy" ? `Buy ${sym}` : `Sell ${sym}`)}</button></div>
        </>
      )}
      <Sheet open={pick} onClose={() => setPick(false)} title="Choose token">
        <div className="field" style={{ marginBottom: 8 }}><Icon.search className="" /><input autoFocus placeholder="name, symbol or 0x…" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="none" /></div>
        {list.map((ca) => { const x = getToken(ca); return <div key={ca} className="row" onClick={() => { setTok(ca); setPick(false); setQ(""); setAmt(""); }}><Logo ca={ca} size={36} /><div className="row-main"><div className="row-name"><b>{x?.symbol ?? short(ca)}</b><span>{x?.name}</span></div><div className="row-sub"><span>{x?.pad}</span></div></div><div className="row-right"><div className="row-mc">{usd(x?.mcapUsd)}</div></div></div>; })}
      </Sheet>
    </>
  );
}
