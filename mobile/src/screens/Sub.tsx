/** The "More" pages. Each is small on purpose: one job, real data, no decoration. */
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import * as HW from "../lib/arc-hotwallet";
import { ARCT, FN, VAULT, p32, pnum } from "../lib/arc-wallet";
import { api, type Trade } from "../lib/api";
import { usd, num, pct, ago, short, isAddr } from "../lib/fmt";
import { go, type Route } from "../lib/router";
import { getPrefs, setPrefs, toast, useStore, getWatch, loadRisk, getRisk } from "../lib/store";
import { Header, Icon, Logo } from "../components/ui";
import { Launch, Pay as PayNative, Referrals as RefNative, Bridge as BridgeNative, Trades, Traders } from "./Native";
import { openUrl, buzzOk } from "../lib/native";
import { Unlock } from "./Wallet";

export default function Sub({ route }: { route: Route }) {
  switch (route.name) {
    case "insiders": return <Insiders />;
    case "alerts": return <Alerts />;
    case "launchpad": return <Launch />;
    case "pay": return <PayNative />;
    case "referrals": return <RefNative />;
    case "bridge": return <BridgeNative />;
    case "trades": return <Trades />;
    case "traders": return <Traders />;
    case "rewards": return <Rewards />;
    case "history": return <History />;
    case "profile": return <Profile wallet={route.wallet} />;
    case "settings": return <Settings />;
    default: return <><Header title="ArcTools" back /><div className="empty">Not here.</div></>;
  }
}

// ---------- Insiders ----------
type Insider = { wallet: string; pnl_total: number; pnl_pct: number; winrate: number; trades: number; volume: number; best_symbol: string | null; best_pnl: number; last_trade: number };
function Insiders() {
  const [rows, setRows] = useState<Insider[] | null>(null);
  useEffect(() => { api.insiders(100).then((r) => setRows(r as unknown as Insider[])).catch(() => setRows([])); }, []);
  return (
    <>
      <Header title="Insiders" back />
      <div className="muted" style={{ padding: "0 14px 8px", fontSize: 12.5 }}>Top-100 wallets by realised + unrealised PnL over 30 days. Tap one to see its trades; copy-trade from its profile.</div>
      {rows == null ? <div className="empty">Loading…</div> : rows.map((r, i) => (
        <div key={r.wallet} className="row" style={{ gridTemplateColumns: "28px 1fr auto" }} onClick={() => go(`/profile/${r.wallet}`)}>
          <span className="muted num" style={{ fontWeight: 700 }}>{i + 1}</span>
          <div className="row-main"><div className="row-name"><b className="mono" style={{ fontSize: 13.5 }}>{short(r.wallet, 5)}</b></div><div className="row-sub num"><span>{r.trades} trades</span><span>WR {Math.round((r.winrate ?? 0) * 100)}%</span>{r.best_symbol && <span className="up">best {r.best_symbol} +{usd(r.best_pnl)}</span>}</div></div>
          <div className="row-right"><div className={`row-mc ${r.pnl_total >= 0 ? "up" : "down"}`} style={{ color: undefined }}>{r.pnl_total >= 0 ? "+" : "−"}{usd(Math.abs(r.pnl_total))}</div><div className="row-chg muted">{ago(r.last_trade)} ago</div></div>
        </div>
      ))}
    </>
  );
}

// ---------- Alerts (watchlist-driven: dev sells, big moves, whales) ----------
function Alerts() {
  const watch = useStore(getWatch); const list = [...watch];
  const [feed, setFeed] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => { void loadRisk(list); api.feed(40).then(setFeed).catch(() => setFeed([])); }, [list.length]);
  return (
    <>
      <Header title="Alerts" back />
      <div className="label">Your watchlist · risk right now</div>
      {list.length === 0 ? <div className="empty">Watch a token (★) to get its dev/bundle alerts here.</div> : list.map((ca) => { const rk = getRisk(ca); const dn = rk?.dev_net_usd ?? 0; return (
        <div key={ca} className="row" onClick={() => go(`/token/${ca}`)}><Logo ca={ca} size={36} /><div className="row-main"><div className="row-name"><b>{short(ca)}</b></div><div className="row-sub">{dn > 50 ? <span className="dev">deployer took out {usd(dn)} in 24h</span> : rk?.bundle_net_usd && rk.bundle_net_usd > 50 ? <span className="dev">launch-block wallets sold {usd(rk.bundle_net_usd)}</span> : <span className="up">quiet</span>}</div></div><Icon.chev className="chev muted" /></div>
      ); })}
      <div className="label">Arc feed · X voices and headlines</div>
      {feed == null ? <div className="empty">Loading…</div> : feed.slice(0, 30).map((f, i) => (
        <button key={i} className="card" onClick={() => f.url && openUrl(String(f.url))} style={{ display: "block", padding: 12, width: "calc(100% - 28px)", textAlign: "left" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }} className="muted">{f.avatar ? <img alt="" src={String(f.avatar)} style={{ width: 20, height: 20, borderRadius: 10 }} /> : null}<b style={{ color: "var(--ink)" }}>{String(f.name ?? f.handle ?? f.source ?? "")}</b>{f.symbol ? <span className="pill green">${String(f.symbol)}</span> : null}<span style={{ marginLeft: "auto" }}>{ago(Number(f.ts))}</span></div>
          <div style={{ fontSize: 13.5, marginTop: 6 }}>{String(f.body ?? f.title ?? "").slice(0, 220)}</div>
        </button>
      ))}
    </>
  );
}

// ---------- Rewards / ARCT: stats + native staking ----------
function Rewards() {
  const [burn, setBurn] = useState<Record<string, number> | null>(null); const [bb, setBb] = useState<Record<string, unknown> | null>(null);
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const addr = HW.hotAddress();
  const [pos, setPos] = useState<{ bal: bigint; staked: bigint; claimable: bigint } | null>(null);
  const [mode, setMode] = useState<"stake" | "withdraw">("stake"); const [amt, setAmt] = useState(""); const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    api.burn().then((r) => setBurn(r as Record<string, number>)).catch(() => undefined); api.buyback().then(setBb).catch(() => undefined);
    if (!addr) return;
    try {
      const [b, st, cl] = await Promise.all([HW.hotCall(ARCT, FN.balanceOf + p32(addr)), HW.hotCall(VAULT, FN.staked + p32(addr)), HW.hotCall(VAULT, FN.claimableUsdc + p32(addr)).catch(() => "0x0")]);
      const h = (x: string | null) => (x && x !== "0x" ? BigInt(x) : 0n);
      setPos({ bal: h(b), staked: h(st), claimable: h(cl) });
    } catch { /* keep */ }
  }, [addr]);
  useEffect(() => { void load(); }, [load, busy]);
  const run = async () => {
    setBusy("…");
    try {
      const wei = amt.toLowerCase() === "max" ? (mode === "stake" ? pos!.bal : pos!.staked) : BigInt(Math.round(Number(amt) * 1e6)) * 10n ** 12n;
      if (wei <= 0n) throw new Error("Enter an amount");
      if (mode === "stake") {
        const al = await HW.hotCall(ARCT, "0xdd62ed3e" + p32(addr!) + p32(VAULT));
        if (!al || al === "0x" || BigInt(al) < wei) { setBusy("Approving…"); await HW.hotWait(await HW.hotApprove(ARCT, VAULT, (1n << 256n) - 1n)); }
        setBusy("Staking…"); const h = await HW.hotSend({ to: VAULT, data: FN.stake + pnum(wei), gasLimit: 250_000n }); buzzOk(); toast(`Staked ${num(Number(wei) / 1e18)} ARCT`, "ok", h);
      } else { setBusy("Withdrawing…"); const h = await HW.hotSend({ to: VAULT, data: FN.withdraw + pnum(wei), gasLimit: 250_000n }); buzzOk(); toast(`Withdrew ${num(Number(wei) / 1e18)} ARCT`, "ok", h); }
      setAmt("");
    } catch (e) { toast(String((e as Error).message || e).slice(0, 140), "err"); } finally { setBusy(null); }
  };
  const claim = async () => { setBusy("Claiming…"); try { const h = await HW.hotSend({ to: VAULT, data: FN.claimUsdc, gasLimit: 200_000n }); buzzOk(); toast("USDC rewards claimed", "ok", h); } catch (e) { toast(String((e as Error).message).slice(0, 140), "err"); } finally { setBusy(null); } };
  const f18 = (v: bigint) => Number(v) / 1e18;
  return (
    <>
      <Header title="ARCT" back />
      <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="tile"><small>Burned</small><b className="up">{burn ? `${num(burn.burned)} (${burn.pct?.toFixed(2)}%)` : "…"}</b></div>
        <div className="tile"><small>Buybacks</small><b>{bb ? `${bb.runs} · ${usd(Number(bb.usdc_spent), 0)}` : "…"}</b></div>
      </div>
      {addr && (
        <div className="card" style={{ padding: 12 }}>
          <div className="label" style={{ margin: "0 0 6px" }}>Staking</div>
          <div className="kv" style={{ borderTop: 0 }}><span>Staked</span><b className="num">{pos ? num(f18(pos.staked)) : "…"} ARCT</b></div>
          <div className="kv"><span>In wallet</span><b className="num">{pos ? num(f18(pos.bal)) : "…"} ARCT</b></div>
          <div className="kv"><span>Claimable</span><b className="num up">{pos ? `${f18(pos.claimable).toFixed(4)} USDC` : "…"}</b></div>
          {!HW.isUnlocked() ? <Unlock /> : (
            <>
              <div className="seg" style={{ padding: "8px 0" }}>{(["stake", "withdraw"] as const).map((m) => <button key={m} className={`chip ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>{m}</button>)}</div>
              <div className="field"><span className="muted">ARCT</span><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><button className="pill" onClick={() => setAmt("max")}>MAX</button></div>
              <div className="grid2" style={{ marginTop: 10 }}>
                <button className={`btn sm ${mode === "stake" ? "primary" : "ghost"}`} disabled={!!busy || !amt} onClick={run}>{busy ?? (mode === "stake" ? "Stake" : "Withdraw")}</button>
                <button className="btn sm ghost" disabled={!!busy || !pos || pos.claimable === 0n} onClick={claim}>Claim USDC</button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="card"><b>How it works</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>Every fee — 0.5% swap, 1% sniper, 1% pad trade, 2% bridge, 2% pay-link — lands in the treasury; a keeper buys ARCT and burns it in the same transaction. Stakers earn USDC from ArcToolsPad fees plus 5% of the supply of every token launched there.</p></div>
      <div style={{ padding: "0 14px" }}><button className="btn primary" onClick={() => go(`/token/${ARCT}`)}>Trade ARCT</button></div>
    </>
  );
}

// ---------- History ----------
function History() {
  const addr = HW.hotAddress();
  const [rows, setRows] = useState<(Trade & { token: string; symbol?: string })[] | null>(null);
  useEffect(() => { if (addr) api.walletTrades(addr, 100).then((r) => setRows(r as (Trade & { token: string; symbol?: string })[])).catch(() => setRows([])); }, [addr]);
  return (
    <>
      <Header title="History" back />
      {!addr ? <div className="empty">Create a wallet first.</div> : rows == null ? <div className="empty">Loading…</div> : rows.length === 0 ? <div className="empty">No trades yet.</div> : rows.map((x) => (
        <div key={x.tx + x.ts} className="trade-row" style={{ gridTemplateColumns: "44px 1fr auto" }} onClick={() => go(`/token/${x.token}`)}>
          <span className="muted num">{ago(x.ts)}</span>
          <div><b className={x.side === "buy" ? "up" : "down"}>{x.side.toUpperCase()}</b> <b>{x.symbol ?? short(x.token)}</b><div className="muted num" style={{ fontSize: 12 }}>{num(x.tokens)} · {x.venue}</div></div>
          <b className="num">{usd(x.usdc, 2)}</b>
        </div>
      ))}
    </>
  );
}

// ---------- Profile ----------
function Profile({ wallet }: { wallet?: string }) {
  const w = (wallet ?? HW.hotAddress() ?? "").toLowerCase();
  const [p, setP] = useState<{ profile?: Record<string, unknown>; stats?: Record<string, number | null> } | null>(null);
  const [rows, setRows] = useState<(Trade & { token: string; symbol?: string })[]>([]);
  useEffect(() => { if (!isAddr(w)) return; fetch(`https://bot-production-4200.up.railway.app/api/profile?wallet=${w}`).then((r) => r.json()).then(setP).catch(() => setP({})); api.walletTrades(w, 40).then((r) => setRows(r as typeof rows)).catch(() => undefined); }, [w]);
  const s = p?.stats ?? {}; const pr = p?.profile ?? {};
  return (
    <>
      <Header title={String(pr.display ?? pr.handle ?? short(w, 5))} back right={<button className="icon-btn" onClick={() => { navigator.clipboard?.writeText(w); toast("Address copied", "ok"); }}><Icon.copy className="" /></button>} />
      {!isAddr(w) ? <div className="empty">No wallet.</div> : (
        <>
          <div className="tiles"><div className="tile"><small>PnL</small><b className={(s.pnl_total ?? 0) >= 0 ? "up" : "down"}>{s.pnl_total != null ? `${s.pnl_total >= 0 ? "+" : "−"}${usd(Math.abs(s.pnl_total))}` : "—"}</b></div><div className="tile"><small>Volume</small><b>{usd(s.volume)}</b></div><div className="tile"><small>Trades</small><b>{num(s.trades)}</b></div><div className="tile"><small>Win</small><b>{s.winrate != null ? `${Math.round(s.winrate * 100)}%` : "—"}</b></div></div>
          {pr.bio ? <div className="card muted" style={{ fontSize: 13.5 }}>{String(pr.bio)}</div> : null}
          {w !== (HW.hotAddress() ?? "").toLowerCase() && <div style={{ padding: "0 14px 10px" }}><button className="btn primary" onClick={() => openUrl(`https://t.me/ArcSniper_bot?start=copy_${w.replace(/^0x/, "")}`)}>Copy-trade in @ArcSniper_bot</button></div>}
          <div className="label">Recent trades</div>
          {rows.map((x) => <div key={x.tx + x.ts} className="trade-row" style={{ gridTemplateColumns: "44px 1fr auto" }} onClick={() => go(`/token/${x.token}`)}><span className="muted num">{ago(x.ts)}</span><div><b className={x.side === "buy" ? "up" : "down"}>{x.side.toUpperCase()}</b> <b>{x.symbol ?? short(x.token)}</b></div><b className="num">{usd(x.usdc, 2)}</b></div>)}
        </>
      )}
    </>
  );
}

// ---------- Settings ----------
function Settings() {
  const prefs = useStore(getPrefs);
  const [pre, setPre] = useState(prefs.presets.join(", "));
  return (
    <>
      <Header title="Settings" back />
      <div className="label">Trading</div>
      <div className="card">
        <div className="kv" style={{ borderTop: 0 }}><span>Sell slippage</span><div style={{ display: "flex", gap: 6 }}>{[1, 3, 5, 10].map((s) => <button key={s} className={`pill ${prefs.slippage === s ? "green" : ""}`} onClick={() => setPrefs({ slippage: s })}>{s}%</button>)}</div></div>
        <div className="kv"><span>Quick-buy default</span><div style={{ display: "flex", gap: 6 }}>{prefs.presets.map((s) => <button key={s} className={`pill ${prefs.quickBuy === s ? "green" : ""}`} onClick={() => setPrefs({ quickBuy: s })}>{s}</button>)}</div></div>
        <div className="kv" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}><span>Preset amounts (USDC)</span><div className="field" style={{ padding: "8px 12px" }}><input value={pre} onChange={(e) => setPre(e.target.value)} onBlur={() => { const v = pre.split(",").map((x) => Number(x.trim())).filter((x) => x > 0).slice(0, 4); if (v.length) setPrefs({ presets: v, quickBuy: v.includes(prefs.quickBuy) ? prefs.quickBuy : v[0] }); }} inputMode="decimal" /></div></div>
        <div className="kv"><span>Buy slippage</span><b className="muted">none — buys fill at any price</b></div>
      </div>
      <div className="label">Lists</div>
      <div className="card">
        <div className="kv" style={{ borderTop: 0 }}><span>Hide clone farms</span><button className={`pill ${prefs.hideClones ? "green" : ""}`} onClick={() => setPrefs({ hideClones: !prefs.hideClones })}>{prefs.hideClones ? "on" : "off"}</button></div>
      </div>
      <div className="label">About</div>
      <div className="card muted" style={{ fontSize: 12.5 }}>ArcTools for Android v1.3 · arctools.fun · Fees fund ARCT buybacks that burn in the same transaction. Your key never leaves this phone. Internal review only — no third-party audit.</div>
    </>
  );
}
