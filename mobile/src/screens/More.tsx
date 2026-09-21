import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { go } from "../lib/router";
import { Header, Icon } from "../components/ui";
import { openUrl } from "../lib/native";
import { APP_VERSION } from "../App";

const ITEMS: [string, string, keyof typeof Icon][] = [
  ["/archy", "Ask Archy", "eye"], ["/trades", "Live trades", "bolt"], ["/traders", "Top traders", "users"], ["/insiders", "Insiders", "eye"],
  ["/alerts", "Alerts", "bell"], ["/launchpad", "Launch", "rocket"], ["/pay", "Pay links", "link"],
  ["/referrals", "Referrals", "gift"], ["/bridge", "Bridge", "bridge"], ["/rewards", "ARCT", "flame"],
  ["/history", "History", "chart"], ["/profile", "Profile", "user"], ["/settings", "Settings", "gear"],
];

export default function More() {
  const [chain, setChain] = useState<{ last_block: number; index_lag_s: number | null } | null>(null);
  useEffect(() => { api.chain().then(setChain).catch(() => undefined); const id = setInterval(() => api.chain().then(setChain).catch(() => undefined), 10_000); return () => clearInterval(id); }, []);
  return (
    <>
      <Header title="More" />
      <div className="tilegrid">
        {ITEMS.map(([to, title, ic]) => { const Ic = Icon[ic]; return (
          <button key={to} className="tilebtn" onClick={() => go(to)}><Ic className="" /><span>{title}</span></button>
        ); })}
      </div>
      <div className="card" style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }} >
        <span className="muted">Arc network</span>
        <span className="num">block {chain?.last_block?.toLocaleString("en-US") ?? "…"} · index {chain ? `${chain.index_lag_s ?? 0}s` : "…"} <span style={{ color: (chain?.index_lag_s ?? 99) < 15 ? "var(--up)" : "var(--amber)" }}>●</span></span>
      </div>
      <div className="label">Community</div>
      <div className="grid4" style={{ padding: "0 14px 12px" }}>
        {([["𝕏", "X", "https://x.com/ArcToolsBackup"], ["TG", "Portal", "https://t.me/ArcToolsPortal"], ["TG", "Trends", "https://t.me/ARCTrends"], ["TG", "Sniper", "https://t.me/ArcSniper_bot"]] as const).map(([ic, l, u]) => (
          <button key={u} className="action" onClick={() => openUrl(u)}><span className="icon-btn" style={{ fontWeight: 800, fontSize: 13 }}>{ic}</span>{l}</button>
        ))}
      </div>
      <div className="brandfoot"><b>ArcOne</b><span>powered by ArcTools</span><small>v{APP_VERSION} · arctools.fun · fees fund ARCT buyback & burn</small></div>
    </>
  );
}
