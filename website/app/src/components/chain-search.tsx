import { useEffect, useRef, useState } from "react";

import { TokenLogo } from "@/components/token-logo";

export type SearchHit = {
  token: string; symbol: string | null; txs: number; vol: number; last_ts: number | null; venue: string | null;
  source: "index" | "chain" | "unknown"; lookalike?: boolean;
};

const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
const ago = (ts: number | null) => {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`;
};

/** Chain-wide token search shown under the filter box when the query matches nothing (or few rows) in the loaded lists.
 *  Every ERC-20 on Arc: our swap index (with 24 h stats) + arc-scan's chain-wide search. Click → token page (probes on-chain). */
export function ChainSearch({ q, hide, renderBuy }: { q: string; hide: Set<string>; renderBuy?: (hit: SearchHit) => React.ReactNode }) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) { setHits(null); return; }
    const my = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).then((j) => {
        if (my !== seq.current) return;
        setHits((j.rows ?? []) as SearchHit[]);
        setBusy(false);
      }).catch(() => { if (my === seq.current) { setHits([]); setBusy(false); } });
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  if (query.length < 2) return null;
  const rows = (hits ?? []).filter((h) => !hide.has(h.token));
  if (!busy && rows.length === 0 && hits !== null && hide.size > 0) return null; // everything already visible in the table
  return (
    <div style={{ background: "var(--arc-paper)", border: "1px solid var(--arc-line)", marginBottom: 8 }}>
      <div className="arc-mono" style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", fontSize: 11, gap: 8, padding: "6px 12px" }}>
        <span>SEARCH ALL OF ARC</span>
        <span style={{ color: "var(--arc-ink)" }}>“{query}”</span>
        <span style={{ flex: 1 }} />
        <span>{busy ? "searching…" : rows.length === 0 ? "no token with that name or address on Arc" : `${rows.length} token${rows.length === 1 ? "" : "s"} · index + arc-scan`}</span>
      </div>
      {rows.slice(0, 12).map((h) => (
        <div key={h.token} style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 10, padding: "6px 12px" }}>
          <TokenLogo src={null} symbol={h.symbol ?? "?"} size={22} radius={6} monogram />
          <a href={`/token/${h.token}`} className="arc-mono" style={{ color: "var(--arc-ink)", fontSize: 13, fontWeight: 600, minWidth: 70, textDecoration: "none" }}>{h.symbol ?? "unknown"}</a>
          <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{h.token.slice(0, 6)}…{h.token.slice(-4)}</span>
          <button className="arc-mono" onClick={() => void navigator.clipboard?.writeText(h.token)} style={{ background: "transparent", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: 0 }} title="copy address" type="button">⧉</button>
          {h.lookalike && <span className="arc-mono" style={{ color: "var(--arc-down)", fontSize: 10 }}>⚠ lookalike name</span>}
          <span style={{ flex: 1 }} />
          {h.source === "index" ? (
            <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{usd(h.vol)} 24h · {h.txs} txs{h.last_ts ? ` · last ${ago(h.last_ts)}` : ""}{h.venue ? ` · ${h.venue}` : ""}</span>
          ) : (
            <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{h.source === "chain" ? "on-chain · no indexed trades" : "unknown contract · will probe on open"}</span>
          )}
          <a href={`/token/${h.token}`} className="arc-mono" style={{ border: "1px solid var(--arc-line)", color: "var(--arc-cobalt)", fontSize: 11, padding: "3px 8px", textDecoration: "none" }}>chart</a>
          {renderBuy?.(h)}
        </div>
      ))}
    </div>
  );
}
