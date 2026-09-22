import { useCallback, useEffect, useState } from "react";

import { WalletPanel } from "@/components/wallet-panel";
import { AD_ARCT_USD, AD_DAYS, AD_H, AD_SLOTS, AD_USDC, AD_W, ARCT, USDC, adQuote, adSubmit, adsMine, type Ad } from "@/lib/ads";
import { hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { connectWallet, getStoredWallet, onWalletChange, sendTx } from "@/lib/arc-wallet";

const card: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 18 };
const input: React.CSSProperties = { background: "var(--arc-bg, #0a0c10)", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", fontSize: 13, padding: "8px 10px", width: "100%" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const pad32 = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
const transferData = (to: string, amount: bigint) => "0xa9059cbb" + pad32(to) + pad32(amount.toString(16));

/** shared by /advertise (classic shell) and /advertise2 (Terminal v2 shell) */
export function AdvertiseContent({ v2 = false }: { v2?: boolean }) {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setAddr(isUnlocked() && hotAddress() ? hotAddress() : getStoredWallet());
    sync(); const a = onHotChange(sync); const b = onWalletChange(() => sync());
    return () => { a(); b(); };
  }, []);
  const useHot = !!addr && isUnlocked() && hotAddress()?.toLowerCase() === addr.toLowerCase();
  const send = useCallback(async (to: string, data: string) => {
    if (!addr) throw new Error("no wallet");
    const h = useHot ? await hotSend({ to, data, value: 0n }) : await sendTx({ to, data, value: 0n, from: addr });
    const rc = await hotWait(h); if (rc.status !== 1) throw new Error("transaction reverted"); return h;
  }, [addr, useHot]);

  const [quote, setQuote] = useState<Awaited<ReturnType<typeof adQuote>> | null>(null);
  useEffect(() => { adQuote().then(setQuote).catch(() => null); }, []);
  const [mine, setMine] = useState<Ad[]>([]);
  const reload = useCallback(() => { if (addr) adsMine({ data: { wallet: addr } }).then(setMine).catch(() => null); }, [addr]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <p className="arc-eyebrow">SPONSORED SLOTS</p>
      <h1 className="arc-h2" style={{ fontSize: 30 }}>Your banner at the top of the Terminal</h1>
      <p className="arc-body" style={{ maxWidth: 760 }}>
        {AD_SLOTS} slots under the Terminal heading, on the classic site and on Terminal v2, {AD_DAYS} days each. {AD_USDC} USDC, or ARCT worth {AD_ARCT_USD} USD at the moment you pay —
        paid to the ArcTools fee treasury, the same wallet every fee goes to (ARCT buyback and burn). Every banner is reviewed by a human before it shows; the fee is not a publishing right.
        No shorteners, no wallet-drainer domains, nothing pretending to be another project. A rejected banner is refunded by hand, minus network cost.
      </p>
      <div className="arc-pay-grid" style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", marginTop: 22 }}>
        <div style={card}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>Book a slot</p>
          {!addr ? (
            <div style={{ border: "1px dashed var(--arc-line)", borderRadius: 10, padding: 20, textAlign: "center" }}>
              <p className="arc-body" style={{ margin: "0 0 12px" }}>Unlock your trading wallet or connect a browser wallet. The banner is tied to the wallet that pays.</p>
              <button className="arc-cta" onClick={() => void connectWallet().catch(() => null)} type="button">Connect wallet</button>
              <div style={{ marginTop: 14, textAlign: "left" }}><WalletPanel onReady={(a) => setAddr(a)} /></div>
            </div>
          ) : <BookForm addr={addr} quote={quote} send={send} onDone={reload} />}
        </div>
        <div style={card}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>Banner spec</p>
          <ul className="arc-body" style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
            <li><strong>{AD_W} × {AD_H} px</strong>, PNG / WebP / JPEG, under 300 KB. Shown at half size (530 × 72), so keep text at least 24 px tall in the file.</li>
            <li>Any other size is resized to fit and center-cropped by the form — check the preview before paying.</li>
            <li>Whole banner is one link to your https URL. A small "AD" tag and the time left are drawn over the bottom corners.</li>
            <li>Goes live after review, for {AD_DAYS} × 24 h. If all {AD_SLOTS} slots are taken it queues and starts when one frees up — the form shows when.</li>
            <li>Same banner, same time, on <a href={v2 ? "/trade2" : "/trade"} style={{ color: "var(--arc-cobalt)" }}>Terminal</a> and <a href={v2 ? "/trade" : "/trade2"} style={{ color: "var(--arc-cobalt)" }}>{v2 ? "classic Terminal" : "Terminal v2"}</a>. Not shown in the ArcOne app.</li>
          </ul>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "14px 0 12px", textTransform: "uppercase" }}>My banners {addr ? `· ${short(addr)}` : ""}</p>
          {!addr ? <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13 }}>Connect to see yours.</p>
            : mine.length === 0 ? <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13 }}>None yet.</p>
            : mine.map((a) => (
              <div className="arc-mono" key={a.id} style={{ border: "1px solid var(--arc-line)", borderRadius: 10, fontSize: 12, marginBottom: 8, padding: 10 }}>
                <img alt="" src={`/api/ads-img/${a.id}`} style={{ aspectRatio: "1060 / 144", borderRadius: 6, display: "block", marginBottom: 6, objectFit: "cover", width: "100%" }} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
                  <span>#{a.id} · {a.title}</span>
                  <span style={{ color: a.status === "approved" ? "#22c580" : a.status === "rejected" ? "#ff6a6a" : "#ffb054" }}>{a.status}</span>
                </div>
                <div style={{ color: "var(--arc-muted)", marginTop: 4 }}>{a.status === "approved" ? `${when(a.starts_at)} → ${when(a.ends_at)}` : a.status === "pending" ? "waiting for review" : a.note ?? ""}</div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

function BookForm({ addr, quote, send, onDone }: { addr: string; quote: Awaited<ReturnType<typeof adQuote>> | null; send: (to: string, data: string) => Promise<string>; onDone: () => void }) {
  const [title, setTitle] = useState(""); const [url, setUrl] = useState(""); const [image, setImage] = useState<string>(""); const [imgNote, setImgNote] = useState("");
  const [pay, setPay] = useState<"USDC" | "ARCT">("USDC"); const [tx, setTx] = useState("");
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 4_000_000) { setImgNote("file over 4 MB"); return; }
    const img = new Image(); const u = URL.createObjectURL(f);
    img.onload = () => {
      const exact = img.width === AD_W && img.height === AD_H;
      const c = document.createElement("canvas"); c.width = AD_W; c.height = AD_H; const g = c.getContext("2d")!;
      // cover-fit: scale so the file fills 1060×144, crop the overflow evenly
      const s = Math.max(AD_W / img.width, AD_H / img.height); const w = img.width * s; const h = img.height * s;
      g.drawImage(img, (AD_W - w) / 2, (AD_H - h) / 2, w, h);
      let out = c.toDataURL("image/webp", 0.92);
      if (out.length > 380_000) out = c.toDataURL("image/webp", 0.75);
      if (out.length > 380_000) out = c.toDataURL("image/jpeg", 0.8);
      setImage(out);
      setImgNote(exact ? `${img.width}×${img.height} — exact size` : `${img.width}×${img.height} → resized and center-cropped to ${AD_W}×${AD_H}; check the preview`);
      URL.revokeObjectURL(u);
    };
    img.onerror = () => setImgNote("not an image");
    img.src = u;
  };

  const amount = quote ? (pay === "USDC" ? BigInt(quote.usdc) : quote.arct ? BigInt(quote.arct) : null) : null;
  const amountTxt = quote ? (pay === "USDC" ? `${AD_USDC} USDC` : quote.arct ? `${(Number(quote.arct) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ARCT (≈ ${AD_ARCT_USD} USD at ${quote.arctPrice.toFixed(6)} USDC)` : "ARCT price unavailable") : "…";
  const canPay = !!image && title.trim().length >= 2 && /^https:\/\//i.test(url) && !!amount && !busy;

  const doPay = async () => {
    if (!amount || !quote) return;
    setBusy("Paying…"); setMsg(null);
    try {
      const h = await send(pay === "USDC" ? USDC : ARCT, transferData(quote.treasury, amount));
      setTx(h); setBusy("Submitting…");
      const r = await adSubmit({ data: { wallet: addr, title: title.trim(), url: url.trim(), image, payToken: pay, tx: h } });
      if (!r.ok) { setMsg({ ok: false, text: `Paid (tx ${h.slice(0, 12)}…) but the submission was refused: ${r.reason}. Fix and press "Submit again" — the payment is kept.` }); }
      else { setMsg({ ok: true, text: `Banner #${r.id} submitted. It shows after review; you will see its status here.` }); setTitle(""); setUrl(""); setImage(""); setImgNote(""); setTx(""); onDone(); }
    } catch (e) { setMsg({ ok: false, text: String((e as Error).message ?? e) }); }
    setBusy(null);
  };
  const resubmit = async () => {
    if (!tx) return;
    setBusy("Submitting…"); setMsg(null);
    const r = await adSubmit({ data: { wallet: addr, title: title.trim(), url: url.trim(), image, payToken: pay, tx } }).catch((e) => ({ ok: false as const, reason: String(e) }));
    if (!r.ok) setMsg({ ok: false, text: r.reason }); else { setMsg({ ok: true, text: `Banner #${r.id} submitted.` }); setTx(""); onDone(); }
    setBusy(null);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label className="arc-mono" style={{ fontSize: 12 }}>Banner file ({AD_W}×{AD_H})
        <input accept="image/png,image/webp,image/jpeg" onChange={(e) => onFile(e.target.files?.[0])} style={{ ...input, marginTop: 4, padding: 6 }} type="file" />
      </label>
      {image && <img alt="preview" src={image} style={{ aspectRatio: "1060 / 144", border: "1px solid var(--arc-line)", borderRadius: 10, display: "block", objectFit: "cover", width: "100%" }} />}
      {imgNote && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>{imgNote}</p>}
      <label className="arc-mono" style={{ fontSize: 12 }}>Title (alt text, shown in the admin notice)
        <input maxLength={48} onChange={(e) => setTitle(e.target.value)} placeholder="Project name — one line" style={{ ...input, marginTop: 4 }} value={title} />
      </label>
      <label className="arc-mono" style={{ fontSize: 12 }}>Link (https)
        <input onChange={(e) => setUrl(e.target.value)} placeholder="https://yourproject.xyz" style={{ ...input, marginTop: 4 }} value={url} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        {(["USDC", "ARCT"] as const).map((k) => <button className="arc-mono" disabled={k === "ARCT" && !quote?.arct} key={k} onClick={() => setPay(k)} style={{ background: pay === k ? "rgba(46,124,255,0.18)" : "transparent", border: `1px solid ${pay === k ? "var(--arc-cobalt)" : "var(--arc-line)"}`, borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "6px 12px" }} type="button">{k === "USDC" ? `${AD_USDC} USDC` : `${AD_ARCT_USD} USD in ARCT`}</button>)}
      </div>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>You pay: <span style={{ color: "var(--arc-ink)" }}>{amountTxt}</span> → treasury {quote ? short(quote.treasury) : ""}. Non-refundable once approved; refunded by hand if rejected.</p>
      {tx && !busy && msg && !msg.ok
        ? <button className="arc-cta" onClick={() => void resubmit()} type="button">Submit again (payment {tx.slice(0, 10)}… kept)</button>
        : <button className="arc-cta" disabled={!canPay} onClick={() => void doPay()} type="button">{busy ?? `Pay ${pay === "USDC" ? `${AD_USDC} USDC` : "in ARCT"} and submit`}</button>}
      {msg && <p className="arc-mono" style={{ color: msg.ok ? "#22c580" : "#ff6a6a", fontSize: 12, margin: 0 }}>{msg.text}</p>}
    </div>
  );
}
