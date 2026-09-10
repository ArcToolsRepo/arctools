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
    body: "ArcTools is the sniper terminal for Arc: armed from Telegram, settled in native USDC.",
    clip: "/assets/world/scene-01.mp4",
    id: "instrument",
    kicker: "ARC MAINNET 5042",
    label: "Instrument",
    mobileClip: "/assets/world/scene-01-mobile.mp4",
    mobilePoster: "/assets/world/scene-01-mobile-poster.png",
    poster: "/assets/world/scene-01-poster.png",
    tags: ["USDC-NATIVE", "0.6S BLOCKS"],
    title: "Snipe the first block",
  },
  {
    align: "right",
    body: "RadarDex, ArcPad, Warp and Uniswap V3 today. A new pad is a config entry, not a rebuild.",
    clip: "/assets/world/scene-02.mp4",
    id: "venues",
    label: "Venues",
    mobileClip: "/assets/world/scene-02-mobile.mp4",
    mobilePoster: "/assets/world/scene-02-mobile-poster.png",
    poster: "/assets/world/scene-02-poster.png",
    tags: ["RADARDEX", "ARCPAD", "WARP", "UNISWAP V3"],
    title: "Every launchpad. One crosshair.",
  },
  {
    body: "Signed once, broadcast to every RPC at the same instant. Pre-approved USDC makes a snipe one transaction.",
    clip: "/assets/world/scene-03.mp4",
    id: "speed",
    label: "Speed",
    mobileClip: "/assets/world/scene-03-mobile.mp4",
    mobilePoster: "/assets/world/scene-03-mobile-poster.png",
    poster: "/assets/world/scene-03-poster.png",
    tags: ["RACE BROADCAST", "PRE-APPROVED"],
    title: "Dollar-native. Sub-second.",
  },
  {
    align: "right",
    body: "Every fill opens a live position panel: current value, profit in dollars, take-profit and panic exit on buttons.",
    clip: "/assets/world/scene-04.mp4",
    id: "positions",
    label: "Positions",
    mobileClip: "/assets/world/scene-04-mobile.mp4",
    mobilePoster: "/assets/world/scene-04-mobile-poster.png",
    poster: "/assets/world/scene-04-poster.png",
    tags: ["LIVE PNL", "TP 2-10X"],
    title: "Lock. Fire. Track.",
  },
];
