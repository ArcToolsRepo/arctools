import { useEffect, useState } from "react";

const API = "/bot";

type Meta = { ds_enhanced?: boolean; ds_url?: string | null; logo?: string | null; twitter?: string | null; telegram?: string | null; website?: string | null };

/**
 * "DEX ✓" badge: the token's info is filled in on DexScreener.
 *
 * That block is editable only by whoever controls the token (they pay for it), so it doubles as a signal that
 * somebody stood behind the token publicly — and it is where we source the logo and socials for tokens that never
 * touched a launchpad. Clicking it opens the pair page.
 *
 * Renders nothing until the check comes back positive, so a slow or failed call can never leave a broken badge.
 */
export function DexBadge({ token, hasSocials }: { token: string | null | undefined; hasSocials?: boolean }) {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`${API}/api/token-meta?tokens=${token}`, { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j: { meta?: Record<string, Meta> }) => {
        const m = j.meta?.[token.toLowerCase()];
        // keep the row even without the badge: its socials may still be the only ones we have
        if (alive && (m?.ds_enhanced || m?.twitter || m?.telegram || m?.website)) setMeta(m ?? null);
      })
      .catch(() => null);
    return () => { alive = false; };
  }, [token]);

  if (!meta) return null;
  const link = (href: string, label: string, title: string) => (
    <a className="arc-tokmeta" href={href} key={label} rel="noreferrer"
      style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 4, textDecoration: "none" }} target="_blank" title={title}>{label}</a>
  );
  // socials the page itself did not have — most anonymous Uniswap tokens only have them on DexScreener
  const extras = hasSocials ? [] : [
    meta.twitter ? link(`https://x.com/${meta.twitter}`, "𝕏", `@${meta.twitter}`) : null,
    meta.telegram ? link(`https://t.me/${meta.telegram}`, "✈︎", `t.me/${meta.telegram}`) : null,
    meta.website ? link(meta.website, "web", meta.website) : null,
  ].filter(Boolean);
  if (!meta.ds_enhanced) return <>{extras}</>;
  return (
    <>
    {extras}
    <a
      className="arc-mono"
      href={meta.ds_url || `https://dexscreener.com/arc/${token}`}
      rel="noreferrer"
      style={{
        alignItems: "center", background: "rgba(34,197,128,0.12)", border: "1px solid var(--arc-up)",
        borderRadius: 6, color: "var(--arc-up)", display: "inline-flex", fontSize: 10, gap: 4,
        marginLeft: 6, padding: "1px 6px", textDecoration: "none",
      }}
      target="_blank"
      title="Token info is filled in on DexScreener — logo, website and socials come from the token's own owner, who is the only one who can edit that block. Opens the pair page."
    >
      DEX ✓ updated
    </a>
    </>
  );
}
