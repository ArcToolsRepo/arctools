import { rpc } from "@/lib/arc-api";
import { bindings } from "@/lib/bindings.server";
import { AD_ARCT_USD, AD_DAYS, AD_H, AD_SLOTS, AD_USDC, AD_W, ARCT, BOT, TRANSFER_TOPIC, TREASURY, USDC, type Ad } from "@/lib/ads";

/** the E2E wallet used by scripts/e2e_*.ts — real transactions, symbolic fee, so a release can be checked without spending 250 USDC */
const TEST_WALLETS = new Set(["0x731ea5b6a768f8e0c47a977d3abf484e54adc620"]);

/** one Telegram message to the admin chat; returns "tg:ok" or the error text (kept on the row for diagnosis) */
export async function notifyAdmin(text: string, keyboard?: { text: string; url: string }[][]): Promise<string> {
  const env = bindings();
  if (!env.TG_ALERT_TOKEN || !env.TG_ADMIN_ID) return "tg:not configured";
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TG_ALERT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_ADMIN_ID, text, disable_web_page_preview: false, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) }),
    });
    const j = await r.json() as { ok?: boolean; description?: string };
    return j.ok ? "tg:ok" : `tg:${j.description ?? r.status}`;
  } catch (e) { return `tg:${String((e as Error).message ?? e)}`; }
}

let ready = false;
async function db() {
  const d = bindings().DB;
  if (!d) throw new Error("no db");
  if (!ready) {
    await d.exec("CREATE TABLE IF NOT EXISTS ads (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT, title TEXT, url TEXT, image TEXT, pay_token TEXT, pay_amount TEXT, pay_tx TEXT UNIQUE, status TEXT, created_at INTEGER, starts_at INTEGER, ends_at INTEGER, note TEXT)");
    ready = true;
  }
  return d;
}

const now = () => Math.floor(Date.now() / 1000);
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

/** USDC per ARCT from the indexer (price1m = USDC per 1M tokens) */
export async function arctPrice(): Promise<number> {
  const j = await fetch(`${BOT}/api/token-stats?token=${ARCT}`).then((r) => r.json() as Promise<{ price1m?: number }>);
  const p = (j?.price1m ?? 0) / 1e6;                       // price1m = USDC per 1M tokens
  if (!(p > 0)) throw new Error("ARCT price unavailable");
  return p;
}


/** decode a dataURL png/webp/jpeg header just enough to read its pixel size */
function imageSize(dataUrl: string): { w: number; h: number } | null {
  const m = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const b = Uint8Array.from(atob(m[2].slice(0, 4096)), (c) => c.charCodeAt(0));
  if (m[1] === "png" && b.length > 24) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
  if (m[1] === "webp" && b.length > 30) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === "VP8 ") return { w: (b[26] | b[27] << 8) & 0x3fff, h: (b[28] | b[29] << 8) & 0x3fff };
    if (tag === "VP8L") return { w: 1 + ((b[21] | b[22] << 8) & 0x3fff), h: 1 + (((b[22] >> 6) | b[23] << 2 | (b[24] & 0x0f) << 10) & 0x3fff) };
    if (tag === "VP8X") return { w: 1 + (b[24] | b[25] << 8 | b[26] << 16), h: 1 + (b[27] | b[28] << 8 | b[29] << 16) };
  }
  if (m[1] === "jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const mk = b[i + 1]; const len = b[i + 2] << 8 | b[i + 3];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: b[i + 5] << 8 | b[i + 6], w: b[i + 7] << 8 | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

async function hmac(msg: string): Promise<string> {
  const key = bindings().TG_ALERT_TOKEN ?? "no-token";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].slice(0, 16).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const reviewKey = (id: number, action: string) => hmac(`ad:${id}:${action}`);

/** verify the payment tx on-chain: one ERC-20 Transfer of the right token, from the buyer, to the treasury, ≥ required (ARCT: −3 % tolerance for price drift) */
async function verifyPayment(tx: string, wallet: string, token: string): Promise<{ ok: true; amount: bigint } | { ok: false; reason: string }> {
  const rc = (await rpc("eth_getTransactionReceipt", [tx]).catch(() => null)) as { status?: string; logs?: { address: string; topics: string[]; data: string }[] } | null;
  if (!rc) return { ok: false, reason: "transaction not found yet — wait for it to confirm and retry" };
  if (rc.status !== "0x1") return { ok: false, reason: "transaction reverted" };
  const want = token === "ARCT" ? ARCT : USDC;
  let paid = 0n;
  for (const l of rc.logs ?? []) {
    if (l.address.toLowerCase() !== want || l.topics[0] !== TRANSFER_TOPIC || l.topics.length < 3) continue;
    if ("0x" + l.topics[1].slice(26).toLowerCase() !== wallet.toLowerCase()) continue;
    if ("0x" + l.topics[2].slice(26).toLowerCase() !== TREASURY) continue;
    paid += BigInt(l.data);
  }
  if (paid === 0n) return { ok: false, reason: "no transfer from your wallet to the treasury in this transaction" };
  let need: bigint;
  if (TEST_WALLETS.has(wallet.toLowerCase())) need = token === "ARCT" ? 10n ** 18n : 100_000n;   // the release-check wallet pays 1 ARCT / 0.1 USDC
  else if (token === "ARCT") { const p = await arctPrice(); need = BigInt(Math.floor((AD_ARCT_USD * 0.97 / p) * 1e18)); }
  else need = BigInt(AD_USDC * 1e6);
  if (paid < need) return { ok: false, reason: `paid too little: ${paid} < ${need} raw units` };
  return { ok: true, amount: paid };
}


/** approved banners visible right now (≤ 3), oldest start first — the public feed */
export async function activeAds(): Promise<Ad[]> {
  const d = await db(); const t = now();
  const r = await d.prepare("SELECT id,wallet,title,url,pay_token,pay_amount,pay_tx,status,created_at,starts_at,ends_at,note FROM ads WHERE status='approved' AND starts_at <= ? AND ends_at > ? ORDER BY starts_at ASC LIMIT ?").bind(t, t, AD_SLOTS).all<Ad>();
  return r.results ?? [];
}

/** admin decision. approve → schedule: now if a slot is free, else right after the earliest-ending live banner (queue) */
export async function reviewAd(id: number, action: "approve" | "reject", note = ""): Promise<{ ok: boolean; msg: string }> {
  const d = await db(); const t = now();
  const ad = await d.prepare("SELECT id,status FROM ads WHERE id = ?").bind(id).first<{ id: number; status: string }>();
  if (!ad) return { ok: false, msg: "no such banner" };
  if (ad.status !== "pending") return { ok: false, msg: `banner #${id} is already ${ad.status}` };
  if (action === "reject") { await d.prepare("UPDATE ads SET status='rejected', note=? WHERE id=?").bind(note || "rejected by admin", id).run(); return { ok: true, msg: `banner #${id} rejected — refund by hand if due` }; }
  const live = await d.prepare("SELECT ends_at FROM ads WHERE status='approved' AND ends_at > ? ORDER BY ends_at ASC").bind(t).all<{ ends_at: number }>();
  const ends = (live.results ?? []).map((x) => x.ends_at);
  // slots are a rolling window: the n-th queued banner starts when the (n − SLOTS + 1)-th live/queued one ends
  const start = ends.length < AD_SLOTS ? t : ends[ends.length - AD_SLOTS];
  await d.prepare("UPDATE ads SET status='approved', starts_at=?, ends_at=?, note=? WHERE id=?").bind(start, start + AD_DAYS * 86400, note || null, id).run();
  return { ok: true, msg: start === t ? `banner #${id} live now until ${new Date((start + AD_DAYS * 86400) * 1000).toUTCString()}` : `banner #${id} queued — starts ${new Date(start * 1000).toUTCString()}` };
}

export async function adImage(id: number): Promise<string | null> {
  const d = await db();
  const r = await d.prepare("SELECT image FROM ads WHERE id = ?").bind(id).first<{ image: string }>();
  return r?.image ?? null;
}


/** how long until a slot frees up, for the "next free slot" line */
export async function nextFree(): Promise<{ live: number; nextFreeAt: number | null; queued: number }> {
  const d = await db(); const t = now();
  const live = await d.prepare("SELECT ends_at FROM ads WHERE status='approved' AND ends_at > ? ORDER BY ends_at ASC").bind(t).all<{ ends_at: number }>();
  const ends = (live.results ?? []).map((x) => x.ends_at);
  const pending = await d.prepare("SELECT COUNT(*) n FROM ads WHERE status='pending'").first<{ n: number }>();
  return { live: Math.min(ends.length, AD_SLOTS), nextFreeAt: ends.length < AD_SLOTS ? null : ends[ends.length - AD_SLOTS], queued: Math.max(0, ends.length - AD_SLOTS) + (pending?.n ?? 0) };
}

export type SubmitIn = { wallet: string; title: string; url: string; image: string; payToken: "USDC" | "ARCT"; tx: string };
export async function submitAd(data: SubmitIn) {
    const wallet = (data.wallet ?? "").toLowerCase(); const title = (data.title ?? "").trim().slice(0, 48); const url = (data.url ?? "").trim();
    if (!isAddr(wallet)) return { ok: false as const, reason: "bad wallet" };
    if (title.length < 2) return { ok: false as const, reason: "title too short" };
    if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(url) || /(bit\.ly|tinyurl|t\.co\/|cutt\.ly|rb\.gy)/i.test(url)) return { ok: false as const, reason: "url must be a plain https link (no shorteners)" };
    if (!/^0x[0-9a-f]{64}$/i.test(data.tx ?? "")) return { ok: false as const, reason: "bad tx hash" };
    if (!data.image || data.image.length > 400_000) return { ok: false as const, reason: "banner missing or over 300 KB" };
    const sz = imageSize(data.image);
    if (!sz) return { ok: false as const, reason: "banner must be PNG, WebP or JPEG" };
    if (sz.w !== AD_W || sz.h !== AD_H) return { ok: false as const, reason: `banner must be exactly ${AD_W}×${AD_H} px (got ${sz.w}×${sz.h})` };
    const pay = await verifyPayment(data.tx.toLowerCase(), wallet, data.payToken === "ARCT" ? "ARCT" : "USDC");
    if (!pay.ok) return { ok: false as const, reason: pay.reason };
    const d = await db();
    const dup = await d.prepare("SELECT id FROM ads WHERE pay_tx = ?").bind(data.tx.toLowerCase()).first<{ id: number }>();
    if (dup) return { ok: false as const, reason: `this payment is already used by banner #${dup.id}` };
    const r = await d.prepare("INSERT INTO ads (wallet,title,url,image,pay_token,pay_amount,pay_tx,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',?) RETURNING id")
      .bind(wallet, title, url, data.image, data.payToken === "ARCT" ? "ARCT" : "USDC", pay.amount.toString(), data.tx.toLowerCase(), now()).first<{ id: number }>();
    const id = r?.id ?? 0;
    // tell the admin — approve / reject are one click, signed links
    const env = bindings();
    if (env.TG_ALERT_TOKEN && env.TG_ADMIN_ID) {
      const [ka, kr] = await Promise.all([reviewKey(id, "approve"), reviewKey(id, "reject")]);
      const paidTxt = data.payToken === "ARCT" ? `${(Number(pay.amount) / 1e18).toLocaleString()} ARCT` : `${Number(pay.amount) / 1e6} USDC`;
      const text = `📢 New banner #${id} awaiting review\n\n${title}\n${url}\nfrom ${wallet}\npaid ${paidTxt} · tx ${data.tx.slice(0, 12)}…\n\nPreview: https://arctools.fun/api/ads-img/${id}?preview=1`;
      const tg = await notifyAdmin(text, [[
        { text: "✅ Approve", url: `https://arctools.fun/api/ads-review?id=${id}&do=approve&k=${ka}` },
        { text: "❌ Reject", url: `https://arctools.fun/api/ads-review?id=${id}&do=reject&k=${kr}` },
      ]]);
      await d.prepare("UPDATE ads SET note = ? WHERE id = ?").bind(tg, id).run();   // "tg:ok" or the Telegram error — visible to the admin in D1
    } else await d.prepare("UPDATE ads SET note = 'tg:not configured' WHERE id = ?").bind(id).run();
    return { ok: true as const, id };
}

export async function quoteAd() {
  let arct: string | null = null; let price = 0;
  try { price = await arctPrice(); arct = BigInt(Math.ceil((AD_ARCT_USD / price) * 1e18)).toString(); } catch { /* ARCT option hidden */ }
  return { usdc: BigInt(AD_USDC * 1e6).toString(), arct, arctPrice: price, treasury: TREASURY, slots: AD_SLOTS, days: AD_DAYS, w: AD_W, h: AD_H };
}

export async function mineAds(data: { wallet: string }) {
  if (!isAddr(data.wallet)) return [];
  const d = await db();
  const r = await d.prepare("SELECT id,wallet,title,url,pay_token,pay_amount,pay_tx,status,created_at,starts_at,ends_at,note FROM ads WHERE wallet = ? ORDER BY id DESC LIMIT 20").bind(data.wallet.toLowerCase()).all<Ad>();
  return r.results ?? [];
}

/** pending banners whose admin notice failed (bot blocked, network) get it re-sent, at most once an hour each.
 *  Called from the public feed handler, so it runs as long as anyone looks at the Terminal. */
let lastRetry = 0;
export async function retryNotices(): Promise<void> {
  const t = now();
  if (t - lastRetry < 3600) return;
  lastRetry = t;
  const d = await db();
  const rows = await d.prepare("SELECT id,title,url,wallet,pay_token,pay_amount FROM ads WHERE status='pending' AND (note IS NULL OR note != 'tg:ok') LIMIT 5").all<{ id: number; title: string; url: string; wallet: string; pay_token: string; pay_amount: string }>();
  for (const a of rows.results ?? []) {
    const [ka, kr] = await Promise.all([reviewKey(a.id, "approve"), reviewKey(a.id, "reject")]);
    const paidTxt = a.pay_token === "ARCT" ? `${(Number(a.pay_amount) / 1e18).toLocaleString()} ARCT` : `${Number(a.pay_amount) / 1e6} USDC`;
    const r = await notifyAdmin(`📢 Banner #${a.id} awaiting review (notice re-sent)\n\n${a.title}\n${a.url}\nfrom ${a.wallet}\npaid ${paidTxt}\n\nPreview: https://arctools.fun/api/ads-img/${a.id}`, [[
      { text: "✅ Approve", url: `https://arctools.fun/api/ads-review?id=${a.id}&do=approve&k=${ka}` },
      { text: "❌ Reject", url: `https://arctools.fun/api/ads-review?id=${a.id}&do=reject&k=${kr}` },
    ]]);
    await d.prepare("UPDATE ads SET note = ? WHERE id = ?").bind(r, a.id).run();
  }
}
