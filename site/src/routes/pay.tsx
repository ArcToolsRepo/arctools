import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { WalletPanel } from "@/components/wallet-panel";
import { CLAIM, FEE_BPS, MIN_USDC, decodeCode, encodeCode, encodeCreate, idFromLogs, linksBySender, linksFor, newKey, readLink, rememberKey, signClaim, storedKey, submitClaim, toWei, type LinkState } from "@/lib/arc-claim";
import { hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { connectWallet, getStoredWallet, onWalletChange, sendTx } from "@/lib/arc-wallet";
import { usePrefs } from "@/lib/i18n";
import "../arc-site.css";

export const Route = createFileRoute("/pay")({
  head: () => ({ meta: [
    { title: "Pay links: send USDC on Arc with a link" },
    { name: "description", content: "Send USDC to anyone with a link. No wallet needed to receive, no gas needed to collect, uncollected links come back to you. 2% fee at collection." },
  ] }),
  component: Pay,
});

const TTL = [["1 hour", 3600], ["24 hours", 86400], ["3 days", 259200], ["7 days", 604800], ["30 days", 2592000]] as const;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtUsd = (s: string | number) => Number(s).toFixed(2);
const when = (ts: number) => new Date(ts * 1000).toLocaleString();

function Pay() {
  const { t } = usePrefs();
  const [hash, setHash] = useState<string>(() => (typeof location !== "undefined" ? location.hash.slice(1) : ""));
  useEffect(() => { const f = () => setHash(location.hash.slice(1)); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  const code = useMemo(() => decodeCode(decodeURIComponent(hash)), [hash]);
  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/pay" />
      <section className="arc-section" style={{ maxWidth: 1100, paddingTop: 112 }}>
        <p className="arc-eyebrow">PAY LINKS</p>
        <h1 className="arc-h2" style={{ fontSize: 30 }}>{t("Send USDC with a link")}</h1>
        <p className="arc-body" style={{ maxWidth: 720 }}>
          Park USDC behind a link and share it anywhere. Whoever opens it picks the wallet that gets paid — no wallet needed up front, no gas needed to collect.
          Uncollected links return to you when they expire. Every link is its own on-chain record; nothing is pooled. Fee: {FEE_BPS / 100}% at collection.
        </p>
        {code ? <Collect code={decodeURIComponent(hash)} id={code.id} keyBytes={code.key} /> : <Sender />}
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 28 }}>
          Contract <a href={`https://arc-scan.org/address/${CLAIM}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{CLAIM}</a> · also in the sniper bot: <code>/send 5</code>
        </p>
      </section>
    </main>
  );
}

/* ---------------------------------- sender side ---------------------------------- */

function Sender() {
  const [addr, setAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState("5");
  const [ttl, setTtl] = useState<number>(259200);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: number; code: string; amount: number; expiry: number; tx: string } | null>(null);
  const [links, setLinks] = useState<LinkState[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const pick = () => setAddr((isUnlocked() ? hotAddress() : null) ?? getStoredWallet() ?? hotAddress());
    pick(); const a = onWalletChange(pick); const b = onHotChange(pick); return () => { a(); b(); };
  }, []);
  const refresh = useCallback(async () => { if (addr) setLinks(await linksBySender(addr).catch(() => [])); }, [addr]);
  useEffect(() => { setLinks(null); void refresh(); const id = setInterval(() => void refresh(), 20_000); return () => clearInterval(id); }, [refresh]);

  const amt = Number(amount.replace(",", "."));
  const fee = Number.isFinite(amt) ? amt * FEE_BPS / 10_000 : 0;
  const useHot = !!addr && isUnlocked() && hotAddress()?.toLowerCase() === addr.toLowerCase();

  const create = async () => {
    if (!addr || !Number.isFinite(amt) || amt < MIN_USDC) { setErr(`Minimum is ${MIN_USDC} USDC.`); return; }
    setErr(null); setMade(null);
    const { key, address: claimKey } = newKey();
    const data = encodeCreate(claimKey, ttl);
    try {
      setBusy(useHot ? "Signing with your trading wallet…" : "Confirm in your wallet…");
      const tx = useHot ? await hotSend({ data, to: CLAIM, value: toWei(amt) }) : await sendTx({ data, from: addr, to: CLAIM, value: toWei(amt) });
      setBusy("Waiting for Arc…");
      const rc = await waitReceipt(tx);
      if (!rc || Number(rc.status) !== 1) throw new Error("transaction reverted");
      const id = idFromLogs(rc.logs);
      if (id == null) throw new Error("link id not found in receipt");
      rememberKey(id, key);
      setMade({ amount: amt, code: encodeCode(id, key), expiry: Math.floor(Date.now() / 1000) + ttl, id, tx });
      void refresh();
    } catch (e) {
      setErr((e as Error).message.slice(0, 140));
    } finally { setBusy(null); }
  };
  const copy = (txt: string, k: string) => { void navigator.clipboard.writeText(txt); setCopied(k); setTimeout(() => setCopied(null), 1500); };

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", marginTop: 22 }} className="arc-pay-grid">
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 20 }}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>New link</p>
        {!addr ? (
          <div style={{ border: "1px dashed var(--arc-line)", borderRadius: 10, padding: 20, textAlign: "center" }}>
            <p className="arc-body" style={{ margin: "0 0 12px" }}>Unlock your trading wallet or connect a browser wallet to fund a link.</p>
            <button className="arc-cta" onClick={() => void connectWallet().catch(() => null)} type="button">Connect wallet</button>
            <div style={{ marginTop: 14, textAlign: "left" }}><WalletPanel onReady={(a) => setAddr(a)} /></div>
          </div>
        ) : (
          <>
            <label className="arc-mono" style={{ color: "var(--arc-muted)", display: "block", fontSize: 11 }}>Amount (USDC)</label>
            <div style={{ alignItems: "center", display: "flex", gap: 8, margin: "6px 0 14px" }}>
              <input className="arc-mono" inputMode="decimal" onChange={(e) => setAmount(e.target.value)} style={inp} value={amount} />
              {[1, 5, 20, 100].map((v) => <button className="arc-mono" key={v} onClick={() => setAmount(String(v))} style={chip(amount === String(v))} type="button">{v}</button>)}
            </div>
            <label className="arc-mono" style={{ color: "var(--arc-muted)", display: "block", fontSize: 11 }}>Comes back to you if not collected within</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0 16px" }}>
              {TTL.map(([l, s]) => <button className="arc-mono" key={s} onClick={() => setTtl(s)} style={chip(ttl === s)} type="button">{l}</button>)}
            </div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", fontSize: 12, justifyContent: "space-between", margin: "0 0 12px" }}>
              <span>Recipient gets</span><strong style={{ color: "var(--arc-ink)" }}>{Number.isFinite(amt) ? fmtUsd(amt - fee) : "—"} USDC</strong>
            </div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", fontSize: 12, justifyContent: "space-between", margin: "0 0 16px" }}>
              <span>Fee at collection ({FEE_BPS / 100}%)</span><span>{fmtUsd(fee)} USDC</span>
            </div>
            <button className="arc-cta" disabled={!!busy} onClick={() => void create()} style={{ opacity: busy ? 0.6 : 1, width: "100%" }} type="button">
              {busy ?? `Create ${Number.isFinite(amt) ? fmtUsd(amt) : ""} USDC link`}
            </button>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "10px 0 0" }}>
              Funding from {useHot ? "your trading wallet" : "your browser wallet"} <code>{short(addr)}</code>
            </p>
            {err && <p className="arc-mono" style={{ color: "#f0534f", fontSize: 12, margin: "10px 0 0" }}>{err}</p>}
          </>
        )}
        {made && (
          <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: 12, marginTop: 18, padding: 16 }}>
            <p className="arc-mono" style={{ color: "var(--arc-up)", fontSize: 13, fontWeight: 700, margin: "0 0 8px" }}>Link #{made.id} ready · {fmtUsd(made.amount)} USDC · expires {when(made.expiry)}</p>
            {([["Web", linksFor(made.code).site, "w"], ["Telegram", linksFor(made.code).bot, "t"]] as const).map(([l, u, k]) => (
              <div key={k} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0" }}>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, width: 70 }}>{l}</span>
                <code className="arc-mono" style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 6, flex: "1 1 240px", fontSize: 11, overflowWrap: "anywhere", padding: "8px 10px" }}>{u}</code>
                <button className="arc-mono" onClick={() => copy(u, k)} style={{ background: copied === k ? "var(--arc-up)" : "var(--arc-cobalt)", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 11, padding: "8px 12px" }} type="button">{copied === k ? "Copied" : "Copy"}</button>
              </div>
            ))}
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "10px 0 0" }}>Anyone holding this link can collect it — share it with the person you mean. Kept on this device under “Your links”.</p>
          </div>
        )}
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 20 }}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>Your links {addr ? <>· <code>{short(addr)}</code></> : null}</p>
        {!addr ? <p className="arc-body" style={{ color: "var(--arc-muted)" }}>Connect a wallet to see the links it created.</p>
          : links == null ? <p className="arc-mono" style={{ color: "var(--arc-muted)" }}>Loading…</p>
          : links.length === 0 ? <p className="arc-body" style={{ color: "var(--arc-muted)" }}>No links from this wallet yet.</p>
          : links.map((l) => <LinkRow key={l.id} l={l} onCopy={copy} copied={copied} />)}
        <Totals links={links ?? []} />
      </div>
    </div>
  );
}

function LinkRow({ l, onCopy, copied }: { l: LinkState; onCopy: (t: string, k: string) => void; copied: string | null }) {
  const key = storedKey(l.id);
  const state = l.status === "open" && l.expired ? "expired · refund pending" : l.status;
  const color = l.status === "claimed" ? "var(--arc-up)" : l.status === "refunded" ? "var(--arc-muted)" : l.expired ? "#e5a33b" : "var(--arc-cobalt)";
  const left = Math.max(0, l.expiry - Math.floor(Date.now() / 1000));
  return (
    <div style={{ borderTop: "1px solid var(--arc-line)", padding: "10px 0" }}>
      <div className="arc-mono" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 10, justifyContent: "space-between" }}>
        <span>#{l.id} · <strong>{fmtUsd(l.amount)} USDC</strong></span>
        <span style={{ color }}>{state}{l.status === "open" && !l.expired ? ` · ${left >= 3600 ? `${Math.floor(left / 3600)} h` : `${Math.max(1, Math.floor(left / 60))} min`} left` : ""}</span>
      </div>
      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 4 }}>
        {l.status === "claimed" && l.recipient ? <>collected by <a href={`/insider/${l.recipient}`} style={{ color: "var(--arc-cobalt)" }}>{short(l.recipient)}</a> · {fmtUsd(l.paid ?? 0)} paid{l.tx ? <> · <a href={`https://arc-scan.org/tx/${l.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">tx</a></> : null}</>
          : l.status === "refunded" ? <>returned to you</>
          : <>expires {when(l.expiry)}</>}
      </div>
      {l.status === "open" && !l.expired && (key
        ? <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="arc-mono" onClick={() => onCopy(linksFor(encodeCode(l.id, key)).site, `s${l.id}`)} style={mini} type="button">{copied === `s${l.id}` ? "Copied" : "Copy web link"}</button>
            <button className="arc-mono" onClick={() => onCopy(linksFor(encodeCode(l.id, key)).bot, `b${l.id}`)} style={mini} type="button">{copied === `b${l.id}` ? "Copied" : "Copy Telegram link"}</button>
          </div>
        : <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "6px 0 0" }}>Created on another device or in the bot — the link itself lives there (bot: /links).</p>)}
    </div>
  );
}

function Totals({ links }: { links: LinkState[] }) {
  if (!links.length) return null;
  const sum = (f: (l: LinkState) => boolean) => links.filter(f).reduce((a, l) => a + Number(l.amount), 0);
  const tiles = [["Sent", fmtUsd(sum(() => true))], ["Collected", fmtUsd(sum((l) => l.status === "claimed"))], ["Open", fmtUsd(sum((l) => l.status === "open" && !l.expired))], ["Returned", fmtUsd(sum((l) => l.status === "refunded"))]];
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", marginTop: 14 }}>
      {tiles.map(([k, v]) => (
        <div key={k} style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 8, padding: "8px 10px" }}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0, textTransform: "uppercase" }}>{k}</p>
          <p className="arc-mono" style={{ fontSize: 16, fontWeight: 700, margin: "2px 0 0" }}>{v} <span style={{ color: "var(--arc-muted)", fontSize: 11 }}>USDC</span></p>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- recipient side ---------------------------------- */

function Collect({ code, id, keyBytes }: { code: string; id: number; keyBytes: Uint8Array }) {
  const [link, setLink] = useState<LinkState | null | undefined>(undefined);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; paid: string; recipient: string } | null>(null);
  useEffect(() => { let alive = true; void readLink(id).then((l) => alive && setLink(l)); return () => { alive = false; }; }, [id]);
  useEffect(() => { const a = getStoredWallet() ?? hotAddress(); if (a && !to) setTo(a); }, [to]);

  const collect = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) { setMsg("That is not a valid address."); return; }
    setBusy(true); setMsg(null);
    try {
      const sig = await signClaim(keyBytes, id, to);
      const r = await submitClaim(id, to, sig);
      setDone({ paid: r.paid, recipient: r.recipient, tx: r.tx });
    } catch (e) { setMsg((e as Error).message.slice(0, 140)); } finally { setBusy(false); }
  };

  const box: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 14, marginTop: 22, maxWidth: 520, padding: 24 };
  if (link === undefined) return <div style={box}><p className="arc-mono" style={{ color: "var(--arc-muted)" }}>Reading your link…</p></div>;
  if (link === null) return <div style={box}><h2 className="arc-h2" style={{ fontSize: 20 }}>This link is not valid</h2><p className="arc-body" style={{ color: "var(--arc-muted)" }}>It may be incomplete — ask the sender to resend it.</p></div>;
  if (done) return (
    <div style={{ ...box, border: "1px solid rgba(34,197,94,0.35)" }}>
      <h2 className="arc-h2" style={{ color: "var(--arc-up)", fontSize: 20 }}>Collected</h2>
      <p className="arc-mono" style={{ fontSize: 34, fontWeight: 800, margin: "6px 0 2px" }}>{fmtUsd(done.paid)} <span style={{ color: "var(--arc-muted)", fontSize: 16 }}>USDC</span></p>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>is now in <code>{done.recipient}</code> · <a href={`https://arc-scan.org/tx/${done.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">transaction</a></p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
        <a className="arc-cta" href="/trade">Trade it in the Terminal</a>
        <a className="arc-cta" href="/pay" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)" }}>Send your own link</a>
      </div>
    </div>
  );
  if (link.status !== "open" || link.expired) return (
    <div style={box}><h2 className="arc-h2" style={{ fontSize: 20 }}>This link was already used</h2>
      <p className="arc-body" style={{ color: "var(--arc-muted)" }}>{link.status === "claimed" ? "The USDC was already collected." : "It expired and went back to the sender."}</p></div>
  );
  const amount = Number(link.amount), net = amount * (1 - FEE_BPS / 10_000);
  return (
    <div style={box}>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0, textTransform: "uppercase" }}>Someone sent you USDC</p>
      <p className="arc-mono" style={{ fontSize: 40, fontWeight: 800, margin: "6px 0 2px" }}>{fmtUsd(amount)} <span style={{ color: "var(--arc-muted)", fontSize: 16 }}>USDC</span></p>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "0 0 16px" }}>on Arc · from <code>{short(link.sender)}</code> · expires {when(link.expiry)}</p>
      <label className="arc-mono" style={{ color: "var(--arc-muted)", display: "block", fontSize: 11 }}>Wallet that should receive it</label>
      <input className="arc-mono" onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" spellCheck={false} style={{ ...inp, margin: "6px 0 10px", width: "100%" }} value={to} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="arc-mono" onClick={() => void connectWallet().then((a) => setTo(a)).catch(() => null)} style={mini} type="button">Use my browser wallet</button>
        <a className="arc-mono" href={linksFor(code).bot} style={{ ...mini, textDecoration: "none" }}>Open in Telegram</a>
      </div>
      <button className="arc-cta" disabled={busy} onClick={() => void collect()} style={{ marginTop: 14, opacity: busy ? 0.6 : 1, width: "100%" }} type="button">{busy ? "Sending on Arc…" : `Collect ${fmtUsd(net)} USDC`}</button>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "10px 0 0" }}>No gas needed — we send the transaction. {FEE_BPS / 100}% fee ({fmtUsd(amount - net)} USDC) is taken at collection.</p>
      {msg && <p className="arc-mono" style={{ color: "#f0534f", fontSize: 12, margin: "10px 0 0" }}>{msg}</p>}
    </div>
  );
}

/* ---------------------------------- helpers ---------------------------------- */

async function waitReceipt(hash: string): Promise<{ status: string; logs: { address: string; topics: string[] }[] } | null> {
  // the hot wallet has its own waiter but drops the logs; the receipt proxy returns the full object for both wallet kinds
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    try {
      const r = await fetch(`/bot/api/receipt?hash=${hash}`, { cache: "no-store" });
      const j = (await r.json()) as { receipt?: { status: string; logs: { address: string; topics: string[] }[] } | null };
      if (j.receipt) return j.receipt;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}
void hotWait;

const inp: React.CSSProperties = { background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", fontSize: 14, padding: "10px 12px", width: 140 };
const chip = (on: boolean): React.CSSProperties => ({ background: on ? "var(--arc-cobalt)" : "transparent", border: "1px solid " + (on ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 8, color: on ? "#fff" : "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "8px 12px" });
const mini: React.CSSProperties = { background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 6, color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "7px 10px" };
