/**
 * ArcTools journey: ONE continuous film cut frame-exact into 4 chapter
 * segments (same take, zero seams). Posters are the exact first frames of the
 * encoded clips beside them.
 */
import type {
  ScrollScrubScene,
  ScrollScrubTheme,
} from "@/components/scroll-scrub/scroll-scrub";

/** Brand tokens (dark steel + azure, matched to the ArcTools logo). The film
 * itself is a bright studio world, so chapter ink stays dark for contrast. */
export const scrollScrubTheme: ScrollScrubTheme = {
  accent: "#2f7ff5",
  background: "#0a0c10",
  ink: "#eef2f9",
  muted: "#c3cbdb",
};

export const scrollScrubScenes: ScrollScrubScene[] = [
  {
    body: "ArcTools is the trading terminal for Arc: every launchpad in one table, one aggregated swap, insiders and intel on the same screen — settled in native USDC.",
    clip: "/assets/world/scene-01.mp4",
    id: "instrument",
    kicker: "ARC MAINNET 5042",
    label: "Terminal",
    mobileClip: "/assets/world/scene-01-mobile.mp4",
    mobilePoster: "/assets/world/scene-01-mobile-poster.png",
    poster: "/assets/world/scene-01-poster.png",
    tags: ["USDC-NATIVE", "0.6S BLOCKS"],
    title: "Trade the whole chain",
  },
  {
    align: "right",
    body: "ArcToolsPad, ArcPad, RadarDex, Warp, Archemist, Arguspad, act.fun, UBI.fun, Uniswap V3 and V4. One feed, one swap that splits across venues for the best fill.",
    clip: "/assets/world/scene-02.mp4",
    id: "venues",
    label: "Venues",
    mobileClip: "/assets/world/scene-02-mobile.mp4",
    mobilePoster: "/assets/world/scene-02-mobile-poster.png",
    poster: "/assets/world/scene-02-poster.png",
    tags: ["RADARDEX", "ARCPAD", "WARP", "UNISWAP V3"],
    title: "Every launchpad. One swap.",
  },
  {
    body: "An in-browser trading wallet signs quick-buys with one click, no popups. In Telegram, the sniper fires on the launch event or the moment you paste a CA.",
    clip: "/assets/world/scene-03.mp4",
    id: "speed",
    label: "Execution",
    mobileClip: "/assets/world/scene-03-mobile.mp4",
    mobilePoster: "/assets/world/scene-03-mobile-poster.png",
    poster: "/assets/world/scene-03-poster.png",
    tags: ["RACE BROADCAST", "PRE-APPROVED"],
    title: "One click. Native USDC.",
  },
  {
    align: "right",
    body: "Top-100 wallets by PnL tracked live, whale and bridge flows, alert rules in your DM. Positions with realized PnL and one-tap sells in Holdings.",
    clip: "/assets/world/scene-04.mp4",
    id: "positions",
    label: "Intel",
    mobileClip: "/assets/world/scene-04-mobile.mp4",
    mobilePoster: "/assets/world/scene-04-mobile-poster.png",
    poster: "/assets/world/scene-04-poster.png",
    tags: ["LIVE PNL", "TP 2-10X"],
    title: "Insiders. Intel. Positions.",
  },
];
