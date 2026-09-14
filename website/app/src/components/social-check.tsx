import { useEffect, useState } from "react";
import { BOT_API } from "@/lib/bot-api";

/**
 * Social check: who is behind the token. X account age/followers/previous
 * handles, Telegram size/type/previous names, domain age, deployer track
 * record — and, most important, the SAME account/group/domain reused by other
 * tokens on Arc. Data from the ArcTools registry (bot API).
 */

type Reuse = { token: string; symbol: string | null; mcap: number | null };
type Check = {
  x: { handle: string; ok: boolean; name: string | null; followers: number | null; tweets: number | null; joined: number | null; age_days: number | null; previous_handles: string[]; reused_by: Reuse[] } | null;
  telegram: { handle: string; ok: boolean; kind: string | null; members: number | null; title: string | null; previous_handles: string[]; reused_by: Reuse[] } | null;
  web: { domain: string; ok: boolean; registered: number | null; age_days: number | null; registrar: string | null; reused_by: Reuse[] } | null;
  deployer: { address: string; count: number; dead: number; tokens: { token: string; symbol: string | null; mcap: number | null; dead: boolean; last_trade: number | null }[] } | null;
};

const GREEN = "#22c580";
const AMBER = "#e8a838";
const RED = "#f0534f";

const fmtN = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const age = (d: number | null | undefined) => (d === null || d === undefined ? "—" : d < 1 ? "today" : d < 60 ? `${d}d` : d < 730 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`);

function Flag({ tone, children }: { tone: "ok" | "warn" | "bad" | "mute"; children: React.ReactNode }) {
  const c = tone === "ok" ? GREEN : tone === "warn" ? AMBER : tone === "bad" ? RED : "var(--arc-muted)";
  return (
    <span className="arc-mono" style={{ border: `1px solid ${c}`, color: c, display: "inline-block", fontSize: 10, margin: "3px 4px 0 0", padding: "2px 7px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Reused({ list, what }: { list: Reuse[]; what: string }) {
  if (!list.length) return <Flag tone="ok">not reused</Flag>;
  return (
    <>
      <Flag tone="bad">same {what} on {list.length} other token{list.length > 1 ? "s" : ""}</Flag>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8, paddingBottom: 4 }}>
        {list.slice(0, 6).map((r) => (
          <a className="arc-mono" href={`/token/${r.token}`} key={r.token} style={{ color: "var(--arc-muted)", fontSize: 11, textDecoration: "underline dotted", whiteSpace: "nowrap" }}>
            {r.symbol || r.token.slice(0, 8)}{r.mcap ? ` $${fmtN(r.mcap)}` : ""}
          </a>
        ))}
      </div>
    </>
  );
}

function Col({ title, sub, children }: { title: string; sub?: string | null; children: React.ReactNode }) {
  return (
    <div style={{ background: "#0e1118", border: "1px solid var(--arc-line)", minWidth: 0, padding: "12px 14px 14px" }}>
      <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 11, letterSpacing: 0.6, margin: 0 }}>{title}</p>
      {sub && <p className="arc-mono" style={{ color: "var(--arc-ink)", fontSize: 13, margin: "3px 0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</p>}
      <div>{children}</div>
    </div>
  );
}

export function SocialCheck(props: { token: string; x?: string | null; tg?: string | null; web?: string | null; deployer?: string | null }) {
  const [d, setD] = useState<Check | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ token: props.token });
    if (props.x) q.set("x", props.x);
    if (props.tg) q.set("tg", props.tg);
    if (props.web) q.set("web", props.web);
    if (props.deployer) q.set("deployer", props.deployer);
    fetch(`${BOT_API}/api/social-check?${q}`)
      .then((r) => r.json())
      .then((j: Check) => { if (alive) setD(j); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [props.token, props.x, props.tg, props.web, props.deployer]);

  // verdict
  let bad = 0;
  let warn = 0;
  if (d) {
    for (const s of [d.x?.reused_by, d.telegram?.reused_by, d.web?.reused_by]) if (s && s.length) bad++;
    if (d.x?.previous_handles.length) warn++;
    if (d.telegram?.previous_handles.length) warn++;
    if (d.x?.age_days !== null && d.x?.age_days !== undefined && d.x.age_days < 30) warn++;
    if (d.web?.age_days !== null && d.web?.age_days !== undefined && d.web.age_days < 14) warn++;
    if (d.deployer && d.deployer.dead >= 2) bad++;
    else if (d.deployer && d.deployer.count > 3) warn++;
  }
  const nothing = d && !d.x && !d.telegram && !d.web && !d.deployer;
  const verdictColor = bad ? RED : (warn || nothing) ? AMBER : GREEN;
  const verdict = !d ? "" : nothing ? "nothing to verify" : bad ? `${bad} red flag${bad > 1 ? "s" : ""}` : warn ? `${warn} thing${warn > 1 ? "s" : ""} to check` : "no red flags found";

  return (
    <section style={{ border: "1px solid var(--arc-line)", marginTop: 14 }}>
      <div style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 12, padding: "10px 12px" }}>
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, textTransform: "uppercase" }}>Social check</span>
        {d && <span className="arc-mono" style={{ color: verdictColor, fontSize: 12 }}>{verdict}</span>}
        {!d && !err && <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>checking accounts...</span>}
        {err && <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>registry unavailable</span>}
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginLeft: "auto" }}>who is behind this token</span>
      </div>
      {nothing && (
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0, padding: 14 }}>
          No socials or deployer published for this token. That is a flag in itself.
        </p>
      )}
      {d && !nothing && (
        <div className="arc-social-grid">
          <Col title="X / TWITTER" sub={d.x ? `@${d.x.handle}${d.x.name ? ` · ${d.x.name}` : ""}` : null}>
            {!d.x && <Flag tone="mute">no X account listed</Flag>}
            {d.x && !d.x.ok && <Flag tone="warn">account not found or suspended</Flag>}
            {d.x && d.x.ok && (
              <>
                <Flag tone={d.x.age_days !== null && d.x.age_days < 30 ? "warn" : "ok"}>age {age(d.x.age_days)}</Flag>
                <Flag tone={(d.x.followers ?? 0) < 100 ? "warn" : "ok"}>{fmtN(d.x.followers)} followers</Flag>
                <Flag tone="mute">{fmtN(d.x.tweets)} posts</Flag>
                {d.x.previous_handles.length > 0 ? (
                  <Flag tone="warn">previously: {d.x.previous_handles.slice(0, 3).map((h) => "@" + h).join(", ")}</Flag>
                ) : (
                  <Flag tone="ok">no handle changes on record</Flag>
                )}
                <div><Reused list={d.x.reused_by} what="X account" /></div>
              </>
            )}
          </Col>
          <Col title="TELEGRAM" sub={d.telegram ? `@${d.telegram.handle}${d.telegram.title ? ` · ${d.telegram.title}` : ""}` : null}>
            {!d.telegram && <Flag tone="mute">no Telegram listed</Flag>}
            {d.telegram && !d.telegram.ok && <Flag tone="warn">link does not resolve</Flag>}
            {d.telegram && d.telegram.ok && (
              <>
                <Flag tone="mute">{d.telegram.kind ?? "?"}</Flag>
                <Flag tone={(d.telegram.members ?? 0) < 50 ? "warn" : "ok"}>{fmtN(d.telegram.members)} {d.telegram.kind === "channel" ? "subscribers" : "members"}</Flag>
                {d.telegram.previous_handles.length > 0 ? (
                  <Flag tone="warn">previously: {d.telegram.previous_handles.slice(0, 3).map((h) => "@" + h).join(", ")}</Flag>
                ) : (
                  <Flag tone="ok">no name changes on record</Flag>
                )}
                <div><Reused list={d.telegram.reused_by} what="group" /></div>
              </>
            )}
          </Col>
          <Col title="WEBSITE" sub={d.web?.domain ?? null}>
            {!d.web && <Flag tone="mute">no website listed</Flag>}
            {d.web && !d.web.ok && <Flag tone="warn">domain lookup failed</Flag>}
            {d.web && d.web.ok && (
              <>
                <Flag tone={d.web.age_days !== null && d.web.age_days < 14 ? "warn" : "ok"}>registered {age(d.web.age_days)} ago</Flag>
                {d.web.registrar && <Flag tone="mute">{d.web.registrar}</Flag>}
                <div><Reused list={d.web.reused_by} what="domain" /></div>
              </>
            )}
          </Col>
          <Col title="DEPLOYER" sub={d.deployer ? `${d.deployer.address.slice(0, 6)}…${d.deployer.address.slice(-4)}` : null}>
            {!d.deployer && <Flag tone="mute">deployer unknown</Flag>}
            {d.deployer && (
              <>
                <Flag tone={d.deployer.count === 1 ? "ok" : d.deployer.count > 3 ? "warn" : "mute"}>{d.deployer.count} token{d.deployer.count > 1 ? "s" : ""} launched</Flag>
                {d.deployer.dead > 0 && <Flag tone={d.deployer.dead >= 2 ? "bad" : "warn"}>{d.deployer.dead} dead (&lt;$1K or no trades 3d)</Flag>}
                {d.deployer.count === 1 && <Flag tone="ok">first launch from this wallet</Flag>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
                  {d.deployer.tokens.slice(0, 6).map((t) => (
                    <a className="arc-mono" href={`/token/${t.token}`} key={t.token} style={{ color: t.dead ? RED : "var(--arc-muted)", fontSize: 11, textDecoration: "underline dotted", whiteSpace: "nowrap" }}>
                      {t.symbol || t.token.slice(0, 8)}{t.mcap ? ` $${fmtN(t.mcap)}` : ""}
                    </a>
                  ))}
                </div>
                <a className="arc-mono" href={`https://arc-scan.org/address/${d.deployer.address}`} rel="noreferrer" style={{ color: "var(--arc-muted)", display: "inline-block", fontSize: 10, marginTop: 6 }} target="_blank">explorer ↗</a>
              </>
            )}
          </Col>
        </div>
      )}
      <p className="arc-mono" style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", fontSize: 10, margin: 0, padding: "8px 12px" }}>
        Handle history comes from our own registry (tracking every Arc token's socials since Sep 2026) plus public X archives. "Not reused" means not reused on Arc as far as we have seen — it is not a guarantee.
      </p>
    </section>
  );
}
