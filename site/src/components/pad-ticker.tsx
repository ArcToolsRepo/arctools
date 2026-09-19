import { useEffect, useState, useRef } from "react";
import { BOT_API } from "@/lib/bot-api";

import { xAvatar } from "@/lib/arc-api";
import { TokenLogo } from "@/components/token-logo";

const API = BOT_API;
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
    // the strip needs ten logos — it used to download the entire token list (4.8 MB) for them, and a token that the
    // capped list does not carry showed a monogram. One point lookup in the metadata index instead.
    fetch(`/bot/api/token-meta?tokens=${miss.join(",")}`).then((r) => r.json()).then((j: { meta?: Record<string, { logo?: string | null; symbol?: string | null; launchpad?: string | null; twitter?: string | null }> }) => {
      if (!alive) return;
      const got = j.meta ?? {};
      setMeta((o) => {
        const n = { ...o };
        for (const t of miss) {
          const m = got[t] ?? got[t.toLowerCase()];
          n[t] = { token: t, logo: m?.logo ?? null, twitter: m?.twitter ?? null, ...(m?.launchpad === "long" ? { stock: true } : {}) } as Meta;
        }
        return n;
      });
      // whatever the index could not resolve (stock wrappers carry their issuer's favicon, not an on-chain logo)
      const still = miss.filter((x) => !(got[x]?.logo));
      for (const tk of still.slice(0, 6)) {
        void fetch(`/api/tokenpage?ca=${tk}`).then((r) => r.json()).then((d: { logo?: string | null; stock?: unknown }) => {
          if (!alive || !d?.logo) return;
          setMeta((o) => ({ ...o, [tk]: { ...(o[tk] ?? { token: tk }), logo: d.logo ?? null } as Meta }));
        }).catch(() => null);
      }
    }).catch(() => null);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.token).join(",")]);

  // readable speed: ~55 px/s regardless of how many tokens are in the strip (the track holds two copies, the
  // animation moves half of it per cycle) — fixed 14 s for a 2500 px strip was "lightspeed"
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dur, setDur] = useState(90);
  useEffect(() => {
    const el = trackRef.current; if (!el) return;
    const w = el.scrollWidth / 2; if (w > 0) setDur(Math.max(30, Math.round(w / 55)));
  }, [rows.length]);
  if (rows.length === 0) return null;

  const items = rows.map((t, i) => {
    const m = meta[t.token.toLowerCase()];
    const pair = m?.stock ? "IOU" : m?.quoteSymbol && m.quoteSymbol !== "USDC" ? m.quoteSymbol : "USDC";
    return (
      <a className="arc-ticker__item" href={`/token/${t.token}`} key={t.token} style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
        <span style={{ color: i < 3 ? "#f5c542" : "var(--arc-muted)", fontSize: 10, minWidth: 14 }}>#{i + 1}</span>
        <TokenLogo fallback={xAvatar(m?.twitter)} monogram radius={4} size={16} src={m?.logo ?? null} symbol={t.symbol} />
        <b>{t.symbol}</b>
        <span style={{ color: "var(--arc-muted)", fontSize: 10 }}>/{pair}</span>
        {t.mcap != null && t.mcap > 0 && <span style={{ color: "var(--arc-muted)" }}>{usd(t.mcap)}</span>}
        {t.chg != null && <span style={{ color: t.chg >= 0 ? "var(--arc-up)" : "#f0534f" }}>{t.chg >= 0 ? "+" : ""}{t.chg.toFixed(0)}%</span>}
      </a>
    );
  });

  return (
    <div aria-hidden className="arc-ticker" title="Top 10 by 24 h volume on Arc — re-ranked every minute">
      <div className="arc-ticker__track" ref={trackRef} style={{ animationDuration: `${dur}s` }}>
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
