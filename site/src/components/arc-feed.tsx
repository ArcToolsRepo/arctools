/**
 * The Arc feed panel: what Arc accounts are posting on X plus crypto headlines, in one column under the
 * trading wallet. A post that names an Arc token carries its own buy button, so reading and buying are the
 * same motion — the ticker only becomes a button when the backend could resolve it to one contract, because
 * a button pointing at the wrong token is worse than plain text.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

const API = "/bot";

type FeedRow = {
  kind: "x" | "news";
  id: string;
  ts: number;
  url: string;
  token?: string | null;
  symbol?: string | null;
  logo?: string | null;
  match_kind?: string | null;
  // X
  handle?: string;
  name?: string;
  avatar?: string;
  followers?: number;
  body?: string;
  likes?: number;
  reposts?: number;
  // news
  source?: string;
  title?: string;
};

const ago = (ts: number) => {
  const d = Math.max(0, Date.now() / 1000 - ts);
  if (d < 90) return `${Math.round(d)}s`;
  if (d < 5400) return `${Math.round(d / 60)}m`;
  if (d < 172800) return `${Math.round(d / 3600)}h`;
  return `${Math.round(d / 86400)}d`;
};
const compact = (n?: number) =>
  !n ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

export function ArcFeed({ onBuy, buyAmount }: { onBuy?: (token: string) => void; buyAmount?: number }) {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [kind, setKind] = useState<"all" | "x" | "news">("all");
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/feed?kind=${kind}&limit=30`, { signal: AbortSignal.timeout(12_000) });
      const j = (await r.json()) as { rows?: FeedRow[] };
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setErr(false);
    } catch {
      setErr(true);
    }
  }, [kind]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const tabs: Array<["all" | "x" | "news", string]> = [["all", "All"], ["x", "X"], ["news", "News"]];

  return (
    <section style={{ border: "1px solid var(--arc-line)", borderRadius: 10, marginTop: 12, overflow: "hidden" }}>
      <header style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 8, justifyContent: "space-between", padding: "10px 12px" }}>
        <span style={{ alignItems: "center", display: "flex", gap: 7 }}>
          <span aria-hidden className="arc-live-dot" />
          <strong style={{ fontSize: 13 }}>Arc feed</strong>
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {tabs.map(([k, label]) => (
            <button
              className="arc-mono"
              key={k}
              onClick={() => setKind(k)}
              style={{
                background: kind === k ? "var(--arc-cobalt)" : "transparent",
                border: "1px solid var(--arc-line)", borderRadius: 999, color: kind === k ? "#fff" : "var(--arc-muted)",
                cursor: "pointer", fontSize: 10, padding: "2px 9px",
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div style={{ maxHeight: 520, overflowY: "auto" }}>
        {!rows.length && (
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0, padding: "14px 12px" }}>
            {err ? "feed unavailable — retrying" : "loading the feed…"}
          </p>
        )}
        {rows.map((r) => (
          <article key={`${r.kind}-${r.id}`} style={{ borderTop: "1px solid var(--arc-line)", display: "grid", gap: 6, padding: "10px 12px" }}>
            <div style={{ alignItems: "center", display: "flex", gap: 7 }}>
              {r.kind === "x" && r.avatar ? (
                <img alt="" src={r.avatar} style={{ borderRadius: "50%", height: 22, objectFit: "cover", width: 22 }} />
              ) : (
                <span className="arc-mono" style={{ background: "var(--arc-line)", borderRadius: 6, fontSize: 9, padding: "3px 5px" }}>
                  {r.kind === "news" ? "NEWS" : "X"}
                </span>
              )}
              <a href={r.url} rel="noreferrer noopener" style={{ color: "var(--arc-ink)", fontSize: 12, fontWeight: 600, textDecoration: "none" }} target="_blank">
                {r.kind === "x" ? r.name || `@${r.handle}` : r.source}
              </a>
              {r.kind === "x" && (
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>
                  @{r.handle}{r.followers ? ` · ${compact(r.followers)}` : ""}
                </span>
              )}
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginLeft: "auto" }}>{ago(r.ts)}</span>
            </div>

            <a href={r.url} rel="noreferrer noopener" style={{ color: "var(--arc-ink)", fontSize: 12, lineHeight: 1.45, textDecoration: "none" }} target="_blank">
              {r.kind === "x" ? r.body : r.title}
            </a>

            {r.token && (
              <div style={{ alignItems: "center", display: "flex", gap: 6 }}>
                <Link
                  className="arc-mono"
                  style={{ alignItems: "center", color: "var(--arc-cobalt)", display: "flex", fontSize: 11, gap: 5, textDecoration: "none" }}
                  to={`/token/${r.token}` as string}
                >
                  {r.logo ? <img alt="" src={r.logo} style={{ borderRadius: "50%", height: 16, width: 16 }} /> : null}
                  ${r.symbol || r.token.slice(0, 6)}
                </Link>
                {r.match_kind && (
                  <span className="arc-mono" title={`matched by ${r.match_kind}`} style={{ color: "var(--arc-muted)", fontSize: 9 }}>
                    {r.match_kind}
                  </span>
                )}
                {onBuy && (
                  <button
                    className="arc-mono"
                    onClick={() => onBuy(r.token!)}
                    style={{
                      background: "var(--arc-up)", border: "none", borderRadius: 999, color: "#04140a",
                      cursor: "pointer", fontSize: 10, fontWeight: 700, marginLeft: "auto", padding: "3px 10px",
                    }}
                    type="button"
                  >
                    ⚡ {buyAmount ?? 5}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
