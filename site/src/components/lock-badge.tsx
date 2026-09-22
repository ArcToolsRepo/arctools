/** "LP locked until …" strip for a token page — reads /api/locks?token= (ArcLocker, straight from chain). */
import { useEffect, useState } from "react";
import type { LockRow } from "@/lib/arc-locker";

const when = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
export function LockBadge({ token }: { token: string }) {
  const [rows, setRows] = useState<LockRow[] | null>(null);
  useEffect(() => { let alive = true; fetch(`/api/locks?token=${token}`).then((r) => r.json()).then((j) => alive && setRows(j.locks ?? [])).catch(() => alive && setRows([])); return () => { alive = false; }; }, [token]);
  if (!rows || rows.length === 0) return null;
  const lp = rows.filter((l) => l.label !== "token"); const tok = rows.filter((l) => l.label === "token");
  const latest = (xs: LockRow[]) => Math.max(...xs.map((l) => l.unlockAt));
  const share = lp.map((l) => l.poolShare ?? 0).reduce((a, b) => a + b, 0);
  return (
    <div className="arc-mono" style={{ alignItems: "center", background: "rgba(34,197,128,0.08)", border: "1px solid rgba(34,197,128,0.35)", borderRadius: 10, display: "flex", flexWrap: "wrap", fontSize: 12, gap: 14, margin: "10px 0", padding: "8px 12px" }}>
      <span style={{ color: "#22c580", fontWeight: 700 }}>ARCLOCKER</span>
      {lp.length > 0 && <span>LP locked{share > 0 ? ` · ${(share * 100).toFixed(0)}% of pool` : ""} until <strong>{when(latest(lp))}</strong> ({lp.length} position{lp.length > 1 ? "s" : ""})</span>}
      {tok.length > 0 && <span>{tok.length} token lock{tok.length > 1 ? "s" : ""} until <strong>{when(latest(tok))}</strong></span>}
      <a href="/locker" style={{ color: "var(--arc-cobalt)", marginLeft: "auto" }}>lock yours</a>
    </div>
  );
}
