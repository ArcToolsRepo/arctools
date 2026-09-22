/** ArcPredict — UP/DOWN rounds on Arc. Contract addresses from contracts/ArcPredict.deploy.json; state from the bot's operator loop. */
import { ethCall, p32, pnum } from "@/lib/arc-wallet";
import { BOT_API } from "@/lib/bot-api";

export const PREDICT_MARKETS: { key: string; label: string; symbol: string; address: string; logo: string }[] = [
  { key: "BTC/USD", label: "Bitcoin", symbol: "BTC", address: "0x88fb5f7Fd4a9cEeF59AaE3DD5fEE92259E2B10e0", logo: "/assets/predict/btc.svg" },
  { key: "ETH/USD", label: "Ethereum", symbol: "ETH", address: "0x4d235443685AD0273b8Dd3Ebd4F3af9E466afB4d", logo: "/assets/predict/eth.svg" },
  { key: "SOL/USD", label: "Solana", symbol: "SOL", address: "0x6D8B07940A378Ea97E9C4caa4Bdab40603639fc4", logo: "/assets/predict/sol.svg" },
];
export const PREDICT_ADMIN = "0x408c3d3fd36fdf84888f343417787d8710e76fe8";
export const PRICE_DEC = 8;

export const SEL = {   // keccak256(signature)[:4], computed offline (web3.py) — see contracts/ArcPredict.sol
  betUp: "0x5e457cf8",
  betDown: "0x47d2a6c7",
  claim: "0x6ba4c138",
  claimable: "0x22d95eac",
  getUserRounds: "0x951fd600",
  userRoundsLength: "0x02072b12",
};

export type RoundState = {
  epoch: number; startTime: number; lockTime: number; closeTime: number; lockPrice: number; closePrice: number;
  upAmount: string; downAmount: string; rewardBase: string; rewardAmount: string; fee: string; status: number; winner: number;
};
export type MarketState = {
  address: string; interval: number; buffer: number; minBet: string; maxBet: string; feeBps: number;
  currentEpoch: number | null; paused: boolean | null; genesisStarted: boolean | null; genesisLocked: boolean | null;
  rounds: Record<string, RoundState>; last?: { fn: string; price?: number; tx?: string; ok?: boolean }; last_error?: string | null; checked?: number;
};
export type PredictState = { operator: string | null; operator_balance: number | null; ts: number; markets: Record<string, MarketState>; prices: Record<string, { price: number | null; sources: Record<string, number>; ts: number; reason?: string }>; error: string | null };

export async function fetchState(): Promise<PredictState> {
  const r = await fetch(`${BOT_API}/api/predict/state`, { cache: "no-store" });
  if (!r.ok) throw new Error(`state ${r.status}`);
  return r.json() as Promise<PredictState>;
}
export type HistRound = { epoch: number; lock_time: number; close_time: number; lock_price: number; close_price: number; up_amount: string; down_amount: string; reward_amount: string; fee: string; status: number; winner: number };
export async function fetchHistory(market: string, n = 40): Promise<HistRound[]> {
  const r = await fetch(`${BOT_API}/api/predict/rounds?market=${encodeURIComponent(market)}&n=${n}`);
  const j = await r.json() as { rounds: HistRound[] };
  return j.rounds ?? [];
}

/** encode helpers for the hot wallet / browser wallet */
export const encodeBet = (up: boolean, epoch: number) => (up ? SEL.betUp : SEL.betDown) + pnum(BigInt(epoch));
export function encodeClaim(epochs: number[]): string {
  // claim(uint256[]) — offset 0x20, length, items
  return SEL.claim + p32("0x20") + pnum(BigInt(epochs.length)) + epochs.map((e) => pnum(BigInt(e))).join("");
}

export type UserBet = { epoch: number; position: number; amount: string; claimed: boolean };
/** the wallet's bets on one market (latest first) with what claim() would pay for each right now */
export async function userBets(market: string, user: string, max = 60): Promise<{ bets: UserBet[]; claimable: Record<number, string> }> {
  const m = PREDICT_MARKETS.find((x) => x.key === market)!;
  const lenHex = await ethCall(m.address, SEL.userRoundsLength + p32(user));
  const len = Number(BigInt(lenHex || "0x0"));
  if (len === 0) return { bets: [], claimable: {} };
  const n = Math.min(max, len); const cursor = len - n;
  const raw = await ethCall(m.address, SEL.getUserRounds + p32(user) + pnum(BigInt(cursor)) + pnum(BigInt(n)));
  const words = (raw.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt("0x" + w));
  // ABI: (uint256[] epochs, Bet[] bets) → two dynamic offsets
  const offE = Number(words[0]) / 32, offB = Number(words[1]) / 32;
  const nE = Number(words[offE]); const epochs = Array.from({ length: nE }, (_, i) => Number(words[offE + 1 + i]));
  const nB = Number(words[offB]);
  const bets: UserBet[] = Array.from({ length: nB }, (_, i) => {
    const base = offB + 1 + i * 3;
    return { epoch: epochs[i], position: Number(words[base]), amount: words[base + 1].toString(), claimed: words[base + 2] !== 0n };
  }).reverse();
  const cl = await ethCall(m.address, SEL.claimable + p32(user) + p32("0x40") + pnum(BigInt(epochs.length)) + epochs.map((e) => pnum(BigInt(e))).join(""));
  const cw = (cl.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt("0x" + w));
  const claimable: Record<number, string> = {};
  const nC = Number(cw[1] ?? 0n);
  for (let i = 0; i < nC; i++) if (cw[2 + i] > 0n) claimable[epochs[i]] = cw[2 + i].toString();
  return { bets, claimable };
}

/** tolerant integer parse: "1000", "1.00E+18", 1e18, undefined → bigint (never throws — a bad API value must not crash the page) */
export function big(v: string | number | bigint | null | undefined): bigint {
  if (typeof v === "bigint") return v;
  if (v == null || v === "") return 0n;
  const s = String(v).trim();
  if (/^-?\d+$/.test(s)) return BigInt(s);
  const n = Number(s); return Number.isFinite(n) ? BigInt(Math.round(n)) : 0n;
}
export const fmtUsd = (u: string | bigint | number, digits = 2) => (Number(big(u)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPrice = (p: number, market: string) => (p / 10 ** PRICE_DEC).toLocaleString(undefined, { minimumFractionDigits: market.startsWith("SOL") ? 3 : 2, maximumFractionDigits: market.startsWith("SOL") ? 3 : 2 });
/** payout multiplier for a side given the two pools and the fee: (pool × (1 − fee)) / side */
export function multiplier(up: string, down: string, side: "up" | "down", feeBps: number): number | null {
  const u = big(up), d = big(down); const pool = u + d; const s = side === "up" ? u : d;
  if (s === 0n) return null;
  return Number((pool * BigInt(10_000 - feeBps)) / 10_000n) / Number(s);
}
