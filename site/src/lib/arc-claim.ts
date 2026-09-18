/**
 * USDC pay links (ArcClaim). A link carries a one-time key; whoever opens it names the wallet that gets paid.
 * The key signs (id, recipient) and the buybot relayer submits the claim, so collecting needs no gas.
 * Every link is its own on-chain record (sender → recipient); nothing is pooled. Fee 2 % at collection.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp from "@noble/secp256k1";

import { BOT_API } from "@/lib/bot-api";

export const CLAIM = "0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6";
export const CLAIM_CHAIN = 5042n;
export const FEE_BPS = 200;
export const MIN_USDC = 0.1;
const KEYS = "arctools_paylinks_v1";   // id -> key hex, this device only (lets the sender re-show a link)

export type LinkState = {
  id: number; sender: string; claimKey: string; amount: string; expiry: number; expired: boolean;
  status: "open" | "claimed" | "refunded"; feeBps: number; recipient?: string | null; tx?: string | null; paid?: string;
};

const hex = (b: Uint8Array) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));
const p32 = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const pnum = (n: bigint) => n.toString(16).padStart(64, "0");
const sel = (sig: string) => hex(keccak_256(new TextEncoder().encode(sig))).slice(0, 10);

export const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

export function newKey(): { key: Uint8Array; address: string } {
  const key = secp.utils.randomPrivateKey();
  const pub = secp.getPublicKey(key, false).slice(1);
  return { key, address: "0x" + hex(keccak_256(pub)).slice(-40) };
}

export function encodeCode(id: number, key: Uint8Array): string { return `${id}.${b64(key)}`; }
export function decodeCode(code: string): { id: number; key: Uint8Array } | null {
  const m = /^(\d+)[._]([A-Za-z0-9_-]{43})$/.exec(code.trim());   // web uses ".", Telegram start payloads need "_"
  if (!m) return null;
  const key = unb64(m[2]);
  return key.length === 32 ? { id: Number(m[1]), key } : null;
}
export function linksFor(code: string) {
  return { site: `https://arctools.fun/pay#${code}`, bot: `https://t.me/ArcSniper_bot?start=claim_${code.replace(".", "_")}` };
}

/** create(address claimKey, uint64 ttl) calldata; value = amount in native USDC (18 dec). */
export function encodeCreate(claimKey: string, ttlSeconds: number): string {
  return sel("create(address,uint64)") + p32(claimKey) + pnum(BigInt(ttlSeconds));
}
export function toWei(usdc: number): bigint { return BigInt(Math.round(usdc * 1e6)) * 10n ** 12n; }

/** keccak(abi.encode("ArcClaim", chainid, contract, id, recipient)) — the contract wraps it in EIP-191 itself. */
export function claimInner(id: number, recipient: string): Uint8Array {
  // abi.encode of a dynamic string: offset(0xa0) + 4 static words + string length + padded bytes
  const s = "ArcClaim";
  const body = pnum(0xa0n) + pnum(CLAIM_CHAIN) + p32(CLAIM) + pnum(BigInt(id)) + p32(recipient) + pnum(BigInt(s.length)) + Buffer_from(s);
  return keccak_256(unhex(body));
}
function Buffer_from(s: string): string { return hex(new TextEncoder().encode(s)).slice(2).padEnd(64, "0"); }

export async function signClaim(key: Uint8Array, id: number, recipient: string): Promise<string> {
  const inner = claimInner(id, recipient);
  const prefix = new TextEncoder().encode("\u0019Ethereum Signed Message:\n32");
  const data = new Uint8Array(prefix.length + 32); data.set(prefix); data.set(inner, prefix.length);
  const sig = await secp.signAsync(keccak_256(data), key, { lowS: true });
  return "0x" + sig.r.toString(16).padStart(64, "0") + sig.s.toString(16).padStart(64, "0") + (27 + sig.recovery).toString(16).padStart(2, "0");
}

export async function readLink(id: number): Promise<LinkState | null> {
  const r = await fetch(`${BOT_API}/api/claim/${id}`, { cache: "no-store" });
  if (!r.ok) return null;
  const j = (await r.json()) as LinkState & { error?: string };
  return j.error ? null : j;
}
export async function linksBySender(wallet: string): Promise<LinkState[]> {
  const r = await fetch(`${BOT_API}/api/claim/by-sender?wallet=${wallet.toLowerCase()}`, { cache: "no-store" });
  if (!r.ok) return [];
  return ((await r.json()) as { links?: LinkState[] }).links ?? [];
}
export async function submitClaim(id: number, recipient: string, sig: string): Promise<{ tx: string; paid: string; fee: string; recipient: string }> {
  const r = await fetch(`${BOT_API}/api/claim/submit`, { body: JSON.stringify({ id, recipient, sig }), headers: { "Content-Type": "application/json" }, method: "POST" });
  const j = (await r.json()) as { error?: string; tx: string; paid: string; fee: string; recipient: string };
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

/** Link id from a create() receipt: Created(id indexed, sender indexed, claimKey indexed, …). */
export function idFromLogs(logs: { address: string; topics: string[] }[]): number | null {
  const topic = hex(keccak_256(new TextEncoder().encode("Created(uint256,address,address,uint256,uint64)")));
  for (const l of logs) if (l.address.toLowerCase() === CLAIM.toLowerCase() && l.topics[0]?.toLowerCase() === topic) return Number(BigInt(l.topics[1]));
  return null;
}

export function rememberKey(id: number, key: Uint8Array) {
  try { const m = JSON.parse(localStorage.getItem(KEYS) ?? "{}") as Record<string, string>; m[String(id)] = hex(key); localStorage.setItem(KEYS, JSON.stringify(m)); } catch { /* ignore */ }
}
export function storedKey(id: number): Uint8Array | null {
  try { const m = JSON.parse(localStorage.getItem(KEYS) ?? "{}") as Record<string, string>; return m[String(id)] ? unhex(m[String(id)]) : null; } catch { return null; }
}
