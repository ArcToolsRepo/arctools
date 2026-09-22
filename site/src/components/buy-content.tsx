import { createServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";

import { WalletPanel } from "@/components/wallet-panel";
import { routeSwap } from "@/lib/arc-route";
import { hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { ARC_AGGREGATOR, connectWallet, encodeAggregatorSwap, getStoredWallet, nativeBalance, onWalletChange, sendTx, tokenBalance, waitReceipt } from "@/lib/arc-wallet";

const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";
const FEE_BPS = 50;            // same as /swap — verified on-chain
const card: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 18 };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (units: bigint, dec: number, digits = 2) => (Number(units) / 10 ** dec).toLocaleString(undefined, { maximumFractionDigits: digits });

export const onrampLink = createServerFn({ method: "POST" })
  .inputValidator((d: { wallet: string; fiat: string; amount: number }) => d)
  .handler(async ({ data }) => {
    const { moonpayLink } = await import("@/lib/onramp.server");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip = (getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
    return moonpayLink({ ...data, ip });
  });

export const onrampQuote = createServerFn({ method: "POST" })
  .inputValidator((d: { fiat: string; amount: number }) => d)
  .handler(async ({ data }) => (await import("@/lib/onramp.server")).moonpayQuote(data));
export const onrampTxs = createServerFn({ method: "POST" })
  .inputValidator((d: { wallet: string }) => d)
  .handler(async ({ data }) => (await import("@/lib/onramp.server")).moonpayTransactions(data.wallet));

/** /buy and /buy2: card → USDC on Arc (MoonPay, delivered to the user's own wallet) → one-click swap to ARCT (aggregator). */
export function BuyContent({ v2 = false }: { v2?: boolean }) {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setAddr(isUnlocked() && hotAddress() ? hotAddress() : getStoredWallet());
    sync(); const a = onHotChange(sync); const b = onWalletChange(() => sync());
    return () => { a(); b(); };
  }, []);
  const useHot = !!addr && isUnlocked() && hotAddress()?.toLowerCase() === addr.toLowerCase();

  const [usdc, setUsdc] = useState<bigint | null>(null); const [arct, setArct] = useState<bigint | null>(null);
  const refresh = useCallback(async () => {
    if (!addr) return;
    const [u, t] = await Promise.all([nativeBalance(addr).catch(() => null), tokenBalance(ARCT, addr).catch(() => null)]);
    if (u != null) setUsdc(BigInt(Math.round(u * 1e6)) * 10n ** 12n);   // nativeBalance returns USDC as a float; keep 18-dec wei like the rest of the page
    if (t != null) setArct(t);
  }, [addr]);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 10_000); return () => clearInterval(t); }, [refresh]);

  return (
    <>
      <p className="arc-eyebrow">BUY ARCT</p>
      <h1 className="arc-h2" style={{ fontSize: 30 }}>Card → USDC on Arc → ARCT</h1>
      <p className="arc-body" style={{ maxWidth: 760 }}>
        Two steps, one page. Buy USDC with a card, Apple Pay or Google Pay through MoonPay (USDC on the Arc network) — it lands directly in your own wallet, we never hold it.
        Then swap it to ARCT here in one click (0.5 % fee, the same as /swap, spent on ARCT buyback and burn). Card purchases need MoonPay&apos;s ID check the first time; MoonPay&apos;s fee is shown inside its widget before you pay.
      </p>
      <div className="arc-pay-grid" style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", marginTop: 22 }}>
        <div style={card}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>1 · Buy USDC with a card</p>
          {!addr ? (
            <div style={{ border: "1px dashed var(--arc-line)", borderRadius: 10, padding: 20, textAlign: "center" }}>
              <p className="arc-body" style={{ margin: "0 0 12px" }}>The USDC goes to your wallet — unlock the trading wallet or connect a browser wallet first.</p>
              <button className="arc-cta" onClick={() => void connectWallet().catch(() => null)} type="button">Connect wallet</button>
              <div style={{ marginTop: 14, textAlign: "left" }}><WalletPanel onReady={(a) => setAddr(a)} /></div>
            </div>
          ) : <CardStep addr={addr} />}
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 14 }}>
            No card? Buy USDC on any exchange and withdraw it on the <strong>Arc</strong> network to {addr ? short(addr) : "your wallet"} — or to Base / Arbitrum and use the <a href={v2 ? "/bridge2" : "/bridge"} style={{ color: "var(--arc-cobalt)" }}>bridge</a>. Step 2 works the same.
          </p>
        </div>
        <div style={card}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>2 · Swap USDC → ARCT {addr ? `· ${short(addr)}` : ""}</p>
          {!addr ? <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13 }}>Connect to see your balance.</p>
            : <SwapStep addr={addr} useHot={useHot} usdc={usdc} arct={arct} onDone={refresh} />}
        </div>
      </div>
    </>
  );
}

function CardStep({ addr }: { addr: string }) {
  const [amount, setAmount] = useState(50); const [fiat, setFiat] = useState("usd");
  const [busy, setBusy] = useState(false); const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState<Awaited<ReturnType<typeof onrampQuote>> | null>(null);
  useEffect(() => {
    let alive = true; const h = setTimeout(() => { onrampQuote({ data: { fiat, amount } }).then((r) => { if (alive) setQ(r); }).catch(() => null); }, 400);
    return () => { alive = false; clearTimeout(h); };
  }, [fiat, amount]);
  const [txs, setTxs] = useState<Awaited<ReturnType<typeof onrampTxs>> | null>(null);
  useEffect(() => {
    let alive = true; const pull = () => onrampTxs({ data: { wallet: addr } }).then((r) => { if (alive) setTxs(r); }).catch(() => null);
    pull(); const t = setInterval(pull, 20_000); return () => { alive = false; clearInterval(t); };
  }, [addr]);
  const go = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await onrampLink({ data: { wallet: addr, fiat, amount } });
      if (!r.configured) setNote("Card purchases open as soon as our MoonPay account is approved. Until then: buy USDC on an exchange and withdraw it on Arc (see below).");
      else if (!r.url) setNote(r.reason ?? "could not build the link");
      else {
        if (r.mode === "public") { try { await navigator.clipboard.writeText(addr); } catch { /* clipboard blocked: the address is shown above */ } }
        window.open(r.url, "_blank", "noopener");
        setNote(r.mode === "public"
          ? `MoonPay opened in a new tab. Sign in, keep "USDC (Arc)" as the coin, and when it asks for the wallet address paste yours — it is already copied: ${addr}. The USDC shows up on the right within seconds of MoonPay sending it.`
          : "MoonPay opened in a new tab. When the purchase completes the USDC shows up on the right within a few seconds.");
      }
    } catch (e) { setNote(String((e as Error).message ?? e)); }
    setBusy(false);
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[20, 50, 100, 250, 500].map((v) => <button className="arc-mono" key={v} onClick={() => setAmount(v)} style={chip(amount === v)} type="button">{v}</button>)}
        <input className="arc-mono" min={20} onChange={(e) => setAmount(Number(e.target.value) || 0)} style={{ ...chip(false), width: 90 }} type="number" value={amount} />
        <select className="arc-mono" onChange={(e) => setFiat(e.target.value)} style={chip(false)} value={fiat}>
          {["usd", "eur", "pln", "gbp", "chf"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
        </select>
      </div>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>Your wallet on Arc: <span style={{ color: "var(--arc-ink)" }}>{addr}</span>
        <button className="arc-mono" onClick={() => { void navigator.clipboard.writeText(addr); setNote("Address copied."); }} style={{ ...chip(false), marginLeft: 8, padding: "2px 8px" }} type="button">Copy</button>
        <br />Paste it as the wallet address in MoonPay. Choose network <strong>Arc</strong> (USDC · Arc). Minimum 20, MoonPay ID check on first purchase.</p>
      {q?.configured && q.usdc != null && (
        <div className="arc-mono" style={{ border: "1px solid var(--arc-line)", borderRadius: 10, display: "grid", fontSize: 12, gap: 4, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>You receive</span><span style={{ color: "#22c580" }}>≈ {q.usdc.toFixed(2)} USDC {q.env === "sandbox" ? "(sandbox: Ethereum test USDC)" : "on Arc"}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>MoonPay fee</span><span>{(q.fee ?? 0).toFixed(2)} {fiat.toUpperCase()}{q.networkFee ? ` + ${q.networkFee.toFixed(2)} network` : ""}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Card limits</span><span>{q.min != null ? `${q.min}–${q.max} ${fiat.toUpperCase()}` : "—"}</span></div>
        </div>
      )}
      {q?.configured && q.reason && <p className="arc-mono" style={{ color: "#ffb054", fontSize: 12, margin: 0 }}>{q.reason}</p>}
      <button className="arc-cta" disabled={busy || amount < 20} onClick={() => void go()} type="button">{busy ? "…" : `Buy ${amount} ${fiat.toUpperCase()} of USDC with card`}</button>
      {note && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>{note}</p>}
      {txs?.configured && txs.txs.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0, textTransform: "uppercase" }}>Your card purchases</p>
          {txs.txs.slice(0, 5).map((x) => (
            <div className="arc-mono" key={x.id} style={{ display: "flex", fontSize: 12, gap: 10, justifyContent: "space-between" }}>
              <span>{x.fiat} {x.fiatCode.toUpperCase()} → {x.usdc != null ? `${x.usdc.toFixed(2)} USDC` : "…"}</span>
              <span style={{ color: x.status === "completed" ? "#22c580" : x.status === "failed" ? "#ff6a6a" : "#ffb054" }}>{x.status}{x.failureReason ? ` · ${x.failureReason}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SwapStep({ addr, useHot, usdc, arct, onDone }: { addr: string; useHot: boolean; usdc: bigint | null; arct: bigint | null; onDone: () => void }) {
  const [pct, setPct] = useState(100); const [quote, setQuote] = useState<{ out: bigint; legs: any[]; unquoted?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // keep ~0.3 USDC for gas; the fee (0.5 %) is charged on top of the spend
  const GAS_RESERVE = 3n * 10n ** 17n;   // 0.3 USDC (18-dec wei, like every balance on this page)
  const spendable = usdc != null ? (usdc - GAS_RESERVE > 0n ? usdc - GAS_RESERVE : 0n) : 0n;
  const spend = (spendable * BigInt(pct)) / 100n; const spendNet = (spend * 10_000n) / (10_000n + BigInt(FEE_BPS));
  useEffect(() => {
    if (spendNet <= 0n) { setQuote(null); return; }
    let alive = true;
    routeSwap({ data: { token: ARCT, side: "buy", amount: spendNet.toString() } })   // wei in, like /swap after its ×1e12
      .then((r) => { if (alive) setQuote({ out: BigInt(r.out || "0"), legs: r.legs ?? [], unquoted: (r as any).unquoted }); }).catch(() => alive && setQuote(null));
    return () => { alive = false; };
  }, [spendNet]);
  const swap = async () => {
    if (!quote || quote.legs.length === 0) return;
    setBusy("Swapping…"); setMsg(null);
    try {
      const legs = quote.legs.map((l: any) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      const minOut = quote.unquoted ? 0n : (quote.out * 97n) / 100n;      // 3 % slippage
      const value = spendNet; const total = value + (value * BigInt(FEE_BPS)) / 10_000n;
      const tx = { to: ARC_AGGREGATOR, data: encodeAggregatorSwap("buy", ARCT, legs, minOut, addr, FEE_BPS), value: total };
      const h = useHot ? await hotSend(tx) : await sendTx({ ...tx, from: addr });
      const rc = useHot ? await hotWait(h) : await waitReceipt(h);
      if ((rc as any).status !== 1 && (rc as any).status !== "0x1") throw new Error("swap reverted");
      setMsg({ ok: true, text: `Done — about ${fmt(quote.out, 18, 0)} ARCT. tx ${h.slice(0, 12)}…` }); onDone();
    } catch (e) { setMsg({ ok: false, text: String((e as Error).message ?? e) }); }
    setBusy(null);
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="arc-mono" style={{ display: "flex", fontSize: 13, justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>USDC in wallet</span><span>{usdc == null ? "…" : fmt(usdc, 18, 2)}</span></div>
      <div className="arc-mono" style={{ display: "flex", fontSize: 13, justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>ARCT in wallet</span><span>{arct == null ? "…" : fmt(arct, 18, 0)}</span></div>
      {spendable === 0n ? <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13, margin: "6px 0 0" }}>Waiting for USDC — this panel refreshes every 10 s and lights up when the purchase arrives.</p> : (
        <>
          <div style={{ display: "flex", gap: 8 }}>{[25, 50, 100].map((p) => <button className="arc-mono" key={p} onClick={() => setPct(p)} style={chip(pct === p)} type="button">{p}%</button>)}</div>
          <div className="arc-mono" style={{ display: "flex", fontSize: 13, justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>You swap</span><span>{fmt(spendNet, 18, 2)} USDC + {fmt(spend - spendNet, 18, 3)} fee</span></div>
          <div className="arc-mono" style={{ display: "flex", fontSize: 13, justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>You get about</span><span style={{ color: "#22c580" }}>{quote ? `${fmt(quote.out, 18, 0)} ARCT` : "…"}</span></div>
          <button className="arc-cta" disabled={!!busy || !quote || quote.legs.length === 0} onClick={() => void swap()} type="button">{busy ?? "Swap to ARCT"}</button>
        </>
      )}
      {msg && <p className="arc-mono" style={{ color: msg.ok ? "#22c580" : "#ff6a6a", fontSize: 12, margin: 0 }}>{msg.text}</p>}
    </div>
  );
}
const chip = (on: boolean): React.CSSProperties => ({ background: on ? "rgba(46,124,255,0.18)" : "transparent", border: `1px solid ${on ? "var(--arc-cobalt)" : "var(--arc-line)"}`, borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "6px 12px" });
