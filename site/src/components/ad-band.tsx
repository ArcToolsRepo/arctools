import { useEffect, useState } from "react";

/** The three sponsored slots under the Terminal heading. Banners are exactly 1060×144 px and render at 530×72 css px
 *  (3 across on desktop, stacked on phones). Empty slots sell themselves. Nothing here is generated: an approved
 *  banner is the advertiser's own file, served from /api/ads-img/:id. */
type Ad = { id: number; title: string; url: string; ends_at: number };
type Feed = { ads: Ad[]; slots: number; days: number; next_free_at: number | null; queued?: number };

const left = (ts: number) => { const s = Math.max(0, ts - Date.now() / 1000); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); return d > 0 ? `${d}d ${h}h left` : `${h}h left`; };

export function AdBand({ v2 = false }: { v2?: boolean }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => fetch("/api/ads").then((r) => r.json()).then((j: Feed) => { if (alive) setFeed(j); }).catch(() => null);
    pull(); const t = setInterval(pull, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const ads = feed?.ads ?? []; const slots = feed?.slots ?? 3;
  const book = v2 ? "/advertise2" : "/advertise";
  return (
    <div className="arc-adband" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", margin: "14px 0 4px" }}>
      {Array.from({ length: slots }, (_, i) => {
        const a = ads[i];
        if (a) return (
          <a className="arc-adband__slot" href={a.url} key={a.id} rel="noopener sponsored" style={{ aspectRatio: "1060 / 144", borderRadius: 12, display: "block", overflow: "hidden", position: "relative" }} target="_blank" title={a.title}>
            <img alt={a.title} loading="lazy" src={`/api/ads-img/${a.id}`} style={{ display: "block", height: "100%", objectFit: "cover", width: "100%" }} />
            <span className="arc-mono" style={{ background: "rgba(0,0,0,0.55)", borderRadius: 6, bottom: 6, color: "#cfd6e4", fontSize: 10, left: 8, padding: "1px 6px", position: "absolute" }}>AD</span>
            <span className="arc-mono" style={{ background: "rgba(0,0,0,0.55)", borderRadius: 6, bottom: 6, color: "#cfd6e4", fontSize: 10, padding: "1px 6px", position: "absolute", right: 8 }}>{left(a.ends_at)}</span>
          </a>
        );
        return (
          <a className="arc-adband__slot is-empty" href={book} key={`e${i}`} style={{ alignItems: "center", aspectRatio: "1060 / 144", border: "1px dashed var(--arc-line)", borderRadius: 12, color: "var(--arc-muted)", display: "flex", gap: 12, padding: "0 16px", textDecoration: "none" }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
            <span style={{ display: "grid", gap: 2 }}>
              <span className="arc-mono" style={{ color: "var(--arc-ink)", fontSize: 13 }}>{i === 0 && ads.length === 0 ? "Your project here" : "Sponsored slot"}</span>
              <span className="arc-mono" style={{ fontSize: 11 }}>{feed?.next_free_at && i >= ads.length && ads.length >= slots ? `next free ${left(feed.next_free_at)}` : `250 USDC or 200 USD in ARCT · ${feed?.days ?? 7} days`}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
