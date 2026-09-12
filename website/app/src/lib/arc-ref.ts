/**
 * Referral glue for the site. The ledger lives in the bot API (shared with the sniper).
 *  - ?ref=CODE on any page is remembered in this browser
 *  - as soon as a wallet address is known (connected or trading wallet) it is bound to that code — once
 *  - after every confirmed swap the page reports (tx, fee) and the referrer is credited 25% of the fee
 */
const API = "https://bot-production-4200.up.railway.app";
const KEY = "arctools_ref";
const BOUND = "arctools_ref_bound";

export function captureRef() {
  try {
    const c = new URLSearchParams(window.location.search).get("ref");
    if (c && /^[A-Z0-9]{4,12}$/i.test(c)) localStorage.setItem(KEY, c.toUpperCase());
  } catch { /* ignore */ }
}
export function refCode(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }

export async function bindRef(wallet: string | null | undefined) {
  const code = refCode();
  if (!code || !wallet) return;
  const w = wallet.toLowerCase();
  try { if ((localStorage.getItem(BOUND) ?? "").split(",").includes(w)) return; } catch { /* ignore */ }
  try {
    await fetch(`${API}/api/ref/bind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject_kind: "wallet", subject_id: w, code }) });
    localStorage.setItem(BOUND, [...new Set([...(localStorage.getItem(BOUND) ?? "").split(",").filter(Boolean), w])].join(","));
  } catch { /* offline: retry next time */ }
}

/** Report a confirmed swap. feeUsd = the platform fee actually charged on-chain (1.5% of the USDC leg). */
export function creditRef(wallet: string, tx: string, feeUsd: number) {
  if (!wallet || !tx || !(feeUsd > 0)) return;
  // the Worker forwards it with the shared secret; the browser never sees the key
  void fetch("/api/ref-credit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: wallet.toLowerCase(), tx, fee_usd: feeUsd }), keepalive: true }).catch(() => null);
}
