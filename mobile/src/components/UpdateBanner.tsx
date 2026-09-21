/** Persistent "new version" banner with a one-tap in-app install. Sits above the Trending list and in Settings. */
import { useEffect, useState } from "react";
import { checkUpdate, installUpdate, onUpdateChange, pendingUpdate, updateLog, updateRequired, type Progress } from "../lib/update";
import { toast } from "../lib/store";
import { APP_VERSION } from "../App";

/** Settings card: current version, last check, "Check for updates" — visible even when nothing is pending. */
export function UpdateCard() {
  const [, tick] = useState(0); const [checking, setChecking] = useState(false); const [checkedAt, setCheckedAt] = useState<number | null>(null);
  useEffect(() => { const off = onUpdateChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const m = pendingUpdate();
  const check = async () => { setChecking(true); try { await checkUpdate(true); setCheckedAt(Date.now()); } finally { setChecking(false); } };
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ minWidth: 0 }}><b>App updates</b><div className="muted" style={{ fontSize: 12 }}>Installed: ArcOne {APP_VERSION}</div></div>
        {!m && <button className="btn sm" disabled={checking} onClick={check}>{checking ? "Checking…" : "Check now"}</button>}
      </div>
      {m ? <UpdateBanner compact /> : <div className="muted" style={{ fontSize: 12 }}>{checkedAt ? "You are on the latest version." : "Checked at launch and every hour."} Updates download and install in-app — no browser.</div>}
    </div>
  );
}

export function UpdateBanner({ compact = false }: { compact?: boolean }) {
  const [, tick] = useState(0);
  const [prog, setProg] = useState<Progress | null>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("upd_hide") === "1"; } catch { return false; } });
  useEffect(() => { const off = onUpdateChange(() => tick((n) => n + 1)); void checkUpdate(); return () => { off(); }; }, []);
  const m = pendingUpdate();
  if (!m || (hidden && !updateRequired() && !compact)) return null;
  const busy = prog && prog.phase !== "done" && prog.phase !== "error" && prog.phase !== "fallback";
  const go = async () => {
    try { await installUpdate(m, setProg); }
    catch (e) { toast(`Update failed: ${String((e as Error).message).slice(0, 80)}`, "err"); }
  };
  return (
    <div className={`upd ${updateRequired() ? "upd--req" : ""} ${compact ? "upd--in" : ""}`}>
      <div className="upd__txt">
        <b>ArcOne {m.version} is out</b>
        <small>{updateRequired() ? "This version is no longer supported — update to keep trading." : m.changelog ?? "Fixes and improvements. Your wallet and settings stay."}</small>
        {prog && prog.phase === "download" && <div className="upd__bar"><i style={{ width: `${prog.pct}%` }} /></div>}
        {prog?.phase === "verify" && <small>Verifying the file (SHA-256)…</small>}
        {prog?.phase === "install" && <small>{prog.msg}</small>}
        {prog?.phase === "done" && <small>Tap <b>Install</b> on the Android screen. Your wallet and settings stay.</small>}
        {prog?.phase === "fallback" && <small className="down">{prog.msg}</small>}
        {prog?.phase === "error" && <small className="down">{prog.msg}</small>}
        {prog && (prog.phase === "fallback" || prog.phase === "error") && updateLog.length > 0 && <details><summary className="muted" style={{ fontSize: 11 }}>details</summary><pre style={{ fontSize: 10, whiteSpace: "pre-wrap", margin: 0 }}>{updateLog.join("\n")}</pre></details>}
      </div>
      <div className="upd__act">
        <button className="btn primary sm" disabled={!!busy} onClick={go}>{busy ? (prog?.phase === "download" ? `${prog.pct}%` : "…") : prog?.phase === "done" ? "Install again" : prog?.phase === "fallback" ? "Retry" : "Update"}</button>
        {!updateRequired() && !compact && <button className="icon-btn sm" aria-label="Later" onClick={() => { setHidden(true); try { sessionStorage.setItem("upd_hide", "1"); } catch { /* ignore */ } }}>×</button>}
      </div>
    </div>
  );
}
