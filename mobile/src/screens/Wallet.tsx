import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import * as HW from "../lib/arc-hotwallet";
import { api, type Holding } from "../lib/api";
import { usd, num, short, pct, isAddr } from "../lib/fmt";
import { go } from "../lib/router";
import { toast, useStore } from "../lib/store";
import { Header, Icon, Logo, Sheet } from "../components/ui";

/** wallet presence/unlock as a store-like hook (arc-hotwallet has its own listener bus) */
function useHot() {
  const [, tick] = useState(0);
  useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  return { has: HW.hasWallet(), unlocked: HW.isUnlocked(), addr: HW.hotAddress() };
}

// ---------- onboarding ----------
function Onboard() {
  const [mode, setMode] = useState<"pick" | "create" | "import" | "recover" | "saved">("pick");
  const [pass, setPass] = useState(""); const [pass2, setPass2] = useState(""); const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false); const [created, setCreated] = useState<HW.Created | null>(null);
  const [ack, setAck] = useState(false);
  const run = async (fn: () => Promise<HW.Created>) => {
    if (pass.length < 6) return toast("Passcode: at least 6 characters", "err");
    if (mode !== "import" && mode !== "recover" && pass !== pass2) return toast("Passcodes do not match", "err");
    setBusy(true);
    try { const c = await fn(); setCreated(c); setMode("saved"); } catch (e) { toast(String((e as Error).message || e), "err"); } finally { setBusy(false); }
  };
  if (mode === "saved" && created) {
    return (
      <div style={{ padding: 14 }}>
        <div className="card" style={{ margin: 0, borderLeft: "3px solid var(--amber)" }}>
          <b style={{ fontSize: 17 }}>Save these now. They are shown once.</b>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13.5 }}>The private key is the wallet: with it you can import on any phone. The recovery code only resets a forgotten passcode on THIS phone. Lose the phone without the key and the funds are gone — nobody can recover them.</p>
        </div>
        <div className="label">Address</div>
        <div className="card mono" style={{ fontSize: 13, wordBreak: "break-all" }}>{created.address}</div>
        <div className="label">Private key</div>
        <div className="card mono" style={{ fontSize: 12.5, wordBreak: "break-all" }} onClick={() => { navigator.clipboard?.writeText(created.privateKey); toast("Key copied", "ok"); }}>{created.privateKey}<div className="muted" style={{ fontSize: 11, marginTop: 6 }}>tap to copy</div></div>
        <div className="label">Recovery code</div>
        <div className="card mono" style={{ fontSize: 14, letterSpacing: 1 }} onClick={() => { navigator.clipboard?.writeText(created.recoveryCode); toast("Recovery code copied", "ok"); }}>{created.recoveryCode}<div className="muted" style={{ fontSize: 11, marginTop: 6 }}>tap to copy</div></div>
        <label style={{ display: "flex", gap: 10, alignItems: "center", padding: "14px 14px 8px", fontSize: 14 }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 20, height: 20 }} /> I saved the key and the recovery code somewhere safe.
        </label>
        <div style={{ padding: 14 }}><button className="btn primary" disabled={!ack} onClick={() => HW.unlock(pass).then(() => go("/wallet"))}>Open wallet</button></div>
      </div>
    );
  }
  return (
    <div style={{ padding: 14 }}>
      {mode === "pick" && (
        <>
          <div className="card" style={{ margin: "0 0 12px", textAlign: "center", padding: 28 }}>
            <div className="icon-btn" style={{ width: 64, height: 64, borderRadius: 20, margin: "0 auto 12px", background: "rgba(34,197,94,0.15)", color: "var(--up)" }}><Icon.wallet className="" /></div>
            <b style={{ fontSize: 20 }}>Your Arc wallet</b>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>Trade every launchpad with one tap. The key is generated here and never leaves this phone.</p>
          </div>
          <button className="btn primary" onClick={() => setMode("create")}>Create a new wallet</button>
          <div style={{ height: 10 }} />
          <button className="btn ghost" onClick={() => setMode("import")}>Import a private key</button>
          <div style={{ height: 10 }} />
          
        </>
      )}
      {mode !== "pick" && (
        <>
          <button className="muted" style={{ marginBottom: 10, fontSize: 14 }} onClick={() => setMode("pick")}>‹ back</button>
          {mode === "import" && <><div className="label" style={{ margin: "0 0 6px" }}>Private key</div><div className="field"><Icon.key className="" /><input placeholder="0x…" value={key} onChange={(e) => setKey(e.target.value.trim())} autoCapitalize="none" autoCorrect="off" /></div></>}
          {mode === "recover" && <><div className="label" style={{ margin: "0 0 6px" }}>Recovery code</div><div className="field"><Icon.shield className="" /><input placeholder="word-word-word-…" value={key} onChange={(e) => setKey(e.target.value.trim())} autoCapitalize="none" autoCorrect="off" /></div></>}
          <div className="label" style={{ margin: "14px 0 6px" }}>{mode === "create" ? "Choose a passcode" : "New passcode"}</div>
          <div className="field"><Icon.lock className="" /><input type="password" placeholder="at least 6 characters" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
          {mode === "create" && <><div style={{ height: 8 }} /><div className="field"><Icon.lock className="" /><input type="password" placeholder="repeat passcode" value={pass2} onChange={(e) => setPass2(e.target.value)} /></div></>}
          <p className="muted" style={{ fontSize: 12.5, margin: "10px 2px 16px" }}>The passcode encrypts the key on this phone (PBKDF2 + AES-GCM). It is not sent anywhere and cannot be reset — only the recovery code can.</p>
          <button className="btn primary" disabled={busy} onClick={() => run(() => mode === "create" ? HW.createWallet(pass) : mode === "import" ? HW.importWallet(key, pass) : HW.recoverWallet(key, pass))}>
            {busy ? "…" : mode === "create" ? "Create wallet" : mode === "import" ? "Import" : "Restore"}
          </button>
        </>
      )}
    </div>
  );
}

// ---------- unlock ----------
export function Unlock({ onDone }: { onDone?: () => void }) {
  const [pass, setPass] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await HW.unlock(pass); toast("Unlocked", "ok"); onDone?.(); } catch { toast("Wrong passcode", "err"); } finally { setBusy(false); }
  };
  return (
    <div style={{ padding: 14 }}>
      <div className="label" style={{ margin: "0 0 6px" }}>Passcode</div>
      <div className="field"><Icon.lock className="" /><input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="unlock to trade" /></div>
      <div style={{ height: 10 }} />
      <button className="btn primary" disabled={busy || !pass} onClick={submit}>Unlock</button>
      <ForgotPass />
    </div>
  );
}

function ForgotPass() {
  const [open, setOpen] = useState(false); const [code, setCode] = useState(""); const [np, setNp] = useState("");
  if (!HW.hasRecovery()) return null;
  return (
    <div style={{ marginTop: 14 }}>
      {!open ? <button className="muted" style={{ fontSize: 13, width: "100%" }} onClick={() => setOpen(true)}>Forgot the passcode? Use the recovery code</button> : (
        <>
          <div className="field"><Icon.shield className="" /><input placeholder="recovery code" value={code} onChange={(e) => setCode(e.target.value.trim())} autoCapitalize="none" /></div>
          <div style={{ height: 8 }} /><div className="field"><Icon.lock className="" /><input type="password" placeholder="new passcode" value={np} onChange={(e) => setNp(e.target.value)} /></div>
          <div style={{ height: 8 }} /><button className="btn ghost sm" disabled={!code || np.length < 6} onClick={() => HW.recoverWallet(code, np).then(() => toast("Passcode reset", "ok")).catch(() => toast("Recovery code does not match", "err"))}>Reset passcode</button>
        </>
      )}
    </div>
  );
}

// ---------- main wallet screen ----------
export default function Wallet() {
  const { has, unlocked, addr } = useHot();
  const [bal, setBal] = useState<number | null>(null);
  const [hold, setHold] = useState<Holding[] | null>(null);
  const [sheet, setSheet] = useState<"none" | "receive" | "send" | "export" | "danger">("none");
  const load = useCallback(async () => {
    if (!addr) return;
    HW.hotBalance(addr).then(setBal).catch(() => undefined);
    api.holdings(addr).then((r) => setHold(r.holdings ?? [])).catch(() => setHold([]));
  }, [addr]);
  useEffect(() => { void load(); const id = setInterval(load, 20_000); return () => clearInterval(id); }, [load]);

  if (!has) return <><Header title="Wallet" /><Onboard /></>;
  const total = (bal ?? 0) + (hold ?? []).reduce((s, h) => s + (h.valueUsdc ?? 0), 0);
  return (
    <>
      <Header title="Wallet" right={<button className="icon-btn" onClick={() => go("/settings")}><Icon.gear className="" /></button>} />
      <div className="card" style={{ textAlign: "center", padding: "22px 14px 18px" }}>
        <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total balance</div>
        <div className="bal num">{bal == null ? "…" : usd(total, 2)}</div>
        <div className="muted num" style={{ fontSize: 13 }}>{bal == null ? "" : `${bal.toFixed(2)} USDC · ${(hold ?? []).length} tokens`}</div>
        <button className="addr" style={{ marginTop: 10, display: "inline-flex", gap: 6, alignItems: "center" }} onClick={() => { navigator.clipboard?.writeText(addr!); toast("Address copied", "ok"); }}>{short(addr, 6)} <Icon.copy className="" /></button>
        {!unlocked && <div style={{ marginTop: 10 }}><span className="pill amber"><Icon.lock className="" /> locked — unlock to trade</span></div>}
      </div>
      <div className="grid4" style={{ padding: "0 14px 12px" }}>
        {[["receive", "Receive", Icon.receive], ["send", "Send", Icon.send], ["swap", "Swap", Icon.swap], ["history", "History", Icon.chart]].map(([k, l, Ic]) => (
          <button key={k as string} className="action" onClick={() => k === "swap" ? go("/swap") : k === "history" ? go("/history") : setSheet(k as "receive" | "send")}>
            <span className="icon-btn"><Ic className="" /></span>{l as string}
          </button>
        ))}
      </div>
      {!unlocked && <Unlock />}
      <div className="list-h"><span>Holdings</span><span>{hold ? `${hold.length}` : ""}</span></div>
      {hold == null ? <div className="empty">Loading…</div> : hold.length === 0 ? <div className="empty">No tokens yet. Find one on Trending and tap buy.</div> :
        hold.sort((a, b) => (b.valueUsdc ?? 0) - (a.valueUsdc ?? 0)).map((h) => { const pnlPct = h.avgEntry && h.price ? (h.price / h.avgEntry - 1) * 100 : null; return (
          <div key={h.token} className="row" onClick={() => go(`/token/${h.token}`)}>
            <Logo ca={h.token} />
            <div className="row-main">
              <div className="row-name"><b>{h.symbol || short(h.token)}</b></div>
              <div className="row-sub num"><span>{num(h.amount)}</span>{pnlPct != null && <span className={pnlPct >= 0 ? "up" : "down"}>{pct(pnlPct)}</span>}{h.transferredIn && <span>transferred in</span>}</div>
            </div>
            <div className="row-right"><div className="row-mc" style={{ color: "var(--ink)" }}>{usd(h.valueUsdc, 2)}</div>{h.unrealized != null && <div className={`row-chg ${h.unrealized >= 0 ? "up" : "down"}`}>{h.unrealized >= 0 ? "+" : "−"}{usd(Math.abs(h.unrealized), 2)}</div>}</div>
          </div>
        ); })}
      <div className="label">Security</div>
      <div className="card" style={{ padding: 0 }}>
        <button className="menu-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setSheet("export")}><span className="icon-btn"><Icon.key className="" /></span><div><b>Export private key</b><small>Needs your passcode</small></div><Icon.chev className="chev" /></button>
        <button className="menu-row" style={{ width: "100%", textAlign: "left" }} onClick={() => HW.lock()}><span className="icon-btn"><Icon.lock className="" /></span><div><b>Lock now</b><small>Passcode required for the next trade</small></div><Icon.chev className="chev" /></button>
        <button className="menu-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setSheet("danger")}><span className="icon-btn" style={{ color: "var(--down)" }}><Icon.x className="" /></span><div><b style={{ color: "var(--down)" }}>Remove wallet from this phone</b><small>Only if you have the key saved</small></div><Icon.chev className="chev" /></button>
      </div>
      <ReceiveSheet open={sheet === "receive"} onClose={() => setSheet("none")} addr={addr!} />
      <SendSheet open={sheet === "send"} onClose={() => { setSheet("none"); void load(); }} bal={bal ?? 0} unlocked={unlocked} />
      <ExportSheet open={sheet === "export"} onClose={() => setSheet("none")} />
      <Sheet open={sheet === "danger"} onClose={() => setSheet("none")} title="Remove wallet?">
        <p className="muted" style={{ fontSize: 14 }}>This deletes the encrypted key from this phone. If you have not saved the private key or the recovery code, the funds at <span className="mono">{short(addr, 6)}</span> are gone forever.</p>
        <button className="btn danger" onClick={() => { HW.forgetWallet(); setSheet("none"); toast("Wallet removed", "info"); }}>I have the key. Remove.</button>
      </Sheet>
    </>
  );
}

function ReceiveSheet({ open, onClose, addr }: { open: boolean; onClose: () => void; addr: string }) {
  const [qr, setQr] = useState("");
  useEffect(() => { if (open) QRCode.toDataURL(addr, { margin: 1, width: 260, color: { dark: "#000000", light: "#ffffff" } }).then(setQr); }, [open, addr]);
  return (
    <Sheet open={open} onClose={onClose} title="Receive USDC on Arc">
      <div style={{ textAlign: "center" }}>
        {qr && <img alt="" src={qr} style={{ width: 220, height: 220, borderRadius: 12, background: "#fff", padding: 8 }} />}
        <div className="mono" style={{ fontSize: 12.5, wordBreak: "break-all", margin: "12px 0" }}>{addr}</div>
        <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(addr); toast("Address copied", "ok"); }}>Copy address</button>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Send USDC on the Arc network only. USDC is the gas here — you need nothing else. Coming from another chain? Use Bridge in More.</p>
      </div>
    </Sheet>
  );
}

function SendSheet({ open, onClose, bal, unlocked }: { open: boolean; onClose: () => void; bal: number; unlocked: boolean }) {
  const [to, setTo] = useState(""); const [amt, setAmt] = useState(""); const [busy, setBusy] = useState(false);
  const send = async () => {
    const a = Number(amt);
    if (!isAddr(to)) return toast("Enter a valid 0x address", "err");
    if (!(a > 0) || a > bal - 0.01) return toast("Amount exceeds balance (keep ~0.01 for gas)", "err");
    setBusy(true);
    try { const h = await HW.hotWithdraw(to, a); toast(`Sent ${a} USDC`, "ok", h); setTo(""); setAmt(""); onClose(); }
    catch (e) { toast(String((e as Error).message || e).slice(0, 140), "err"); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Send USDC">
      {!unlocked ? <Unlock /> : (
        <>
          <div className="field"><Icon.user className="" /><input placeholder="recipient 0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} autoCapitalize="none" autoCorrect="off" /></div>
          <div style={{ height: 8 }} />
          <div className="field"><span className="muted">USDC</span><input inputMode="decimal" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><button className="pill" onClick={() => setAmt(Math.max(0, bal - 0.02).toFixed(2))}>MAX</button></div>
          <div className="muted num" style={{ fontSize: 12.5, margin: "8px 2px 14px" }}>Available {bal.toFixed(2)} USDC</div>
          <button className="btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send"}</button>
        </>
      )}
    </Sheet>
  );
}

function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pass, setPass] = useState(""); const [key, setKey] = useState<string | null>(null);
  useEffect(() => { if (!open) { setPass(""); setKey(null); } }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Export private key">
      {key ? (
        <>
          <div className="card mono" style={{ margin: 0, fontSize: 12.5, wordBreak: "break-all", borderLeft: "3px solid var(--down)" }} onClick={() => { navigator.clipboard?.writeText(key); toast("Key copied", "ok"); }}>{key}<div className="muted" style={{ fontSize: 11, marginTop: 6 }}>tap to copy · anyone with this key owns the funds</div></div>
        </>
      ) : (
        <>
          <div className="field"><Icon.lock className="" /><input type="password" placeholder="passcode" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
          <div style={{ height: 10 }} />
          <button className="btn ghost" disabled={!pass} onClick={() => HW.exportKey(pass).then(setKey).catch(() => toast("Wrong passcode", "err"))}>Reveal</button>
        </>
      )}
    </Sheet>
  );
}
