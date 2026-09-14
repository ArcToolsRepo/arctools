/** Base URL of the buybot / Arc Insider API as seen from the BROWSER: same-origin proxy (/bot) — the direct
 *  Railway host is only used server-side (Worker → Railway). */
export const BOT_ORIGIN = "https://bot-production-4200.up.railway.app";
export const BOT_API: string = typeof window === "undefined" ? BOT_ORIGIN : "/bot";
