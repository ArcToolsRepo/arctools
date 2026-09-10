import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";

import { ArcNav } from "@/components/arc-nav";
import { ScrollScrub } from "@/components/scroll-scrub/scroll-scrub";
import { scrollScrubScenes, scrollScrubTheme } from "@/scroll-scrub-scenes";
import "../arc-site.css";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: Index,
});

const BOT_URL = "https://t.me/ArcSniper_bot";

/** Primary CTA: cobalt pill with reticle corner brackets + magnetic pull. */
function OpenBotCta() {
  const ref = useRef<HTMLAnchorElement>(null);

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width / 2) / r.width;
    const dy = (e.clientY - r.top - r.height / 2) / r.height;
    el.style.transform = `translate(${dx * 8}px, ${dy * 6}px)`;
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <a
      className="arc-cta"
      href={BOT_URL}
      onPointerLeave={onLeave}
      onPointerMove={onMove}
      ref={ref}
      rel="noreferrer"
      target="_blank"
    >
      <span aria-hidden className="arc-cta__corner arc-cta__corner--tl" />
      <span aria-hidden className="arc-cta__corner arc-cta__corner--tr" />
      <span aria-hidden className="arc-cta__corner arc-cta__corner--bl" />
      <span aria-hidden className="arc-cta__corner arc-cta__corner--br" />
      Open the bot
    </a>
  );
}

const VENUES = ["RadarDex", "ArcPad", "Warp", "Uniswap V3"];

type Feature = {
  body: string;
  icon: string;
  pattern?: boolean;
  span: number;
  title: string;
};

const FEATURES: Feature[] = [
  {
    body: "Instant buys, event triggers on new launches, migration triggers on curve graduations. Armed and disarmed on buttons.",
    icon: "/assets/icons/crosshair.png",
    span: 5,
    title: "Sniper modes",
  },
  {
    body: "Race broadcast sends your signed transaction to every RPC at once. The fastest node wins the block.",
    icon: "/assets/icons/bolt.png",
    span: 4,
    title: "Race broadcast",
  },
  {
    body: "",
    icon: "",
    pattern: true,
    span: 3,
    title: "",
  },
  {
    body: "Native CCTP moves USDC from Ethereum, Base or Arbitrum straight to your sniping wallet on Arc.",
    icon: "/assets/icons/bridge.png",
    span: 4,
    title: "CCTP bridge",
  },
  {
    body: "Mirror the buys of any wallet you track, sized to your own budget, on your own wallet.",
    icon: "/assets/icons/copy.png",
    span: 4,
    title: "Copy-trade",
  },
  {
    body: "Graduation progress, watched deployers, whale buys. Pinged the moment it happens.",
    icon: "/assets/icons/bell.png",
    span: 4,
    title: "Alerts",
  },
];

function Index() {
  return (
    <main className="arc-site">
      <ArcNav />

      {/* phones: static hero (the scroll film is desktop-only) */}
      <section className="arc-hero-mobile">
        <p className="arc-eyebrow">Live on Arc · chain 5042</p>
        <h1 className="arc-h2">The sniper terminal for Arc</h1>
        <p className="arc-body">
          Snipe launches from Telegram, launch tokens on ArcToolsPad, stake $ARCT and earn from every trade —
          everything settles in native USDC.
        </p>
        <div>
          <a className="arc-cta" href="/launchpad">Launch a token</a>
          <a className="arc-cta" href="https://t.me/ArcSniper_bot" rel="noreferrer" target="_blank">Open the bot</a>
        </div>
      </section>

      <ScrollScrub scenes={scrollScrubScenes} theme={scrollScrubTheme} />

      <section aria-label="Supported venues" className="arc-rail" id="venues">
        <div className="arc-rail__inner">
          <div className="arc-rail__venues">
            {VENUES.map((v, i) => (
              <span key={v}>
                {i > 0 && <span aria-hidden className="arc-rail__tick">|</span>}
                <span className="arc-rail__venue">{v}</span>
              </span>
            ))}
          </div>
          <a className="arc-link-tick" href={`${BOT_URL}?start=feed`} rel="noreferrer" target="_blank">
            Watch the feed
          </a>
        </div>
      </section>

      <section className="arc-section" id="features">
        <p className="arc-eyebrow">Capabilities</p>
        <h2 className="arc-h2">A full range kit, not just a trigger</h2>
        <div className="arc-bento" style={{ marginTop: 36 }}>
          {FEATURES.map((f, i) =>
            f.pattern ? (
              <div
                aria-hidden
                className="arc-cell arc-cell--pattern"
                key={`p-${i}`}
                style={{
                  gridColumn: `span ${f.span}`,
                  minHeight: 140,
                }}
              >
                <span className="arc-corner arc-corner--tl" />
                <span className="arc-corner arc-corner--br" />
              </div>
            ) : (
              <div className="arc-cell" key={f.title} style={{ gridColumn: `span ${f.span}` }}>
                <span className="arc-corner arc-corner--tl" />
                <span className="arc-corner arc-corner--br" />
                <img alt="" className="arc-cell__icon" src={f.icon} />
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="arc-section" id="how">
        <p className="arc-eyebrow">How it works</p>
        <h2 className="arc-h2">Three moves to the trigger</h2>
        <div style={{ marginTop: 36 }}>
          <div className="arc-step">
            <span className="arc-step__num">01</span>
            <div>
              <h3>Fund</h3>
              <p className="arc-body">
                Create a wallet in the bot and bridge USDC from Ethereum, Base or Arbitrum. On Arc, USDC is the gas too.
              </p>
            </div>
          </div>
          <div className="arc-step">
            <span className="arc-step__num">02</span>
            <div>
              <h3>Arm</h3>
              <p className="arc-body">
                Paste a contract address or pick a token from the live feed. Amount, gas, slippage, venue and mode: all buttons.
              </p>
            </div>
          </div>
          <div className="arc-step">
            <span className="arc-step__num">03</span>
            <div>
              <h3>Track</h3>
              <p className="arc-body">
                Every fill opens a position panel with live value and dollar PnL. Sell in one tap, set a take-profit, or panic out.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="arc-section" id="panel">
        <div className="arc-showcase">
          <div>
            <h2 className="arc-h2">The panel opens itself</h2>
            <p className="arc-body">
              The moment a snipe fills, ArcTools posts your position card: entry, current value, realized profit and the
              percentage in green or red. Take-profit levels close positions automatically while you sleep.
            </p>
          </div>
          <img alt="ArcTools position panel with live profit and loss" src="/assets/ui/positions-panel.png" />
        </div>
      </section>

      <section className="arc-section" id="tools">
        <p className="arc-eyebrow">The toolkit</p>
        <h2 className="arc-h2">Everything ArcTools does today</h2>
        <div style={{ display: "grid", gap: 0, gridTemplateColumns: "1fr", marginTop: 26 }}>
          {[
            ["01", "ArcToolsPad launchpad", "Launch a token on Arc in one transaction: pick marketing, rewards and auto-burn taxes, choose the reward token (USDC, ARCT or any token), add socials and a logo. Instant bonding-curve trading in native USDC.", "/launchpad", "Launch a token"],
            ["02", "ARCT staking rewards", "Stake $ARCT and earn from the whole launchpad: a cut of the 1% platform fee on every ArcToolsPad trade plus 5% of the supply of every token launched, claimable whenever you like.", "/rewards", "Stake ARCT"],
            ["03", "Sniper bot", "Paste a contract address in Telegram and a full buy panel opens: amount, gas, slippage, venue, mode and multi-wallet, all on buttons. Fires instantly or arms on the launch event, with a 1% service fee per trade.", "https://t.me/ArcSniper_bot", "Open the sniper"],
            ["04", "Buy alerts bot", "Add it to your token's group: live buy alerts from ArcToolsPad, ArcPad, Uniswap V3, DYORSwap and WarpDex with custom emoji bars, your photo, GIF or MP4 on every alert, project socials, min-buy filters and a test button.", "https://t.me/ArcToolsBuyBot", "Open the buy bot"],
            ["05", "Trending channel", "The Arc trending board: 24h buy volume ranking across tracked tokens, refreshed every few minutes. Paid boosts pin your token on top with a rocket.", "https://t.me/ARCTrends", "Open trending"],
            ["06", "Token explorer", "Every token from ArcPad, RadarDex, Warp and fresh Uniswap V3 pools with logos, socials, market caps, volume, filters and live candle charts. New deploys appear in seconds.", "/feed", "Open the feed"],
            ["07", "Scanner", "The rug check: ownership, mint and pause levers in the bytecode, real USDC pool liquidity, spot price and ticker clones. One paste, one verdict.", "/scan", "Scan a token"],
            ["08", "Portfolio", "Any Arc wallet, valued live in dollars: native USDC plus every token it holds, priced through the V3 quoter in one pass.", "/portfolio", "Check a wallet"],
            ["09", "Bridge", "Circle CCTP v2 in the browser and in the bot: burn USDC on Ethereum, Base or Arbitrum, mint natively on Arc. The 2% service fee is taken atomically inside the mint transaction.", "/bridge", "Bridge USDC"],
            ["10", "Alerts", "Browser notifications for new deploys and price targets on the feed page. In the bot: curve graduation, deployer watch, whale buys and take-profits that fire while you sleep.", "/feed", "Set an alert"],
          ].map(([num, title, body, href, label]) => (
            <div className="arc-step" key={num}>
              <span className="arc-step__num">{num}</span>
              <div>
                <h3>{title}</h3>
                <p className="arc-body">{body}</p>
                <a
                  className="arc-link-tick"
                  href={href}
                  {...(href.startsWith("http") ? { rel: "noreferrer", target: "_blank" } : {})}
                  style={{ display: "inline-block", marginTop: 8 }}
                >
                  {label}
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="arc-band">
        <div className="arc-band__inner">
          <h2 className="arc-h2" style={{ maxWidth: 560 }}>
            Ready on chain 5042
          </h2>
          <p className="arc-body" style={{ maxWidth: 460 }}>
            The instrument is calibrated. Fund a wallet and take the first block.
          </p>
          <OpenBotCta />
        </div>
      </section>

      <section className="arc-section" style={{ paddingBottom: 40, textAlign: "center" }}>
        <p className="arc-eyebrow" style={{ textAlign: "center" }}>Mobile</p>
        <div className="arc-stores" style={{ marginTop: 16 }}>
          <div className="arc-store">
            <span aria-hidden className="arc-store__icon"></span>
            <span className="arc-store__meta">
              <span className="arc-store__soon">Coming soon</span>
              <span className="arc-store__name">App Store</span>
            </span>
          </div>
          <div className="arc-store">
            <span aria-hidden className="arc-store__icon">▶</span>
            <span className="arc-store__meta">
              <span className="arc-store__soon">Coming soon</span>
              <span className="arc-store__name">Google Play</span>
            </span>
          </div>
        </div>
      </section>

      <footer className="arc-footer">
        <span className="arc-footer__brand">
          <img alt="" src="/assets/brand/logo-mark.png" />
          ArcTools
        </span>
        <div className="arc-socials">
          <a className="arc-link-tick" href="https://t.me/ArcToolsPortal" rel="noreferrer" target="_blank">
            Portal chat
          </a>
          <a className="arc-link-tick" href="https://t.me/ARCTrends" rel="noreferrer" target="_blank">
            Trending
          </a>
          <a className="arc-link-tick" href="https://t.me/ArcToolsBuyBot" rel="noreferrer" target="_blank">
            Buy bot
          </a>
          <a className="arc-link-tick" href="https://x.com/ArcChainTools" rel="noreferrer" target="_blank">
            X
          </a>
        </div>
        <div className="arc-footer__links">
          <a className="arc-link-dotted" href="https://arc-scan.org" rel="noreferrer" target="_blank">
            Arc Scan
          </a>
          <a className="arc-link-dotted" href="https://radardex.pro" rel="noreferrer" target="_blank">
            RadarDex
          </a>
          <a className="arc-link-dotted" href="https://arcpad.meme" rel="noreferrer" target="_blank">
            ArcPad
          </a>
          <a className="arc-link-dotted" href="https://circlewarp.fun" rel="noreferrer" target="_blank">
            Warp
          </a>
        </div>
      </footer>
    </main>
  );
}
