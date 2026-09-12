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

const VENUES = ["ArcToolsPad", "ArcPad", "RadarDex", "Warp", "Archemist", "Arguspad", "act.fun", "UBI.fun", "Uniswap V3", "Uniswap V4"];

type Feature = {
  body: string;
  icon: string;
  pattern?: boolean;
  span: number;
  title: string;
};

const FEATURES: Feature[] = [
  { body: "GMGN-style table for Arc: new pairs, trending, insider picks, watchlist and holdings. One-click buy from any row, signed by an in-browser trading wallet or MetaMask.", icon: "/assets/icons/crosshair.png", span: 5, title: "Terminal" },
  { body: "Every Arc launchpad and DEX behind one swap. Quotes V3, V4, bonding curves and Warp, splits the order across venues when it pays.", icon: "/assets/icons/bolt.png", span: 4, title: "Aggregator" },
  { body: "", icon: "", pattern: true, span: 3, title: "" },
  { body: "Top-100 wallets by 30-day PnL, recomputed every 2 minutes from the chain-wide swap index. Their buys, sells and clusters stream to Telegram.", icon: "/assets/icons/copy.png", span: 4, title: "Insiders" },
  { body: "Whale feed, richest wallets, fresh capital, bridge flows, movers — and alert rules you define yourself, delivered to your DM.", icon: "/assets/icons/bell.png", span: 4, title: "Intel" },
  { body: "Paste a CA in Telegram and a Maestro-style panel opens. Fires instantly or arms on the launch event across ten venues.", icon: "/assets/icons/bridge.png", span: 4, title: "Sniper bot" },
];


function Index() {
  return (
    <main className="arc-site">
      <ArcNav />

      {/* phones: static hero (the scroll film is desktop-only) */}
      <section className="arc-hero-mobile">
        <p className="arc-eyebrow">Live on Arc · chain 5042</p>
        <h1 className="arc-h2">The trading terminal for Arc</h1>
        <p className="arc-body">
          Every launchpad in one table, one aggregated swap, insider tracking, on-chain intel and a Telegram sniper —
          all settling in native USDC.
        </p>
        <div>
          <a className="arc-cta" href="/trade">Open the Terminal</a>
          <a className="arc-cta" href="https://t.me/ArcSniper_bot" rel="noreferrer" target="_blank">Sniper bot</a>
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
          <a className="arc-link-tick" href="/trade">All launches</a>
        </div>
      </section>

      <section className="arc-section" id="features">
        <p className="arc-eyebrow">What you get</p>
        <h2 className="arc-h2">One terminal for the whole chain</h2>
        <div className="arc-bento" style={{ marginTop: 36 }}>
          {FEATURES.map((f, i) =>
            f.pattern ? (
              <div aria-hidden className="arc-cell arc-cell--pattern" key={`p-${i}`} style={{ gridColumn: `span ${f.span}`, minHeight: 140 }}>
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
        <h2 className="arc-h2">Three moves to the first fill</h2>
        <div style={{ marginTop: 36 }}>
          {[
            ["01", "Fund", "Create the trading wallet in the Terminal — the key never leaves your browser — and top it up from MetaMask or bridge USDC from Ethereum, Base or Arbitrum. On Arc, USDC is the gas too."],
            ["02", "Pick", "New pairs, trending, insider picks or the tokens surviving past 15 minutes. Market cap, liquidity, volume, top-10 share and insider count on every row; the scanner one click away."],
            ["03", "Fire", "Set the quick-buy amount once. Every ⚡ button routes through the aggregator to the best venue and signs in one click. Positions, PnL and one-tap sells live in Holdings."],
          ].map(([n, t, b]) => (
            <div className="arc-step" key={n}>
              <span className="arc-step__num">{n}</span>
              <div>
                <h3>{t}</h3>
                <p className="arc-body">{b}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="arc-section" id="panel">
        <div className="arc-showcase">
          <div>
            <h2 className="arc-h2">Telegram never sleeps</h2>
            <p className="arc-body">
              The sniper posts a position card the moment a buy fills: entry, live value, realized PnL. Take-profits close
              positions automatically, the Insiders channel streams top-wallet moves and your own alert rules ping you
              the second a whale, a bridge or a cluster hits.
            </p>
          </div>
          <img alt="ArcTools position panel with live profit and loss" src="/assets/ui/positions-panel.png" />
        </div>
      </section>

      <section className="arc-section" id="tools">
        <p className="arc-eyebrow">The toolkit</p>
        <h2 className="arc-h2">Everything ArcTools does today</h2>
        <div className="arc-tools" style={{ marginTop: 26 }}>
          {[
            ["Terminal", "Live token table with one-click buys, in-browser trading wallet, watchlist and holdings.", "/trade", "Open"],
            ["Aggregator", "One swap across V3, V4, bonding curves and Warp with split routing and a 1.5% fee.", "/trade", "Trade"],
            ["Insiders", "Top-100 wallets by 30-day PnL and their live activity, plus the rising tier.", "/insiders", "Leaderboard"],
            ["Insider alerts", "Telegram channel: buys, sells, clusters and new entrants of the top wallets.", "https://t.me/ArcToolsInsiders", "Join"],
            ["Intel", "Whales, fresh capital, bridge flows, balance moves, movers and a custom alert builder.", "/intel", "Explore"],
            ["Token explorer", "Every launch from ten venues inside the Terminal: source chips, market-cap and volume filters.", "/trade", "Explore"],
            ["Token pages", "Chart, trades, holders, insider flags and the unified swap for any contract.", "/trade", "Browse"],
            ["Scanner", "Rug check: ownership and mint levers, real liquidity, spot price, ticker clones.", "/scan", "Scan"],
            ["Profile", "Equity, holdings with average entry and realized PnL, trade history, deposits.", "/profile", "Profile"],
            ["Portfolio", "Any Arc wallet valued live in USDC, every token priced in one pass.", "/portfolio", "Check"],
            ["ArcToolsPad", "Launch a token in one transaction: taxes, reward token, socials, logo, LP burned.", "/launchpad", "Launch"],
            ["ARCT rewards", "Stake $ARCT: a share of every ArcToolsPad fee plus 5% of every launched supply.", "/rewards", "Stake"],
            ["Bridge", "Circle CCTP v2 from Ethereum, Base or Arbitrum straight to Arc. 2% fee inside the mint.", "/bridge", "Bridge"],
            ["Sniper bot", "Maestro-style buy panels, launch triggers, copy-trade, multi-wallet. 1% per trade.", "https://t.me/ArcSniper_bot", "Open bot"],
            ["Buy alerts bot", "Group buy alerts with custom media, emoji bars, socials and min-buy filters.", "https://t.me/ArcToolsBuyBot", "Add to group"],
            ["Trending", "24h buy-volume ranking across the chain; boosts pin your token on top.", "https://t.me/ARCTrends", "Channel"],
            ["Watchlist & rules", "/watch any wallet, /alert on price, whale, bridge, cluster or balance — in your DM.", "https://t.me/ArcToolsBuyBot?start=watch_", "Set up"],
            ["Gas faucet", "A few cents of USDC so a fresh wallet can send its first transaction.", "/portfolio", "Faucet"],
          ].map(([title, body, href, label]) => (
            <a className="arc-tool" href={href} key={title} {...(href.startsWith("http") ? { rel: "noreferrer", target: "_blank" } : {})}>
              <span className="arc-corner arc-corner--tl" />
              <span className="arc-corner arc-corner--br" />
              <h3>{title}</h3>
              <p>{body}</p>
              <span className="arc-tool__go">{label} →</span>
            </a>
          ))}
        </div>
      </section>

      <section className="arc-band">
        <div className="arc-band__inner">
          <h2 className="arc-h2" style={{ maxWidth: 560 }}>
            Ready on chain 5042
          </h2>
          <p className="arc-body" style={{ maxWidth: 460 }}>
            Create the trading wallet, top it up, and take the next launch from the first block.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <a className="arc-cta" href="/trade">Open the Terminal</a>
            <OpenBotCta />
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
          <a className="arc-link-tick" href="https://t.me/ArcSniper_bot" rel="noreferrer" target="_blank">
            Sniper
          </a>
          <a className="arc-link-tick" href="https://t.me/ArcToolsInsiders" rel="noreferrer" target="_blank">
            Insiders
          </a>
          <a className="arc-link-tick" href="https://x.com/ArcToolsBackup" rel="noreferrer" target="_blank">
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
          <a className="arc-link-dotted" href="https://archemist.fun" rel="noreferrer" target="_blank">
            Archemist
          </a>
          <a className="arc-link-dotted" href="https://arguspad.io" rel="noreferrer" target="_blank">
            Arguspad
          </a>
        </div>
      </footer>
    </main>
  );
}
