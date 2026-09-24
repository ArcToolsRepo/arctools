/** ArcPerps v1 — contract bindings (hand-encoded ABI; the site has no ethers/viem). See contracts/ArcPerps.sol. */
import { ethCall, p32, pnum } from "@/lib/arc-wallet";
import { BOT_API } from "@/lib/bot-api";

export const ARC_PERPS = "0xCB39e1ec980FF6dC5137141EC5858Fe9D7124291";
export const PERPS_FEE_BPS = 10; export const MAINT_BPS = 1500; export const P8 = 1e8;
export const SEL = { open: "0x6606768f", close: "0x576c5907", lpDeposit: "0x8c22f801", lpWithdraw: "0x09a5d5bf", equityOf: "0x71bbab34", liquidationPrice: "0xb7507cfd", shares: "0xce7c2ac2", fund: "0xb60d4288", fundShares: "0xf8df3191", lpUnlockAt: "0x76c5f27f", capacity: "0xc66015d4", maxLeverage: "0xcc9e7139" };

export type SignedPrice = { market: number; name: string; price: number; priceUsd: number; feedLive: boolean; ts: number; sig: string; source: string };
export type PerpMarket = { id: number; name: string; token: string; kind: 0 | 1; levLive: number; levOff: number; corridorBps: number; oiCap: number; longOI?: number; shortOI?: number; price?: number; feedLive?: boolean; lastFunding?: number; active?: boolean; mark?: number | null; source?: string; maxLevLive?: number; maxLevOff?: number };
export type PerpsState = { address: string; operator: string | null; operator_balance: number | null; fund: number | null; paused: boolean | null; seed: number; markets: PerpMarket[]; indexed_to: number; liquidations: number; ts: number };
export type PerpPosition = { id: number; owner: string; market: number; name: string | null; is_long: boolean; margin: string; notional: string; entry_price: string; opened_ts: number; open_tx: string; closed_ts: number | null; close_tx: string | null; close_price: string | null; pnl: string | null; funding: string | null; fee: string | null; payout: string | null; liquidated: boolean | null; mark: number | null };

export const fetchPerpsState = () => fetch(`${BOT_API}/api/perps/state`, { cache: "no-store" }).then((r) => r.json()) as Promise<PerpsState>;
export const fetchSignedPrice = (market: number) => fetch(`${BOT_API}/api/perps/price?market=${market}`, { cache: "no-store" }).then((r) => r.json()) as Promise<SignedPrice>;
export const fetchPositions = (wallet: string, openOnly = false) => fetch(`${BOT_API}/api/perps/positions?wallet=${wallet}${openOnly ? "&open=1" : ""}`, { cache: "no-store" }).then((r) => r.json()).then((j) => (j.positions ?? []) as PerpPosition[]);

const pbytes = (hex: string) => { const h = hex.replace(/^0x/, ""); return pnum(BigInt(h.length / 2)) + h.padEnd(Math.ceil(h.length / 64) * 64, "0"); };
/** open(uint256 market, bool isLong, uint16 leverage, uint128 price, bool feedLive, uint64 ts, bytes sig) — value = margin + fee */
export function encodeOpen(market: number, isLong: boolean, lev: number, p: SignedPrice): string {
  return SEL.open + pnum(BigInt(market)) + pnum(isLong ? 1n : 0n) + pnum(BigInt(lev)) + pnum(BigInt(p.price)) + pnum(p.feedLive ? 1n : 0n) + pnum(BigInt(p.ts)) + pnum(0xe0n) + pbytes(p.sig);
}
export function encodeClose(id: number, p: SignedPrice): string { return SEL.close + pnum(BigInt(id)) + pnum(BigInt(p.price)) + pnum(p.feedLive ? 1n : 0n) + pnum(BigInt(p.ts)) + pnum(0xa0n) + pbytes(p.sig); }
export const encodeLpWithdraw = (sh: bigint) => SEL.lpWithdraw + pnum(sh);
/** msg.value for a given margin: margin × (1 + lev × 0.1 %) */
export const openValue = (marginWei: bigint, lev: number) => marginWei + (marginWei * BigInt(lev) * BigInt(PERPS_FEE_BPS)) / 10_000n;

const words = (raw: string) => (raw.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt("0x" + w));
const signed = (w: bigint) => BigInt.asIntN(256, w);
export async function equityOf(id: number): Promise<{ equity: bigint; pnl: bigint; funding: bigint; mark: bigint }> {
  const w = words(await ethCall(ARC_PERPS, SEL.equityOf + pnum(BigInt(id)))); return { equity: signed(w[0]), pnl: signed(w[1]), funding: signed(w[2]), mark: w[3] };
}
export async function liquidationPrice(id: number): Promise<bigint> { return words(await ethCall(ARC_PERPS, SEL.liquidationPrice + pnum(BigInt(id))))[0]; }
export async function lpInfo(addr: string): Promise<{ shares: bigint; totalShares: bigint; fund: bigint; unlockAt: number }> {
  const [s, t, f, u] = await Promise.all([ethCall(ARC_PERPS, SEL.shares + p32(addr)), ethCall(ARC_PERPS, SEL.fundShares), ethCall(ARC_PERPS, SEL.fund), ethCall(ARC_PERPS, SEL.lpUnlockAt + p32(addr))]);
  return { shares: BigInt(s || "0x0"), totalShares: BigInt(t || "0x0"), fund: BigInt(f || "0x0"), unlockAt: Number(BigInt(u || "0x0")) };
}
export async function capacity(market: number, isLong: boolean): Promise<bigint> { return words(await ethCall(ARC_PERPS, SEL.capacity + pnum(BigInt(market)) + pnum(isLong ? 1n : 0n)))[0]; }

/** client-side equity with the live mark: margin + notional × (mark/entry − 1) × side − fundingPaid */
export function liveEquity(p: PerpPosition, markUsd: number | null, fundingPaid: bigint = 0n): { pnl: number; equity: number; roe: number } {
  const margin = Number(BigInt(p.margin)) / 1e18, notional = Number(BigInt(p.notional)) / 1e18, entry = Number(BigInt(p.entry_price)) / P8;
  if (!markUsd || !entry) return { pnl: 0, equity: margin, roe: 0 };
  let pnl = notional * (markUsd / entry - 1); if (!p.is_long) pnl = -pnl;
  const eq = margin + pnl - Number(fundingPaid) / 1e18; return { pnl, equity: eq, roe: margin ? (eq - margin) / margin * 100 : 0 };
}
export const liqPriceLocal = (entry: number, margin: number, notional: number, isLong: boolean) => { const move = margin * (1 - MAINT_BPS / 10_000) / notional; return isLong ? entry * (1 - move) : entry * (1 + move); };
