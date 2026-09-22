import { bindings } from "@/lib/bindings.server";

/** MoonPay on-ramp: card / Apple Pay / Google Pay → USDC delivered natively on Arc (currency code `usdc_arc`, chainId 5042)
 *  straight to the user's own wallet. We never hold the money; the ARCT part is a normal aggregator swap afterwards.
 *  Secrets (Worker): MOONPAY_PK (publishable), MOONPAY_SK (secret, signs URLs), MOONPAY_ENV = "sandbox" | "live". */
const HOSTS = { sandbox: "https://buy-sandbox.moonpay.com", live: "https://buy.moonpay.com" };

async function hmacB64(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export type OnrampLink = { configured: boolean; env?: "sandbox" | "live"; url?: string; reason?: string };

/** a signed widget URL for one wallet + amount. MoonPay requires the signature whenever walletAddress is pre-filled. */
export async function moonpayLink(input: { wallet: string; fiat: string; amount: number; ip?: string }): Promise<OnrampLink> {
  const env = bindings() as unknown as { MOONPAY_PK?: string; MOONPAY_SK?: string; MOONPAY_ENV?: string };
  if (!env.MOONPAY_PK || !env.MOONPAY_SK) return { configured: false, reason: "MoonPay keys not set yet (KYB pending)" };
  const mode: "sandbox" | "live" = env.MOONPAY_ENV === "live" ? "live" : "sandbox";
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.wallet)) return { configured: true, env: mode, reason: "bad wallet" };
  const fiat = /^[a-z]{3}$/.test(input.fiat) ? input.fiat : "usd";
  const amount = Math.min(10_000, Math.max(20, Math.round(input.amount || 50)));
  const q = new URLSearchParams();
  q.set("apiKey", env.MOONPAY_PK);
  q.set("currencyCode", "usdc_arc");
  q.set("walletAddress", input.wallet);
  q.set("baseCurrencyCode", fiat);
  q.set("baseCurrencyAmount", String(amount));
  q.set("showWalletAddressForm", "true");           // the buyer sees where it goes, cannot change it
  q.set("colorCode", "#2e7cff");
  q.set("redirectURL", "https://arctools.fun/buy?done=1");
  if (input.ip && mode === "live") q.set("allowedIpAddress", await hmacB64(env.MOONPAY_SK, input.ip));   // required to go live: widget loads only for this IP
  const search = "?" + q.toString();                 // URLSearchParams encodes every value, as MoonPay requires
  const signature = await hmacB64(env.MOONPAY_SK, search);
  return { configured: true, env: mode, url: `${HOSTS[mode]}${search}&signature=${encodeURIComponent(signature)}` };
}
