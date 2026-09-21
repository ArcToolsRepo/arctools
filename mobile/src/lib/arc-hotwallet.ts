/**
 * In-site "hot wallet" (GMGN-style): a key generated in the browser, encrypted with a passcode (PBKDF2 + AES-GCM)
 * and kept in localStorage. Never leaves the device. Lets the site buy/sell with one click — no wallet popups.
 * Transactions are legacy (type 0) signed locally and broadcast to Arc RPCs.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp from "@noble/secp256k1";

const STORE = "arctools_hot_v1";
const CHAIN_ID = 5042n;
const SEND_RPCS = ["https://arctools.fun/api/rpc"];   // the site's RPC proxy (CORS open; the app has no same origin)   // Worker proxy (public Arc RPCs have no CORS for browsers)
// reads go through our own Worker proxy: the public relay bans browser IPs and answers with the bare word
// "banned", which is not JSON — that is why the USDC balance tile sat on "…" forever
const READ_RPC = "https://arctools.fun/api/rpc";
const READ_FALLBACK = "https://rpc-production-ba7a.up.railway.app";
const UNLOCK_MS = 30 * 60_000;

type Stored = { addr: string; iv: string; salt: string; ct: string; createdAt: number; riv?: string; rsalt?: string; rct?: string };
/** Recovery code: 5 groups of 5 (base32, no confusable chars). Encrypts a second copy of the key. */
export function makeRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(25));
  const chars = Array.from(b).map((x) => alphabet[x % alphabet.length]);
  return [0, 5, 10, 15, 20].map((i) => chars.slice(i, i + 5).join("")).join("-");
}
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z2-9]/g, "");
let _key: Uint8Array | null = null;
let _addr: string | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const SESSION = "arctools_hot_session";   // unlocked key for this tab only (cleared on tab close / lock / 30 min)

function saveSession() {
  try { if (_key && _addr) sessionStorage.setItem(SESSION, JSON.stringify({ k: hex(_key), a: _addr, exp: Date.now() + UNLOCK_MS })); } catch { /* ignore */ }
}
function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION);
    if (!raw) return;
    const s = JSON.parse(raw) as { k: string; a: string; exp: number };
    if (Date.now() > s.exp) { sessionStorage.removeItem(SESSION); return; }
    _key = unhex(s.k); _addr = s.a; armLock();
  } catch { /* ignore */ }
}

export function onHotChange(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((f) => f());

const hex = (b: Uint8Array) => "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array((h.replace(/^0x/, "").match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => new Uint8Array(atob(s).split("").map((c) => c.charCodeAt(0)));

export function addressOf(priv: Uint8Array): string {
  const pub = secp.getPublicKey(priv, false).slice(1);
  const h = keccak_256(pub);
  const raw = hex(h.slice(12));
  // EIP-55 checksum
  const lower = raw.slice(2);
  const hh = Array.from(keccak_256(new TextEncoder().encode(lower))).map((x) => x.toString(16).padStart(2, "0")).join("");
  return "0x" + lower.split("").map((c, i) => (parseInt(hh[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}

async function deriveAes(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 200_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function hasWallet(): boolean {
  try { return !!localStorage.getItem(STORE); } catch { return false; }
}
export function storedAddress(): string | null {
  try { const s = localStorage.getItem(STORE); return s ? (JSON.parse(s) as Stored).addr : null; } catch { return null; }
}
export function isUnlocked(): boolean { return !!_key; }
export function hotAddress(): string | null { return _addr ?? storedAddress(); }

function armLock() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(lock, UNLOCK_MS);
  saveSession();
}
export function lock() { _key = null; if (_timer) clearTimeout(_timer); _timer = null; try { sessionStorage.removeItem(SESSION); } catch { /* ignore */ } emit(); }
if (typeof window !== "undefined") restoreSession();

async function encryptWith(secret: string, priv: Uint8Array) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await deriveAes(secret, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, aes, priv as BufferSource));
  return { iv: b64(iv), salt: b64(salt), ct: b64(ct) };
}

async function persist(priv: Uint8Array, pass: string, recoveryCode: string) {
  const a = await encryptWith(pass, priv);
  const r = await encryptWith(normCode(recoveryCode), priv);
  const s: Stored = { addr: addressOf(priv), iv: a.iv, salt: a.salt, ct: a.ct, riv: r.iv, rsalt: r.salt, rct: r.ct, createdAt: Date.now() };
  localStorage.setItem(STORE, JSON.stringify(s));
  _key = priv; _addr = s.addr; armLock(); emit();
  return s.addr;
}

export type Created = { address: string; privateKey: string; recoveryCode: string };

/** Creates the wallet. Returns the key + recovery code ONCE — the UI must force the user to save them. */
export async function createWallet(pass: string): Promise<Created> {
  if (pass.length < 6) throw new Error("Passcode: at least 6 characters.");
  const priv = secp.utils.randomPrivateKey();
  const code = makeRecoveryCode();
  const address = await persist(priv, pass, code);
  return { address, privateKey: hex(priv), recoveryCode: code };
}
export async function importWallet(privHex: string, pass: string): Promise<Created> {
  const priv = unhex(privHex.trim());
  if (priv.length !== 32) throw new Error("Private key must be 32 bytes hex.");
  if (pass.length < 6) throw new Error("Passcode: at least 6 characters.");
  const code = makeRecoveryCode();
  const address = await persist(priv, pass, code);
  return { address, privateKey: hex(priv), recoveryCode: code };
}
/** Forgot the passcode: decrypt with the recovery code and set a new passcode (new recovery code too). */
export async function recoverWallet(code: string, newPass: string): Promise<Created> {
  const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Stored | null;
  if (!s || !s.rct || !s.riv || !s.rsalt) throw new Error("No recovery data on this device (wallet created before recovery codes existed) — import the private key instead.");
  if (newPass.length < 6) throw new Error("New passcode: at least 6 characters.");
  const aes = await deriveAes(normCode(code), unb64(s.rsalt));
  let priv: Uint8Array;
  try {
    priv = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.riv) as BufferSource }, aes, unb64(s.rct) as BufferSource));
  } catch {
    throw new Error("Recovery code does not match this wallet.");
  }
  const fresh = makeRecoveryCode();
  const address = await persist(priv, newPass, fresh);
  return { address, privateKey: hex(priv), recoveryCode: fresh };
}
export function hasRecovery(): boolean {
  try { const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Stored | null; return !!s?.rct; } catch { return false; }
}
export async function unlock(pass: string): Promise<string> {
  const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Stored | null;
  if (!s) throw new Error("No wallet on this device.");
  const aes = await deriveAes(pass, unb64(s.salt));
  try {
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) as BufferSource }, aes, unb64(s.ct) as BufferSource));
    _key = pt; _addr = s.addr; armLock(); emit();
    return s.addr;
  } catch {
    throw new Error("Wrong passcode.");
  }
}
export async function exportKey(pass: string): Promise<string> {
  await unlock(pass);
  return hex(_key!);
}
export function forgetWallet() { localStorage.removeItem(STORE); lock(); _addr = null; emit(); }

// ---------------- RPC ----------------
async function rpc(method: string, params: unknown[], url = READ_RPC): Promise<any> {
  let lastErr = "";
  for (const endpoint of url === READ_RPC ? [READ_RPC, READ_FALLBACK] : [url]) {
    let body = "";
    try {
      const r = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      });
      body = await r.text();
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "network error";
      continue;
    }
    let j: { result?: any; error?: { message?: string } };
    try {
      j = JSON.parse(body);
    } catch {
      // a blocked or rate-limited endpoint replies in plain text; never let that reach JSON.parse unguarded
      lastErr = body.trim().slice(0, 40) || "empty response";
      continue;
    }
    if (j.error) throw new Error(j.error.message ?? "rpc error");
    return j.result;
  }
  throw new Error(`rpc unavailable (${lastErr})`);
}
export async function hotBalance(addr = hotAddress()): Promise<number> {
  if (!addr) return 0;
  return Number(BigInt(await rpc("eth_getBalance", [addr, "latest"]))) / 1e18;
}
export async function hotCall(to: string, data: string): Promise<string> { return rpc("eth_call", [{ to, data }, "latest"]); }

// ---------------- RLP + signing (legacy tx) ----------------
function rlpEncode(item: Uint8Array | Uint8Array[]): Uint8Array {
  if (Array.isArray(item)) {
    const body = concat(item.map(rlpEncode));
    return concat([lenPrefix(body.length, 0xc0), body]);
  }
  if (item.length === 1 && item[0] < 0x80) return item;
  return concat([lenPrefix(item.length, 0x80), item]);
}
function lenPrefix(len: number, base: number): Uint8Array {
  if (len < 56) return new Uint8Array([base + len]);
  const bl = toMinBytes(BigInt(len));
  return concat([new Uint8Array([base + 55 + bl.length]), bl]);
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function toMinBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([]);
  let h = n.toString(16); if (h.length % 2) h = "0" + h;
  return unhex(h);
}

export type HotTx = { to: string; data?: string; value?: bigint; gasLimit?: bigint };

/** Sign + broadcast. Estimates gas (×1.25) when gasLimit is not given. Returns tx hash. */
export async function hotSend(tx: HotTx): Promise<string> {
  if (!_key || !_addr) throw new Error("Wallet locked.");
  armLock();
  const from = _addr;
  const [nonceHex, gasPriceHex] = await Promise.all([rpc("eth_getTransactionCount", [from, "pending"], SEND_RPCS[0]), rpc("eth_gasPrice", [], SEND_RPCS[0])]);
  let gas = tx.gasLimit;
  if (!gas) {
    const est = await rpc("eth_estimateGas", [{ from, to: tx.to, data: tx.data ?? "0x", value: "0x" + (tx.value ?? 0n).toString(16) }], SEND_RPCS[0]).catch((e: Error) => { throw new Error("Simulation failed: " + e.message); });
    gas = (BigInt(est) * 125n) / 100n + 20_000n;
  }
  const gasPrice = (BigInt(gasPriceHex) * 115n) / 100n;
  const fields = [toMinBytes(BigInt(nonceHex)), toMinBytes(gasPrice), toMinBytes(gas), unhex(tx.to), toMinBytes(tx.value ?? 0n), unhex(tx.data ?? "0x"), toMinBytes(CHAIN_ID), new Uint8Array([]), new Uint8Array([])];
  const sigHash = keccak_256(rlpEncode(fields));
  const sig = await secp.signAsync(sigHash, _key, { lowS: true });
  const v = CHAIN_ID * 2n + 35n + BigInt(sig.recovery);
  const signed = rlpEncode([fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], toMinBytes(v), toMinBytes(sig.r), toMinBytes(sig.s)]);
  const raw = hex(signed);
  let lastErr: Error | null = null;
  for (const url of SEND_RPCS) {
    try { return await rpc("eth_sendRawTransaction", [raw], url); } catch (e) { lastErr = e as Error; }
  }
  throw lastErr ?? new Error("broadcast failed");
}

/** EIP-191 personal_sign with the trading wallet (used to prove ownership for referral claims). */
export async function hotSignMessage(message: string): Promise<string> {
  if (!_key || !_addr) throw new Error("Wallet locked.");
  armLock();
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\u0019Ethereum Signed Message:\n${body.length}`);
  const data = new Uint8Array(prefix.length + body.length); data.set(prefix); data.set(body, prefix.length);
  const sig = await secp.signAsync(keccak_256(data), _key, { lowS: true });
  const r = sig.r.toString(16).padStart(64, "0"), sv = sig.s.toString(16).padStart(64, "0"), v = (27 + sig.recovery).toString(16).padStart(2, "0");
  return "0x" + r + sv + v;
}

export async function hotWait(hash: string, timeoutMs = 90_000): Promise<{ status: number; logs: { address: string; topics: string[]; data: string }[] }> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await rpc("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) return { status: Number(r.status), logs: (r.logs ?? []) as { address: string; topics: string[]; data: string }[] };
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("Timed out waiting for the receipt.");
}

/** Native USDC transfer (withdraw). */
export async function hotWithdraw(to: string, amountUsdc: number): Promise<string> {
  return hotSend({ to, value: BigInt(Math.round(amountUsdc * 1e6)) * 10n ** 12n, gasLimit: 30_000n });
}

// ---------------------------------------------------------------- ArcOrders (limit / TP / SL) — EIP-712 signing
export const ARC_ORDERS = "0x1abE31ba5d3c496635EFd35CB0B7f7d86BA30aF2";
export type ArcOrder = { maker: string; token: string; isBuy: boolean; amountIn: bigint; minRate: bigint; expiry: bigint; salt: bigint };

const utf8 = (s: string) => new TextEncoder().encode(s);
const pad32 = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
const u256 = (v: bigint) => v.toString(16).padStart(64, "0");
const ORDER_TYPEHASH = "0x" + Array.from(keccak_256(utf8("Order(address maker,address token,bool isBuy,uint256 amountIn,uint256 minRate,uint256 expiry,uint256 salt)"))).map((b) => b.toString(16).padStart(2, "0")).join("");
const DOMAIN_TYPEHASH = "0x" + Array.from(keccak_256(utf8("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))).map((b) => b.toString(16).padStart(2, "0")).join("");
const h32 = (u8: Uint8Array) => "0x" + Array.from(keccak_256(u8)).map((b) => b.toString(16).padStart(2, "0")).join("");
const hexBytes = (hex: string) => { const s = hex.replace(/^0x/, ""); const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return o; };

export function arcOrderDigest(o: ArcOrder): string {
  const domain = h32(hexBytes(pad32(DOMAIN_TYPEHASH) + pad32(h32(utf8("ArcOrders"))) + pad32(h32(utf8("1"))) + u256(CHAIN_ID) + pad32(ARC_ORDERS)));
  const struct = h32(hexBytes(pad32(ORDER_TYPEHASH) + pad32(o.maker) + pad32(o.token) + u256(o.isBuy ? 1n : 0n) + u256(o.amountIn) + u256(o.minRate) + u256(o.expiry) + u256(o.salt)));
  return h32(hexBytes("1901" + pad32(domain) + pad32(struct)));
}

/** Sign an ArcOrders order with the trading wallet (EIP-712, no gas). Returns 65-byte hex signature (v = 27/28). */
export async function hotSignOrder(o: ArcOrder): Promise<string> {
  if (!_key || !_addr) throw new Error("Wallet locked.");
  armLock();
  const digest = hexBytes(arcOrderDigest(o));
  const sig = await secp.signAsync(digest, _key, { lowS: true });
  return "0x" + sig.r.toString(16).padStart(64, "0") + sig.s.toString(16).padStart(64, "0") + (27 + sig.recovery).toString(16).padStart(2, "0");
}

/** ERC-20 approve(spender, amount) from the trading wallet. */
export async function hotApprove(token: string, spender: string, amount: bigint): Promise<string> {
  return hotSend({ to: token, data: "0x095ea7b3" + pad32(spender) + u256(amount) });
}

/** allowance(owner, spender) as bigint. */
export async function hotAllowance(token: string, owner: string, spender: string): Promise<bigint> {
  const r = await hotCall(token, "0xdd62ed3e" + pad32(owner) + pad32(spender));
  return r && r !== "0x" ? BigInt(r) : 0n;
}
