/**
 * Trader leaderboard.
 *
 * Sorting by absolute PnL alone would hand the top of the board permanently to whoever got one lucky fill, so
 * ROI, win rate and volume are equal citizens here, and the backend requires a few closed positions and drops
 * wallets flagged as bots before a row is eligible at all.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { type LeaderRow, getLeaderboard } from "@/lib/arc-profile";
import { ArcNav } from "@/components/arc-nav";
import "../arc-site.css";

export const Route = createFileRoute("/leaderboard")({ component: Leaderboard });

const usd = (n?: number | null) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;

const SEASONS: Array<["7d" | "30d" | "all", string]> = [["7d", "this week"], ["30d", "this month"], ["all", "all time"]];
const SORTS: Array<[string, string]> = [["pnl", "PnL"], ["roi", "ROI"], ["winrate", "win rate"], ["volume", "volume"]];

function Leaderboard() {
  const [season, setSeason] = useState<"7d" | "30d" | "all">("7d");
  const [sort, setSort] = useState("pnl");
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getLeaderboard(season, sort).then((j) => { if (alive) { setRows(j.rows || []); setLoading(false); } });
    return () => { alive = false; };
  }, [season, sort]);

  const btn = (on: boolean): React.CSSProperties => ({
    background: on ? "var(--arc-cobalt)" : "transparent", border: "1px solid var(--arc-line)", borderRadius: 999,
    color: on ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "4px 12px",
  });

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/leaderboard" />
      <section className="arc-section" style={{ display: "grid", gap: 16, maxWidth: 1180, paddingBottom: 80, paddingTop: 118 }}>
      <header>
        <h1 style={{ fontSize: 30, margin: 0 }}>Traders</h1>
        <p style={{ color: "var(--arc-muted)", margin: "6px 0 0" }}>
          Ranked from Arc swaps, not from anything anyone typed in. Everyone with a profile is listed; a row counts
          as ranked once it has three closed positions and $100 of volume, and bot-flagged wallets never count.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SEASONS.map(([s, label]) => (
          <button className="arc-mono" key={s} onClick={() => setSeason(s)} style={btn(season === s)} type="button">{label}</button>
        ))}
        <span style={{ width: 14 }} />
        {SORTS.map(([s, label]) => (
          <button className="arc-mono" key={s} onClick={() => setSort(s)} style={btn(sort === s)} type="button">{label}</button>
        ))}
      </div>

      <div style={{ border: "1px solid var(--arc-line)", borderRadius: 12, overflow: "hidden" }}>
        {loading && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>reading the chain…</p>}
        {!loading && !rows.length && (
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>
            Nobody qualifies yet. <Link style={{ color: "var(--arc-cobalt)" }} to="/profile">Create the first profile</Link>.
          </p>
        )}
        {rows.map((r, i) => (
          <Link
            key={r.handle}
            params={{ handle: r.handle }}
            style={{
              alignItems: "center", borderTop: i ? "1px solid var(--arc-line)" : "none", color: "var(--arc-ink)",
              display: "flex", gap: 12, padding: "10px 14px", textDecoration: "none",
            }}
            to="/u/$handle"
          >
            <span className="arc-mono" style={{ color: i < 3 ? "#d9a441" : "var(--arc-muted)", fontSize: 12, width: 22 }}>{i + 1}</span>
            {r.avatar
              ? <img alt="" src={r.avatar} style={{ borderRadius: 8, height: 28, objectFit: "cover", width: 28 }} />
              : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", borderRadius: 8, display: "flex", fontSize: 11, height: 28, justifyContent: "center", width: 28 }}>
                  {r.handle.slice(0, 2).toUpperCase()}
                </span>}
            <span style={{ display: "grid" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {r.display || `@${r.handle}`} {r.x_verified ? <span style={{ color: "var(--arc-up)", fontSize: 10 }}>✓</span> : null}
              </span>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>
                @{r.handle}{r.x_handle ? ` · 𝕏 @${r.x_handle}` : ""}
                {r.ranked === false && (
                  <span title="needs 3 closed positions and $100 volume to be ranked"
                    style={{ border: "1px solid var(--arc-line)", borderRadius: 999, color: "var(--arc-muted)", marginLeft: 6, padding: "1px 6px" }}>
                    unranked
                  </span>
                )}
              </span>
            </span>
            <span className="arc-mono" style={{ color: (r.pnl_total ?? 0) >= 0 ? "var(--arc-up)" : "var(--arc-down, #f0534f)", fontSize: 13, marginLeft: "auto", width: 100, textAlign: "right" }}>
              {usd(r.pnl_total)}
            </span>
            <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, width: 70, textAlign: "right" }}>
              {r.roi == null ? "—" : `${r.roi.toFixed(1)}%`}
            </span>
            <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, width: 60, textAlign: "right" }}>
              {r.winrate == null ? "—" : `${(r.winrate * 100).toFixed(0)}%`}
            </span>
            <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, width: 84, textAlign: "right" }}>
              {usd(r.volume)}
            </span>
          </Link>
        ))}
      </div>

      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
        Columns: PnL · ROI on volume · win rate · volume. Seasons reset the window, never the record.
      </p>
      </section>
    </main>
  );
}
