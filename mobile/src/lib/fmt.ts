/** Number formatting the way trading apps do it: short, dense, unambiguous. */
export const usd = (v: number | null | undefined, digits = 1): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(digits)}K`;
  if (a >= 1) return `$${v.toFixed(2)}`;
  if (a >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toPrecision(3)}`;
};
export const num = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
export const pct = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "K" : v.toFixed(1)}%`;
};
/** price from price1m (USDC per 1M tokens) */
export const price = (p1m: number | null | undefined): string => {
  if (p1m == null || !Number.isFinite(p1m) || p1m <= 0) return "—";
  const p = p1m / 1e6;
  if (p >= 1) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  // sub-script zeros: $0.0₅42
  const s = p.toFixed(20).replace(/0+$/, "");
  const m = s.match(/^0\.(0*)(\d{1,4})/);
  if (!m) return `$${p.toExponential(2)}`;
  const zeros = m[1].length;
  return zeros >= 3 ? `$0.0${String(zeros).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[+d])}${m[2]}` : `$${s.slice(0, 10)}`;
};
export const ago = (ts: number | null | undefined): string => {
  if (!ts) return "—";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
export const short = (a: string | null | undefined, n = 4): string => (a && a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a ?? "—");
export const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
