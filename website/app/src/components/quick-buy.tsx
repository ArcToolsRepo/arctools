import { useEffect, useState } from "react";

import { hasWallet, hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { creditRef } from "@/lib/arc-ref";
import { routeSwap } from "@/lib/arc-route";
import { ARC_AGGREGATOR, encodeAggregatorSwap } from "@/lib/arc-wallet";

const KEY = "arctools_quickbuy";
export function quickAmount(): number {
  try { return Number(localStorage.getItem(KEY) ?? "5") || 5; } catch { return 5; }
}
export function setQuickAmount(v: number) {
  try { localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
}

/** ⚡ one-click buy through the in-browser trading wallet (unlocked on /trade). Falls back to a link to /trade. */
export function QuickBuy({ token, symbol, compact = false }: { token: string; symbol: string; compact?: boolean }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [amt, setAmt] = useState(5);
  useEffect(() => {
    setReady(isUnlocked()); setAmt(quickAmount());
    return onHotChange(() => setReady(isUnlocked()));
  }, []);
  const run = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const addr = hotAddress();
    // no unlocked trading wallet: the token page has the full swap panel (connect wallet or open the trading wallet there)
    if (!ready || !addr) { window.location.href = `/token/${token}?buy=1`; return; }
    setBusy(true); setMsg(null);
    try {
      const spend = (BigInt(Math.round(amt * 1e6)) * 10n ** 12n * 1000n) / 1015n;
      const r = await routeSwap({ data: { token, side: "buy", amount: spend.toString() } });
      if (r.error || r.legs.length === 0) throw new Error(r.error === "no venue" ? "no pool yet" : r.error ?? "no pool yet");
      const minOut = r.unquoted ? 0n : (BigInt(r.out) * 90n) / 100n;   // 10% slippage for one-click; no quote (RPC busy) → market
      if (r.unquoted) setMsg({ ok: true, text: "no quote · market" });
      const legs = r.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      const h = await hotSend({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("buy", token, legs, minOut, addr, 150), value: spend + (spend * 15n) / 1000n });
      setMsg({ ok: true, text: "sent…" });
      const rc = await hotWait(h);
      setMsg({ ok: rc.status === 1, text: rc.status === 1 ? `bought ${symbol}` : "reverted" });
      if (rc.status === 1) creditRef(addr, h, Number(spend) / 1e18 * 0.015);
    } catch (err) { setMsg({ ok: false, text: (err as Error).message.slice(0, 40) }); }
    setBusy(false);
    setTimeout(() => setMsg(null), 6000);
  };
  const label = msg ? msg.text : busy ? "…" : ready ? `⚡ ${amt}` : hasWallet() ? "⚡ unlock" : "⚡ buy";
  return (
    <button
      className="arc-mono"
      disabled={busy}
      onClick={run}
      style={{ background: msg ? (msg.ok ? "rgba(34,197,128,0.18)" : "rgba(240,83,79,0.18)") : ready ? "var(--arc-up)" : "transparent", border: "1px solid " + (msg && !msg.ok ? "#f0534f" : "var(--arc-up)"), borderRadius: 4, color: msg ? (msg.ok ? "var(--arc-up)" : "#f0534f") : ready ? "#06130b" : "var(--arc-up)", cursor: "pointer", fontSize: compact ? 11 : 12, fontWeight: 700, padding: compact ? "3px 8px" : "5px 10px", whiteSpace: "nowrap" }}
      title={ready ? `Buy ${amt} USDC of ${symbol} with the trading wallet (best venue, 10% max slippage)` : "Open the token page to buy (connect a wallet or unlock the trading wallet)"}
      type="button"
    >
      {label}
    </button>
  );
}
