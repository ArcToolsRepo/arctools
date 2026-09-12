import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { TokenLogo } from "@/components/token-logo";

/**
 * Live buy / sell toasts (GMGN-style) for the tokens currently shown in the Terminal.
 * Polls the swap index every 4 s, shows the newest fills as cards stacked bottom-left,
 * each for ~6 s. Only swaps that happened after the page opened are shown, deduped by tx+log.
 */
const API = "https://bot-production-4200.up.railway.app";
const SHOW_MS = 6500;
const MAX_VISIBLE = 4;
const MIN_USD = 5;

type Swap = { tx: string; log_index: number; ts: number; token: string; side: "buy" | "sell"; usdc: number; price1m: number | null; symbol: string | null; rank: number | null };
type Toast = Swap & { key: string; shownAt: number };

const fmtUsd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `$${n.toFixed(2)}`);
function fmtPrice(p1m: number | null): string {
  if (!p1m || p1m <= 0) return "";
  const p = p1m / 1e6;
  if (p >= 1) return `$${p.toFixed(p >= 100 ? 2 : 4)}`;
  const s = p.toFixed(12);
  const m = s.match(/^0\.(0*)(\d{1,4})/);
  if (!m) return `$${p}`;
  const zeros = m[1].length;
  return zeros >= 3 ? `$0.0${subscript(zeros)}${m[2]}` : `$${p.toFixed(zeros + 4)}`;
}
const subscript = (n: number) => String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function TradeToasts({ tokens, logos, enabled = true }: { tokens: string[]; logos: Record<string, string | null | undefined>; enabled?: boolean }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const since = useRef<number>(Math.floor(Date.now() / 1000) - 20);
  const watch = useRef<Set<string>>(new Set());
  useEffect(() => { watch.current = new Set(tokens.map((t) => t.toLowerCase())); }, [tokens]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const j = (await fetch(`${API}/api/whales?minutes=2&min_usd=${MIN_USD}&limit=60`).then((r) => r.json())) as { rows?: Swap[] };
        const fresh = (j.rows ?? [])
          .filter((s) => s.ts >= since.current && watch.current.has(s.token.toLowerCase()))
          .map((s) => ({ ...s, key: `${s.tx}:${s.log_index}`, shownAt: Date.now() }))
          .filter((s) => !seen.current.has(s.key))
          .sort((a, b) => a.ts - b.ts)
          .slice(-3);
        if (!alive || !fresh.length) return;
        fresh.forEach((s) => seen.current.add(s.key));
        setToasts((t) => [...t, ...fresh].slice(-MAX_VISIBLE));
      } catch { /* index busy: skip this tick */ }
    };
    void poll();
    const id = setInterval(poll, 4000);
    const gc = setInterval(() => setToasts((t) => t.filter((x) => Date.now() - x.shownAt < SHOW_MS)), 500);
    return () => { alive = false; clearInterval(id); clearInterval(gc); };
  }, [enabled]);

  if (!toasts.length) return null;
  return (
    <div aria-live="polite" className="arc-toasts" style={{ bottom: 18, display: "flex", flexDirection: "column", gap: 8, maxWidth: "calc(100vw - 36px)", pointerEvents: "none", position: "fixed", width: 340, zIndex: 60 }}>
      {toasts.map((t) => {
        const up = t.side === "buy"; const col = up ? "var(--arc-up)" : "#f0534f";
        return (
          <Link className="arc-toast" key={t.key} params={{ ca: t.token }} style={{ alignItems: "center", background: "rgba(10,14,22,0.96)", border: "1px solid rgba(255,255,255,0.08)", borderLeft: `3px solid ${col}`, borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.45)", color: "var(--arc-ink)", display: "flex", gap: 12, padding: "10px 14px", pointerEvents: "auto", textDecoration: "none" }} to="/token/$ca">
            <TokenLogo radius={20} size={40} src={logos[t.token.toLowerCase()] ?? null} symbol={t.symbol ?? "?"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ alignItems: "baseline", display: "flex", gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{t.symbol ?? short(t.token)}</strong>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{short(t.token)}</span>
                {t.rank != null && <span className="arc-mono" style={{ background: "rgba(46,124,255,0.18)", border: "1px solid var(--arc-cobalt)", borderRadius: 4, fontSize: 10, padding: "0 5px" }}>INSIDER #{t.rank}</span>}
              </div>
              <div className="arc-mono" style={{ color: col, fontSize: 13 }}>{up ? "Buy" : "Sell"}{fmtPrice(t.price1m) ? ` · ${fmtPrice(t.price1m)}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="arc-mono" style={{ color: col, fontSize: 16, fontWeight: 700 }}>{fmtUsd(t.usdc)}</div>
              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>now</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
