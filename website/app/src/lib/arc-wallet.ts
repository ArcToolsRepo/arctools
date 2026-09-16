/**
 * Client-side wallet + calldata helpers for ArcPad (browser only — uses
 * window.ethereum). Never import this from server code.
 */

export const CHAIN_HEX = "0x13b2"; // 5042
export const RPC_URL = "https://rpc-production-ba7a.up.railway.app";
export const PAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE";
export const VAULT = "0x48aDA931C2C220B074c39449B7e70860A3B4C277";     // v3 (pad v3 fees + drops)
export const VAULT_V2 = "0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd";  // legacy: v2 fees + old drops, withdraw/claim only
export const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";

export const FN = {
  approve: "0x095ea7b3",
  balanceOf: "0x70a08231",
  buy: "0xcce7ec13",
  claimDrop: "0x75bf81d6",
  claimRewards: "0xef5cfb8c",
  claimUsdc: "0x1d6ee8eb",
  claimable: "0xd4570c1c",
  claimableUsdc: "0x55d2ac86",
  createToken: "0xa3059b23",
  quoteBuy: "0x0d7a94f6",
  quoteSell: "0xd98b2f5c",
  sell: "0x6a272462",
  stake: "0xa694fc3a",
  staked: "0x98807d84",
  withdraw: "0x2e1a7d4d",
} as const;

export const p32 = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
export const pnum = (n: bigint) => n.toString(16).padStart(64, "0");

/** ABI-encode a dynamic string (offset handled by caller). */
function encStringTail(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, "0");
  return pnum(BigInt(bytes.length)) + (bytes.length === 0 ? "" : padded);
}

/** createToken(string,string,uint16,uint16,uint16,address,string,string,string,address) */
export function encodeCreateToken(
  name: string, symbol: string, marketingBps: number, rewardsBps: number,
  burnBps: number, marketingWallet: string, website: string, twitter: string, telegram: string,
  rewardToken: string = "0x0000000000000000000000000000000000000000",
): string {
  const heads: string[] = [];
  const tails: string[] = [];
  const dyn = [name, symbol, website, twitter, telegram];
  const staticVals = [
    null, null, pnum(BigInt(marketingBps)), pnum(BigInt(rewardsBps)),
    pnum(BigInt(burnBps)), p32(marketingWallet), null, null, null, p32(rewardToken),
  ];
  const headCount = 10;
  let tailOffset = headCount * 32;
  let d = 0;
  for (let i = 0; i < headCount; i++) {
    if (staticVals[i] !== null) {
      heads.push(staticVals[i] as string);
    } else {
      const t = encStringTail(dyn[d++]);
      heads.push(pnum(BigInt(tailOffset)));
      tails.push(t);
      tailOffset += t.length / 2;
    }
  }
  return FN.createToken + heads.join("") + tails.join("");
}

// ---------------- ArcPad v3: quote tokens, launch modes, graduation ----------------
export const PAD_V3 = "0x2726AeC64D8a9BC41B9940dDA5D21c889458B348";
export const TOLLY = "0xbc43ce8dec648ea298c4275559b81d6261c90b67";
export const FN3 = {
  buyToken: "0xe671499b",     // buyToken(address token, uint256 quoteIn, uint256 minOut)
  createToken: "0x7eaa59d8",  // createToken(CreateParams)
  launch: "0x214013ca",       // launch(address) -> (quoteToken, quoteTier, mode, targetQuote, virtualQuote, graduated, pool, lpTokenId)
  minTarget: "0x260840c9",
  instantFee: "0xc47d51be",  // instantFee() -> flat launch fee for Instant mode (native USDC)
};

export type CreateParamsV3 = {
  name: string; symbol: string;
  marketingBps: number; rewardsBps: number; burnBps: number;
  marketingWallet: string;
  website: string; twitter: string; telegram: string;
  rewardToken: string;   // 0x0 = paid in the quote token
  quoteToken: string;    // 0x0 = native USDC
  mode: 0 | 1;           // 0 curve, 1 instant Uniswap
  targetQuote: bigint;   // curve graduation target OR instant seed, quote units (1e18)
};

/** ABI-encode createToken((string,string,uint16,uint16,uint16,address,string,string,string,address,address,uint8,uint256)). */
export function encodeCreateTokenV3(p: CreateParamsV3): string {
  const dyn = [p.name, p.symbol, p.website, p.twitter, p.telegram];
  const statics: (string | null)[] = [
    null, null, pnum(BigInt(p.marketingBps)), pnum(BigInt(p.rewardsBps)), pnum(BigInt(p.burnBps)),
    p32(p.marketingWallet), null, null, null, p32(p.rewardToken), p32(p.quoteToken), pnum(BigInt(p.mode)), pnum(p.targetQuote),
  ];
  const heads: string[] = [];
  const tails: string[] = [];
  let off = statics.length * 32;
  let d = 0;
  for (const s of statics) {
    if (s !== null) heads.push(s);
    else {
      const t = encStringTail(dyn[d++]);
      heads.push(pnum(BigInt(off)));
      tails.push(t);
      off += t.length / 2;
    }
  }
  // single tuple argument: outer head is the offset (0x20) to the tuple body
  return FN3.createToken + pnum(32n) + heads.join("") + tails.join("");
}

// ---------------- provider ----------------

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

// ---- EIP-6963: every injected wallet announces itself; we remember the one the user picked ----
type Announced = { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eth };
const announced = new Map<string, Announced>();
let listening = false;
function listenProviders() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent<Announced>).detail;
    if (d?.info?.rdns) announced.set(d.info.rdns, d);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
export function listWallets(): { rdns: string; name: string; icon: string }[] {
  listenProviders();
  return [...announced.values()].map((a) => ({ rdns: a.info.rdns, name: a.info.name, icon: a.info.icon }));
}
function chosenRdns(): string | null { try { return localStorage.getItem("arctools_wallet_rdns"); } catch { return null; } }

export function getEth(): Eth | null {
  listenProviders();
  const r = chosenRdns();
  if (r && announced.has(r)) return announced.get(r)!.provider;
  const w = window as unknown as { ethereum?: Eth };
  return w.ethereum ?? null;
}

export const WALLET_EVENT = "arctools:wallet";

export function setStoredWallet(addr: string | null) {
  try {
    if (addr) localStorage.setItem("arctools_wallet", addr);
    else localStorage.removeItem("arctools_wallet");
  } catch { /* private mode */ }
  try {
    window.dispatchEvent(new CustomEvent(WALLET_EVENT, { detail: addr }));
  } catch { /* ssr guard */ }
}

/** Full disconnect: forget the address, revoke the site's account permission in the wallet (MetaMask / Rabby honour
 *  wallet_revokePermissions), and forget which extension was chosen — the next Connect shows the pickers again. */
export async function disconnectWallet(): Promise<void> {
  const eth = getEth();
  setStoredWallet(null);
  try { localStorage.removeItem("arctools_wallet_rdns"); } catch { /* ignore */ }
  if (eth) {
    try { await eth.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch { /* not supported: fine */ }
  }
}

export function getStoredWallet(): string | null {
  try {
    return localStorage.getItem("arctools_wallet");
  } catch {
    return null;
  }
}

/** Subscribe a page to wallet changes (connect/disconnect anywhere on the site). */
export function onWalletChange(cb: (addr: string | null) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent).detail ?? null);
  window.addEventListener(WALLET_EVENT, h);
  return () => window.removeEventListener(WALLET_EVENT, h);
}

/** Ask the user which wallet extension to use when more than one is installed (EIP-6963). Resolves the chosen rdns. */
let pickerHook: ((opts: { rdns: string; name: string; icon: string }[]) => Promise<string | null>) | null = null;
export function setWalletPicker(fn: typeof pickerHook) { pickerHook = fn; }

export async function connectWallet(opts: { forcePicker?: boolean } = {}): Promise<string> {
  listenProviders();
  await new Promise((r) => setTimeout(r, 60));   // let extensions answer requestProvider
  const wallets = listWallets();
  let eth: Eth | null = null;
  if (wallets.length > 1 && (opts.forcePicker || !chosenRdns() || !announced.has(chosenRdns()!))) {
    const pick = pickerHook ? await pickerHook(wallets) : wallets[0].rdns;
    if (!pick) throw new Error("Connection cancelled.");
    try { localStorage.setItem("arctools_wallet_rdns", pick); } catch { /* ignore */ }
    eth = announced.get(pick)?.provider ?? null;
  } else if (wallets.length === 1) {
    try { localStorage.setItem("arctools_wallet_rdns", wallets[0].rdns); } catch { /* ignore */ }
    eth = announced.get(wallets[0].rdns)?.provider ?? getEth();
  } else {
    eth = getEth();
  }
  if (!eth) throw new Error("No wallet found. Install MetaMask / Rabby and retry.");
  // after a disconnect the permission was revoked, so this opens the account chooser instead of silently reusing the last account
  let accts: string[] = [];
  try {
    await eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch (e) {
    if ((e as { code?: number }).code === 4001) throw new Error("Connection cancelled.");
    /* wallets without wallet_requestPermissions fall through to eth_requestAccounts */
  }
  accts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_HEX }],
    });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{
        blockExplorerUrls: ["https://arc-scan.org"],
        chainId: CHAIN_HEX,
        chainName: "Arc",
        nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
        rpcUrls: ["https://rpc.arc-scan.org"],
      }],
    });
  }
  const a = accts[0];
  setStoredWallet(a);
  return a;
}

export async function sendTx(tx: { to: string; data: string; value?: bigint; from: string }): Promise<string> {
  const eth = getEth();
  if (!eth) throw new Error("No wallet");
  const h = (await eth.request({
    method: "eth_sendTransaction",
    params: [{
      data: tx.data,
      from: tx.from,
      to: tx.to,
      value: tx.value ? "0x" + tx.value.toString(16) : "0x0",
    }],
  })) as string;
  return h;
}

async function relay(method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(RPC_URL, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result;
}

/** Receipt polling: our own Arc node first (no per-IP limit — a browser doing 1 poll/s got 429s from the public relay
 *  and the swap button hung on "Waiting for confirmation…" long after the transaction was mined), relay as backup.
 *  `onTick` reports elapsed seconds so the UI can say "still pending". */
export async function waitReceipt(hash: string, timeoutMs = 180_000, onTick?: (s: number) => void):
Promise<{ status: string; logs: { address: string; topics: string[] }[] }> {
  const t0 = Date.now();
  const fromNode = async () => {
    try {
      const j = (await fetch(`/bot/api/receipt?hash=${hash}`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json())) as
        { receipt?: { status: string; logs: { address: string; topics: string[] }[] } | null };
      return j.receipt ?? null;
    } catch { return null; }
  };
  while (Date.now() - t0 < timeoutMs) {
    const r = (await fromNode()) ?? ((await relay("eth_getTransactionReceipt", [hash]).catch(() => null)) as
      { status: string; logs: { address: string; topics: string[] }[] } | null);
    if (r) return r;
    onTick?.(Math.round((Date.now() - t0) / 1000));
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("not confirmed within 3 min — check the explorer, the transaction may still land");
}

export async function ethCall(to: string, data: string): Promise<string> {
  return (await relay("eth_call", [{ data, to }, "latest"])) as string;
}

/** Simulate a state-changing call (with from/value) and throw the decoded revert reason ("target", "no usdc pool"…). */
export async function simulateCall(tx: { data: string; from: string; to: string; value?: bigint }): Promise<string> {
  try {
    return (await relay("eth_call", [{ data: tx.data, from: tx.from, to: tx.to, ...(tx.value ? { value: "0x" + tx.value.toString(16) } : {}), gasPrice: "0x0" }, "latest"])) as string;
  } catch (e) {
    const raw = String((e as Error).message ?? e);
    // Error(string) selector 0x08c379a0: decode the ABI string if present anywhere in the message / data
    const m = raw.match(/0x08c379a0[0-9a-f]+/i);
    if (m) {
      try {
        const hex = m[0].slice(10);
        const len = Number(BigInt("0x" + hex.slice(64, 128)));
        const str = hex.slice(128, 128 + len * 2).match(/.{2}/g)!.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
        throw new Error(str);
      } catch (inner) { if ((inner as Error).message && !(inner as Error).message.startsWith("Cannot")) throw inner; }
    }
    throw new Error(raw.replace(/^execution reverted:?\s*/i, ""));
  }
}

export async function nativeBalance(addr: string): Promise<number> {
  const r = (await relay("eth_getBalance", [addr, "latest"])) as string;
  return Number(BigInt(r) / 10n ** 12n) / 1e6;
}

export async function tokenBalance(token: string, addr: string): Promise<bigint> {
  const r = await ethCall(token, FN.balanceOf + p32(addr));
  return r && r !== "0x" ? BigInt(r) : 0n;
}

export const fmt = (n: number, d = 2) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(d);

/** Downscale an image file to a small JPEG data URL (for D1 storage).
 *  Tries createImageBitmap first (handles more formats, incl. some HEIC/AVIF),
 *  falls back to <img> decoding. */
export async function fileToSmallDataUrl(file: File, maxPx = 256): Promise<string> {
  const draw = (w0: number, h0: number, src: CanvasImageSource): string => {
    const scale = Math.min(1, maxPx / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(src, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  };
  try {
    const bmp = await createImageBitmap(file);
    const out = draw(bmp.width, bmp.height, bmp);
    bmp.close();
    return out;
  } catch {
    /* fall through to <img> */
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("unsupported image format"));
      i.src = url;
    });
    return draw(img.width, img.height, img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------- ArcAggregator (one swap for V3 / V4 / ArcToolsPad curves, split routing) ----------------
export const ARC_AGGREGATOR = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"; // v2: + VENUE_V3PATH (two-hop V3 via wrapped stocks); v1 0xff9A8F35… stays live for old txs
const AGG_SEL = { buy: "0x9125f3db", sell: "0xe95e170b" };
export type AggLeg = { venue: number; target: string; fee: number; key: { currency0: string; currency1: string; fee: number; tick_spacing: number; hooks: string } | null; amount: string };

/** buy(address token, Leg[] legs, uint256 minOut, address to, uint16 feeBps) / sell(...) — Leg is a static 9-word tuple. */
export function encodeAggregatorSwap(side: "buy" | "sell", token: string, legs: AggLeg[], minOut: bigint, to: string, feeBps: number): string {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const legWords = legs.map((l) => {
    const k = l.key ?? { currency0: ZERO, currency1: ZERO, fee: 0, tick_spacing: 0, hooks: ZERO };
    return pnum(BigInt(l.venue)) + p32(l.target) + pnum(BigInt(l.fee)) + p32(k.currency0) + p32(k.currency1) + pnum(BigInt(k.fee)) +
      pnum(BigInt.asUintN(256, BigInt(k.tick_spacing))) + p32(k.hooks) + pnum(BigInt(l.amount));
  }).join("");
  const head = p32(token) + pnum(0xa0n) + pnum(minOut) + p32(to) + pnum(BigInt(feeBps));
  return (side === "buy" ? AGG_SEL.buy : AGG_SEL.sell) + head + pnum(BigInt(legs.length)) + legWords;
}
