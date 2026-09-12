import { useEffect, useState } from "react";

/** Token artwork with a monogram fallback: a broken / rate-limited image never leaves an empty box. */
export function TokenLogo({ src, symbol, size = 38, radius = 8, style }: { src: string | null | undefined; symbol: string; size?: number; radius?: number; style?: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const ok = !!src && !failed;
  return (
    <span style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: radius, display: "inline-flex", flex: "none", height: size, justifyContent: "center", overflow: "hidden", width: size, ...style }}>
      {ok
        ? <img alt="" height={size} loading="lazy" onError={() => setFailed(true)} src={src!} style={{ height: "100%", objectFit: "cover", width: "100%" }} width={size} />
        : <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: Math.max(11, Math.round(size * 0.36)) }}>{(symbol || "?").slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}
