import { useCallback, useEffect, useMemo, useState } from "react";

import { WalletPanel } from "@/components/wallet-panel";
import { ARC_WORK, CATEGORIES, WORK_ARBITER, enc, fetchGig, fetchGigs, fetchOrders, fmtUsdc, short, type Gig, type Order, type SellerStats } from "@/lib/arc-work";
import { hotAddress, hotSend, hotSignMessage, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { BOT_API } from "@/lib/bot-api";
import { connectWallet, getStoredWallet, onWalletChange, sendTx, waitReceipt } from "@/lib/arc-wallet";

/** ArcTools Market — services for token teams with USDC escrow. Money sits in ArcWork.sol until the buyer accepts;
 *  ArcTools can only split a disputed order, never touch the rest. */
const card: React.CSSProperties = { background: "var(--arc-paper-deep)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 16 };
const input: React.CSSProperties = { background: "var(--arc-paper)", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", fontSize: 13, padding: "8px 10px", width: "100%" };
const chip = (on: boolean): React.CSSProperties => ({ background: on ? "rgba(46,124,255,0.18)" : "transparent", border: `1px solid ${on ? "var(--arc-cobalt)" : "var(--arc-line)"}`, borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "6px 12px" });
const when = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const Stars = ({ n }: { n: number | null }) => <span style={{ color: "var(--arc-warn)", fontSize: 12 }}>{n == null ? "no reviews yet" : `${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))} ${n.toFixed(1)}`}</span>;

type View = { kind: "browse" } | { kind: "gig"; id: number } | { kind: "orders" } | { kind: "sell" } | { kind: "order"; id: number };

export function MarketContent({ v2 = false, initial }: { v2?: boolean; initial?: View }) {
  const [view, setView] = useState<View>(initial ?? { kind: "browse" });
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setAddr(isUnlocked() && hotAddress() ? hotAddress() : getStoredWallet());
    sync(); const a = onHotChange(sync); const b = onWalletChange(() => sync());
    return () => { a(); b(); };
  }, []);
  const useHot = !!addr && isUnlocked() && hotAddress()?.toLowerCase() === addr.toLowerCase();
  const send = useCallback(async (data: string, value = 0n) => {
    if (!addr) throw new Error("no wallet");
    const h = useHot ? await hotSend({ to: ARC_WORK, data, value }) : await sendTx({ to: ARC_WORK, data, value, from: addr });
    const rc = useHot ? await hotWait(h) : await waitReceipt(h);
    if ((rc as { status?: number | string }).status !== 1 && (rc as { status?: number | string }).status !== "0x1") throw new Error("transaction reverted");
    return h;
  }, [addr, useHot]);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const say = (ok: boolean, text: string) => { setToast({ ok, text }); setTimeout(() => setToast(null), 7000); };
  const base = v2 ? "/market2" : "/market";

  return (
    <>
      <div style={{ alignItems: "flex-end", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
        <div>
          <p className="arc-eyebrow">ARCTOOLS MARKET · USDC ESCROW</p>
          <h1 className="arc-h2" style={{ fontSize: 30, margin: 0 }}>Hire for your token. Pay only when it is delivered.</h1>
          <p className="arc-body" style={{ margin: "8px 0 0", maxWidth: 780 }}>
            Logos, websites, Telegram setups, KOL posts, contract reviews — from people who work on Arc. Your USDC sits in the <a href={`https://arc-scan.org/address/${ARC_WORK}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">ArcWork contract</a> until you accept the delivery.
            Not delivered by the deadline? Take it back. Delivered badly? Dispute — ArcTools splits it, and that is the only thing ArcTools can do with the money. 2 % fee on completion (1 % for sellers holding 250k ARCT), refunds carry no fee. Reviews are on-chain and permanent.
          </p>
        </div>
        <div className="arc-mono" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {([["browse", "Browse"], ["orders", "My orders"], ["sell", "Sell a service"]] as const).map(([k, l]) => <button key={k} onClick={() => setView({ kind: k })} style={chip(view.kind === k || (k === "browse" && view.kind === "gig"))} type="button">{l}</button>)}
          {!addr ? <button className="arc-cta" onClick={() => void connectWallet().catch(() => null)} type="button">Connect wallet</button> : <span style={{ alignSelf: "center", color: "var(--arc-muted)", fontSize: 12 }}>{useHot ? "⚡" : "🦊"} {short(addr)}</span>}
        </div>
      </div>
      {!addr && <div style={{ marginTop: 10, maxWidth: 520 }}><WalletPanel onReady={(a) => setAddr(a)} /></div>}

      <div style={{ marginTop: 18 }}>
        {view.kind === "browse" && <Browse onOpen={(id) => setView({ kind: "gig", id })} />}
        {view.kind === "gig" && <GigPage id={view.id} addr={addr} send={send} say={say} onBack={() => setView({ kind: "browse" })} onHired={() => setView({ kind: "orders" })} />}
        {view.kind === "orders" && <Orders addr={addr} send={send} say={say} />}
        {view.kind === "sell" && <Sell addr={addr} send={send} say={say} onDone={() => setView({ kind: "orders" })} />}
        {view.kind === "order" && <Orders addr={addr} send={send} say={say} focus={view.id} />}
      </div>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 24 }}>
        Contract {short(ARC_WORK)} · arbiter {short(WORK_ARBITER)} (ArcTools) · fee 2 % → ARCT buyback · source on GitHub · deep links: {base}/gig/ID, {base}/order/ID
      </p>
      {toast && <div className="arc-mono" style={{ background: toast.ok ? "rgba(34,197,94,0.14)" : "rgba(255,107,94,0.14)", border: `1px solid ${toast.ok ? "var(--arc-up)" : "var(--arc-error)"}`, borderRadius: 10, bottom: 20, fontSize: 13, maxWidth: 440, padding: "10px 14px", position: "fixed", right: 20, zIndex: 40 }}>{toast.text}</div>}
    </>
  );
}

// ───────────────────────── browse ─────────────────────────
function Browse({ onOpen }: { onOpen: (id: number) => void }) {
  const [data, setData] = useState<{ gigs: Gig[]; sellers: Record<string, SellerStats> } | null>(null);
  const [cat, setCat] = useState<string>("");
  useEffect(() => { fetchGigs({ category: cat || undefined }).then(setData).catch(() => null); }, [cat]);
  return (
    <>
      <div className="arc-mono" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setCat("")} style={chip(cat === "")} type="button">All</button>
        {CATEGORIES.map((c, i) => <button key={c} onClick={() => setCat(String(i))} style={chip(cat === String(i))} type="button">{c}</button>)}
      </div>
      {!data ? <p className="arc-body" style={{ color: "var(--arc-muted)" }}>Loading…</p> : data.gigs.length === 0 ? <p className="arc-body" style={{ color: "var(--arc-muted)" }}>No gigs in this category yet — be the first to list one.</p> : (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {data.gigs.map((g) => {
            const s = data.sellers[g.seller];
            return (
              <button className="arc-body" key={g.id} onClick={() => onOpen(g.id)} style={{ ...card, cursor: "pointer", display: "grid", gap: 8, padding: 0, overflow: "hidden", textAlign: "left" }} type="button">
                {g.meta?.image ? <img alt="" loading="lazy" src={g.meta.image} style={{ aspectRatio: "16 / 9", display: "block", objectFit: "cover", width: "100%" }} /> : <div style={{ aspectRatio: "16 / 9", background: "linear-gradient(135deg, rgba(46,124,255,0.25), rgba(34,197,128,0.15))", display: "grid", placeItems: "center" }}><span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>{g.categoryLabel}</span></div>}
                <div style={{ display: "grid", gap: 8, padding: "0 16px 16px" }}>
                <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", fontSize: 11, justifyContent: "space-between", textTransform: "uppercase" }}><span>{g.categoryLabel}</span><span>{g.deliveryDays} d</span></div>
                <div style={{ color: "var(--arc-ink)", fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{g.meta?.title ?? `Gig #${g.id}`}</div>
                <div style={{ color: "var(--arc-muted)", fontSize: 13, lineHeight: 1.45, maxHeight: 60, overflow: "hidden" }}>{g.meta?.description ?? g.uri}</div>
                <div className="arc-mono" style={{ alignItems: "center", display: "flex", fontSize: 12, justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ color: "var(--arc-up)", fontSize: 18, fontWeight: 700 }}>{fmtUsdc(g.price, 0)} USDC</span>
                  <span style={{ color: "var(--arc-muted)" }}>{g.sold} sold{g.disputed ? ` · ${g.disputed} disputed` : ""}</span>
                </div>
                <div className="arc-mono" style={{ display: "flex", fontSize: 12, gap: 8, justifyContent: "space-between" }}>
                  <a href={`/u/${g.seller}`} onClick={(e) => e.stopPropagation()} style={{ color: "var(--arc-cobalt)" }}>{g.seller === WORK_ARBITER ? "ArcTools" : short(g.seller)}</a>
                  <Stars n={s?.rating ?? null} />
                </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ───────────────────────── gig page + hire ─────────────────────────
function GigPage({ id, addr, send, say, onBack, onHired }: { id: number; addr: string | null; send: (d: string, v?: bigint) => Promise<string>; say: (ok: boolean, t: string) => void; onBack: () => void; onHired: () => void }) {
  const [g, setG] = useState<Gig | null>(null); const [brief, setBrief] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { fetchGig(id).then(setG).catch(() => null); }, [id]);
  if (!g) return <p className="arc-body" style={{ color: "var(--arc-muted)" }}>Loading…</p>;
  const mine = addr && addr.toLowerCase() === g.seller;
  const hire = async () => {
    if (brief.trim().length < 10) { say(false, "Write a brief: what exactly, where to deliver, how to reach you (≥ 10 chars)"); return; }
    setBusy(true);
    try { const h = await send(enc.hire(g.id, brief.trim()), BigInt(g.price)); say(true, `Hired. ${fmtUsdc(g.price)} USDC is in escrow · ${h.slice(0, 10)}…`); onHired(); }
    catch (e) { say(false, String((e as Error).message ?? e)); }
    setBusy(false);
  };
  return (
    <div className="arc-pay-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)" }}>
      <div style={card}>
        <button className="arc-mono" onClick={onBack} style={{ ...chip(false), marginBottom: 12 }} type="button">← all gigs</button>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0, textTransform: "uppercase" }}>{g.categoryLabel} · gig #{g.id}</p>
        <h2 className="arc-h2" style={{ fontSize: 24, margin: "6px 0 10px" }}>{g.meta?.title ?? `Gig #${g.id}`}</h2>
        {g.meta?.image && <img alt="" src={g.meta.image} style={{ aspectRatio: "16 / 9", borderRadius: 10, display: "block", marginBottom: 12, objectFit: "cover", width: "100%" }} />}
        <p className="arc-body" style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{g.meta?.description ?? "The seller has not published a description yet."}</p>
        {g.meta?.samples?.length ? <p className="arc-mono" style={{ fontSize: 12 }}>Samples: {g.meta.samples.map((s, i) => <a href={s} key={s} rel="noreferrer" style={{ color: "var(--arc-cobalt)", marginRight: 8 }} target="_blank">[{i + 1}]</a>)}</p> : null}
        {g.meta?.tags?.length ? <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{g.meta.tags.map((t) => `#${t}`).join("  ")}</p> : null}
        <div className="arc-mono" style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", fontSize: 12, marginTop: 12, paddingTop: 10 }}>
          Seller <a href={`/u/${g.seller}`} style={{ color: "var(--arc-cobalt)" }}>{g.seller === WORK_ARBITER ? "ArcTools (house)" : g.seller}</a> · {g.sold} completed · {g.disputed} disputed · <Stars n={g.rating} />
          {g.meta?.contact ? <> · contact: {g.meta.contact}</> : null}
        </div>
        {g.reviews && g.reviews.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, textTransform: "uppercase" }}>Reviews</p>
            {g.reviews.map((r) => <div className="arc-body" key={r.order} style={{ borderTop: "1px solid var(--arc-line)", fontSize: 13, padding: "8px 0" }}><span style={{ color: "var(--arc-warn)" }}>{"★".repeat(r.stars)}</span> {r.text} <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>— {short(r.buyer)}, order #{r.order}</span></div>)}
          </div>
        )}
      </div>
      <div style={card}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 8px", textTransform: "uppercase" }}>Hire</p>
        <div className="arc-mono" style={{ color: "var(--arc-up)", fontSize: 28, fontWeight: 700 }}>{fmtUsdc(g.price, 0)} USDC</div>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>Delivery in {g.deliveryDays} day{g.deliveryDays > 1 ? "s" : ""}. You pay the listed price, nothing more; the seller's 2 % fee is taken at completion.</p>
        {!g.active ? <p className="arc-mono" style={{ color: "var(--arc-warn)", fontSize: 12 }}>This gig is paused by the seller.</p> : mine ? <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>This is your gig — manage it under My orders / Sell.</p> : (
          <>
            <textarea onChange={(e) => setBrief(e.target.value)} placeholder="Your brief: what exactly you need, links, where to deliver, and how to reach you (Telegram / X). Stored on-chain with the order, visible to the seller and the arbiter." rows={6} style={{ ...input, marginTop: 6, resize: "vertical" }} value={brief} />
            <button className="arc-cta" disabled={!addr || busy} onClick={() => void hire()} style={{ marginTop: 10, width: "100%" }} type="button">{busy ? "Paying into escrow…" : addr ? `Pay ${fmtUsdc(g.price, 0)} USDC into escrow` : "Connect a wallet to hire"}</button>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 8 }}>Escrow rules: accept when delivered → seller paid. No delivery by deadline + 3 days → cancel and get 100 % back. Disagreement → dispute, ArcTools splits within 48 h. 72 h of silence after delivery → seller can claim.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── orders (buyer + seller + arbiter) ─────────────────────────
function Orders({ addr, send, say, focus }: { addr: string | null; send: (d: string, v?: bigint) => Promise<string>; say: (ok: boolean, t: string) => void; focus?: number }) {
  const [data, setData] = useState<{ orders: Order[]; acceptWindowH: number; cancelGraceD: number } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [text, setText] = useState<Record<number, string>>({}); const [stars, setStars] = useState<Record<number, number>>({}); const [split, setSplit] = useState<Record<number, number>>({});
  const reload = useCallback(() => { if (addr) fetchOrders(addr).then(setData).catch(() => null); }, [addr]);
  useEffect(() => { reload(); const t = setInterval(reload, 15_000); return () => clearInterval(t); }, [reload]);
  const isArbiter = addr?.toLowerCase() === WORK_ARBITER;
  const [disputed, setDisputed] = useState<Order[]>([]);
  useEffect(() => {
    if (!isArbiter) return;
    const pull = () => fetch(`${BOT_API}/api/work/disputed`, { cache: "no-store" }).then((r) => r.json()).then((j: { orders: Order[] }) => setDisputed(j.orders ?? [])).catch(() => null);
    pull(); const t = setInterval(pull, 15_000); return () => clearInterval(t);
  }, [isArbiter]);
  const act = async (id: number, data: string, okText: string) => {
    setBusy(id);
    try { const h = await send(data); say(true, `${okText} · ${h.slice(0, 10)}…`); reload(); }
    catch (e) { say(false, String((e as Error).message ?? e)); }
    setBusy(null);
  };
  if (!addr) return <p className="arc-body" style={{ color: "var(--arc-muted)" }}>Connect a wallet to see your orders.</p>;
  if (!data) return <p className="arc-body" style={{ color: "var(--arc-muted)" }}>Loading…</p>;
  const now = Math.floor(Date.now() / 1000);
  const list = [...data.orders, ...disputed.filter((d) => !data.orders.some((o) => o.id === d.id))].sort((a, b) => b.id - a.id);
  if (list.length === 0) return <p className="arc-body" style={{ color: "var(--arc-muted)" }}>No orders yet. Hire someone under Browse, or list a service under Sell.</p>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {list.map((o) => {
        const me = addr.toLowerCase(); const buyer = o.buyer === me; const seller = o.seller === me;
        const t = text[o.id] ?? ""; const color = o.status === 3 ? "var(--arc-up)" : o.status === 5 ? "var(--arc-warn)" : o.status === 4 ? "var(--arc-muted)" : "var(--arc-cobalt)";
        return (
          <div id={`order-${o.id}`} key={o.id} style={{ ...card, boxShadow: focus === o.id ? "0 0 0 1px var(--arc-cobalt)" : undefined }}>
            <div className="arc-mono" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
              <span>#{o.id} · <strong style={{ color: "var(--arc-ink)" }}>{o.gig?.meta?.title ?? `gig #${o.gigId}`}</strong> · {fmtUsdc(o.amount)} USDC</span>
              <span style={{ color, fontSize: 12, textTransform: "uppercase" }}>{o.statusLabel}{o.status === 6 ? ` · ${o.buyerBps / 100} % to buyer` : ""}</span>
            </div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, marginTop: 6 }}>
              {buyer ? "You are the buyer" : seller ? "You are the seller" : "Arbiter view"} · buyer {short(o.buyer)} · seller {short(o.seller)} · paid {when(o.paidAt)} · deadline {when(o.deadline)}{o.deliveredAt ? ` · delivered ${when(o.deliveredAt)}` : ""}
            </div>
            <div className="arc-body" style={{ fontSize: 13, marginTop: 8 }}><span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>BRIEF </span>{o.brief}</div>
            {o.delivery && <div className="arc-body" style={{ fontSize: 13, marginTop: 4 }}><span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>DELIVERY </span>{/^https?:\/\//.test(o.delivery) ? <a href={o.delivery} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{o.delivery}</a> : o.delivery}</div>}
            {o.events.filter((e) => e.name === "OrderDisputed" || e.name === "OrderResolved").map((e, i) => <div className="arc-body" key={i} style={{ color: "var(--arc-warn)", fontSize: 12, marginTop: 4 }}>{e.name === "OrderDisputed" ? `Dispute by ${short(e.actor)}: ${String(e.data.reason ?? "")}` : `Resolved: ${String(e.data.note ?? "")}`}</div>)}

            {/* actions */}
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {seller && (o.status === 1 || o.status === 2) && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input onChange={(e) => setText({ ...text, [o.id]: e.target.value })} placeholder="Delivery: link to the files / result + a note" style={input} value={t} />
                  <button className="arc-cta" disabled={busy === o.id || t.trim().length < 3} onClick={() => void act(o.id, enc.deliver(o.id, t.trim()), o.status === 2 ? "Revision delivered" : "Delivered — buyer has 72 h to accept")} type="button">{o.status === 2 ? "Re-deliver" : "Deliver"}</button>
                </div>
              )}
              {buyer && o.status === 2 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button className="arc-cta" disabled={busy === o.id} onClick={() => void act(o.id, enc.accept(o.id), "Accepted — seller paid")} type="button">Accept & release {fmtUsdc(o.amount)} USDC</button>
                  <input onChange={(e) => setText({ ...text, [o.id]: e.target.value })} placeholder="Problem? Describe it and open a dispute" style={{ ...input, flex: 1, minWidth: 200 }} value={t} />
                  <button className="arc-mono" disabled={busy === o.id || t.trim().length < 5} onClick={() => void act(o.id, enc.dispute(o.id, t.trim()), "Dispute opened — ArcTools will resolve within 48 h")} style={chip(false)} type="button">Dispute</button>
                </div>
              )}
              {buyer && o.status === 1 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button className="arc-mono" disabled={busy === o.id || now < o.deadline + data.cancelGraceD * 86400} onClick={() => void act(o.id, enc.cancelUndelivered(o.id), "Cancelled — 100 % refunded")} style={chip(false)} title={now < o.deadline + data.cancelGraceD * 86400 ? `available ${when(o.deadline + data.cancelGraceD * 86400)}` : ""} type="button">Cancel (nothing delivered)</button>
                  <input onChange={(e) => setText({ ...text, [o.id]: e.target.value })} placeholder="Problem? Describe it and open a dispute" style={{ ...input, flex: 1, minWidth: 200 }} value={t} />
                  <button className="arc-mono" disabled={busy === o.id || t.trim().length < 5} onClick={() => void act(o.id, enc.dispute(o.id, t.trim()), "Dispute opened")} style={chip(false)} type="button">Dispute</button>
                </div>
              )}
              {seller && (o.status === 1 || o.status === 2) && (
                <div style={{ display: "flex", gap: 8 }}>
                  {o.status === 2 && <button className="arc-mono" disabled={busy === o.id || now < o.deliveredAt + data.acceptWindowH * 3600} onClick={() => void act(o.id, enc.claimAfterSilence(o.id), "Claimed after buyer silence")} style={chip(false)} title={now < o.deliveredAt + data.acceptWindowH * 3600 ? `available ${when(o.deliveredAt + data.acceptWindowH * 3600)}` : ""} type="button">Claim (buyer silent 72 h)</button>}
                  <button className="arc-mono" disabled={busy === o.id} onClick={() => { if (confirm("Refund the buyer in full?")) void act(o.id, enc.refund(o.id), "Refunded the buyer"); }} style={chip(false)} type="button">Refund buyer</button>
                </div>
              )}
              {buyer && (o.status === 3 || o.status === 6) && o.stars === 0 && (
                <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>Review:</span>
                  {[1, 2, 3, 4, 5].map((s) => <button key={s} onClick={() => setStars({ ...stars, [o.id]: s })} style={{ background: "transparent", border: 0, color: (stars[o.id] ?? 0) >= s ? "var(--arc-warn)" : "var(--arc-muted)", cursor: "pointer", fontSize: 20 }} type="button">★</button>)}
                  <input onChange={(e) => setText({ ...text, [o.id]: e.target.value })} placeholder="A sentence for the next buyer" style={{ ...input, flex: 1, minWidth: 200 }} value={t} />
                  <button className="arc-mono" disabled={busy === o.id || !stars[o.id]} onClick={() => void act(o.id, enc.review(o.id, stars[o.id], t.trim()), "Review posted on-chain")} style={chip(false)} type="button">Post review</button>
                </div>
              )}
              {isArbiter && o.status === 5 && (
                <div style={{ alignItems: "center", background: "rgba(255,176,32,0.08)", border: "1px solid var(--arc-warn)", borderRadius: 10, display: "flex", flexWrap: "wrap", gap: 8, padding: 10 }}>
                  <span className="arc-mono" style={{ color: "var(--arc-warn)", fontSize: 12 }}>ARBITER · buyer gets</span>
                  <input max={100} min={0} onChange={(e) => setSplit({ ...split, [o.id]: Number(e.target.value) })} style={{ ...input, width: 80 }} type="number" value={split[o.id] ?? 50} />
                  <span className="arc-mono" style={{ fontSize: 12 }}>%</span>
                  <input onChange={(e) => setText({ ...text, [o.id]: e.target.value })} placeholder="Reasoning (public, on-chain)" style={{ ...input, flex: 1, minWidth: 220 }} value={t} />
                  <button className="arc-cta" disabled={busy === o.id || t.trim().length < 5} onClick={() => void act(o.id, enc.resolve(o.id, Math.round((split[o.id] ?? 50) * 100), t.trim()), "Resolved")} type="button">Resolve</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── sell ─────────────────────────
function Sell({ addr, send, say, onDone }: { addr: string | null; send: (d: string, v?: bigint) => Promise<string>; say: (ok: boolean, t: string) => void; onDone: () => void }) {
  const [cat, setCat] = useState(0); const [price, setPrice] = useState("50"); const [days, setDays] = useState("3");
  const [title, setTitle] = useState(""); const [desc, setDesc] = useState(""); const [samples, setSamples] = useState(""); const [contact, setContact] = useState(""); const [tg, setTg] = useState("");
  const [mine, setMine] = useState<Gig[]>([]); const [busy, setBusy] = useState<string | null>(null); const [image, setImage] = useState("");
  const onFile = (f: File | undefined) => {
    if (!f) return; const img = new Image(); const u = URL.createObjectURL(f);
    img.onload = () => { const c = document.createElement("canvas"); c.width = 800; c.height = 450; const g = c.getContext("2d")!; const s = Math.max(800 / img.width, 450 / img.height); g.drawImage(img, (800 - img.width * s) / 2, (450 - img.height * s) / 2, img.width * s, img.height * s); let out = c.toDataURL("image/webp", 0.85); if (out.length > 380_000) out = c.toDataURL("image/webp", 0.6); setImage(out); URL.revokeObjectURL(u); };
    img.src = u;
  };
  const reload = useCallback(() => { if (addr) fetchGigs({ seller: addr, active: false }).then((d) => setMine(d.gigs)).catch(() => null); }, [addr]);
  useEffect(() => { reload(); }, [reload]);
  const canHot = !!addr && isUnlocked() && hotAddress()?.toLowerCase() === addr.toLowerCase();

  const publishMeta = async (gigId: number) => {
    const body = { gigId, title: title.trim(), description: desc.trim(), samples: samples.split(/\s+/).filter((s) => s.startsWith("https://")), contact: contact.trim(), tags: [] as string[], tg: tg.replace(/^@/, ""), image };
    const { message } = await fetch(`${BOT_API}/api/work/meta-message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (!canHot) throw new Error("publishing the description needs the trading wallet (signature) — unlock it, or edit later");
    const sig = await hotSignMessage(message);
    const r = await fetch(`${BOT_API}/api/work/meta`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, sig }) }).then((x) => x.json());
    if (!r.ok) throw new Error(r.reason ?? "meta rejected");
  };
  const create = async () => {
    const p = Number(price); const d = Number(days);
    if (!(p >= 1) || !(d >= 1 && d <= 90) || title.trim().length < 3 || desc.trim().length < 20) { say(false, "Price ≥ 1 USDC, delivery 1–90 days, title ≥ 3 and description ≥ 20 characters"); return; }
    setBusy("Creating gig on-chain…");
    try {
      const before = (await fetchGigs({ seller: addr!, active: false })).gigs.length;
      await send(enc.createGig(cat, BigInt(Math.round(p * 1e6)) * 10n ** 12n, d, `arctools://gig/${addr!.slice(2, 10)}-${Date.now()}`));
      // find the new gig id (the newest one of this seller)
      let gigId = -1; for (let i = 0; i < 6 && gigId < 0; i++) { await new Promise((r) => setTimeout(r, 1500)); const g = (await fetchGigs({ seller: addr!, active: false })).gigs; if (g.length > before) gigId = Math.max(...g.map((x) => x.id)); }
      if (gigId < 0) throw new Error("gig created but not yet indexed — refresh in a moment and publish the description from the list below");
      setBusy("Publishing description (signature)…"); await publishMeta(gigId);
      say(true, `Gig #${gigId} is live.`); reload(); onDone();
    } catch (e) { say(false, String((e as Error).message ?? e)); }
    setBusy(null);
  };
  return (
    <div className="arc-pay-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
      <div style={card}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 10px", textTransform: "uppercase" }}>List a service</p>
        {!addr ? <p className="arc-body" style={{ color: "var(--arc-muted)" }}>Connect a wallet first. The trading wallet is needed to sign the description.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            <select className="arc-mono" onChange={(e) => setCat(Number(e.target.value))} style={input} value={cat}>{CATEGORIES.map((c, i) => <option key={c} value={i}>{c}</option>)}</select>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              <label className="arc-mono" style={{ fontSize: 12 }}>Price (USDC)<input inputMode="decimal" onChange={(e) => setPrice(e.target.value)} style={{ ...input, marginTop: 4 }} value={price} /></label>
              <label className="arc-mono" style={{ fontSize: 12 }}>Delivery (days)<input inputMode="numeric" onChange={(e) => setDays(e.target.value)} style={{ ...input, marginTop: 4 }} value={days} /></label>
            </div>
            <input maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Title — e.g. Logo + banner pack for your token (3 concepts, 2 revisions)" style={input} value={title} />
            <textarea maxLength={3000} onChange={(e) => setDesc(e.target.value)} placeholder="What exactly the buyer gets, what you need from them, revisions, formats. Be precise — this is what the arbiter reads in a dispute." rows={6} style={{ ...input, resize: "vertical" }} value={desc} />
            <input onChange={(e) => setSamples(e.target.value)} placeholder="Sample links (https://…, space-separated, up to 6)" style={input} value={samples} />
            <label className="arc-mono" style={{ fontSize: 12 }}>Cover image (16:9, shown on the card)
              <input accept="image/png,image/webp,image/jpeg" onChange={(e) => onFile(e.target.files?.[0])} style={{ ...input, marginTop: 4, padding: 6 }} type="file" />
            </label>
            {image && <img alt="cover preview" src={image} style={{ aspectRatio: "16 / 9", borderRadius: 8, display: "block", objectFit: "cover", width: "100%" }} />}
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              <input onChange={(e) => setContact(e.target.value)} placeholder="Contact shown on the gig (e.g. Telegram @you)" style={input} value={contact} />
              <input onChange={(e) => setTg(e.target.value)} placeholder="Telegram handle for order alerts (start @ArcToolsBuyBot first)" style={input} value={tg} />
            </div>
            <button className="arc-cta" disabled={!!busy} onClick={() => void create()} type="button">{busy ?? "Create gig (on-chain) and publish"}</button>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>Listing is free. 2 % of each completed order goes to the ARCT buyback (1 % if you hold 250k ARCT). You can pause or reprice the gig any time; reviews stay.</p>
          </div>
        )}
      </div>
      <div style={card}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 10px", textTransform: "uppercase" }}>My gigs</p>
        {mine.length === 0 ? <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13 }}>None yet.</p> : mine.map((g) => (
          <div className="arc-mono" key={g.id} style={{ borderTop: "1px solid var(--arc-line)", fontSize: 12, padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-ink)" }}>#{g.id} {g.meta?.title ?? "(no description yet)"}</span><span style={{ color: g.active ? "var(--arc-up)" : "var(--arc-muted)" }}>{g.active ? "active" : "paused"}</span></div>
            <div style={{ color: "var(--arc-muted)", display: "flex", gap: 10, justifyContent: "space-between", marginTop: 4 }}>
              <span>{fmtUsdc(g.price, 0)} USDC · {g.deliveryDays} d · {g.sold} sold · <Stars n={g.rating} /></span>
              <button onClick={() => { setBusy("…"); send(enc.updateGig(g.id, !g.active, BigInt(g.price), g.deliveryDays, g.uri)).then(() => { say(true, g.active ? "Paused" : "Active"); reload(); }).catch((e) => say(false, String(e))).finally(() => setBusy(null)); }} style={chip(false)} type="button">{g.active ? "Pause" : "Activate"}</button>
            </div>
            {!g.meta && <button onClick={() => { setTitle(title || `Gig #${g.id}`); publishMeta(g.id).then(() => { say(true, "Description published"); reload(); }).catch((e) => say(false, String((e as Error).message ?? e))); }} style={{ ...chip(false), marginTop: 6 }} type="button">Publish the description from the form →</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
