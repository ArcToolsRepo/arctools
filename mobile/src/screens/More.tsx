import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { go } from "../lib/router";
import { Header, Icon } from "../components/ui";

const ITEMS: [string, string, string, keyof typeof Icon][] = [
  ["/insiders", "Insiders", "Wallets that were early last time, ranked by what they made", "users"],
  ["/alerts", "Alerts", "Whales, movers, dev sells on your watchlist", "bell"],
  ["/launchpad", "ArcToolsPad", "Launch a token on Arc — 30 USDC, instant", "rocket"],
  ["/pay", "Pay links", "Send USDC with a link; the receiver claims", "link"],
  ["/referrals", "Referrals", "Earn 25% of the fees your invites generate", "gift"],
  ["/bridge", "Bridge", "USDC from other chains to Arc (CCTP)", "bridge"],
  ["/rewards", "ARCT & burn", "Buyback stats, burn counter, staking", "flame"],
  ["/history", "History", "Your trades and transfers", "chart"],
  ["/profile", "My profile", "Public trader page for your wallet", "user"],
  ["/settings", "Settings", "Slippage, quick-buy amounts, clone filter", "gear"],
];

export default function More() {
  const [chain, setChain] = useState<{ last_block: number; index_lag_s: number | null } | null>(null);
  useEffect(() => { api.chain().then(setChain).catch(() => undefined); const id = setInterval(() => api.chain().then(setChain).catch(() => undefined), 10_000); return () => clearInterval(id); }, []);
  return (
    <>
      <Header title="More" />
      <div className="card" style={{ padding: 0 }}>
        {ITEMS.map(([to, title, sub, ic]) => { const Ic = Icon[ic]; return (
          <button key={to} className="menu-row" style={{ width: "100%", textAlign: "left" }} onClick={() => go(to)}><span className="icon-btn"><Ic className="" /></span><div><b>{title}</b><small>{sub}</small></div><Icon.chev className="chev" /></button>
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
