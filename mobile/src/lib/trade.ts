/** One place that turns "buy X for N USDC" into a signed, broadcast transaction — the same path the web Swap
 *  uses (route from the site, ArcAggregator on-chain, hot wallet signs locally). Fee 0.5 % → treasury → ARCT buyback. */
import { api } from "./api";
import { ARC_AGGREGATOR, encodeAggregatorSwap } from "./arc-wallet";
import * as HW from "./arc-hotwallet";
import { getPrefs, toast } from "./store";
import { buzzErr, buzzOk } from "./native";

const FEE_BPS = 50;                       // matches the site's /swap tab and the on-chain fee
const USDC_DEC = 18n;                     // native USDC on Arc is 18-dec under the hood
const p32 = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const SEL = { allowance: "0xdd62ed3e", approve: "0x095ea7b3", balanceOf: "0x70a08231", decimals: "0x313ce567" };

export type Leg = { venue: number; target: string; fee: number; key: { currency0: string; currency1: string; fee: number; tick_spacing: number; hooks: string } | null; amount: string };
export type Quote = { legs: Leg[]; out: bigint; label: string };

export async function quoteBuy(token: string, usdc: number): Promise<Quote> {
  const wei = BigInt(Math.round(usdc * 1e6)) * 10n ** (USDC_DEC - 6n);
  const r = await api.swapRoute(token, "buy", wei.toString());
  const legs = (r.legs ?? []) as Leg[];
  if (!legs.length) throw new Error("No route: this token has no liquidity our router can reach");
  return { legs, out: BigInt(r.out || "0"), label: r.single?.[0]?.label ?? "route" };
}
export async function quoteSell(token: string, amountRaw: bigint): Promise<Quote> {
  const r = await api.swapRoute(token, "sell", amountRaw.toString());
  const legs = (r.legs ?? []) as Leg[];
  if (!legs.length) throw new Error("No exit: our router cannot sell this token right now");
  return { legs, out: BigInt(r.out || "0"), label: r.single?.[0]?.label ?? "route" };
}

export async function tokenDecimals(token: string): Promise<number> {
  try { const h = await HW.hotCall(token, SEL.decimals); return h && h !== "0x" ? Number(BigInt(h)) : 18; } catch { return 18; }
}
export async function tokenBalanceRaw(token: string, owner: string): Promise<bigint> {
  try { const h = await HW.hotCall(token, SEL.balanceOf + p32(owner)); return h && h !== "0x" ? BigInt(h) : 0n; } catch { return 0n; }
}

/** BUY: speed over safety, by the owner's rule — minOut = 0, fixed gas, no estimate round-trip. */
export async function buy(token: string, usdc: number, onStep?: (s: string) => void): Promise<string> {
  if (!HW.isUnlocked()) throw new Error("Unlock the wallet first");
  const from = HW.hotAddress()!;
  onStep?.("Finding the best venue…");
  const q = await quoteBuy(token, usdc);
  const spend = q.legs.reduce((s, l) => s + BigInt(l.amount), 0n);
  const value = spend + (spend * BigInt(FEE_BPS)) / 10_000n;           // fee rides on top, in native USDC
  onStep?.(`Buying via ${q.label}…`);
  // a buy that completes an ArcPad curve graduates it in the same call (Uniswap pool + LP mint ≈ 5.5 M gas);
  // 900k made that last buy fail out-of-gas. Unused gas costs nothing, so curve legs get 7 M.
  const viaCurve = q.legs.some((l) => l.venue === 3 || l.venue === 4 || l.venue === 6);
  const hash = await HW.hotSend({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("buy", token, q.legs, 0n, from, FEE_BPS), value, gasLimit: viaCurve ? 7_000_000n : 900_000n });
  return hash;
}

/** SELL: percentage of the balance, slippage from prefs, approve once if needed. */
export async function sell(token: string, pctOfBalance: number, onStep?: (s: string) => void): Promise<string> {
  if (!HW.isUnlocked()) throw new Error("Unlock the wallet first");
  const from = HW.hotAddress()!;
  onStep?.("Reading balance…");
  const bal = await tokenBalanceRaw(token, from);
  if (bal === 0n) throw new Error("Nothing to sell");
  const amount = pctOfBalance >= 100 ? bal : (bal * BigInt(Math.round(pctOfBalance * 100))) / 10_000n;
  onStep?.("Finding the best exit…");
  const q = await quoteSell(token, amount);
  const slip = getPrefs().slippage;
  const minOut = (q.out * BigInt(Math.round((100 - slip) * 100))) / 10_000n;
  const al = await HW.hotCall(token, SEL.allowance + p32(from) + p32(ARC_AGGREGATOR)).catch(() => "0x0");
  if (!al || al === "0x" || BigInt(al) < amount) {
    onStep?.("Approving…");
    const ah = await HW.hotApprove(token, ARC_AGGREGATOR, (1n << 256n) - 1n);
    await HW.hotWait(ah);
  }
  onStep?.(`Selling via ${q.label}…`);
  return HW.hotSend({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("sell", token, q.legs, minOut, from, FEE_BPS), gasLimit: 900_000n });
}

/** fire-and-report wrapper used by every buy button */
export async function quickBuy(token: string, symbol: string, usdc: number) {
  try {
    const h = await buy(token, usdc, (s) => toast(s, "info"));
    buzzOk(); toast(`Bought ${symbol} for ${usdc} USDC`, "ok", h);
    HW.hotWait(h).then((r) => { if (r.status !== 1) toast(`${symbol} buy reverted on-chain`, "err", h); }).catch(() => undefined);
    return h;
  } catch (e) {
    buzzErr(); toast(String((e as Error).message || e).slice(0, 160), "err");
    throw e;
  }
}
