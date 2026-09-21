import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { go } from "../lib/router";
import { Header, Icon } from "../components/ui";

const ITEMS: [string, string, keyof typeof Icon][] = [
  ["/trades", "Live trades", "bolt"], ["/traders", "Top traders", "users"], ["/insiders", "Insiders", "eye"],
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
      <div className="empty" style={{ padding: 20, fontSize: 12 }}>ArcTools for Android · arctools.fun · fees: 0.5% swap, 1% sniper, 2% bridge → ARCT buyback & burn</div>
    </>
  );
}
