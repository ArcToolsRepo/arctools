import { useEffect, useState } from "react";

import { TokenLogo } from "@/components/token-logo";

const API = "https://bot-production-4200.up.railway.app";
type Trend = { token: string; symbol: string; mcap: number | null; chg: number | null; vol: number };
type Meta = { token: string; logo?: string | null; twitter?: string | null; stock?: boolean; quoteSymbol?: string | null };

const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);

/** Site-wide marquee under the nav: top-10 trending tokens of the last 24 h (by volume), with logos. Re-ranks every 60 s. */
export function PadTicker() {
  const [rows, setRows] = useState<Trend[]>([]);
  const [meta, setMeta] = useState<Record<string, Meta>>({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const j = (await (await fetch(`${API}/api/trending?minutes=1440&limit=10`)).json()) as { rows?: Trend[] };
        if (alive && Array.isArray(j.rows) && j.rows.length) setRows(j.rows.slice(0, 10));
      } catch { /* next tick */ }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    const miss = rows.map((r) => r.token.toLowerCase()).filter((t) => !(t in meta));
    if (!miss.length) return;
    let alive = true;
    fetch("/api/tokens").then((r) => r.json()).then((j: Meta[] | { tokens?: Meta[] }) => {
      if (!alive) return;
      const list = Array.isArray(j) ? j : (j.tokens ?? []);
      const m: Record<string, Meta> = {};
      for (const t of list) m[t.token.toLowerCase()] = t;
      setMeta((o) => { const n = { ...o }; for (const t of miss) n[t] = m[t] ?? { token: t }; return n; });
    }).catch(() => null);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.token).join(",")]);

  if (rows.length === 0) return null;

  const items = rows.map((t, i) => {
    const m = meta[t.token.toLowerCase()];
    const pair = m?.stock ? "IOU" : m?.quoteSymbol && m.quoteSymbol !== "USDC" ? m.quoteSymbol : "USDC";
    return (
      <a className="arc-ticker__item" href={`/token/${t.token}`} key={t.token} style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
        <span style={{ color: i < 3 ? "#f5c542" : "var(--arc-muted)", fontSize: 10, minWidth: 14 }}>#{i + 1}</span>
        <TokenLogo fallback={null} monogram radius={4} size={16} src={m?.logo ?? null} symbol={t.symbol} />
        <b>{t.symbol}</b>
        <span style={{ color: "var(--arc-muted)", fontSize: 10 }}>/{pair}</span>
        {t.mcap != null && t.mcap > 0 && <span style={{ color: "var(--arc-muted)" }}>{usd(t.mcap)}</span>}
        {t.chg != null && <span style={{ color: t.chg >= 0 ? "var(--arc-up)" : "#f0534f" }}>{t.chg >= 0 ? "+" : ""}{t.chg.toFixed(0)}%</span>}
      </a>
    );
  });

  return (
    <div aria-hidden className="arc-ticker" title="Top 10 by 24 h volume on Arc — re-ranked every minute">
      <div className="arc-ticker__track">
        {[0, 1].map((rep) => (
          <span className="arc-ticker__group" key={rep}>
            <span className="arc-ticker__item" style={{ color: "var(--arc-muted)", fontSize: 10, letterSpacing: "0.08em" }}>TRENDING 24H</span>
            {items.map((it, i) => <span key={`${rep}-${i}`}>{it}</span>)}
          </span>
        ))}
      </div>
    </div>
  );
}
