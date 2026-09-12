import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import {
  createWallet, exportKey, forgetWallet, hasWallet, hotAddress, hotBalance, hotWait, hotWithdraw,
  importWallet, isUnlocked, lock, onHotChange, unlock,
} from "@/lib/arc-hotwallet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const DOWN = "var(--arc-down, #f0534f)";

// ---------------- wallet panel ----------------
export function WalletPanel({ onReady }: { onReady: (addr: string | null) => void }) {
  const [, force] = useState(0);
  const [pass, setPass] = useState("");
  const [mode, setMode] = useState<"create" | "import" | "unlock" | "open">(hasWallet() ? "unlock" : "create");
  const [imp, setImp] = useState("");
  const [bal, setBal] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<string | null>(null);
  const [wd, setWd] = useState({ to: "", amt: "" });
  const [tab, setTab] = useState<"deposit" | "withdraw" | "keys">("deposit");
  const addr = hotAddress();

  const refresh = useCallback(async () => {
    const a = hotAddress();
    if (!a) return;
    setBal(await hotBalance(a).catch(() => null));
    setQr(await QRCode.toDataURL(a, { margin: 1, width: 150, color: { dark: "#e8ecf6", light: "#0e1118" } }).catch(() => null));
  }, []);
  useEffect(() => {
    const off = onHotChange(() => { force((x) => x + 1); setMode(isUnlocked() ? "open" : hasWallet() ? "unlock" : "create"); onReady(isUnlocked() ? hotAddress() : null); });
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
        {mode === "open" && <button className="arc-mono" onClick={() => lock()} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "2px 8px" }} type="button">lock</button>}
      </div>
      <p style={{ color: "var(--arc-muted)", fontSize: 12, margin: "4px 0 10px" }}>
        {mode === "open" ? "Unlocked. One-click buys sign here, no popups." : "A key generated in this browser, encrypted with your passcode. Deposit USDC to it and trade with one click."}
      </p>
      {mode !== "open" && (
        <div style={{ display: "grid", gap: 8 }}>
          {mode === "import" && <input className="arc-mono" onChange={(e) => setImp(e.target.value)} placeholder="private key 0x…" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "8px 10px" }} type="password" value={imp} />}
          <input className="arc-mono" onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void act(() => (mode === "unlock" ? unlock(pass) : mode === "import" ? importWallet(imp, pass) : createWallet(pass))); }} placeholder={mode === "unlock" ? "passcode" : "new passcode (min 6 chars)"} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 13, padding: "9px 10px" }} type="password" value={pass} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {mode === "unlock" && <button className="arc-cta" onClick={() => void act(() => unlock(pass))} type="button">Unlock</button>}
            {mode === "create" && <button className="arc-cta" onClick={() => void act(() => createWallet(pass))} type="button">Create wallet</button>}
            {mode === "import" && <button className="arc-cta" onClick={() => void act(() => importWallet(imp, pass))} type="button">Import</button>}
            {mode !== "import" && <button className="arc-mono" onClick={() => setMode("import")} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "6px 10px" }} type="button">import key</button>}
            {mode === "import" && <button className="arc-mono" onClick={() => setMode(hasWallet() ? "unlock" : "create")} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "6px 10px" }} type="button">back</button>}
            {hasWallet() && mode !== "unlock" && <button className="arc-mono" onClick={() => setMode("unlock")} style={{ background: "transparent", border: "none", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11 }} type="button">unlock existing</button>}
          </div>
          {hasWallet() && mode === "unlock" && addr && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>{short(addr)} · balance {bal !== null ? `${bal.toFixed(2)} USDC` : "…"}</p>}
        </div>
      )}
      {mode === "open" && addr && (
        <div>
          <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
            <p className="arc-mono" style={{ fontSize: 26, margin: 0 }}>{bal !== null ? bal.toFixed(2) : "…"} <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>USDC</span></p>
            <button className="arc-mono" onClick={() => { void navigator.clipboard.writeText(addr); setMsg("Address copied."); }} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "3px 8px" }} type="button">{short(addr)} ⧉</button>
          </div>
          <div style={{ display: "flex", gap: 4, margin: "10px 0 8px" }}>
            {(["deposit", "withdraw", "keys"] as const).map((t) => <button key={t} className="arc-mono" onClick={() => setTab(t)} style={{ background: tab === t ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (tab === t ? "var(--arc-cobalt)" : "var(--arc-line)"), color: tab === t ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 10px" }} type="button">{t}</button>)}
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
              <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>The key lives only in this browser. Back it up: clearing site data deletes it and the funds with it. Import it in MetaMask/Rabby any time.</p>
              <button className="arc-mono" onClick={() => { if (confirm("Remove the wallet from this browser? Make sure the key is backed up.")) forgetWallet(); }} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: DOWN, cursor: "pointer", fontSize: 11, padding: "4px 8px", width: "fit-content" }} type="button">remove from this device</button>
            </div>
          )}
        </div>
      )}
      {msg && <p className="arc-mono" style={{ color: msg.startsWith("Wrong") || msg.includes("failed") ? DOWN : "var(--arc-cobalt)", fontSize: 11, margin: "8px 0 0" }}>{msg}</p>}
    </div>
  );
}

