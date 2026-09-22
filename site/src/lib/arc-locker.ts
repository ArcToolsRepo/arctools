/** ArcLocker — reads straight from the contract (two eth_calls, memoised 60 s). No indexer involved.
 *  Contract: 0x07868eB2E92D4F1D9967f6Dc3B8a8Af5623Dbb94 (Arc). Locks are ERC-20 (tokens, V2 LP) or ERC-721
 *  (Uniswap V3 NPM / v4 Positions NFT). For V3/v4 positions we also read the position's liquidity and the pool's
 *  in-range liquidity so a token page can say "62 % of the pool's liquidity is locked until …". */
import { rpc, toNum } from "./arc-api";

export const ARC_LOCKER = "0x07868eB2E92D4F1D9967f6Dc3B8a8Af5623Dbb94";
export const V3_NPM = "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377";
export const V4_POSM = "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b";
const ZERO = "0x0000000000000000000000000000000000000000";
const p32 = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const pnum = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
export const SEL = { locksForToken: "0x75b99371", getLocks: "0x4a374d4d", locksOf: "0xc3f9ab58", feeFor: "0xec46a409", lockFee: "0x56a06235", positions: "0x99fbab88", liquidity: "0x1a686502",
  lockERC20: "0x6f75d653", lockERC721: "0x9d864c00", withdraw: "0x00f714ce", extend: "0x00fc7d8f", collectV3Fees: "0xf444b184", transferLock: "0xb48dd3be", releasable: "0xe4bf01a8",
  approve: "0x095ea7b3", nftApprove: "0x095ea7b3", getApproved: "0x081812fc" };

export type LockRow = {
  id: number; kind: "ERC20" | "ERC721"; asset: string; amountOrId: string; initial: string; owner: string;
  lockedAt: number; unlockAt: number; vestEnd: number; token0: string; token1: string | null; withdrawn: boolean;
  /** what it is, for the UI */
  label: "token" | "v2-lp" | "v3-position" | "v4-position" | "nft";
  /** V3 only: share of the pool's active liquidity this position holds (0..1), when readable */
  poolShare?: number | null;
};

const w = (hex: string, i: number) => hex.slice(2 + 64 * i, 2 + 64 * (i + 1));
const addr = (word: string) => "0x" + word.slice(24);

async function ids(selector: string, key: string): Promise<number[]> {
  const r = (await rpc("eth_call", [{ to: ARC_LOCKER, data: selector + p32(key) }, "latest"])) as string | null;
  if (!r || r.length < 130) return [];
  const n = Number(BigInt("0x" + w(r, 1)));
  return Array.from({ length: n }, (_, i) => Number(BigInt("0x" + w(r, 2 + i))));
}

export async function getLocks(lockIds: number[]): Promise<LockRow[]> {
  if (!lockIds.length) return [];
  const data = SEL.getLocks + pnum(0x20) + pnum(lockIds.length) + lockIds.map((i) => pnum(i)).join("");
  const r = (await rpc("eth_call", [{ to: ARC_LOCKER, data }, "latest"])) as string | null;
  if (!r || r.length < 130) return [];
  // abi: offset, length, then N static tuples of 11 words
  const n = Number(BigInt("0x" + w(r, 1)));
  const out: LockRow[] = [];
  for (let k = 0; k < n; k++) {
    const b = 2 + 11 * k;
    const kind = Number(BigInt("0x" + w(r, b))) === 0 ? "ERC20" : "ERC721";
    const asset = addr(w(r, b + 1));
    const token1 = addr(w(r, b + 9));
    const label: LockRow["label"] = kind === "ERC20" ? (token1 !== ZERO ? "v2-lp" : "token") : asset.toLowerCase() === V3_NPM.toLowerCase() ? "v3-position" : asset.toLowerCase() === V4_POSM.toLowerCase() ? "v4-position" : "nft";
    out.push({
      id: lockIds[k], kind, asset, amountOrId: BigInt("0x" + w(r, b + 2)).toString(), initial: BigInt("0x" + w(r, b + 3)).toString(), owner: addr(w(r, b + 4)),
      lockedAt: Number(BigInt("0x" + w(r, b + 5))), unlockAt: Number(BigInt("0x" + w(r, b + 6))), vestEnd: Number(BigInt("0x" + w(r, b + 7))),
      token0: addr(w(r, b + 8)), token1: token1 === ZERO ? null : token1, withdrawn: BigInt("0x" + w(r, b + 10)) !== 0n, label,
    });
  }
  return out;
}

/** V3 position share of its pool's current in-range liquidity (best effort) */
async function v3PoolShare(tokenId: string): Promise<number | null> {
  try {
    const pos = (await rpc("eth_call", [{ to: V3_NPM, data: SEL.positions + pnum(BigInt(tokenId)) }, "latest"])) as string;
    if (!pos || pos.length < 2 + 64 * 12) return null;
    const token0 = addr(w(pos, 2)), token1 = addr(w(pos, 3)), fee = Number(BigInt("0x" + w(pos, 4))), liq = BigInt("0x" + w(pos, 7));
    // pool address via factory.getPool
    const FACTORY = "0xf0db7b58379503491d857db50ac9ece64c653918";   // Uniswap V3 factory on Arc
    const pool = (await rpc("eth_call", [{ to: FACTORY, data: "0x1698ee82" + p32(token0) + p32(token1) + pnum(fee) }, "latest"])) as string;
    if (!pool || pool.length < 66 || /^0x0+$/.test(pool)) return null;
    const pl = (await rpc("eth_call", [{ to: addr(pool.slice(2)), data: SEL.liquidity }, "latest"])) as string;
    const poolLiq = BigInt(pl);
    return poolLiq > 0n ? Number((liq * 10_000n) / poolLiq) / 10_000 : null;
  } catch { return null; }
}

export async function locksForToken(token: string): Promise<LockRow[]> {
  const rows = await getLocks(await ids(SEL.locksForToken, token));
  await Promise.all(rows.map(async (l) => { if (l.label === "v3-position" && !l.withdrawn) l.poolShare = await v3PoolShare(l.amountOrId); }));
  return rows.filter((l) => !l.withdrawn);
}
export async function locksOf(owner: string): Promise<LockRow[]> { return getLocks(await ids(SEL.locksOf, owner)); }
export async function feeFor(who: string): Promise<number> {
  const r = (await rpc("eth_call", [{ to: ARC_LOCKER, data: SEL.feeFor + p32(who) }, "latest"])) as string | null;
  return r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : 50;
}
export { toNum };
