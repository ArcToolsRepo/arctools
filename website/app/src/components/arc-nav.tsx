import { useEffect, useState } from "react";

import { connectWallet, getStoredWallet, onWalletChange, setStoredWallet } from "@/lib/arc-wallet";
import { PadTicker } from "./pad-ticker";

/** Shared site nav: tool links, launchpad, rewards, wallet connect. */
export function ArcNav({ active }: { active?: string }) {
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    setWallet(getStoredWallet());
    return onWalletChange(setWallet); // live sync with every page's connect button
  }, []);

  const connect = async () => {
    try {
      await connectWallet(); // adds/switches to the Arc network too
    } catch (e) {
      alert((e as Error).message.slice(0, 120));
    }
  };

  const disconnect = () => {
    setStoredWallet(null);
  };

  const links = [
    ["/trade", "Trade"],
    ["/profile", "Profile"],
    ["/feed", "Feed"],
    ["/scan", "Scanner"],
    ["/portfolio", "Portfolio"],
    ["/bridge", "Bridge"],
  ] as const;

  return (
    <>
    <nav className={"arc-nav" + (active && active !== "/" ? " arc-nav--side" : "")}>
      <a className="arc-nav__brand" href="/">
        <img alt="ArcTools monogram" src="/assets/brand/logo-mark.png" />
        ArcTools
      </a>
      <div className="arc-nav__links" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 18 }}>
        {links.map(([href, label]) => (
          <a
            className="arc-link-tick"
            href={href}
            key={href}
            style={active === href ? { textDecoration: "underline", textUnderlineOffset: 6 } : undefined}
          >
            {label}
          </a>
        ))}
        <a className="arc-link-tick" data-active={active === "/launchpad" || undefined} href="/launchpad">
          Launchpad
        </a>
        <a className="arc-link-tick" data-active={active === "/rewards" || undefined} href="/rewards">
          Rewards
        </a>
        <a className="arc-link-tick" data-active={active === "/insiders" || undefined} href="/insiders">
          Insiders
        </a>
        <a className="arc-link-tick" data-active={active === "/intel" || undefined} href="/intel">
          Intel
        </a>
        <a className="arc-link-tick" href="https://t.me/ArcSniper_bot" rel="noreferrer" target="_blank">
          Bot
        </a>
        <a
          aria-label="ArcTools on X"
          className="arc-link-tick"
          href="https://x.com/ArcToolsBackup"
          rel="noreferrer"
          style={{ fontSize: 15, textTransform: "none" }}
          target="_blank"
          title="X"
        >
          𝕏
        </a>
        <a
          aria-label="ArcTools Telegram portal"
          className="arc-link-tick"
          href="https://t.me/ArcToolsPortal"
          rel="noreferrer"
          style={{ fontSize: 15, textTransform: "none" }}
          target="_blank"
          title="Telegram"
        >
          ✈︎
        </a>
      </div>
      {wallet ? (
        <button className="arc-wallet arc-mono" onClick={disconnect} title="Disconnect" type="button">
          {wallet.slice(0, 6)}…{wallet.slice(-4)} ✕
        </button>
      ) : (
        <button className="arc-wallet arc-wallet--connect arc-mono" onClick={() => void connect()} type="button">
          Connect wallet
        </button>
      )}
    </nav>
    <PadTicker />
    {active && active !== "/" && <style>{`
      @media (min-width: 1024px) {
        .arc-nav--side { inset: 0 auto 0 0; width: 200px; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px; padding: 18px 14px; border-bottom: none; border-right: 1px solid var(--arc-line); overflow-y: auto; }
        .arc-nav--side .arc-nav__brand { margin-bottom: 14px; }
        .arc-nav--side .arc-nav__links { flex-direction: column; align-items: stretch !important; gap: 2px !important; flex: 1; }
        .arc-nav--side .arc-nav__links a { padding: 9px 10px; border-radius: 6px; font-size: 13px; }
        .arc-nav--side .arc-nav__links a[data-active], .arc-nav--side .arc-nav__links a[style*="underline"] { background: rgba(46,124,255,0.14); color: var(--arc-cobalt); text-decoration: none !important; }
        .arc-nav--side .arc-wallet { margin-top: 12px; width: 100%; }
        .arc-site:has(.arc-nav--side) { padding-left: 200px; }
        .arc-site:has(.arc-nav--side) .arc-section { padding-top: 70px !important; }
        .arc-site:has(.arc-nav--side) .arc-ticker, .arc-site:has(.arc-nav--side) .pad-ticker { margin-left: 0; }
      }
    `}</style>}
    </>
  );
}
