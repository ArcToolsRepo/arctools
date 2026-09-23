/** x402 pay-per-call for the ArcTools API — scheme `exact` on Arc's USDC facade (Circle FiatTokenV2 behind a proxy,
 *  EIP-3009 `transferWithAuthorization` verified on-chain). We are resource server AND facilitator: this file builds the
 *  402 challenge and verifies the signed authorization; settlement is done by the buybot relayer (it holds the gas key).
 *  Docs: docs/x402-design.md. */
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp from "@noble/secp256k1";

import { rpc } from "@/lib/arc-api";
import { bindings } from "@/lib/bindings.server";

export const USDC = "0x3600000000000000000000000000000000000000";
export const TREASURY = "0xb35c471b31d636b96f95b84e7a27d69b63235c0d";
export const NETWORK = "eip155:5042";
export const CHAIN_ID = 5042;
export const BOT = "https://bot-production-4200.up.railway.app";
/** price per call in 6-dec USDC units (what the ERC-20 facade counts in) */
export const PRICES: Record<string, { amount: string; upstream: string; description: string }> = {
  "token-stats": { amount: "5000", upstream: "/api/token-stats", description: "price, 5m/1h/6h/24h change, volume, txns, traders, supply, mcap" },
  "dev-audit": { amount: "20000", upstream: "/api/dev-audit", description: "deployer history, previous tokens, funder cluster, bundles, clone-farm flag" },
  "sell-sim": { amount: "30000", upstream: "/api/sim", description: "on-chain buy-then-sell round-trip simulation, honeypot verdict, realised slippage" },
  "token-report": { amount: "40000", upstream: "", description: "token-stats + dev-audit + sell-sim in one call" },
};
export const MAX_TIMEOUT = 60;

export type Auth = { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
export type Payment = { x402Version: number; scheme: string; network: string; payload: { signature: string; authorization: Auth } };

// ───────── EIP-712 (no viem in this project: @noble does the math, keccak does the rest) ─────────
const hex = (b: Uint8Array) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const kt = (s: string) => keccak_256(new TextEncoder().encode(s));
const pad = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const num = (v: string | bigint) => BigInt(v).toString(16).padStart(64, "0");
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

const DOMAIN_SEPARATOR = keccak_256(fromHex(
  hex(kt("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")) +
  hex(kt("USDC")).slice(2) + hex(kt("2")).slice(2) + num(BigInt(CHAIN_ID)) + pad(USDC)));
const TWA_TYPEHASH = kt("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

export function digest(a: Auth): Uint8Array {
  const structHash = keccak_256(fromHex(hex(TWA_TYPEHASH) + pad(a.from) + pad(a.to) + num(a.value) + num(a.validAfter) + num(a.validBefore) + pad(a.nonce)));
  return keccak_256(concat(new Uint8Array([0x19, 0x01]), DOMAIN_SEPARATOR, structHash));
}
export function recover(a: Auth, signature: string): string | null {
  try {
    const sig = fromHex(signature); if (sig.length !== 65) return null;
    let v = sig[64]; if (v >= 27) v -= 27; if (v > 1) return null;
    const pub = secp.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(digest(a)).toRawBytes(false);
    return hex(keccak_256(pub.slice(1)).slice(12));
  } catch { return null; }
}
/** the on-chain domain separator, to assert our constant matches the facade (run once at boot in dev) */
export const DOMAIN_SEPARATOR_HEX = hex(DOMAIN_SEPARATOR);

// ───────── challenge ─────────
export function challengeBody(resource: string, endpoint: string, error = "payment required") {
  const p = PRICES[endpoint];
  return { x402Version: 1, error, accepts: [{
    scheme: "exact", network: NETWORK, asset: USDC, payTo: TREASURY, maxAmountRequired: p.amount, resource,
    description: `ArcTools ${endpoint}: ${p.description}`, mimeType: "application/json", maxTimeoutSeconds: MAX_TIMEOUT,
    extra: { name: "USDC", version: "2" },
  }] };
}
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "X-PAYMENT, content-type", "access-control-expose-headers": "PAYMENT-REQUIRED, X-PAYMENT-RESPONSE" };
/** base64 of a UTF-8 JSON string (btoa alone throws on any char > 0xFF) */
export const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
export function challenge(resource: string, endpoint: string, error?: string) {
  const body = challengeBody(resource, endpoint, error);
  return new Response(JSON.stringify(body), { status: 402, headers: { "content-type": "application/json", "cache-control": "no-store", "PAYMENT-REQUIRED": b64(JSON.stringify(body)), ...CORS } });
}
export const corsHeaders = CORS;

// ───────── verify ─────────
export type Verified = { ok: true; from: string; key: string; value: string } | { ok: false; reason: string };
export async function verify(p: Payment, endpoint: string): Promise<Verified> {
  const a = p?.payload?.authorization; const sig = p?.payload?.signature;
  if (!a || !sig) return { ok: false, reason: "malformed payment" };
  if (p.x402Version !== 1 || p.scheme !== "exact" || p.network !== NETWORK) return { ok: false, reason: `unsupported scheme/network (want exact on ${NETWORK})` };
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.from) || !/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) return { ok: false, reason: "bad from/nonce" };
  if (a.to.toLowerCase() !== TREASURY) return { ok: false, reason: "payTo mismatch" };
  const price = BigInt(PRICES[endpoint].amount);
  if (BigInt(a.value) < price) return { ok: false, reason: `amount ${a.value} below price ${price}` };
  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validAfter) > now) return { ok: false, reason: "authorization not yet valid" };
  if (Number(a.validBefore) < now + 5) return { ok: false, reason: "authorization expires too soon (need ≥ 5 s for settlement)" };
  if (Number(a.validBefore) - now > 3600) return { ok: false, reason: "authorization window too long (max 1 h)" };
  const signer = recover(a, sig);
  if (!signer || signer !== a.from.toLowerCase()) return { ok: false, reason: "signature does not recover to `from`" };
  const key = hex(keccak_256(fromHex(sig)));
  const kv = bindings().KV;
  if (kv) {
    if (await kv.get(`x402:nonce:${a.nonce.toLowerCase()}`)) return { ok: false, reason: "nonce already seen" };
    if (await kv.get(`x402:deny:${a.from.toLowerCase()}`)) return { ok: false, reason: "a previous payment from this address failed to settle; it is settle-first for 24 h — POST the same payment to /api/x402/settle and retry" };
  }
  // chain: nonce unused + balance sufficient (two cheap eth_calls on our node)
  const [used, bal] = await Promise.all([
    rpc("eth_call", [{ to: USDC, data: "0xe94a0102" + pad(a.from) + pad(a.nonce) }, "latest"]) as Promise<string>,
    rpc("eth_call", [{ to: USDC, data: "0x70a08231" + pad(a.from) }, "latest"]) as Promise<string>,
  ]);
  if (BigInt(used || "0x0") !== 0n) return { ok: false, reason: "nonce already used on-chain" };
  if (BigInt(bal || "0x0") < BigInt(a.value)) return { ok: false, reason: `insufficient USDC: balance ${BigInt(bal || "0x0")} < ${a.value}` };
  if (kv) await kv.put(`x402:nonce:${a.nonce.toLowerCase()}`, "1", { expirationTtl: 3700 });
  return { ok: true, from: a.from.toLowerCase(), key, value: a.value };
}

/** hand the settlement to the relayer; returns what it said (or the error) — callers decide fast-path vs settle-first */
export async function settle(p: Payment, key: string, endpoint: string, waitForTx = false): Promise<{ ok: boolean; tx?: string; reason?: string }> {
  const env = bindings() as unknown as { X402_SETTLE_AUTH?: string };
  try {
    const r = await fetch(`${BOT}/api/x402/settle${waitForTx ? "?wait=1" : ""}`, { method: "POST", headers: { "content-type": "application/json", "X-Settle-Auth": env.X402_SETTLE_AUTH ?? "" }, body: JSON.stringify({ key, endpoint, payment: p }) });
    return await r.json() as { ok: boolean; tx?: string; reason?: string };
  } catch (e) { return { ok: false, reason: String((e as Error).message ?? e) }; }
}
