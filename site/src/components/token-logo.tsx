import { useEffect, useState } from "react";

/** Token artwork. No artwork anywhere → a quiet "no logo" tile (never an empty box, never a misleading letter). */
export function TokenLogo({ src, fallback, symbol, size = 38, radius = 8, style, monogram = false }: { src: string | null | undefined; fallback?: string | null; symbol: string; size?: number; radius?: number; style?: React.CSSProperties; monogram?: boolean }) {
  // load chain: src → fallback (e.g. the project's X avatar) → tile. A transient CDN error retries the primary once after 8 s.
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useEffect(() => { setStage(0); }, [src, fallback]);
  useEffect(() => {
    if (stage !== 2 || !src) return;
    const id = setTimeout(() => setStage(0), 8000);
    return () => clearTimeout(id);
  }, [stage, src]);
  const cur = stage === 0 ? src : stage === 1 ? fallback : null;
  const ok = !!cur;
  const onErr = () => setStage((st) => (st === 0 && fallback ? 1 : 2));
  return (
    <span style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: radius, display: "inline-flex", flex: "none", height: size, justifyContent: "center", overflow: "hidden", width: size, ...style }} title={ok ? undefined : "No logo added by the creator"}>
      {ok
        ? <img alt="" height={size} key={cur!} loading="lazy" onError={onErr} src={cur!} style={{ height: "100%", objectFit: "cover", width: "100%" }} width={size} />
        : <Monogram size={size} symbol={symbol} />}
    </span>
  );
}


/** Deterministic identicon for tokens whose creators never added artwork: two letters on a gradient derived from the
 *  symbol — the table stays uniform instead of screaming "NO LOGO" on a third of the rows (hover explains it). */
function Monogram({ symbol, size }: { symbol: string; size: number }) {
  const s = (symbol || "?").replace(/[^a-z0-9]/gi, "").toUpperCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360, hue2 = (hue + 40 + (h >> 8) % 60) % 360;
  const txt = s.slice(0, s.length >= 4 ? 2 : 1) || "?";
  return (
    <span className="arc-mono" style={{ alignItems: "center", background: `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${hue2} 60% 24%))`, color: "rgba(255,255,255,0.92)", display: "flex", fontSize: Math.max(9, Math.round(size * (txt.length > 1 ? 0.34 : 0.42))), fontWeight: 700, height: "100%", justifyContent: "center", letterSpacing: "0.02em", width: "100%" }} title="No logo added by the creator">
      {txt}
    </span>
  );
}
