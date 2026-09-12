import { connectWallet, getStoredWallet, nativeBalance, onWalletChange, sendTx, waitReceipt } from "@/lib/arc-wallet";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import {
  createWallet, exportKey, forgetWallet, hasWallet, hotAddress, hotBalance, hotWait, hotWithdraw,
  importWallet, isUnlocked, lock, onHotChange, recoverWallet, unlock, type Created,
} from "@/lib/arc-hotwallet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const DOWN = "var(--arc-down, #f0534f)";

// ---------------- wallet panel ----------------
export function WalletPanel({ onReady }: { onReady: (addr: string | null) => void }) {
  const [, force] = useState(0);
  const [pass, setPass] = useState("");
  const [mode, setMode] = useState<"create" | "import" | "unlock" | "open" | "recover">(hasWallet() ? "unlock" : "create");
  const [backup, setBackup] = useState<Created | null>(null);   // shown once after create/import/recover — must be acknowledged
  const [ack, setAck] = useState(false);
  const [rcode, setRcode] = useState("");
  const [imp, setImp] = useState("");
  const [bal, setBal] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<string | null>(null);
  const [wd, setWd] = useState({ to: "", amt: "" });
  const [tab, setTab] = useState<"deposit" | "withdraw" | "keys">("deposit");
  const [forget, setForget] = useState(false);   // locked-screen path: forget without unlocking (needs typed confirmation)
  const [forgetTyped, setForgetTyped] = useState("");
  const [topup, setTopup] = useState({ amt: "", bal: null as number | null, busy: false });
  const [browser, setBrowser] = useState<string | null>(null);
  useEffect(() => { setBrowser(getStoredWallet()); return onWalletChange(setBrowser); }, []);
  useEffect(() => { if (browser) void nativeBalance(browser).then((b) => setTopup((t) => ({ ...t, bal: b }))).catch(() => null); }, [browser]);
  const topUp = async () => {
    const amt = Number(topup.amt);
    if (!addr || !(amt > 0)) return;
    setTopup((t) => ({ ...t, busy: true })); setMsg(null);
    try {
      const from = browser ?? (await connectWallet());
      const h = await sendTx({ to: addr, data: "0x", value: BigInt(Math.round(amt * 1e6)) * 10n ** 12n, from });
      setMsg(`Top-up sent: ${h.slice(0, 14)}…`);
      await waitReceipt(h, 90_000);
      setMsg(`Top-up of ${amt} USDC confirmed.`);
      await refresh();
      void nativeBalance(from).then((b) => setTopup((t) => ({ ...t, bal: b, amt: "" }))).catch(() => null);
    } catch (e) { setMsg((e as Error).message.includes("reject") ? "Top-up cancelled in the wallet." : "Top-up failed: " + (e as Error).message.slice(0, 80)); }
    setTopup((t) => ({ ...t, busy: false }));
  };
  // "replace wallet" flow: warn about funds on the old key, force a key export, then generate a fresh one
  const [rot, setRot] = useState<null | { positions: number | null; oldKey: string | null; saved: boolean; newPass: string; action: "new" | "remove" }>(null);
  const startRotate = async (action: "new" | "remove") => {
    let positions: number | null = null;
    try {
      const r = await fetch(`https://bot-production-4200.up.railway.app/api/positions?wallet=${addr}`).then((x) => x.json());
      positions = Array.isArray(r?.positions) ? r.positions.filter((q: { qty?: number }) => (q.qty ?? 0) > 0).length : 0;
    } catch { /* unknown */ }
    setRot({ positions, oldKey: null, saved: false, newPass: "", action });
    setMsg(null);
  };
  const addr = hotAddress();

  const refresh = useCallback(async () => {
    const a = hotAddress();
    if (!a) return;
    setBal(await hotBalance(a).catch(() => null));
    setQr(await QRCode.toDataURL(a, { margin: 1, width: 150, color: { dark: "#e8ecf6", light: "#0e1118" } }).catch(() => null));
  }, []);
  useEffect(() => {
    const off = onHotChange(() => { force((x) => x + 1); setMode((m) => (m === "recover" && !isUnlocked() ? m : isUnlocked() ? "open" : hasWallet() ? "unlock" : "create")); onReady(isUnlocked() ? hotAddress() : null); });
    if (isUnlocked()) setMode("open");
    void refresh();
    const id = setInterval(refresh, 15_000);
    return () => { off(); clearInterval(id); };
  }, [refresh, onReady]);

  const act = async (fn: () => Promise<unknown>) => { setMsg(null); try { await fn(); setPass(""); await refresh(); } catch (e) { setMsg((e as Error).message); } };

  return (
    <div style={{ background: "var(--arc-paper)", border: "1px solid var(--arc-line)", padding: 14 }}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Trading wallet</p>
        {mode === "open" && (
          <span style={{ display: "flex", gap: 6 }}>
            <button className="arc-mono" onClick={() => { setTab("keys"); void startRotate("new"); }} style={{ background: "transparent", border: "1px solid var(--arc-cobalt)", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: "2px 8px" }} title="Forget this wallet and generate a fresh one (warns about funds, exports the old key first)" type="button">🔄 new wallet</button>
            <button className="arc-mono" onClick={() => lock()} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "2px 8px" }} type="button">lock</button>
          </span>
        )}
      </div>
      <p style={{ color: "var(--arc-muted)", fontSize: 12, margin: "4px 0 10px" }}>
        {mode === "open" ? "Unlocked. One-click buys sign here, no popups." : "A key generated in this browser, encrypted with your passcode. Deposit USDC to it and trade with one click."}
      </p>
      {mode !== "open" && (
        <div style={{ display: "grid", gap: 8 }}>
          {mode === "import" && <input className="arc-mono" onChange={(e) => setImp(e.target.value)} placeholder="private key 0x…" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "8px 10px" }} type="password" value={imp} />}
          {mode === "recover" && <input className="arc-mono" onChange={(e) => setRcode(e.target.value)} placeholder="recovery code XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "8px 10px" }} value={rcode} />}
          <input className="arc-mono" onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && mode === "unlock") void act(() => unlock(pass)); }} placeholder={mode === "unlock" ? "passcode" : "new passcode (min 6 chars)"} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 13, padding: "9px 10px" }} type="password" value={pass} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {mode === "unlock" && <button className="arc-cta" onClick={() => void act(() => unlock(pass))} type="button">Unlock</button>}
            {mode === "create" && <button className="arc-cta" onClick={() => void act(async () => { setBackup(await createWallet(pass)); setAck(false); })} type="button">Create wallet</button>}
            {mode === "import" && <button className="arc-cta" onClick={() => void act(async () => { setBackup(await importWallet(imp, pass)); setAck(false); })} type="button">Import</button>}
            {mode === "recover" && <button className="arc-cta" onClick={() => void act(async () => { setBackup(await recoverWallet(rcode, pass)); setAck(false); })} type="button">Reset passcode</button>}
            {mode !== "import" && <button className="arc-mono" onClick={() => setMode("import")} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "6px 10px" }} type="button">import key</button>}
            {(mode === "import" || mode === "recover") && <button className="arc-mono" onClick={() => setMode(hasWallet() ? "unlock" : "create")} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "6px 10px" }} type="button">back</button>}
            {mode === "unlock" && <button className="arc-mono" onClick={() => setMode("recover")} style={{ background: "transparent", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, textDecoration: "underline" }} type="button">forgot passcode?</button>}
            {mode === "unlock" && <button className="arc-mono" onClick={() => setForget(true)} style={{ background: "transparent", border: "none", color: DOWN, cursor: "pointer", fontSize: 11, textDecoration: "underline" }} type="button">forget & start a new wallet</button>}
            {hasWallet() && mode !== "unlock" && <button className="arc-mono" onClick={() => setMode("unlock")} style={{ background: "transparent", border: "none", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11 }} type="button">unlock existing</button>}
          </div>
          {hasWallet() && mode === "unlock" && addr && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>{short(addr)} · balance {bal !== null ? `${bal.toFixed(2)} USDC` : "…"}</p>}
          {mode === "unlock" && forget && addr && (
            <div style={{ border: `1px solid ${(bal ?? 0) > 0.001 ? DOWN : "var(--arc-line)"}`, background: (bal ?? 0) > 0.001 ? "rgba(255,80,80,0.06)" : "#0e1118", display: "grid", gap: 8, padding: 10 }}>
              <p className="arc-mono" style={{ color: (bal ?? 0) > 0.001 ? DOWN : "var(--arc-ink)", fontSize: 12, fontWeight: 700, margin: 0 }}>
                {(bal ?? 0) > 0.001 ? `This wallet holds ${(bal ?? 0).toFixed(2)} USDC (plus any tokens).` : "This wallet looks empty (tokens not checked)."}
              </p>
              <p className="arc-mono" style={{ fontSize: 11, margin: 0 }}>
                Without the passcode the key cannot be shown. If you know it, unlock first and use 🔄 new wallet — it exports the old key. If you have the recovery code, use "forgot passcode?". Forgetting now deletes the key from this browser for good.
              </p>
              <input className="arc-mono" onChange={(e) => setForgetTyped(e.target.value)} placeholder='type FORGET to confirm' style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "8px 10px" }} value={forgetTyped} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="arc-cta" disabled={forgetTyped !== "FORGET"} onClick={() => { forgetWallet(); setForget(false); setForgetTyped(""); setMode("create"); setMsg("Old wallet forgotten — create a new one above."); }} style={{ opacity: forgetTyped === "FORGET" ? 1 : 0.45 }} type="button">Forget & create new</button>
                <button className="arc-mono" onClick={() => setForget(false)} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "4px 10px" }} type="button">cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {mode === "open" && addr && backup && !ack && (
        <div style={{ background: "rgba(240,83,79,0.08)", border: "1px solid #f0534f", padding: 12 }}>
          <p style={{ fontWeight: 700, margin: "0 0 6px" }}>Save these now. They are shown once.</p>
          <p style={{ color: "var(--arc-muted)", fontSize: 12, margin: "0 0 8px" }}>The key exists only in this browser. If you clear site data or lose the device without these, the funds are gone. Either one restores the wallet anywhere.</p>
          <p className="arc-mono" style={{ fontSize: 10, margin: "6px 0 2px" }}>PRIVATE KEY</p>
          <p className="arc-mono" style={{ background: "#0e1118", border: "1px solid var(--arc-line)", fontSize: 11, margin: 0, padding: 8, wordBreak: "break-all" }}>{backup.privateKey}</p>
          <p className="arc-mono" style={{ fontSize: 10, margin: "8px 0 2px" }}>RECOVERY CODE (resets a forgotten passcode on this device)</p>
          <p className="arc-mono" style={{ background: "#0e1118", border: "1px solid var(--arc-line)", fontSize: 13, letterSpacing: 1, margin: 0, padding: 8 }}>{backup.recoveryCode}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button className="arc-mono" onClick={() => { void navigator.clipboard.writeText(`ArcTools trading wallet ${backup.address}\nprivate key: ${backup.privateKey}\nrecovery code: ${backup.recoveryCode}`); setMsg("Copied both to clipboard."); }} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "5px 10px" }} type="button">copy both</button>
            <a className="arc-mono" download={`arctools-wallet-${backup.address.slice(2, 8)}.txt`} href={`data:text/plain,${encodeURIComponent(`ArcTools trading wallet\naddress: ${backup.address}\nprivate key: ${backup.privateKey}\nrecovery code: ${backup.recoveryCode}\n`)}`} style={{ border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 11, padding: "5px 10px", textDecoration: "none" }}>download .txt</a>
          </div>
          <label style={{ alignItems: "center", display: "flex", fontSize: 12, gap: 8, marginTop: 10 }}>
            <input onChange={(e) => e.target.checked && setAck(true)} type="checkbox" /> I saved the private key or the recovery code somewhere safe.
          </label>
        </div>
      )}
      {mode === "open" && addr && (!backup || ack) && (
        <div>
          <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
            <p className="arc-mono" style={{ fontSize: 26, margin: 0 }}>{bal !== null ? bal.toFixed(2) : "…"} <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>USDC</span></p>
            <button className="arc-mono" onClick={() => { void navigator.clipboard.writeText(addr); setMsg("Address copied."); }} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "3px 8px" }} type="button">{short(addr)} ⧉</button>
          </div>
          <div style={{ display: "flex", gap: 4, margin: "10px 0 8px" }}>
            {(["deposit", "withdraw", "keys"] as const).map((t) => <button key={t} className="arc-mono" onClick={() => setTab(t)} style={{ background: tab === t ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (tab === t ? "var(--arc-cobalt)" : "var(--arc-line)"), color: tab === t ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 10px" }} type="button">{t === "keys" ? "keys · new wallet" : t}</button>)}
          </div>
          {tab === "deposit" && (
            <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
              {qr && <img alt="deposit QR" height={110} src={qr} style={{ border: "1px solid var(--arc-line)" }} width={110} />}
              <div style={{ fontSize: 12 }}>
                <p style={{ margin: "0 0 4px" }}>Send <strong>USDC on Arc</strong> (native, chain 5042) to:</p>
                <p className="arc-mono" style={{ fontSize: 11, margin: "0 0 6px", wordBreak: "break-all" }}>{addr}</p>
                <p style={{ color: "var(--arc-muted)", margin: 0 }}>From another chain: <a href="/bridge" style={{ color: "var(--arc-cobalt)" }}>bridge</a> USDC to this address. Gas is USDC too — keep 0.05 spare.</p>
              </div>
            </div>
          )}
          {tab === "deposit" && (
            <div style={{ borderTop: "1px solid var(--arc-line)", display: "grid", gap: 6, marginTop: 10, paddingTop: 10 }}>
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>
                TOP UP FROM BROWSER WALLET{browser ? ` · ${browser.slice(0, 6)}…${browser.slice(-4)}${topup.bal !== null ? ` · ${topup.bal.toFixed(2)} USDC` : ""}` : ""}
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="arc-mono" inputMode="decimal" onChange={(e) => setTopup({ ...topup, amt: e.target.value })} placeholder="USDC" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: 1, fontSize: 12, padding: "8px 10px" }} value={topup.amt} />
                {[10, 50, 100].map((n) => <button className="arc-mono" key={n} onClick={() => setTopup({ ...topup, amt: String(n) })} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "0 7px" }} type="button">{n}</button>)}
                <button className="arc-mono" disabled={topup.busy || !(Number(topup.amt) > 0)} onClick={() => void topUp()} style={{ background: "var(--arc-cobalt)", border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, opacity: topup.busy || !(Number(topup.amt) > 0) ? 0.5 : 1, padding: "0 12px", whiteSpace: "nowrap" }} type="button">{topup.busy ? "…" : browser ? "Send" : "Connect & send"}</button>
              </div>
              <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>Moves native USDC from MetaMask / Rabby straight into the trading wallet (one confirmation, ~0.01 USDC gas).</p>
            </div>
          )}
          {tab === "withdraw" && (
            <div style={{ display: "grid", gap: 6 }}>
              <input className="arc-mono" onChange={(e) => setWd({ ...wd, to: e.target.value })} placeholder="to 0x…" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "8px 10px" }} value={wd.to} />
              <div style={{ display: "flex", gap: 6 }}>
                <input className="arc-mono" inputMode="decimal" onChange={(e) => setWd({ ...wd, amt: e.target.value })} placeholder="USDC" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: 1, fontSize: 12, padding: "8px 10px" }} value={wd.amt} />
                <button className="arc-mono" onClick={() => setWd({ ...wd, amt: Math.max(0, (bal ?? 0) - 0.02).toFixed(4) })} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11 }} type="button">max</button>
                <button className="arc-cta" onClick={() => void act(async () => { const h = await hotWithdraw(wd.to.trim(), Number(wd.amt)); setMsg(`Sent: ${h.slice(0, 14)}…`); await hotWait(h); })} type="button">Send</button>
              </div>
            </div>
          )}
          {tab === "keys" && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="arc-mono" onChange={(e) => setPass(e.target.value)} placeholder="passcode to reveal key" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: 1, fontSize: 12, padding: "8px 10px" }} type="password" value={pass} />
                <button className="arc-mono" onClick={() => void act(async () => setShowKey(await exportKey(pass)))} style={{ background: "transparent", border: "1px solid var(--arc-cobalt)", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: "0 10px" }} type="button">export</button>
              </div>
              {showKey && <p className="arc-mono" style={{ background: "#0e1118", border: "1px solid var(--arc-line)", fontSize: 11, margin: 0, padding: 8, wordBreak: "break-all" }}>{showKey}</p>}
              <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>The key lives only in this browser. Back it up: clearing site data deletes it and the funds with it. Import it in MetaMask/Rabby any time. Forgot the passcode? Lock and use "forgot passcode?" with your recovery code.</p>
              {!rot && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button className="arc-mono" onClick={() => void startRotate("new")} style={{ background: "transparent", border: "1px solid var(--arc-cobalt)", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: "4px 8px" }} type="button">generate a new wallet</button>
                  <button className="arc-mono" onClick={() => void startRotate("remove")} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: DOWN, cursor: "pointer", fontSize: 11, padding: "4px 8px" }} type="button">remove from this device</button>
                </div>
              )}
              {rot && (() => {
                const hasFunds = (bal ?? 0) > 0.001 || (rot.positions ?? 0) > 0;
                const canGo = rot.saved || !hasFunds;
                return (
                  <div style={{ border: `1px solid ${hasFunds ? DOWN : "var(--arc-line)"}`, background: hasFunds ? "rgba(255,80,80,0.06)" : "#0e1118", display: "grid", gap: 8, padding: 10 }}>
                    <p className="arc-mono" style={{ color: hasFunds ? DOWN : "var(--arc-ink)", fontSize: 12, fontWeight: 700, margin: 0 }}>
                      {rot.action === "new" ? "Replace the trading wallet" : "Remove the trading wallet"} — {hasFunds ? "the current wallet is NOT empty" : "the current wallet looks empty"}
                    </p>
                    <p className="arc-mono" style={{ fontSize: 11, margin: 0 }}>
                      {short(addr!)} holds <strong>{(bal ?? 0).toFixed(2)} USDC</strong>{rot.positions === null ? " and an unknown number of tokens" : rot.positions > 0 ? ` and ${rot.positions} token position${rot.positions === 1 ? "" : "s"}` : " and no tracked tokens"}.
                      {hasFunds ? " Once the key is gone from this browser, the funds are gone with it — save the private key (or withdraw first)." : " If you ever sent anything unusual to it, save the key anyway."}
                    </p>
                    {!rot.oldKey ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input className="arc-mono" onChange={(e) => setPass(e.target.value)} placeholder="passcode to reveal the OLD key" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: 1, fontSize: 12, padding: "8px 10px" }} type="password" value={pass} />
                        <button className="arc-mono" onClick={() => void act(async () => setRot({ ...rot, oldKey: await exportKey(pass) }))} style={{ background: "transparent", border: "1px solid var(--arc-cobalt)", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: "0 10px" }} type="button">reveal old key</button>
                      </div>
                    ) : (
                      <>
                        <p className="arc-mono" style={{ background: "#0e1118", border: "1px solid var(--arc-line)", fontSize: 11, margin: 0, padding: 8, wordBreak: "break-all" }}>{rot.oldKey}</p>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="arc-mono" onClick={() => void navigator.clipboard.writeText(rot.oldKey!).then(() => setMsg("Old key copied"))} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "4px 8px" }} type="button">copy</button>
                          <button className="arc-mono" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([`ArcTools trading wallet (OLD)\naddress: ${addr}\nprivate key: ${rot.oldKey}\n`], { type: "text/plain" })); a.download = `arctools-old-wallet-${addr!.slice(2, 8)}.txt`; a.click(); }} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "4px 8px" }} type="button">download .txt</button>
                        </div>
                      </>
                    )}
                    <label className="arc-mono" style={{ alignItems: "center", display: "flex", fontSize: 11, gap: 8 }}>
                      <input checked={rot.saved} onChange={(e) => setRot({ ...rot, saved: e.target.checked })} type="checkbox" />
                      I saved the old private key{hasFunds ? "" : " or I accept the wallet is empty"}
                    </label>
                    {rot.action === "new" && (
                      <input className="arc-mono" onChange={(e) => setRot({ ...rot, newPass: e.target.value })} placeholder="passcode for the NEW wallet (min 6 chars)" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "8px 10px" }} type="password" value={rot.newPass} />
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="arc-cta" disabled={!canGo || (rot.action === "new" && rot.newPass.length < 6)} onClick={() => void act(async () => {
                        if (rot.action === "remove") { forgetWallet(); setRot(null); setMode("create"); setMsg("Wallet removed from this browser."); return; }
                        const np = rot.newPass; forgetWallet(); const c = await createWallet(np); setRot(null); setPass(""); setShowKey(null); setBackup(c); setAck(false);
                      })} style={{ opacity: canGo ? 1 : 0.45 }} type="button">{rot.action === "new" ? "Generate new wallet & forget old" : "Remove wallet"}</button>
                      <button className="arc-mono" onClick={() => setRot(null)} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "4px 10px" }} type="button">cancel</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
      {msg && <p className="arc-mono" style={{ color: msg.startsWith("Wrong") || msg.includes("failed") ? DOWN : "var(--arc-cobalt)", fontSize: 11, margin: "8px 0 0" }}>{msg}</p>}
    </div>
  );
}

