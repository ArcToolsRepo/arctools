import { createServerFn } from "@tanstack/react-start";

/** Sponsored banners under the Terminal heading (v1 + v2). Three slots, 7 days each.
 *  Paid on-chain to the fee treasury: 250 USDC, or ARCT worth 200 USD at submission time.
 *  Nothing goes live without the admin clicking Approve in the Telegram notice — the fee is not a publishing right.
 *  Server side (D1, payment check, Telegram) lives in ads.server.ts; this file is safe to import from the client. */
export const AD_SLOTS = 3;
export const AD_DAYS = 7;
export const AD_USDC = 250;                 // USDC
export const AD_ARCT_USD = 200;             // ARCT priced at submission
export const AD_W = 1060; export const AD_H = 144;   // exact banner pixels (renders at 530×72 css px)
export const TREASURY = "0xb35c471b31d636b96f95b84e7a27d69b63235c0d";
export const USDC = "0x3600000000000000000000000000000000000000";
export const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const BOT = "https://bot-production-4200.up.railway.app";

export type Ad = { id: number; wallet: string; title: string; url: string; pay_token: string; pay_amount: string; pay_tx: string; status: string; created_at: number; starts_at: number | null; ends_at: number | null; note: string | null };


export const adQuote = createServerFn({ method: "GET" }).handler(async () => (await import("@/lib/ads.server")).quoteAd());
export const adSubmit = createServerFn({ method: "POST" })
  .inputValidator((d: { wallet: string; title: string; url: string; image: string; payToken: "USDC" | "ARCT"; tx: string }) => d)
  .handler(async ({ data }) => (await import("@/lib/ads.server")).submitAd(data));
export const adsMine = createServerFn({ method: "GET" }).inputValidator((d: { wallet: string }) => d).handler(async ({ data }) => (await import("@/lib/ads.server")).mineAds(data));
