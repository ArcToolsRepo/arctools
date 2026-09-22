import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { connectWallet, disconnectWallet, getStoredWallet, onWalletChange, setStoredWallet, setWalletPicker } from "@/lib/arc-wallet";
import { bindRef, captureRef } from "@/lib/arc-ref";
import { hotAddress, onHotChange } from "@/lib/arc-hotwallet";
import { PadTicker } from "./pad-ticker";
import { ChainBanner } from "./chain-banner";
import { HelpDrawer, openHelp } from "./help-drawer";
import { PrefsBar } from "./prefs-bar";
import { VersionSwitch } from "@/components/version-switch";
import { usePrefs } from "@/lib/i18n";

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

  // picker for the case of several installed wallet extensions (MetaMask + Rabby + …)
  const [picker, setPicker] = useState<{ opts: { rdns: string; name: string; icon: string }[]; resolve: (r: string | null) => void } | null>(null);
  useEffect(() => { setWalletPicker((opts) => new Promise((resolve) => setPicker({ opts, resolve }))); return () => setWalletPicker(null); }, []);
  // referral binding covers both signers: the connected browser wallet AND the in-browser trading wallet (most quick-buy users never connect MetaMask)
  useEffect(() => {
    captureRef(); void bindRef(getStoredWallet()); void bindRef(hotAddress());
    const offW = onWalletChange((a) => void bindRef(a));
    const offH = onHotChange(() => void bindRef(hotAddress()));
    return () => { offW(); offH(); };
  }, []);
  const disconnect = async () => {
    // full disconnect (permission revoked in the extension), then straight back into the connect flow so the
    // user picks the wallet / account they actually want
    await disconnectWallet();
    try { await connectWallet({ forcePicker: true }); } catch { /* user closed the chooser: stays disconnected */ }
  };

  // Fourteen equal links told a newcomer nothing: "Intel", "Insiders", "Scanner" and "Traders" are unguessable
  // side by side. Three destinations people arrive for stay in the open; the rest sit in three named groups.
  const primary = [
    ["/trade", "Terminal"],
    ["/swap", "Swap"],
    ["/portfolio", "Portfolio"],
  ] as const;
  const groups: { label: string; items: readonly (readonly [string, string])[] }[] = [
    { items: [["/scan", "Scanner"], ["/insiders", "Insiders"], ["/leaderboard", "Traders"], ["/intel", "Intel"]], label: "Discover" },
    { items: [["/launchpad", "Launchpad"], ["/locker", "Locker"], ["/advertise", "Advertise"], ["/rewards", "Rewards"], ["/referrals", "Referrals"], ["/pay", "Pay"]], label: "Earn" },
    { items: [["/app", "Android app"]], label: "App" },
    { items: [["/profile", "Profile"], ["/wallets", "Wallets"], ["/bridge", "Bridge"]], label: "Account" },
  ];

  const { t } = usePrefs();
  const side = !!(active && active !== "/");
  return (
    <>
    <nav className={"arc-nav" + (active && active !== "/" ? " arc-nav--side" : "")}>
      <a className="arc-nav__brand" href="/">
        <img alt="ArcTools monogram" src="/assets/brand/logo-mark.png" />
        ArcTools
      </a>
      {active && active !== "/" && active !== "/trade" && (
        <a className="arc-nav__back arc-mono" href="/trade" title="Back to the trading terminal">{t("← Terminal")}</a>
      )}
      <div className="arc-nav__links" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 18 }}>
        {primary.map(([href, label]) => (
          <a
            className="arc-link-tick"
            data-active={active === href || undefined}
            href={href}
            key={href}
            style={active === href ? { textDecoration: "underline", textUnderlineOffset: 6 } : undefined}
          >
            {t(label)}
          </a>
        ))}
        {groups.map((g) => {
          const here = g.items.some(([href]) => href === active);
          return (
            // <details> gives an accessible, keyboard-operable menu that also works before hydration;
            // inside a page (side rail) the group is simply left open, so nothing hides behind a click
            <details className={"arc-nav__group" + (side ? " arc-nav__group--rail" : "")} key={g.label} open={side || undefined}>
              <summary
                className="arc-link-tick arc-nav__groupsum"
                data-active={here || undefined}
                style={here ? { textDecoration: "underline", textUnderlineOffset: 6 } : undefined}
              >
                {t(g.label)}<span aria-hidden className="arc-nav__caret">▾</span>
              </summary>
              <div className="arc-nav__menu">
                {g.items.map(([href, label]) => (
                  <a
                    className="arc-link-tick"
                    data-active={active === href || undefined}
                    href={href}
                    key={href}
                    style={active === href ? { textDecoration: "underline", textUnderlineOffset: 6 } : undefined}
                  >
                    {t(label)}
                  </a>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <VersionSwitch compact />
      <div className="arc-nav__socials" aria-label="ArcTools links">
        {[
          ["https://t.me/ArcSniper_bot", "🔫", "Sniper bot"],
          ["https://t.me/ArcToolsBuyBot", "📟", "Buy bot"],
          ["https://t.me/ARCTrends", "🔥", "Trending channel"],
          ["https://t.me/ArcToolsInsiders", "👁", "Insider alerts"],
          ["https://t.me/ArcToolsPortal", "✈︎", "Telegram portal"],
          ["https://x.com/ArcToolsBackup", "𝕏", "X / Twitter"],
        ].map(([href, icon, label]) => (
          <a className="arc-nav__social" href={href} key={href} rel="noreferrer" target="_blank" title={label}>
            <span aria-hidden className="arc-nav__social-icon">{icon}</span>
            <span className="arc-nav__social-label">{label}</span>
          </a>
        ))}
      </div>
      {picker && typeof document !== "undefined" && createPortal(
        <div onClick={() => { picker.resolve(null); setPicker(null); }} style={{ alignItems: "center", background: "rgba(0,0,0,0.6)", display: "flex", inset: 0, justifyContent: "center", position: "fixed", zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", maxWidth: "calc(100vw - 32px)", padding: 18, width: 320 }}>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 10px", textTransform: "uppercase" }}>Choose a wallet</p>
            {picker.opts.map((o) => (
              <button className="arc-mono" key={o.rdns} onClick={() => { picker.resolve(o.rdns); setPicker(null); }} style={{ alignItems: "center", background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", display: "flex", fontSize: 13, gap: 10, marginBottom: 6, padding: "10px 12px", width: "100%" }} type="button">
                <img alt="" height={22} src={o.icon} width={22} /> {o.name}
              </button>
            ))}
            <button className="arc-mono" onClick={() => { picker.resolve(null); setPicker(null); }} style={{ background: "transparent", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginTop: 4 }} type="button">cancel</button>
          </div>
        </div>
      , document.body)}
      {wallet ? (
        <button className="arc-wallet arc-mono" onClick={() => void disconnect()} title="Disconnect and pick another wallet" type="button">
          {wallet.slice(0, 6)}…{wallet.slice(-4)} ✕
        </button>
      ) : (
        <button className="arc-wallet arc-wallet--connect arc-mono" onClick={() => void connect()} type="button">
          {t("Connect wallet")}
        </button>
      )}
      <button className="arc-mono arc-nav__help" onClick={() => openHelp()} title="Archy Agent — ask how to do something on ArcTools" type="button"><img alt="" src="/archy.png" style={{ borderRadius: "50%", height: 20, width: 20 }} />{side ? "Archy Agent" : ""}</button>
      {!side && <PrefsBar />}
    </nav>
    <HelpDrawer />
    {side && <PrefsBar fixed />}
    <PadTicker />
    <ChainBanner />
    <style>{`
      .arc-nav__socials { display: flex; align-items: center; gap: 6px; }
      .arc-nav__back { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px; font-size: 12px; letter-spacing: 0.04em; color: #06130b; background: var(--arc-up); text-decoration: none; font-weight: 700; white-space: nowrap; }
      .arc-nav__back:hover { filter: brightness(1.08); }
      .arc-nav--side .arc-nav__back { margin: -4px 0 12px; justify-content: center; }
      .arc-nav__social { display: inline-flex; align-items: center; gap: 8px; color: var(--arc-muted); text-decoration: none; font-size: 13px; padding: 4px 6px; border-radius: 6px; }
      .arc-nav__social:hover { color: var(--arc-ink); background: rgba(255,255,255,0.05); }
      .arc-nav__social-label { display: none; }
      .arc-nav__social-icon { width: 18px; text-align: center; font-size: 14px; }
      @media (min-width: 1024px) {
        .arc-nav--side { inset: 0 auto 0 0; width: 220px; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 4px; padding: 16px 12px; border-bottom: none; border-right: 1px solid var(--arc-line); overflow-y: auto; background: rgba(10,12,16,0.97); }
        .arc-nav--side .arc-nav__brand { margin: 2px 6px 14px; }
        .arc-nav--side .arc-nav__links { flex-direction: column; align-items: stretch !important; gap: 4px !important; }
        .arc-nav--side .arc-nav__links a { display: flex; align-items: center; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; letter-spacing: 0.06em; color: var(--arc-ink); background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); transition: background .12s, border-color .12s, transform .08s; }
        .arc-nav--side .arc-nav__links a::after { display: none; }
        .arc-nav--side .arc-nav__links a:hover { background: rgba(46,124,255,0.10); border-color: rgba(46,124,255,0.35); transform: translateX(2px); }
        .arc-nav--side .arc-nav__links a[data-active], .arc-nav--side .arc-nav__links a[style*="underline"] { background: rgba(46,124,255,0.18); border-color: var(--arc-cobalt); color: #fff; text-decoration: none !important; box-shadow: inset 3px 0 0 var(--arc-cobalt); }
        .arc-nav--side .arc-nav__socials { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--arc-line); flex-direction: column; align-items: stretch; gap: 2px; }
        .arc-nav--side .arc-nav__social { padding: 7px 10px; font-size: 12px; }
        .arc-nav--side .arc-nav__social-label { display: inline; }
        .arc-nav--side .arc-wallet { margin-top: 10px; width: 100%; justify-content: center; }
        .arc-site:has(.arc-nav--side) { padding-left: 220px; }
        .arc-site:has(.arc-nav--side) .arc-ticker { left: 220px; right: 0; width: auto; top: 0; }
        .arc-site:has(.arc-nav--side) .arc-section { padding-top: 64px !important; }
      }
    `}</style>
    </>
  );
}
