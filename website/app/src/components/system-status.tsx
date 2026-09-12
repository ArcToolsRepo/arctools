import { useEffect, useState } from "react";

/**
 * "System: Running" pill at the bottom of every page.
 * Reads the buybot watchdog's last round (/api/status): site pages, tokens API, RPC relay, swap index lag, own API.
 * Green = all checks passed, amber = something degraded (self-heal running), grey = watchdog not reporting.
 */
const API = "https://bot-production-4200.up.railway.app/api/status";
type Status = { state: "running" | "degraded" | "stale" | "starting"; ts: number; age_s: number | null; every_s: number; checks: Record<string, { ok: boolean; detail: string; streak: number }> };

const LABEL: Record<string, string> = { pages: "site", tokens: "token feed", relay: "RPC relay", index: "swap index", api: "data API" };

export function SystemStatus() {
  const [st, setSt] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(API, { cache: "no-store" }).then((r) => r.json()).then((j: Status) => { if (alive) setSt(j); }).catch(() => { if (alive) setSt((s) => s ?? { state: "stale", ts: 0, age_s: null, every_s: 180, checks: {} }); });
    void load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const state = st?.state ?? "starting";
  const col = state === "running" ? "var(--arc-up)" : state === "degraded" ? "#f5c542" : "var(--arc-muted)";
  const text = state === "running" ? "System: Running" : state === "degraded" ? "System: Degraded" : state === "stale" ? "System: status unavailable" : "System: checking…";
  const failing = Object.entries(st?.checks ?? {}).filter(([, c]) => !c.ok);
  return (
    <div className="arc-sysstatus" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen((o) => !o)} style={{ bottom: 10, position: "fixed", zIndex: 50 }}>
      {open && st && (
        <div className="arc-mono" style={{ background: "rgba(10,14,22,0.96)", border: "1px solid var(--arc-line)", borderRadius: 8, bottom: 30, fontSize: 11, left: 0, minWidth: 230, padding: "8px 10px", position: "absolute" }}>
          {Object.entries(st.checks).map(([k, c]) => (
            <div key={k} style={{ alignItems: "center", display: "flex", gap: 8, padding: "2px 0" }}>
              <span style={{ background: c.ok ? "var(--arc-up)" : "#f5c542", borderRadius: "50%", display: "inline-block", height: 7, width: 7 }} />
              <span style={{ color: "var(--arc-ink)", minWidth: 80 }}>{LABEL[k] ?? k}</span>
              <span style={{ color: "var(--arc-muted)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.detail}>{c.ok ? "ok" : c.detail}</span>
            </div>
          ))}
          <div style={{ color: "var(--arc-muted)", marginTop: 4 }}>checked every {Math.round((st.every_s || 180) / 60)} min · last {st.age_s != null ? `${st.age_s}s ago` : "—"}{failing.length ? " · self-heal active" : ""}</div>
        </div>
      )}
      <span className="arc-mono" style={{ alignItems: "center", background: "rgba(10,14,22,0.9)", border: "1px solid var(--arc-line)", borderRadius: 999, color: "var(--arc-muted)", cursor: "default", display: "inline-flex", fontSize: 10.5, gap: 6, padding: "3px 9px" }}>
        <span style={{ background: col, borderRadius: "50%", boxShadow: state === "running" ? `0 0 6px ${col}` : "none", display: "inline-block", height: 7, width: 7 }} />
        <span style={{ color: state === "running" ? "var(--arc-ink)" : col }}>{text}</span>
      </span>
    </div>
  );
}
