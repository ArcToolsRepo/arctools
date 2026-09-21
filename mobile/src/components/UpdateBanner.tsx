/** Persistent "new version" banner with a one-tap in-app install. Sits above the Trending list and in Settings. */
import { useEffect, useState } from "react";
import { checkUpdate, installUpdate, onUpdateChange, pendingUpdate, updateRequired, type Progress } from "../lib/update";
import { toast } from "../lib/store";

export function UpdateBanner({ compact = false }: { compact?: boolean }) {
  const [, tick] = useState(0);
  const [prog, setProg] = useState<Progress | null>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("upd_hide") === "1"; } catch { return false; } });
  useEffect(() => { const off = onUpdateChange(() => tick((n) => n + 1)); void checkUpdate(); return () => { off(); }; }, []);
  const m = pendingUpdate();
  if (!m || (hidden && !updateRequired() && !compact)) return null;
  const busy = prog && prog.phase !== "done" && prog.phase !== "error";
  const go = async () => {
    try { await installUpdate(m, setProg); }
    catch (e) { toast(`Update failed: ${String((e as Error).message).slice(0, 80)}`, "err"); }
  };
  return (
    <div className={`upd ${updateRequired() ? "upd--req" : ""}`}>
      <div className="upd__txt">
        <b>ArcOne {m.version} is out</b>
        <small>{updateRequired() ? "This version is no longer supported — update to keep trading." : m.changelog ?? "Fixes and improvements. Your wallet and settings stay."}</small>
        {prog && prog.phase === "download" && <div className="upd__bar"><i style={{ width: `${prog.pct}%` }} /></div>}
        {prog?.phase === "install" && <small>Opening the installer… tap Install on the Android screen.</small>}
        {prog?.phase === "error" && <small className="down">{prog.msg}</small>}
      </div>
      <div className="upd__act">
        <button className="btn primary sm" disabled={!!busy} onClick={go}>{busy ? (prog?.phase === "download" ? `${prog.pct}%` : "…") : "Update"}</button>
        {!updateRequired() && !compact && <button className="icon-btn sm" aria-label="Later" onClick={() => { setHidden(true); try { sessionStorage.setItem("upd_hide", "1"); } catch { /* ignore */ } }}>×</button>}
      </div>
    </div>
  );
}
