import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { hotAddress, hotSignMessage, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { claimRef } from "@/lib/arc-ref";
import { connectWallet, getStoredWallet, onWalletChange } from "@/lib/arc-wallet";
import "../arc-site.css";

const API = "https://bot-production-4200.up.railway.app";
type Stats = { code: string; share: number; referred: number; trades: number; fees_usd: number; earned_usd: number; paid_usd: number; pending_usd: number; payout_wallet: string | null; link_bot: string; link_site: string; recent: { source: string; tx: string; fee_usd: number; share_usd: number; ts: number }[] };

export const Route = createFileRoute("/referrals")({
  head: () => ({ meta: [{ title: "Referrals: earn 25% of ArcTools fees" }, { name: "description", content: "Share your link. Earn 25% of the platform fee on every trade of everyone you bring, on the Terminal and in the sniper bot, paid in USDC." }] }),
  component: Referrals,
});

function Referrals() {
  const [addr, setAddr] = useState<string | null>(null);
  const [st, setSt] = useState<Stats | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [claim, setClaim] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });
  const [payer, setPayer] = useState<{ payer: string | null; balance_usd: number | null; min_claim_usd: number } | null>(null);
  useEffect(() => { fetch(`${API}/api/ref/claim-info`).then((r) => r.json()).then(setPayer).catch(() => null); }, []);
  const doClaim = async () => {
    if (!addr) return;
    setClaim({ busy: true, msg: null, ok: false });
    try {
      // sign with whichever wallet owns the code: the trading wallet when unlocked and it IS this address, else the browser wallet
      const sign = async (msg: string) => {
        if (isUnlocked() && hotAddress()?.toLowerCase() === addr.toLowerCase()) return hotSignMessage(msg);
        const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
        if (!eth) throw new Error("No wallet to sign with.");
        return (await eth.request({ method: "personal_sign", params: [msg, addr] })) as string;
      };
      const r = await claimRef(addr, sign);
      if (r.ok) setClaim({ busy: false, ok: true, msg: `Sent ${r.usd?.toFixed(4)} USDC · tx ${r.tx?.slice(0, 12)}…` });
      else setClaim({ busy: false, ok: false, msg: r.error ?? "claim failed" });
    } catch (e) { setClaim({ busy: false, ok: false, msg: (e as Error).message.slice(0, 80) }); }
  };
  useEffect(() => {
    const pick = () => setAddr(getStoredWallet() ?? hotAddress());
    pick(); const a = onWalletChange(pick); const b = onHotChange(pick); return () => { a(); b(); };
  }, []);
  useEffect(() => {
    if (!addr) { setSt(null); return; }
    let alive = true;
    const load = () => fetch(`${API}/api/ref/stats?wallet=${addr.toLowerCase()}`).then((r) => r.json()).then((j) => alive && setSt(j)).catch(() => null);
    void load(); const id = setInterval(load, 20_000); return () => { alive = false; clearInterval(id); };
  }, [addr]);
  const copy = (t: string, k: string) => { void navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(null), 1500); };
  const usd = (n: number | undefined) => `$${(n ?? 0).toFixed(2)}`;
  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/referrals" />
      <section className="arc-section" style={{ maxWidth: 900, paddingTop: 112 }}>
        <p className="arc-eyebrow">REFERRALS</p>
        <h1 className="arc-h2" style={{ fontSize: 30 }}>Earn 25% of the fees, forever</h1>
        <p className="arc-body" style={{ maxWidth: 700 }}>
          Every trade of everyone who joins through your link pays you a quarter of the platform fee: 1.5% per swap on the Terminal, 1% per trade in the sniper bot. No cap, no expiry. Claim your USDC any time — it is sent to your wallet on the spot.
        </p>
        {!addr ? (
          <div style={{ border: "1px dashed var(--arc-line)", borderRadius: 10, marginTop: 20, padding: 24, textAlign: "center" }}>
            <p className="arc-body" style={{ margin: "0 0 12px" }}>Connect a wallet (or unlock your trading wallet in the Terminal) to get your link.</p>
            <button className="arc-cta" onClick={() => void connectWallet().catch(() => null)} type="button">Connect wallet</button>
          </div>
        ) : !st ? <p className="arc-mono" style={{ color: "var(--arc-muted)" }}>Loading…</p> : (
          <>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 12, marginTop: 20, padding: 18 }}>
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 8px", textTransform: "uppercase" }}>Your code · <strong style={{ color: "var(--arc-ink)", fontSize: 14 }}>{st.code}</strong></p>
              {[["Terminal link", st.link_site, "site"], ["Sniper bot link", st.link_bot, "bot"]].map(([l, u, k]) => (
                <div key={k} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0" }}>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, width: 110 }}>{l}</span>
                  <code className="arc-mono" style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 6, flex: "1 1 320px", fontSize: 12, padding: "8px 10px" }}>{u}</code>
                  <button className="arc-mono" onClick={() => copy(u, k)} style={{ background: copied === k ? "var(--arc-up)" : "var(--arc-cobalt)", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, padding: "8px 14px" }} type="button">{copied === k ? "copied" : "copy"}</button>
                </div>
              ))}
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "10px 0 0" }}>Payout wallet: <code>{st.payout_wallet ?? addr}</code></p>
            </div>
            <div style={{ alignItems: "center", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: 12, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", marginTop: 14, padding: "14px 18px" }}>
              <div>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0, textTransform: "uppercase" }}>Claimable now</p>
                <p className="arc-mono" style={{ color: "var(--arc-up)", fontSize: 26, fontWeight: 700, margin: "2px 0 0" }}>{usd(st.pending_usd)}</p>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "4px 0 0" }}>
                  Native USDC, sent to your payout wallet the moment you claim · minimum {payer?.min_claim_usd ?? 1} USDC
                  {payer?.balance_usd != null ? <> · payout pool funded: ${payer.balance_usd.toFixed(2)}</> : null}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <button className="arc-cta" disabled={claim.busy || (st.pending_usd ?? 0) < (payer?.min_claim_usd ?? 1)} onClick={() => void doClaim()} style={{ opacity: (st.pending_usd ?? 0) < (payer?.min_claim_usd ?? 1) ? 0.5 : 1 }} type="button">{claim.busy ? "Signing…" : "Claim USDC"}</button>
                {claim.msg && <p className="arc-mono" style={{ color: claim.ok ? "var(--arc-up)" : "#f0534f", fontSize: 11, margin: "8px 0 0" }}>{claim.msg}</p>}
              </div>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 14 }}>
              {[["Referred", String(st.referred)], ["Their trades", String(st.trades)], ["Fees they paid", usd(st.fees_usd)], ["You earned", usd(st.earned_usd)], ["Paid out", usd(st.paid_usd)], ["Pending", usd(st.pending_usd)]].map(([k, v]) => (
                <div key={k} style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 8, padding: "10px 12px" }}>
                  <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0, textTransform: "uppercase" }}>{k}</p>
                  <p className="arc-mono" style={{ color: k === "Pending" ? "var(--arc-up)" : "var(--arc-ink)", fontSize: 18, fontWeight: 700, margin: "2px 0 0" }}>{v}</p>
                </div>
              ))}
            </div>
            {st.recent.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "0 0 6px", textTransform: "uppercase" }}>Recent credits</p>
                {st.recent.map((r) => (
                  <div className="arc-mono" key={r.tx} style={{ display: "flex", fontSize: 12, gap: 10, justifyContent: "space-between", padding: "4px 0" }}>
                    <span>{r.source} · <a href={`https://arc-scan.org/tx/${r.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{r.tx.slice(0, 10)}…</a></span>
                    <span style={{ color: "var(--arc-up)" }}>+{usd(r.share_usd)} <span style={{ color: "var(--arc-muted)" }}>of {usd(r.fee_usd)} fee</span></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 24 }}>
          How it works: the person you refer opens your link once; their wallet (site) or Telegram account (bot) is bound to your code for good. Self-referrals and re-binding are rejected. Credits appear within seconds of a confirmed trade.
        </p>
      </section>
    </main>
  );
}
