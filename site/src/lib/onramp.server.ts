import { bindings } from "@/lib/bindings.server";

/** MoonPay on-ramp: card / Apple Pay / Google Pay → USDC delivered natively on Arc (currency code `usdc_arc`, chainId 5042)
 *  straight to the user's own wallet. We never hold the money; the ARCT part is a normal aggregator swap afterwards.
 *  Secrets (Worker): MOONPAY_PK (publishable), MOONPAY_SK (secret, signs URLs), MOONPAY_ENV = "sandbox" | "live". */
const HOSTS = { sandbox: "https://buy-sandbox.moonpay.com", live: "https://buy.moonpay.com" };
/** MoonPay's sandbox has no Arc: test mode buys plain `usdc` (Ethereum) so the widget flow can be exercised end to end; live buys `usdc_arc`. */
const CODE = { sandbox: "usdc", live: "usdc_arc" };

async function hmacB64(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export type OnrampLink = { configured: boolean; env?: "sandbox" | "live"; mode?: "public" | "partner"; url?: string; reason?: string };

/** a signed widget URL for one wallet + amount. MoonPay requires the signature whenever walletAddress is pre-filled. */
export async function moonpayLink(input: { wallet: string; fiat: string; amount: number; ip?: string }): Promise<OnrampLink> {
  const env = bindings() as unknown as { MOONPAY_PK?: string; MOONPAY_SK?: string; MOONPAY_ENV?: string };
  const mode: "sandbox" | "live" = env.MOONPAY_ENV === "live" ? "live" : "sandbox";
  // No live partner keys (no registered company): MoonPay's public consumer flow. Same currency (usdc_arc), same KYC by MoonPay,
  // the buyer pastes the wallet address inside the widget instead of us pre-filling it. Sandbox keys are useless for Arc (no usdc_arc in test mode).
  if (!env.MOONPAY_PK || !env.MOONPAY_SK || mode !== "live") {
    const fiat0 = /^[a-z]{3}$/.test(input.fiat) ? input.fiat : "usd"; const amount0 = Math.min(10_000, Math.max(20, Math.round(input.amount || 50)));
    return { configured: true, env: "live", mode: "public", url: `https://buy.moonpay.com/?currencyCode=usdc_arc&baseCurrencyCode=${fiat0}&baseCurrencyAmount=${amount0}` };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.wallet)) return { configured: true, env: mode, reason: "bad wallet" };
  const fiat = /^[a-z]{3}$/.test(input.fiat) ? input.fiat : "usd";
  const amount = Math.min(10_000, Math.max(20, Math.round(input.amount || 50)));
  const q = new URLSearchParams();
  q.set("apiKey", env.MOONPAY_PK);
  q.set("currencyCode", CODE[mode]);
  q.set("walletAddress", input.wallet);
  q.set("baseCurrencyCode", fiat);
  q.set("baseCurrencyAmount", String(amount));
  q.set("showWalletAddressForm", "true");           // the buyer sees where it goes, cannot change it
  q.set("colorCode", "#2e7cff");
  q.set("redirectURL", "https://arctools.fun/buy?done=1");
  if (input.ip && mode === "live") q.set("allowedIpAddress", await hmacB64(env.MOONPAY_SK, input.ip));   // required to go live: widget loads only for this IP
  const search = "?" + q.toString();                 // URLSearchParams encodes every value, as MoonPay requires
  const signature = await hmacB64(env.MOONPAY_SK, search);
  return { configured: true, env: mode, mode: "partner", url: `${HOSTS[mode]}${search}&signature=${encodeURIComponent(signature)}` };
}

const API = "https://api.moonpay.com";
type Env = { MOONPAY_PK?: string; MOONPAY_SK?: string; MOONPAY_ENV?: string };
const keys = () => bindings() as unknown as Env;

export type OnrampQuote = { configured: boolean; env?: "sandbox" | "live"; usdc?: number; fee?: number; networkFee?: number; total?: number; rate?: number; min?: number; max?: number; reason?: string };

/** live buy quote for the card method — what the widget will show, fetched with the publishable key */
export async function moonpayQuote(input: { fiat: string; amount: number }): Promise<OnrampQuote> {
  const env = keys(); const code = CODE[env.MOONPAY_ENV === "live" ? "live" : "sandbox"];
  if (!env.MOONPAY_PK || env.MOONPAY_ENV !== "live") return { configured: false, reason: "quote needs live partner keys" };
  const fiat = /^[a-z]{3}$/.test(input.fiat) ? input.fiat : "usd"; const amount = Math.max(1, Math.round(input.amount || 50));
  try {
    const [q, l] = await Promise.all([
      fetch(`${API}/v3/currencies/${code}/buy_quote?apiKey=${env.MOONPAY_PK}&baseCurrencyCode=${fiat}&baseCurrencyAmount=${amount}&paymentMethod=credit_debit_card`).then((r) => r.json() as Promise<Record<string, number | string>>),
      fetch(`${API}/v3/currencies/${code}/limits?apiKey=${env.MOONPAY_PK}&baseCurrencyCode=${fiat}&paymentMethod=credit_debit_card`).then((r) => r.json() as Promise<{ baseCurrency?: { minBuyAmount?: number; maxBuyAmount?: number } }>).catch(() => ({} as { baseCurrency?: { minBuyAmount?: number; maxBuyAmount?: number } })),
    ]);
    if (typeof q.quoteCurrencyAmount !== "number") return { configured: true, reason: String(q.message ?? "no quote") };
    return { configured: true, env: env.MOONPAY_ENV === "live" ? "live" : "sandbox", usdc: q.quoteCurrencyAmount, fee: Number(q.feeAmount ?? 0), networkFee: Number(q.networkFeeAmount ?? 0), total: Number(q.totalAmount ?? amount), rate: Number(q.quoteCurrencyPrice ?? 0), min: l.baseCurrency?.minBuyAmount, max: l.baseCurrency?.maxBuyAmount };
  } catch (e) { return { configured: true, reason: String((e as Error).message ?? e) }; }
}

export type OnrampTx = { id: string; status: string; fiat: number; fiatCode: string; usdc: number | null; created: string; updated: string; failureReason: string | null; txHash: string | null };

/** the buyer's recent MoonPay transactions for this wallet — secret key, server-side only. Replaces a webhook: the page polls this. */
export async function moonpayTransactions(wallet: string): Promise<{ configured: boolean; txs: OnrampTx[]; reason?: string }> {
  const env = keys();
  if (!env.MOONPAY_SK || env.MOONPAY_ENV !== "live") return { configured: false, txs: [] };
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { configured: true, txs: [], reason: "bad wallet" };
  try {
    const r = await fetch(`${API}/v1/transactions?walletAddress=${wallet}&limit=10`, { headers: { Authorization: `Api-Key ${env.MOONPAY_SK}` } });
    const j = await r.json() as unknown;
    const rows = Array.isArray(j) ? j : ((j as { data?: unknown[] }).data ?? []);
    if (!r.ok) return { configured: true, txs: [], reason: `moonpay ${r.status}` };
    return { configured: true, txs: (rows as Record<string, unknown>[]).map((t) => ({
      id: String(t.id), status: String(t.status), fiat: Number(t.baseCurrencyAmount ?? 0), fiatCode: String((t.baseCurrency as { code?: string } | undefined)?.code ?? t.baseCurrencyCode ?? ""),
      usdc: typeof t.quoteCurrencyAmount === "number" ? t.quoteCurrencyAmount : null, created: String(t.createdAt ?? ""), updated: String(t.updatedAt ?? ""),
      failureReason: (t.failureReason as string | null) ?? null, txHash: (t.cryptoTransactionId as string | null) ?? null,
    })) };
  } catch (e) { return { configured: true, txs: [], reason: String((e as Error).message ?? e) }; }
}
