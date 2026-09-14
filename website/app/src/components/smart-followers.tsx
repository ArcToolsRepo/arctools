import { useEffect, useState } from "react";
import { BOT_API } from "@/lib/bot-api";

const API = BOT_API;

type Kol = { handle: string; name: string; followers: number; avatar: string; category: string };
type Resp = {
  enabled: boolean; handle: string; total_kols: number; third_party?: boolean;
  account: { handle: string; name?: string; followers?: number; following?: number; created_at?: string; avatar?: string; verified?: boolean; missing?: boolean } | null;
  kols: Kol[];
};

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : String(n));

export function handleOf(url?: string | null): string | null {
  if (!url) return null;
  const m = url.replace(/^@/, "").match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,20})/i) ?? (/^[A-Za-z0-9_]{1,20}$/.test(url) ? [url, url] : null);
  const h = m?.[1]?.toLowerCase();
  return h && !["i", "intent", "search", "home", "status", "share", "hashtag", "explore"].includes(h) ? h : null;
}

function ageOf(created?: string): { text: string; days: number } | null {
  if (!created) return null;
  const t = Date.parse(created);
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, (Date.now() - t) / 86400000);
  return { days, text: days < 45 ? `${Math.round(days)} d` : days < 700 ? `${Math.round(days / 30)} mo` : `${(days / 365).toFixed(1)} y` };
}

/** "Smart followers": which Arc KOLs (>=10k followers, talk about Arc) follow this token's X account, plus account age/size. */
export function SmartFollowers({ x }: { x?: string | null }) {
  const h = handleOf(x);
  const [d, setD] = useState<Resp | null | undefined>(undefined);
  useEffect(() => {
    if (!h) return;
    let alive = true;
    fetch(`${API}/api/kol-follows?handle=${h}`).then((r) => r.json()).then((j) => alive && setD(j)).catch(() => alive && setD(null));
    return () => { alive = false; };
  }, [h]);
  if (!h) return null;
  if (d === undefined) return null;
  if (!d || !d.enabled) return null;
  const age = ageOf(d.account?.created_at);
  const fresh = age && age.days < 30;
  const acc = d.account;
  return (
    <section style={{ border: `1px solid ${fresh ? "#f0534f" : "var(--arc-line)"}`, marginTop: 14, padding: "12px 14px" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em" }}>X ACCOUNT · SMART FOLLOWERS</span>
        <span style={{ flex: 1 }} />
        <a className="arc-mono" href={`https://x.com/${h}`} rel="noreferrer" style={{ color: "#6cc0ff", fontSize: 12, textDecoration: "none" }} target="_blank">@{h} ↗</a>
      </div>
      {acc && !acc.missing && (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          {acc.avatar && <img alt="" height={34} src={acc.avatar} style={{ borderRadius: "50%" }} width={34} />}
          <div style={{ fontSize: 12.5 }}>
            <div style={{ color: "var(--arc-ink)", fontWeight: 700 }}>{acc.name} {acc.verified && <span style={{ color: "#6cc0ff" }} title="blue verified">✓</span>}</div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11.5 }}>
              {fmt(acc.followers ?? 0)} followers · {fmt(acc.following ?? 0)} following
              {age && <> · account age <span style={{ color: fresh ? "#f0534f" : "var(--arc-ink)" }}>{age.text}{fresh ? " — fresh account" : ""}</span></>}
            </div>
          </div>
        </div>
      )}
      {acc?.missing && <div className="arc-mono" style={{ color: "#f0534f", fontSize: 12, marginTop: 8 }}>X account not found — link in metadata points at a deleted, suspended or renamed profile.</div>}
      {d.third_party && (
        <div className="arc-mono" style={{ background: "rgba(240,83,79,0.12)", border: "1px solid #f0534f", borderRadius: 6, color: "#f0534f", fontSize: 12, marginTop: 10, padding: "8px 10px" }}>
          ⚠ The X link in this token's metadata points at a large third-party account (@{h}) — not the project's own. Followers below belong to that account, not to this token.
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        {d.kols.length > 0 ? (
          <>
            <div className="arc-mono" style={{ color: "var(--arc-up)", fontSize: 12.5, fontWeight: 700 }}>Followed by {d.kols.length} Arc KOL{d.kols.length === 1 ? "" : "s"} <span style={{ color: "var(--arc-muted)", fontWeight: 400 }}>of {d.total_kols} tracked</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {d.kols.slice(0, 12).map((k) => (
                <a key={k.handle} href={`https://x.com/${k.handle}`} rel="noreferrer" style={{ alignItems: "center", border: "1px solid var(--arc-line)", borderRadius: 999, color: "var(--arc-ink)", display: "inline-flex", fontSize: 12, gap: 6, padding: "3px 9px 3px 4px", textDecoration: "none" }} target="_blank" title={`${k.name} · ${k.followers.toLocaleString()} followers · ${k.category}`}>
                  {k.avatar ? <img alt="" height={20} src={k.avatar} style={{ borderRadius: "50%" }} width={20} /> : <span style={{ background: "var(--arc-line)", borderRadius: "50%", display: "inline-block", height: 20, width: 20 }} />}
                  @{k.handle}<span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10.5 }}>{fmt(k.followers)}</span>
                </a>
              ))}
              {d.kols.length > 12 && <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "4px 0" }}>+{d.kols.length - 12} more</span>}
            </div>
          </>
        ) : (
          <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>
            {d.total_kols > 0 ? `None of the ${d.total_kols} tracked Arc KOLs (10k+ followers) follow this account.` : "KOL graph is still syncing — check back in a few hours."}
          </div>
        )}
      </div>
      <div style={{ color: "var(--arc-muted)", fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
        KOLs = accounts with 10k+ followers that post about Arc (auto-discovered daily from X) plus ecosystem accounts. A follow is attention, not endorsement — but zero KOLs plus a weeks-old account is the usual shape of a throwaway launch.
      </div>
    </section>
  );
}
