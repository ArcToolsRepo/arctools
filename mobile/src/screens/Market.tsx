/** ArcTools Market in ArcOne: browse gigs, hire into escrow, run your orders (deliver / accept / dispute / claim / refund / review), list a service. */
import { useCallback, useEffect, useState } from "react";
import * as HW from "../lib/arc-hotwallet";
import { toast } from "../lib/store";
import { short } from "../lib/fmt";
import { Header } from "../components/ui";
import { Unlock } from "./Wallet";
import { buzzOk, openUrl } from "../lib/native";

const BOT = "https://bot-production-4200.up.railway.app";
export const ARC_WORK = "0x74Dfc2012B71a377cCDaAE7b7Acd8Df3Cf1A5706"; const ARBITER = "0x408c3d3fd36fdf84888f343417787d8710e76fe8";
const CATS = ["Logo & banner", "Website / landing", "Telegram / Discord", "KOL post", "Contract review", "Other"];
const SEL = { createGig: "0x151cb492", updateGig: "0x19761472", hire: "0x92ca4e15", deliver: "0x6f210902", accept: "0x19b05f49", claimAfterSilence: "0x7467d771", refund: "0x278ecde1", cancelUndelivered: "0x7ba419fe", dispute: "0x66c85dee", resolve: "0x162185ce", review: "0xb6439cca" };
const pnum = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const str = (s: string) => { const b = new TextEncoder().encode(s); const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); return pnum(b.length) + h.padEnd(Math.ceil(h.length / 64) * 64, "0"); };
const head = (n: number) => pnum(32 * n);
const enc = {
  hire: (g: number, brief: string) => SEL.hire + pnum(g) + head(2) + str(brief), deliver: (id: number, d: string) => SEL.deliver + pnum(id) + head(2) + str(d),
  accept: (id: number) => SEL.accept + pnum(id), claim: (id: number) => SEL.claimAfterSilence + pnum(id), refund: (id: number) => SEL.refund + pnum(id), cancel: (id: number) => SEL.cancelUndelivered + pnum(id),
  dispute: (id: number, r: string) => SEL.dispute + pnum(id) + head(2) + str(r), review: (id: number, s: number, t: string) => SEL.review + pnum(id) + pnum(s) + head(3) + str(t),
  resolve: (id: number, bps: number, n: string) => SEL.resolve + pnum(id) + pnum(bps) + head(3) + str(n),
  createGig: (c: number, price: bigint, days: number, uri: string) => SEL.createGig + pnum(c) + pnum(price) + pnum(days) + head(4) + str(uri),
  updateGig: (id: number, active: boolean, price: bigint, days: number, uri: string) => SEL.updateGig + pnum(id) + pnum(active ? 1 : 0) + pnum(price) + pnum(days) + head(5) + str(uri),
};
type Meta = { title: string; description: string; samples: string[]; contact: string; tags: string[]; tg: string; image?: string | null } | null;
type Gig = { id: number; seller: string; category: number; categoryLabel: string; price: string; deliveryDays: number; active: boolean; uri: string; sold: number; disputed: number; rating: number | null; meta: Meta; reviews?: { order: number; buyer: string; stars: number; text: string }[] };
type Order = { id: number; gigId: number; buyer: string; seller: string; amount: string; paidAt: number; deadline: number; deliveredAt: number; status: number; statusLabel: string; buyerBps: number; brief: string; delivery: string; stars: number; gig: Gig | null; events: { name: string; actor: string; data: Record<string, unknown> }[] };
const usd = (w: string, d = 0) => (Number(BigInt(w)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
const stars = (n: number | null) => n == null ? "no reviews" : `${"★".repeat(Math.round(n))} ${n.toFixed(1)}`;
type View = { k: "browse" } | { k: "gig"; id: number } | { k: "orders" } | { k: "sell" };

export default function Market() {
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const [view, setView] = useState<View>({ k: "browse" });
  const me = HW.hotAddress();
  const send = useCallback(async (data: string, value = 0n) => {
    if (!me || !HW.isUnlocked()) throw new Error("Unlock the wallet first");
    const h = await HW.hotSend({ to: ARC_WORK, data, value }); const rc = await HW.hotWait(h); if (rc.status !== 1) throw new Error("transaction reverted"); buzzOk(); return h;
  }, [me]);
  return (
    <>
      <Header title="Market" back />
      <div className="seg">
        {([["browse", "Browse"], ["orders", "My orders"], ["sell", "Sell"]] as const).map(([k, l]) => <button className={"chip" + (view.k === k || (k === "browse" && view.k === "gig") ? " on" : "")} key={k} onClick={() => setView({ k })}>{l}</button>)}
      </div>
      <div className="launch" style={{ display: "grid", gap: 10 }}>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Hire for your token, pay only when delivered. USDC sits in the ArcWork contract until you accept; disputes are split by ArcTools, nothing else is possible. 2 % fee on completion (1 % for 250k ARCT holders), refunds free, reviews on-chain.</p>
        {!HW.isUnlocked() && <Unlock />}
        {view.k === "browse" && <Browse onOpen={(id) => setView({ k: "gig", id })} />}
        {view.k === "gig" && <GigView id={view.id} me={me} send={send} onBack={() => setView({ k: "browse" })} onHired={() => setView({ k: "orders" })} />}
        {view.k === "orders" && <Orders me={me} send={send} />}
        {view.k === "sell" && <Sell me={me} send={send} onDone={() => setView({ k: "orders" })} />}
      </div>
    </>
  );
}

function Browse({ onOpen }: { onOpen: (id: number) => void }) {
  const [gigs, setGigs] = useState<Gig[] | null>(null); const [cat, setCat] = useState<number | null>(null);
  useEffect(() => { fetch(`${BOT}/api/work/gigs${cat != null ? `?category=${cat}` : ""}`).then((r) => r.json()).then((j) => setGigs(j.gigs ?? [])).catch(() => setGigs([])); }, [cat]);
  return (
    <>
      <div className="seg" style={{ padding: 0 }}><button className={"chip" + (cat == null ? " on" : "")} onClick={() => setCat(null)}>All</button>{CATS.map((c, i) => <button className={"chip" + (cat === i ? " on" : "")} key={c} onClick={() => setCat(i)}>{c}</button>)}</div>
      {gigs == null ? <div className="empty">Loading…</div> : gigs.length === 0 ? <div className="empty">No gigs here yet.</div> : gigs.map((g) => (
        <button className="card" key={g.id} onClick={() => onOpen(g.id)} style={{ textAlign: "left", padding: 0, overflow: "hidden" }}>
          {g.meta?.image ? <img alt="" src={g.meta.image} style={{ aspectRatio: "16 / 9", display: "block", objectFit: "cover", width: "100%" }} /> : null}
          <div style={{ display: "grid", gap: 6, padding: 12 }}>
            <div className="row muted" style={{ justifyContent: "space-between", fontSize: 11 }}><span>{g.categoryLabel.toUpperCase()}</span><span>{g.deliveryDays} d</span></div>
            <b style={{ fontSize: 15 }}>{g.meta?.title ?? `Gig #${g.id}`}</b>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4, maxHeight: 54, overflow: "hidden" }}>{g.meta?.description ?? ""}</div>
            <div className="row mono" style={{ justifyContent: "space-between", fontSize: 12 }}><span style={{ color: "var(--up)", fontSize: 17, fontWeight: 700 }}>{usd(g.price)} USDC</span><span className="muted">{g.seller === ARBITER ? "ArcTools" : short(g.seller)} · {g.sold} sold · {stars(g.rating)}</span></div>
          </div>
        </button>
      ))}
    </>
  );
}

function GigView({ id, me, send, onBack, onHired }: { id: number; me: string | null; send: (d: string, v?: bigint) => Promise<string>; onBack: () => void; onHired: () => void }) {
  const [g, setG] = useState<Gig | null>(null); const [brief, setBrief] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`${BOT}/api/work/gig?id=${id}`).then((r) => r.json()).then(setG).catch(() => undefined); }, [id]);
  if (!g) return <div className="empty">Loading…</div>;
  const hire = async () => {
    if (brief.trim().length < 10) { toast("Write a brief (what, where to deliver, how to reach you)", "err"); return; }
    setBusy(true);
    try { await send(enc.hire(g.id, brief.trim()), BigInt(g.price)); toast(`Hired — ${usd(g.price)} USDC in escrow`, "ok"); onHired(); } catch (e) { toast(String((e as Error).message ?? e), "err"); }
    setBusy(false);
  };
  return (
    <>
      <button className="chip" onClick={onBack}>← all gigs</button>
      <div className="card">
        {g.meta?.image && <img alt="" src={g.meta.image} style={{ aspectRatio: "16 / 9", borderRadius: 10, display: "block", objectFit: "cover", width: "100%" }} />}
        <div className="muted" style={{ fontSize: 11 }}>{g.categoryLabel.toUpperCase()} · #{g.id}</div>
        <b style={{ fontSize: 17 }}>{g.meta?.title ?? `Gig #${g.id}`}</b>
        <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{g.meta?.description ?? "No description yet."}</div>
        {g.meta?.samples?.length ? <div className="row" style={{ gap: 6 }}>{g.meta.samples.map((s, i) => <button className="chip" key={s} onClick={() => openUrl(s)}>sample {i + 1}</button>)}</div> : null}
        <div className="muted" style={{ fontSize: 12 }}>Seller {g.seller === ARBITER ? "ArcTools (house)" : short(g.seller)} · {g.sold} completed · {g.disputed} disputed · {stars(g.rating)}{g.meta?.contact ? ` · ${g.meta.contact}` : ""}</div>
        {g.reviews?.map((r) => <div key={r.order} style={{ fontSize: 12.5, borderTop: "1px solid var(--line)", paddingTop: 6 }}><span style={{ color: "var(--amber, #ffb020)" }}>{"★".repeat(r.stars)}</span> {r.text} <span className="muted">— {short(r.buyer)}</span></div>)}
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}><b style={{ color: "var(--up)", fontSize: 22 }}>{usd(g.price)} USDC</b><span className="muted">delivery {g.deliveryDays} d</span></div>
        {me && me.toLowerCase() === g.seller ? <div className="muted" style={{ fontSize: 12 }}>This is your gig.</div> : !g.active ? <div className="muted" style={{ fontSize: 12 }}>Paused by the seller.</div> : (
          <>
            <div className="field field--area"><textarea onChange={(e) => setBrief(e.target.value)} placeholder="Brief: what exactly, links, where to deliver, how to reach you. Stored with the order, visible to seller and arbiter." rows={4} value={brief} /></div>
            <button className="btn primary" disabled={busy || !me} onClick={hire}>{busy ? "Paying into escrow…" : `Pay ${usd(g.price)} USDC into escrow`}</button>
            <div className="muted" style={{ fontSize: 11.5 }}>Accept when delivered → seller paid. Nothing by deadline + 3 days → cancel, 100 % back. Disagreement → dispute, ArcTools splits. 72 h silence after delivery → seller can claim.</div>
          </>
        )}
      </div>
    </>
  );
}

function Orders({ me, send }: { me: string | null; send: (d: string, v?: bigint) => Promise<string> }) {
  const [data, setData] = useState<{ orders: Order[]; acceptWindowH: number; cancelGraceD: number } | null>(null); const [busy, setBusy] = useState<number | null>(null);
  const [txt, setTxt] = useState<Record<number, string>>({}); const [st, setSt] = useState<Record<number, number>>({}); const [split, setSplit] = useState<Record<number, number>>({});
  const [disputed, setDisputed] = useState<Order[]>([]);
  const isArb = me?.toLowerCase() === ARBITER;
  const reload = useCallback(() => { if (me) fetch(`${BOT}/api/work/orders?wallet=${me}`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => undefined); if (isArb) fetch(`${BOT}/api/work/disputed`, { cache: "no-store" }).then((r) => r.json()).then((j) => setDisputed(j.orders ?? [])).catch(() => undefined); }, [me, isArb]);
  useEffect(() => { reload(); const t = setInterval(reload, 15_000); return () => clearInterval(t); }, [reload]);
  const act = async (id: number, data: string, ok: string) => { setBusy(id); try { await send(data); toast(ok, "ok"); reload(); } catch (e) { toast(String((e as Error).message ?? e), "err"); } setBusy(null); };
  if (!me) return <div className="empty">Create or unlock a wallet to see orders.</div>;
  if (!data) return <div className="empty">Loading…</div>;
  const now = Math.floor(Date.now() / 1000);
  const list = [...data.orders, ...disputed.filter((d) => !data.orders.some((o) => o.id === d.id))].sort((a, b) => b.id - a.id);
  if (!list.length) return <div className="empty">No orders yet.</div>;
  return <>{list.map((o) => {
    const buyer = o.buyer === me.toLowerCase(), seller = o.seller === me.toLowerCase(); const t = txt[o.id] ?? "";
    const color = o.status === 3 ? "var(--up)" : o.status === 5 ? "var(--amber, #ffb020)" : o.status === 4 ? "var(--muted)" : "var(--ink)";
    return (
      <div className="card" key={o.id}>
        <div className="row" style={{ justifyContent: "space-between" }}><b>#{o.id} · {o.gig?.meta?.title ?? `gig #${o.gigId}`}</b><span className="mono" style={{ color, fontSize: 11 }}>{o.statusLabel.toUpperCase()}</span></div>
        <div className="muted" style={{ fontSize: 12 }}>{usd(o.amount, 2)} USDC · {buyer ? "you buy" : seller ? "you sell" : "arbiter"} · buyer {short(o.buyer)} · seller {short(o.seller)} · deadline {when(o.deadline)}</div>
        <div style={{ fontSize: 13 }}><span className="muted">BRIEF </span>{o.brief}</div>
        {o.delivery && <div style={{ fontSize: 13 }}><span className="muted">DELIVERY </span>{/^https?:/.test(o.delivery) ? <button className="chip" onClick={() => openUrl(o.delivery)}>open</button> : o.delivery}</div>}
        {o.events.filter((e) => e.name === "OrderDisputed" || e.name === "OrderResolved").map((e, i) => <div key={i} style={{ fontSize: 12, color: "var(--amber, #ffb020)" }}>{e.name === "OrderDisputed" ? `Dispute (${short(e.actor)}): ${String(e.data.reason ?? "")}` : `Resolved: ${String(e.data.note ?? "")}`}</div>)}
        {(seller && (o.status === 1 || o.status === 2)) && <><div className="field"><input onChange={(e) => setTxt({ ...txt, [o.id]: e.target.value })} placeholder="Delivery link / note" value={t} /></div><div className="row" style={{ gap: 6 }}><button className="btn primary" disabled={busy === o.id || t.trim().length < 3} onClick={() => act(o.id, enc.deliver(o.id, t.trim()), "Delivered")} style={{ flex: 1 }}>{o.status === 2 ? "Re-deliver" : "Deliver"}</button>{o.status === 2 && <button className="btn" disabled={busy === o.id || now < o.deliveredAt + data.acceptWindowH * 3600} onClick={() => act(o.id, enc.claim(o.id), "Claimed")}>Claim (72 h)</button>}<button className="btn" disabled={busy === o.id} onClick={() => act(o.id, enc.refund(o.id), "Refunded")}>Refund</button></div></>}
        {buyer && o.status === 2 && <><button className="btn primary" disabled={busy === o.id} onClick={() => act(o.id, enc.accept(o.id), "Accepted — seller paid")}>Accept & release {usd(o.amount, 2)} USDC</button><div className="field"><input onChange={(e) => setTxt({ ...txt, [o.id]: e.target.value })} placeholder="Problem? Describe and dispute" value={t} /></div><button className="btn" disabled={busy === o.id || t.trim().length < 5} onClick={() => act(o.id, enc.dispute(o.id, t.trim()), "Dispute opened")}>Dispute</button></>}
        {buyer && o.status === 1 && <div className="row" style={{ gap: 6 }}><button className="btn" disabled={busy === o.id || now < o.deadline + data.cancelGraceD * 86400} onClick={() => act(o.id, enc.cancel(o.id), "Cancelled, refunded")} style={{ flex: 1 }}>Cancel (not delivered)</button><div className="field" style={{ flex: 2 }}><input onChange={(e) => setTxt({ ...txt, [o.id]: e.target.value })} placeholder="Dispute reason" value={t} /></div><button className="btn" disabled={busy === o.id || t.trim().length < 5} onClick={() => act(o.id, enc.dispute(o.id, t.trim()), "Dispute opened")}>Dispute</button></div>}
        {buyer && (o.status === 3 || o.status === 6) && o.stars === 0 && <div className="row" style={{ gap: 4, alignItems: "center", flexWrap: "wrap" }}>{[1, 2, 3, 4, 5].map((s) => <button key={s} onClick={() => setSt({ ...st, [o.id]: s })} style={{ background: "none", border: 0, color: (st[o.id] ?? 0) >= s ? "var(--amber, #ffb020)" : "var(--dim)", fontSize: 22 }}>★</button>)}<div className="field" style={{ flex: 1 }}><input onChange={(e) => setTxt({ ...txt, [o.id]: e.target.value })} placeholder="One sentence for the next buyer" value={t} /></div><button className="btn" disabled={busy === o.id || !st[o.id]} onClick={() => act(o.id, enc.review(o.id, st[o.id], t.trim()), "Review posted")}>Post</button></div>}
        {isArb && o.status === 5 && <div className="card" style={{ borderColor: "var(--amber, #ffb020)" }}><div className="muted" style={{ fontSize: 11 }}>ARBITER · buyer gets %</div><div className="row" style={{ gap: 6 }}><div className="field" style={{ width: 80 }}><input inputMode="numeric" onChange={(e) => setSplit({ ...split, [o.id]: Number(e.target.value) })} value={split[o.id] ?? 50} /></div><div className="field" style={{ flex: 1 }}><input onChange={(e) => setTxt({ ...txt, [o.id]: e.target.value })} placeholder="Reasoning (public)" value={t} /></div></div><button className="btn primary" disabled={busy === o.id || t.trim().length < 5} onClick={() => act(o.id, enc.resolve(o.id, Math.round((split[o.id] ?? 50) * 100), t.trim()), "Resolved")}>Resolve</button></div>}
      </div>
    );
  })}</>;
}

function Sell({ me, send, onDone }: { me: string | null; send: (d: string, v?: bigint) => Promise<string>; onDone: () => void }) {
  const [cat, setCat] = useState(0); const [price, setPrice] = useState("50"); const [days, setDays] = useState("3"); const [title, setTitle] = useState(""); const [desc, setDesc] = useState(""); const [contact, setContact] = useState(""); const [image, setImage] = useState("");
  const [busy, setBusy] = useState<string | null>(null); const [mine, setMine] = useState<Gig[]>([]);
  const reload = useCallback(() => { if (me) fetch(`${BOT}/api/work/gigs?seller=${me}&active=0`).then((r) => r.json()).then((j) => setMine(j.gigs ?? [])).catch(() => undefined); }, [me]);
  useEffect(() => { reload(); }, [reload]);
  const onFile = (f: File | undefined) => { if (!f) return; const img = new Image(); const u = URL.createObjectURL(f); img.onload = () => { const c = document.createElement("canvas"); c.width = 800; c.height = 450; const g = c.getContext("2d")!; const s = Math.max(800 / img.width, 450 / img.height); g.drawImage(img, (800 - img.width * s) / 2, (450 - img.height * s) / 2, img.width * s, img.height * s); let out = c.toDataURL("image/webp", 0.85); if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", 0.85); if (out.length > 380_000) out = out.startsWith("data:image/webp") ? c.toDataURL("image/webp", 0.6) : c.toDataURL("image/jpeg", 0.6); setImage(out); URL.revokeObjectURL(u); }; img.src = u; };
  const publish = async (gigId: number) => {
    const body = { gigId, title: title.trim(), description: desc.trim(), samples: [] as string[], contact: contact.trim(), tags: [] as string[], tg: "", image };
    const { message } = await fetch(`${BOT}/api/work/meta-message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const sig = await HW.hotSignMessage(message);
    const r = await fetch(`${BOT}/api/work/meta`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, sig }) }).then((x) => x.json()); if (!r.ok) throw new Error(r.reason ?? "meta rejected");
  };
  const create = async () => {
    const p = Number(price), d = Number(days);
    if (!(p >= 1) || !(d >= 1 && d <= 90) || title.trim().length < 3 || desc.trim().length < 20) { toast("Price ≥ 1, days 1–90, title ≥ 3, description ≥ 20 chars", "err"); return; }
    setBusy("Creating gig…");
    try {
      const before = mine.length;
      await send(enc.createGig(cat, BigInt(Math.round(p * 1e6)) * 10n ** 12n, d, `arctools://gig/${me!.slice(2, 10)}-${Date.now()}`));
      let gid = -1; for (let i = 0; i < 6 && gid < 0; i++) { await new Promise((r) => setTimeout(r, 1500)); const g: Gig[] = (await fetch(`${BOT}/api/work/gigs?seller=${me}&active=0`).then((r) => r.json())).gigs ?? []; if (g.length > before) gid = Math.max(...g.map((x) => x.id)); }
      if (gid < 0) throw new Error("created; description can be published from the list in a moment");
      setBusy("Publishing (signature)…"); await publish(gid); toast(`Gig #${gid} is live`, "ok"); reload(); onDone();
    } catch (e) { toast(String((e as Error).message ?? e), "err"); }
    setBusy(null);
  };
  const [editing, setEditing] = useState<number | null>(null);
  const startEdit = (g: Gig) => { setEditing(g.id); setTitle(g.meta?.title ?? ""); setDesc(g.meta?.description ?? ""); setContact(g.meta?.contact ?? ""); setCat(g.category); setImage(""); };
  const saveEdit = async () => { if (editing == null) return; if (title.trim().length < 3 || desc.trim().length < 20) { toast("Title ≥ 3, description ≥ 20 chars", "err"); return; } setBusy("Publishing (signature)…"); try { await publish(editing); toast(`Gig #${editing} updated`, "ok"); setEditing(null); setImage(""); reload(); } catch (e) { toast(String((e as Error).message ?? e), "err"); } setBusy(null); };
  if (!me) return <div className="empty">Create or unlock a wallet to sell.</div>;
  return (
    <>
      <div className="card">
        <div className="launch__label">List a service</div>
        <div className="seg" style={{ padding: 0 }}>{CATS.map((c, i) => <button className={"chip" + (cat === i ? " on" : "")} key={c} onClick={() => setCat(i)}>{c}</button>)}</div>
        <div className="grid2" style={{ display: "grid", gap: 8 }}><div className="field"><input inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="Price USDC" value={price} /></div><div className="field"><input inputMode="numeric" onChange={(e) => setDays(e.target.value)} placeholder="Delivery days" value={days} /></div></div>
        <div className="field"><input maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Title" value={title} /></div>
        <div className="field field--area"><textarea maxLength={3000} onChange={(e) => setDesc(e.target.value)} placeholder="What the buyer gets, what you need from them, revisions, formats." rows={5} value={desc} /></div>
        <div className="field"><input onChange={(e) => setContact(e.target.value)} placeholder="Contact shown on the gig (Telegram @you)" value={contact} /></div>
        <label className="chip" style={{ display: "inline-block" }}>Cover image<input accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} style={{ display: "none" }} type="file" /></label>
        {image && <img alt="" src={image} style={{ aspectRatio: "16 / 9", borderRadius: 10, display: "block", objectFit: "cover", width: "100%" }} />}
        {editing != null ? <div className="row" style={{ gap: 6 }}><button className="btn primary" disabled={!!busy} onClick={saveEdit} style={{ flex: 1 }}>{busy ?? `Update gig #${editing} (no gas)`}</button><button className="btn" onClick={() => { setEditing(null); setImage(""); }}>Cancel</button></div> : <button className="btn primary" disabled={!!busy} onClick={create}>{busy ?? "Create gig and publish"}</button>}
        <div className="muted" style={{ fontSize: 11.5 }}>Listing is free. 2 % of each completed order goes to the ARCT buyback (1 % if you hold 250k ARCT).</div>
      </div>
      {mine.length > 0 && <div className="card"><div className="launch__label">My gigs</div>{mine.map((g) => <div className="row mono" key={g.id} style={{ justifyContent: "space-between", fontSize: 12, padding: "5px 0" }}><span>#{g.id} {g.meta?.title ?? "(no description)"} · {usd(g.price)} USDC</span><button className="chip" onClick={() => startEdit(g)}>{g.meta?.image ? "Edit" : "Edit / cover"}</button><button className="chip" onClick={() => { setBusy("…"); send(enc.updateGig(g.id, !g.active, BigInt(g.price), g.deliveryDays, g.uri)).then(() => { toast(g.active ? "Paused" : "Active", "ok"); reload(); }).catch((e) => toast(String(e), "err")).finally(() => setBusy(null)); }}>{g.active ? "Pause" : "Activate"}</button></div>)}</div>}
    </>
  );
}
