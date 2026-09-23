import { useEffect, useRef, useState } from "react";

import { crossQuote, crossStatus, ORIGINS, type CrossQuote } from "@/lib/arc-cross";
import { hotAddress, isUnlocked } from "@/lib/arc-hotwallet";
import { getEth, getStoredWallet, listWallets } from "@/lib/arc-wallet";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const PRESETS = [5, 10, 25, 50, 100];
const KEY = "arctools_cross_origin";

/** "Pay from another chain": one signature on Base / Arbitrum / Ethereum / OP / BNB / Polygon, token arrives on Arc in seconds. */
export function CrossBuy({ token, symbol, onClose }: { token: string; symbol: string; onClose: () => void }) {
  const [origin, setOrigin] = useState(() => { try { return Number(localStorage.getItem(KEY) ?? 8453) || 8453; } catch { return 8453; } });
  const [payUsdc, setPayUsdc] = useState(false);
  const [usdc, setUsdc] = useState(10);
  const [wallet, setWallet] = useState<string | null>(null);
  const [toHot, setToHot] = useState(false);
  const [q, setQ] = useState<CrossQuote | null>(null); const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "filling" | "done" | "failed">("idle");
  const [log, setLog] = useState<string[]>([]); const [arcTx, setArcTx] = useState<string | null>(null);
  const live = useRef(true); useEffect(() => () => { live.current = false; }, []);
  const o = ORIGINS.find((x) => x.id === origin)!;
  const hot = isUnlocked() ? hotAddress() : null;
  const recipient = toHot && hot ? hot : wallet;
  useEffect(() => { setWallet(getStoredWallet()); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, String(origin)); } catch { /* ignore */ } }, [origin]);

  // live quote: whenever inputs change (debounced); the address used for the quote only needs to be a valid EOA
  useEffect(() => {
    if (phase !== "idle") return;
    const user = wallet ?? "0x000000000000000000000000000000000000dEaD"; const to = recipient ?? user;
    let cancel = false; setQuoting(true);
    const t = setTimeout(() => crossQuote({ data: { user, origin, payUsdc, token, usdc, to } }).then((r) => { if (!cancel) { setQ(r); setQuoting(false); } }).catch((e) => { if (!cancel) { setQ({ error: String((e as Error).message ?? e).slice(0, 80) } as CrossQuote); setQuoting(false); } }), 350);
    return () => { cancel = true; clearTimeout(t); };
  }, [origin, payUsdc, token, usdc, wallet, recipient, phase]);

  const connect = async () => {
    const eth = getEth() as Eth | null; if (!eth) { setLog(["No browser wallet found. Install MetaMask or Rabby."]); return; }
    try { const a = (await eth.request({ method: "eth_requestAccounts" })) as string[]; setWallet(a[0]); } catch { setLog(["Connection cancelled."]); }
  };
  const ensureChain = async (eth: Eth) => {
    const cur = (await eth.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
    if (cur && BigInt(cur) === BigInt(o.hex)) return;
    try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: o.hex }] }); }
    catch (e) { if ((e as { code?: number }).code === 4001) throw new Error(`Switch your wallet to ${o.name} to continue.`); throw new Error(`Add ${o.name} to your wallet first.`); }
  };
  const pay = async () => {
    if (!wallet || !q || q.error || !recipient) return;
    const eth = getEth() as Eth | null; if (!eth) return;
    setPhase("signing"); setLog([]); setArcTx(null);
    try {
      await ensureChain(eth);
      // re-quote with the real payer/recipient right before signing (prices move; the quote above may have used a placeholder)
      const fresh = await crossQuote({ data: { user: wallet, origin, payUsdc, token, usdc, to: recipient } });
      if (fresh.error) throw new Error(fresh.error);
      setQ(fresh);
      let check = "";
      for (const st of fresh.steps) {
        setLog((l) => [...l, st.id === "approve" ? `Approve USDC on ${o.name} in your wallet…` : `Confirm the payment on ${o.name} in your wallet…`]);
        const h = (await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: st.tx.to, data: st.tx.data, value: "0x" + BigInt(st.tx.value).toString(16), ...(st.tx.gas ? { gas: "0x" + BigInt(st.tx.gas).toString(16) } : {}) }] })) as string;
        setLog((l) => [...l, `${st.id === "approve" ? "Approval" : "Payment"} sent: ${h.slice(0, 10)}…`]);
        if (st.check) check = st.check;
        if (st.id === "approve") { await waitOrigin(eth, h); }
      }
      setPhase("filling"); setLog((l) => [...l, "Relay is filling on Arc…"]);
      const t0 = Date.now();
      while (live.current) {
        const s = await crossStatus({ data: { check } });
        if (s.status === "success") { setArcTx(s.txHashes.find((x) => x) ?? null); setPhase("done"); setLog((l) => [...l, `Bought ${symbol} on Arc in ${((Date.now() - t0) / 1000).toFixed(1)} s.`]); return; }
        if (s.status === "failure" || s.status === "refund") { setPhase("failed"); setLog((l) => [...l, s.status === "refund" ? "The Arc swap could not be executed — Relay refunded USDC on Arc to your address." : `Fill failed: ${s.details || "unknown"}`]); return; }
        if (Date.now() - t0 > 180_000) { setPhase("failed"); setLog((l) => [...l, "Still pending after 3 minutes — check the status link below."]); return; }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) { setPhase("failed"); setLog((l) => [...l, String((e as Error).message ?? e).slice(0, 160)]); }
  };
  const waitOrigin = async (eth: Eth, h: string) => { for (let i = 0; i < 60; i++) { const rc = (await eth.request({ method: "eth_getTransactionReceipt", params: [h] })) as { status?: string } | null; if (rc) { if (rc.status !== "0x1") throw new Error("approval reverted"); return; } await new Promise((r) => setTimeout(r, 2000)); } };
  const usd = (n: number | null) => n == null ? "" : `≈ $${n.toFixed(2)}`;
  const tokens = q && !q.error ? Number(BigInt(q.tokenOut)) / 1e18 : 0;
  const box: React.CSSProperties = { background: "var(--arc-paper, #0b0e13)", border: "1px solid var(--arc-line)", borderRadius: 8, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", maxWidth: 480, padding: 18, width: "100%" };
  const chip = (on: boolean): React.CSSProperties => ({ background: on ? "rgba(34,197,128,0.16)" : "transparent", border: "1px solid " + (on ? "var(--arc-up)" : "var(--arc-line)"), borderRadius: 4, color: on ? "var(--arc-up)" : "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "5px 9px" });
  return (
    <div onClick={onClose} role="dialog" style={{ alignItems: "center", background: "rgba(0,0,0,0.6)", display: "flex", inset: 0, justifyContent: "center", padding: 16, position: "fixed", zIndex: 1000 }}>
      <div className="arc-mono" onClick={(e) => e.stopPropagation()} style={box}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <b style={{ fontSize: 14 }}>Buy {symbol} from another chain</b>
          <button onClick={onClose} style={{ background: "none", border: 0, color: "var(--arc-muted)", cursor: "pointer", fontSize: 18 }} type="button">×</button>
        </div>
        <p style={{ color: "var(--arc-muted)", fontSize: 11.5, lineHeight: 1.45, margin: "6px 0 12px" }}>One signature on the chain where your money is. Relay bridges it and calls the ArcTools aggregator on Arc; the token lands in your wallet in a few seconds. Same 1.5 % ArcTools fee as Quick Buy, plus Relay's fee shown below.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{ORIGINS.map((x) => <button key={x.id} onClick={() => setOrigin(x.id)} style={chip(origin === x.id)} type="button">{x.name}</button>)}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button onClick={() => setPayUsdc(false)} style={chip(!payUsdc)} type="button">pay in {o.native}</button>
          {o.usdc && <button onClick={() => setPayUsdc(true)} style={chip(payUsdc)} type="button">pay in USDC</button>}
        </div>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          <span style={{ color: "var(--arc-muted)", fontSize: 11 }}>BUY</span>
          {PRESETS.map((v) => <button key={v} onClick={() => setUsdc(v)} style={chip(usdc === v)} type="button">{v}</button>)}
          <input inputMode="decimal" onChange={(e) => setUsdc(Math.max(0, Number(e.target.value) || 0))} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-ink)", fontSize: 12, padding: "5px 8px", width: 72 }} value={usdc} />
          <span style={{ color: "var(--arc-muted)", fontSize: 11 }}>USDC of {symbol}</span>
        </div>
        <div style={{ background: "var(--arc-panel, rgba(255,255,255,0.04))", border: "1px solid var(--arc-line)", borderRadius: 6, fontSize: 12, lineHeight: 1.7, marginTop: 12, padding: "10px 12px" }}>
          {quoting && !q ? <span style={{ color: "var(--arc-muted)" }}>Quoting…</span> : q?.error ? <span style={{ color: "#f0534f" }}>{q.error}</span> : q ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>You pay on {o.name}</span><b>{q.payFormatted} {q.paySymbol} <span style={{ color: "var(--arc-muted)", fontWeight: 400 }}>{usd(q.payUsd)}</span></b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>You get on Arc</span><b style={{ color: "var(--arc-up)" }}>≈ {tokens.toLocaleString(undefined, { maximumFractionDigits: tokens > 1000 ? 0 : 2 })} {symbol}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Route</span><span>{q.legs.join(" + ")}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Fees</span><span>Relay ${q.relayFeeUsd.toFixed(3)} · ArcTools ${q.arcFeeUsd.toFixed(3)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Time</span><span>~{Math.max(q.timeEstimate, 3)} s{quoting ? " · refreshing…" : ""}</span></div>
            </>
          ) : null}
        </div>
        {hot && wallet && hot.toLowerCase() !== wallet.toLowerCase() && (
          <label style={{ alignItems: "center", color: "var(--arc-muted)", display: "flex", fontSize: 11.5, gap: 6, marginTop: 10 }}>
            <input checked={toHot} onChange={(e) => setToHot(e.target.checked)} type="checkbox" /> deliver to my trading wallet ({hot.slice(0, 6)}…{hot.slice(-4)}) instead of {wallet.slice(0, 6)}…
          </label>
        )}
        <div style={{ marginTop: 12 }}>
          {!wallet ? <button className="arc-cta" onClick={connect} style={{ width: "100%" }} type="button">Connect {listWallets()[0]?.name ?? "wallet"} ({o.name})</button>
            : phase === "idle" || phase === "failed" ? <button className="arc-cta" disabled={!q || !!q.error || quoting} onClick={() => void pay()} style={{ width: "100%" }} type="button">{q && !q.error ? `Pay ${q.payFormatted} ${q.paySymbol} on ${o.name}` : "…"}</button>
            : phase === "done" ? <button className="arc-cta" onClick={onClose} style={{ width: "100%" }} type="button">Done — bought {symbol}</button>
            : <button className="arc-cta" disabled style={{ opacity: 0.7, width: "100%" }} type="button">{phase === "signing" ? "Waiting for your wallet…" : "Filling on Arc…"}</button>}
        </div>
        {log.length > 0 && <div style={{ color: phase === "failed" ? "#f0534f" : "var(--arc-muted)", fontSize: 11.5, lineHeight: 1.6, marginTop: 10 }}>{log.map((l, i) => <div key={i}>{l}</div>)}{arcTx && <a href={`https://arc-scan.org/tx/${arcTx}`} rel="noreferrer" style={{ color: "var(--arc-up)" }} target="_blank">Arc transaction ↗</a>}</div>}
        <p style={{ color: "var(--arc-muted)", fontSize: 10.5, lineHeight: 1.5, margin: "12px 0 0" }}>Bridging by Relay (relay.link). If the Arc swap cannot execute, Relay refunds native USDC on Arc to the recipient address — not {o.native} on {o.name}. Recipient {recipient ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}` : "—"}.</p>
      </div>
    </div>
  );
}

/** Small entry under the swap panel header on token pages. */
export function CrossBuyLink({ token, symbol }: { token: string; symbol: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="arc-mono" onClick={() => setOpen(true)} style={{ background: "transparent", border: "1px dashed var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginBottom: 10, padding: "5px 9px", width: "100%" }} type="button">
        ⛓ Pay from another chain — ETH / USDC on Base, Arbitrum, Ethereum, OP, BNB, Polygon → {symbol} on Arc in seconds
      </button>
      {open && <CrossBuy onClose={() => setOpen(false)} symbol={symbol} token={token} />}
    </>
  );
}
