import { useEffect, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";

import { BOT_API } from "@/lib/bot-api";

/** Red strip under the ticker while Arc (or every public RPC) is down; disappears on its own when blocks flow again.
 *  Same source of truth as the Telegram announcements (buybot chain_status). */
type St = { down: boolean; since: number | null; last_block: number | null; stale_s: number; live_since: number | null };

const rootApi = getRouteApi("__root__");

export function ChainBanner() {
  let initial: St | null = null;
  try { initial = ((rootApi.useLoaderData() as { chain?: St | null } | undefined)?.chain) ?? null; } catch { initial = null; }
  const [st, setSt] = useState<St | null>(initial);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${BOT_API}/api/chain-status`).then((r) => r.json()).then((j: St) => { if (alive) setSt(j); }).catch(() => null);
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  // html class drives the layout offsets (content + fixed prefs bar) in arc-site.css
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("arc-chain-down", !!st?.down);
    if (!st?.down || !box.current) { root.style.removeProperty("--arc-banner-h"); return; }
    const set = () => root.style.setProperty("--arc-banner-h", `${box.current?.offsetHeight ?? 34}px`);
    set();
    const ro = new ResizeObserver(set); ro.observe(box.current);
    return () => { ro.disconnect(); root.classList.remove("arc-chain-down"); root.style.removeProperty("--arc-banner-h"); };
  }, [st?.down]);
  if (!st?.down) return null;
  const mins = st.since ? Math.max(1, Math.floor((Date.now() / 1000 - st.since) / 60)) : Math.floor(st.stale_s / 60);
  const dur = mins < 120 ? `${mins} min` : `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min`;
  return (
    <div className="arc-mono arc-chain-banner" ref={box} role="status" style={{ alignItems: "center", background: "linear-gradient(90deg, rgba(240,83,79,0.22), rgba(240,83,79,0.10))", borderBottom: "1px solid rgba(240,83,79,0.55)", color: "var(--arc-ink)", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 10, justifyContent: "center", padding: "7px 14px" }}>
      <span style={{ background: "#f0534f", borderRadius: "50%", boxShadow: "0 0 0 3px rgba(240,83,79,0.25)", display: "inline-block", height: 8, width: 8 }} />
      <b>Arc chain is not producing blocks</b>
      <span style={{ color: "var(--arc-muted)" }}>down for {dur}{st.last_block ? ` · last block ${st.last_block.toLocaleString()}` : ""}</span>
      <span style={{ color: "var(--arc-muted)" }}>trading resumes automatically when Arc is back · <a href="https://t.me/ARCTrends" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">@ARCTrends</a></span>
    </div>
  );
}
