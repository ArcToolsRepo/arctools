import { useEffect, useRef, useState } from "react";

const API = "/bot";

type Burn = { burned: number | null; supply: number | null; dead: number | null; pct: number | null; usd: number | null };

const fmt = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(0);

/**
 * Live ARCT burn counter for the top bar. Polls the on-chain figure every 45 s; when the number moves, the digits
 * flash once so a fresh burn is visible without watching. Renders nothing until the first successful read, so a
 * slow or failed call never leaves a broken widget in the header.
 */
export function BurnCounter() {
  const [d, setD] = useState<Burn | null>(null);
  const [pop, setPop] = useState(false);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/api/arct-burn`, { signal: AbortSignal.timeout(8000) })
        .then((r) => r.json())
        .then((j: Burn) => {
          if (!alive || typeof j.burned !== "number") return;
          if (prev.current !== null && j.burned > prev.current) {
            setPop(true);
            setTimeout(() => setPop(false), 950);
          }
          prev.current = j.burned;
          setD(j);
        })
        .catch(() => null);
    load();
    const id = setInterval(load, 45_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!d || typeof d.burned !== "number") return null;
  const title = `${d.burned.toLocaleString()} ARCT burned — ${d.pct}% of the 1B supply` +
    (d.usd ? ` (~$${Math.round(d.usd).toLocaleString()} at the current price)` : "") +
    `\n${d.dead?.toLocaleString()} held at the dead address, the rest taken out of totalSupply`;

  return (
    <a
      className="arc-mono"
      href="/token/0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52"
      style={{
        alignItems: "center", background: "var(--arc-paper-deep)", border: "1px solid rgba(255,146,43,0.55)",
        borderRadius: 8, color: "var(--arc-ink)", display: "inline-flex", fontSize: 12, gap: 6,
        padding: "5px 9px", textDecoration: "none", whiteSpace: "nowrap",
      }}
      title={title}
    >
      <span className="arc-flame" aria-hidden>🔥</span>
      <span className={pop ? "arc-burn-pop" : undefined} style={{ color: "#ff922b", fontWeight: 700 }}>{fmt(d.burned)}</span>
      <span style={{ color: "var(--arc-muted)" }}>ARCT burned</span>
    </a>
  );
}
