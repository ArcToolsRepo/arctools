import { useEffect, useState } from "react";

import { BOT_API } from "@/lib/bot-api";

/** Red strip under the ticker while Arc (or every public RPC) is down; disappears on its own when blocks flow again.
 *  Same source of truth as the Telegram announcements (buybot chain_status). */
type St = { down: boolean; since: number | null; last_block: number | null; stale_s: number; live_since: number | null };

export function ChainBanner() {
  const [st, setSt] = useState<St | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${BOT_API}/api/chain-status`).then((r) => r.json()).then((j: St) => { if (alive) setSt(j); }).catch(() => null);
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!st?.down) return null;
  const mins = st.since ? Math.max(1, Math.floor((Date.now() / 1000 - st.since) / 60)) : Math.floor(st.stale_s / 60);
  const dur = mins < 120 ? `${mins} min` : `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min`;
  return (
    <div className="arc-mono arc-chain-banner" role="status" style={{ alignItems: "center", background: "linear-gradient(90deg, rgba(240,83,79,0.22), rgba(240,83,79,0.10))", borderBottom: "1px solid rgba(240,83,79,0.55)", color: "var(--arc-ink)", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 10, justifyContent: "center", padding: "7px 14px" }}>
      <span style={{ background: "#f0534f", borderRadius: "50%", boxShadow: "0 0 0 3px rgba(240,83,79,0.25)", display: "inline-block", height: 8, width: 8 }} />
      <b>Arc chain is not producing blocks</b>
      <span style={{ color: "var(--arc-muted)" }}>down for {dur}{st.last_block ? ` · last block ${st.last_block.toLocaleString()}` : ""}</span>
      <span style={{ color: "var(--arc-muted)" }}>buys, alerts and orders resume automatically when Arc is back · updates every 5 min on <a href="https://t.me/ARCTrends" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">@ARCTrends</a></span>
    </div>
  );
}
