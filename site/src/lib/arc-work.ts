/** ArcWork — services marketplace with USDC escrow. Contract calls are encoded here; reads come from the bot's read layer (/api/work/*). */
import { p32, pnum } from "@/lib/arc-wallet";
import { BOT_API } from "@/lib/bot-api";

export const ARC_WORK = "0x74Dfc2012B71a377cCDaAE7b7Acd8Df3Cf1A5706";
export const WORK_ARBITER = "0x408c3d3fd36fdf84888f343417787d8710e76fe8";
export const CATEGORIES = ["Logo & banner", "Website / landing", "Telegram / Discord setup", "KOL post / thread", "Contract review", "Other"];
export const STATUS = ["none", "paid", "delivered", "completed", "refunded", "disputed", "resolved"] as const;

// keccak256(signature)[:4], computed with web3.py — see contracts/ArcWork.sol
export const SEL = {
  createGig: "0x151cb492",
  updateGig: "0x19761472",
  hire: "0x92ca4e15",
  deliver: "0x6f210902",
  accept: "0x19b05f49",
  claimAfterSilence: "0x7467d771",
  refund: "0x278ecde1",
  cancelUndelivered: "0x7ba419fe",
  dispute: "0x66c85dee",
  resolve: "0x162185ce",
  review: "0xb6439cca",
};

export type GigMeta = { title: string; description: string; samples: string[]; contact: string; tags: string[]; tg: string; updated: number } | null;
export type Gig = { id: number; seller: string; category: number; categoryLabel: string; price: string; deliveryDays: number; active: boolean; uri: string; sold: number; disputed: number; ratingSum: number; ratingCount: number; rating: number | null; meta: GigMeta; reviews?: { order: number; buyer: string; stars: number; text: string; ts: number }[] };
export type SellerStats = { gigs: number; sold: number; disputed: number; rating: number | null; ratingCount: number };
export type Order = { id: number; gigId: number; buyer: string; seller: string; amount: string; paidAt: number; deadline: number; deliveredAt: number; status: number; statusLabel: string; buyerBps: number; brief: string; delivery: string; stars: number; gig: Gig | null; events: { name: string; ts: number; actor: string; data: Record<string, unknown> }[] };

export async function fetchGigs(params: { category?: string; seller?: string; active?: boolean } = {}): Promise<{ gigs: Gig[]; sellers: Record<string, SellerStats>; feeBps: number; tierFeeBps: number; arctTier: string }> {
  const q = new URLSearchParams(); if (params.category) q.set("category", params.category); if (params.seller) q.set("seller", params.seller); if (params.active === false) q.set("active", "0");
  const r = await fetch(`${BOT_API}/api/work/gigs?${q}`); return r.json();
}
export async function fetchGig(id: number): Promise<Gig> { return fetch(`${BOT_API}/api/work/gig?id=${id}`).then((r) => r.json()); }
export async function fetchOrders(wallet: string): Promise<{ orders: Order[]; acceptWindowH: number; cancelGraceD: number }> { return fetch(`${BOT_API}/api/work/orders?wallet=${wallet}`, { cache: "no-store" }).then((r) => r.json()); }
export async function fetchOrder(id: number): Promise<Order> { return fetch(`${BOT_API}/api/work/order?id=${id}`, { cache: "no-store" }).then((r) => r.json()); }

/** ABI string encoding at a given offset slot layout: we build calldata by hand (no ethers in this project) */
function encStr(s: string): { len: string; data: string } {
  const bytes = new TextEncoder().encode(s); const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return { len: pnum(BigInt(bytes.length)), data: hex.padEnd(Math.ceil(hex.length / 64) * 64, "0") };
}
const HEAD = (n: number) => pnum(BigInt(32 * n));   // offset to dynamic part when there are n static words

export const enc = {
  createGig: (category: number, priceWei: bigint, deliveryDays: number, uri: string) => { const s = encStr(uri); return SEL.createGig + pnum(BigInt(category)) + pnum(priceWei) + pnum(BigInt(deliveryDays)) + HEAD(4) + s.len + s.data; },
  updateGig: (id: number, active: boolean, priceWei: bigint, deliveryDays: number, uri: string) => { const s = encStr(uri); return SEL.updateGig + pnum(BigInt(id)) + pnum(active ? 1n : 0n) + pnum(priceWei) + pnum(BigInt(deliveryDays)) + HEAD(5) + s.len + s.data; },
  hire: (gigId: number, brief: string) => { const s = encStr(brief); return SEL.hire + pnum(BigInt(gigId)) + HEAD(2) + s.len + s.data; },
  deliver: (id: number, delivery: string) => { const s = encStr(delivery); return SEL.deliver + pnum(BigInt(id)) + HEAD(2) + s.len + s.data; },
  accept: (id: number) => SEL.accept + pnum(BigInt(id)),
  claimAfterSilence: (id: number) => SEL.claimAfterSilence + pnum(BigInt(id)),
  refund: (id: number) => SEL.refund + pnum(BigInt(id)),
  cancelUndelivered: (id: number) => SEL.cancelUndelivered + pnum(BigInt(id)),
  dispute: (id: number, reason: string) => { const s = encStr(reason); return SEL.dispute + pnum(BigInt(id)) + HEAD(2) + s.len + s.data; },
  resolve: (id: number, buyerBps: number, note: string) => { const s = encStr(note); return SEL.resolve + pnum(BigInt(id)) + pnum(BigInt(buyerBps)) + HEAD(3) + s.len + s.data; },
  review: (id: number, stars: number, text: string) => { const s = encStr(text); return SEL.review + pnum(BigInt(id)) + pnum(BigInt(stars)) + HEAD(3) + s.len + s.data; },
};
export const fmtUsdc = (wei: string | bigint, d = 2) => (Number(BigInt(wei)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
void p32;
