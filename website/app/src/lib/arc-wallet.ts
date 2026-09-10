/**
 * Client-side wallet + calldata helpers for ArcPad (browser only — uses
 * window.ethereum). Never import this from server code.
 */

export const CHAIN_HEX = "0x13b2"; // 5042
export const RPC_URL = "https://rpc-production-ba7a.up.railway.app";
export const PAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE";
export const VAULT = "0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd";
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

// ---------------- provider ----------------

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

export function getEth(): Eth | null {
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

export async function connectWallet(): Promise<string> {
  const eth = getEth();
  if (!eth) throw new Error("No wallet found. Install MetaMask / Rabby and retry.");
  const accts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
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

export async function waitReceipt(hash: string, timeoutMs = 60_000): Promise<{ status: string; logs: { address: string; topics: string[] }[] }> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = (await relay("eth_getTransactionReceipt", [hash]).catch(() => null)) as
      | { status: string; logs: { address: string; topics: string[] }[] }
      | null;
    if (r) return r;
    await new Promise((res) => setTimeout(res, 1200));
  }
  throw new Error("timeout waiting for receipt");
}

export async function ethCall(to: string, data: string): Promise<string> {
  return (await relay("eth_call", [{ data, to }, "latest"])) as string;
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
