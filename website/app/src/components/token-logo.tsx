import { useEffect, useState } from "react";

/** Token artwork. No artwork anywhere → a quiet "no logo" tile (never an empty box, never a misleading letter). */
export function TokenLogo({ src, symbol, size = 38, radius = 8, style, monogram = false }: { src: string | null | undefined; symbol: string; size?: number; radius?: number; style?: React.CSSProperties; monogram?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const ok = !!src && !failed;
  return (
    <span style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: radius, display: "inline-flex", flex: "none", height: size, justifyContent: "center", overflow: "hidden", width: size, ...style }} title={ok ? undefined : "No logo added by the creator"}>
      {ok
        ? <img alt="" height={size} loading="lazy" onError={() => setFailed(true)} src={src!} style={{ height: "100%", objectFit: "cover", width: "100%" }} width={size} />
        : monogram
          ? <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: Math.max(11, Math.round(size * 0.36)) }}>{(symbol || "?").slice(0, 1).toUpperCase()}</span>
          : <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: Math.max(7, Math.round(size * 0.2)), letterSpacing: "0.04em", lineHeight: 1.1, opacity: 0.8, textAlign: "center", textTransform: "uppercase" }}>no<br />logo</span>}
    </span>
  );
}
