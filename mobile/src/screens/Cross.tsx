/** Buy from another chain: your ArcOne address is the same on every EVM chain. Send ETH there on Base / Arbitrum / …, then one
 *  tap pays Relay on that chain and Relay calls the ArcTools aggregator on Arc — the token lands in this wallet in seconds. */
import { useEffect, useState } from "react";
import * as HW from "../lib/arc-hotwallet";
import { toast } from "../lib/store";
import { Header } from "../components/ui";
import { Unlock } from "./Wallet";
import { buzzOk, openUrl } from "../lib/native";

const SITE = "https://arctools.fun";
type Origin = { id: number; name: string; native: string; usdc: boolean; rpc: string; explorer: string };
const ORIGINS: Origin[] = [
  { id: 8453, name: "Base", native: "ETH", usdc: true, rpc: "https://mainnet.base.org", explorer: "https://basescan.org/tx/" },
  { id: 42161, name: "Arbitrum", native: "ETH", usdc: true, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io/tx/" },
  { id: 1, name: "Ethereum", native: "ETH", usdc: true, rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io/tx/" },
  { id: 10, name: "Optimism", native: "ETH", usdc: true, rpc: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io/tx/" },
  { id: 56, name: "BNB Chain", native: "BNB", usdc: true, rpc: "https://bsc-dataseed.binance.org", explorer: "https://bscscan.com/tx/" },
  { id: 137, name: "Polygon", native: "POL", usdc: true, rpc: "https://polygon-rpc.com", explorer: "https://polygonscan.com/tx/" },
];
type Quote = { error?: string; payAmount: string; payFormatted: string; paySymbol: string; payUsd: number | null; tokenOut: string; legs: string[]; timeEstimate: number; relayFeeUsd: number; arcFeeUsd: number; steps: { id: string; tx: { to: string; data: string; value: string; chainId: number; gas?: string }; check: string }[] };
const PRESETS = [5, 10, 25, 50];
const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";

export default function Cross({ token: initial, sym: initialSym }: { token?: string; sym?: string }) {
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const me = HW.hotAddress();
  const [token, setToken] = useState(initial ?? ARCT); const [sym, setSym] = useState(initialSym ?? "");
  const [oi, setOi] = useState(0); const o = ORIGINS[oi];
  const [usdc, setUsdc] = useState(10); const [q, setQ] = useState<Quote | null>(null); const [quoting, setQuoting] = useState(false);
  const [bal, setBal] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<"idle" | "paying" | "filling" | "done" | "failed">("idle"); const [log, setLog] = useState<string[]>([]); const [arcTx, setArcTx] = useState<string | null>(null);
  useEffect(() => { if (!/^0x[0-9a-f]{40}$/.test(token)) { setSym(""); return; } fetch(`${SITE}/api/tokens`).then((r) => r.json()).then((l: { token: string; symbol: string }[]) => { const f = l.find((x) => x.token.toLowerCase() === token)?.symbol; if (f) setSym(f); }).catch(() => undefined); }, [token]);
  useEffect(() => { if (!me) return; let alive = true; const pull = () => HW.balanceOn(o.rpc, me).then((b) => { if (alive) setBal(b); }).catch(() => undefined); setBal(null); pull(); const t = setInterval(pull, 8000); return () => { alive = false; clearInterval(t); }; }, [o.rpc, me]);
  useEffect(() => {
    if (phase !== "idle" || !/^0x[0-9a-f]{40}$/.test(token)) return;
    const user = me ?? "0x000000000000000000000000000000000000dEaD"; let cancel = false; setQuoting(true);
    const t = setTimeout(() => fetch(`${SITE}/api/cross-quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, origin: o.id, payUsdc: false, token, usdc, to: user }) }).then((r) => r.json()).then((j) => { if (!cancel) { setQ(j); setQuoting(false); } }).catch((e) => { if (!cancel) { setQ({ error: String(e).slice(0, 80) } as Quote); setQuoting(false); } }), 400);
    return () => { cancel = true; clearTimeout(t); };
  }, [token, o.id, usdc, me, phase]);
  const need = q && !q.error ? BigInt(q.payAmount) : null; const short = need != null && bal != null && bal < need + need / 20n;
  const pay = async () => {
    if (!me || !HW.isUnlocked()) { toast("Unlock the wallet first", "err"); return; }
    setPhase("paying"); setLog([]); setArcTx(null);
    try {
      const fresh: Quote = await fetch(`${SITE}/api/cross-quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: me, origin: o.id, payUsdc: false, token, usdc, to: me }) }).then((r) => r.json());
      if (fresh.error) throw new Error(fresh.error); setQ(fresh);
      let check = "";
      for (const st of fresh.steps) {
        const h = await HW.hotSendOn(BigInt(o.id), o.rpc, { to: st.tx.to, data: st.tx.data, value: BigInt(st.tx.value), gasLimit: st.tx.gas ? (BigInt(st.tx.gas) * 13n) / 10n : undefined });
        setLog((l) => [...l, `Paid on ${o.name}: ${h.slice(0, 12)}…`]); if (st.check) check = st.check;
      }
      setPhase("filling"); const t0 = Date.now();
      for (;;) {
        const s = await fetch(`${SITE}/api/cross-quote?check=${encodeURIComponent(check)}`).then((r) => r.json());
        if (s.status === "success") { setArcTx(s.txHashes?.[0] ?? null); setPhase("done"); buzzOk(); setLog((l) => [...l, `Bought ${sym || "token"} on Arc in ${((Date.now() - t0) / 1000).toFixed(1)} s`]); toast(`Bought ${sym || "token"}`, "ok"); return; }
        if (s.status === "failure" || s.status === "refund") { setPhase("failed"); setLog((l) => [...l, s.status === "refund" ? "Arc swap could not execute — Relay refunded USDC on Arc to this wallet." : `Fill failed: ${s.details || "unknown"}`]); return; }
        if (Date.now() - t0 > 180_000) { setPhase("failed"); setLog((l) => [...l, "Still pending after 3 minutes."]); return; }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) { setPhase("failed"); setLog((l) => [...l, String((e as Error).message ?? e).slice(0, 160)]); }
  };
  const fmt = (w: bigint) => (Number(w) / 1e18).toLocaleString(undefined, { maximumSignificantDigits: 5 });
  const tokens = q && !q.error ? Number(BigInt(q.tokenOut)) / 1e18 : 0;
  return (
    <>
      <Header title="Buy from another chain" back />
      <div className="launch" style={{ display: "grid", gap: 10 }}>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Your ArcOne address works on every EVM chain. Send ETH to it on Base or Arbitrum (or BNB / POL on their chains), then one tap: Relay bridges and buys through the ArcTools aggregator on Arc. Same 1.5 % fee as Quick Buy plus Relay's fee (about 5 cents).</p>
        {!HW.isUnlocked() && <Unlock />}
        <div className="seg" style={{ padding: 0 }}>{ORIGINS.map((x, i) => <button className={"chip" + (i === oi ? " on" : "")} key={x.id} onClick={() => setOi(i)}>{x.name}</button>)}</div>
        {me && (
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}><span className="muted">Your balance on {o.name}</span><b className="mono">{bal == null ? "…" : `${fmt(bal)} ${o.native}`}</b></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 12, alignItems: "center" }}><span className="muted">Fund it: send {o.native} on {o.name} to</span><button className="chip" onClick={() => { navigator.clipboard?.writeText(me); toast("Address copied", "ok"); }}>{me.slice(0, 8)}…{me.slice(-6)} ⧉</button></div>
          </div>
        )}
        <div className="card">
          <div className="launch__label">Token on Arc</div>
          <div className="field"><input onChange={(e) => setToken(e.target.value.trim().toLowerCase())} placeholder="0x… contract address" value={token} /></div>
          {sym && <div className="muted" style={{ fontSize: 12 }}>{sym}</div>}
          <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}><span className="muted" style={{ fontSize: 11 }}>BUY</span>{PRESETS.map((v) => <button className={"chip" + (usdc === v ? " on" : "")} key={v} onClick={() => setUsdc(v)}>{v}</button>)}<div className="field" style={{ padding: "6px 10px", width: 80 }}><input inputMode="decimal" onChange={(e) => setUsdc(Math.max(0, Number(e.target.value) || 0))} value={usdc} /></div><span className="muted" style={{ fontSize: 11 }}>USDC</span></div>
        </div>
        <div className="card mono" style={{ fontSize: 12 }}>
          {q?.error ? <span style={{ color: "var(--down)" }}>{q.error}</span> : q ? (<>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">You pay on {o.name}</span><b>{q.payFormatted} {q.paySymbol} <span className="muted">{q.payUsd != null ? `≈ $${q.payUsd.toFixed(2)}` : ""}</span></b></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">You get on Arc</span><b style={{ color: "var(--up)" }}>≈ {tokens.toLocaleString(undefined, { maximumFractionDigits: tokens > 1000 ? 0 : 2 })} {sym}</b></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Route</span><span>{q.legs.join(" + ")}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Fees</span><span>Relay ${q.relayFeeUsd.toFixed(3)} · ArcTools ${q.arcFeeUsd.toFixed(3)}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Time</span><span>~{Math.max(q.timeEstimate, 3)} s{quoting ? " · refreshing" : ""}</span></div>
          </>) : <span className="muted">{quoting ? "Quoting…" : "Enter a token"}</span>}
        </div>
        {phase === "done" ? <button className="btn primary" onClick={() => setPhase("idle")}>Done — buy again</button>
          : <button className="btn primary" disabled={!me || !q || !!q.error || quoting || phase === "paying" || phase === "filling" || short} onClick={pay}>{phase === "paying" ? "Paying…" : phase === "filling" ? "Filling on Arc…" : short ? `Not enough ${o.native} on ${o.name}` : q && !q.error ? `Pay ${q.payFormatted} ${q.paySymbol} on ${o.name}` : "…"}</button>}
        {log.length > 0 && <div className="card" style={{ fontSize: 12, color: phase === "failed" ? "var(--down)" : "var(--muted)" }}>{log.map((l, i) => <div key={i}>{l}</div>)}{arcTx && <button className="chip" onClick={() => openUrl(`https://arc-scan.org/tx/${arcTx}`)}>Arc transaction</button>}</div>}
        <p className="muted" style={{ fontSize: 10.5, margin: 0 }}>Bridging by Relay (relay.link). If the Arc swap cannot execute, Relay refunds native USDC on Arc to this wallet — not {o.native} on {o.name}.</p>
      </div>
    </>
  );
}
