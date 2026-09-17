/**
 * Public trader profile: /u/<handle>
 *
 * Laid out the way traders already read these pages: a banner with the avatar breaking out of it, the identity
 * row underneath, then one big card that leads with the number people came for (portfolio value), the period
 * switch, profit with rank, and the realized / unrealized / volume breakdown. Tabs below split the record into
 * open positions, closed positions and raw activity.
 *
 * Every figure is computed by us from Arc swaps. The owner controls the picture, the banner and the bio —
 * never a number.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import {
  type Badge, type ProfileTrade, type ProfileView,
  follow, getProfile, getProfileTrades,
} from "@/lib/arc-profile";
import { hotAddress } from "@/lib/arc-hotwallet";

export const Route = createFileRoute("/u/$handle")({
  component: ProfilePage,
  head: ({ params }) => {
    const card = `https://arctools.fun/bot/api/profile/card?handle=${params.handle}`;
    const title = `@${params.handle} on ArcTools — verified trading record`;
    const desc = "PnL, ROI and win rate computed from Arc swaps, not self-reported.";
    return {
      meta: [
        { title },
        { content: desc, name: "description" },
        { content: title, property: "og:title" },
        { content: desc, property: "og:description" },
        { content: card, property: "og:image" },
        { content: "summary_large_image", name: "twitter:card" },
        { content: card, name: "twitter:image" },
      ],
    };
  },
});

type Position = {
  token: string; symbol: string | null; logo: string | null; n: number; last_ts: number;
  cost: number; proceeds: number; held?: number; value?: number; avg?: number;
  pnl: number; pnl_pct: number | null;
};

const usd = (n?: number | null, dp?: number) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, {
    maximumFractionDigits: dp ?? (Math.abs(n) < 100 ? 2 : 0), minimumFractionDigits: dp ?? 0 })}`;
const ago = (ts?: number) => {
  if (!ts) return "—";
  const d = Math.max(0, Date.now() / 1000 - ts);
  return d < 3600 ? `${Math.round(d / 60)}m` : d < 172800 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
};
const joined = (ts?: number) =>
  ts ? new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const TONE: Record<string, string> = {
  cobalt: "var(--arc-cobalt)", gold: "#d9a441", up: "var(--arc-up)", pink: "#ff5fd2", ink: "var(--arc-ink)",
};
const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";

function BadgePill({ b }: { b: Badge }) {
  const c = TONE[b.tone] ?? "var(--arc-muted)";
  return (
    <span className="arc-mono" style={{ border: `1px solid ${c}`, borderRadius: 999, color: c, fontSize: 10, padding: "2px 8px" }}>
      {b.label}
    </span>
  );
}

function ProfilePage() {
  const { handle } = Route.useParams();
  const [view, setView] = useState<ProfileView | null>(null);
  const [range, setRange] = useState<"7d" | "30d" | "all">("all");
  const [tab, setTab] = useState<"open" | "closed" | "activity">("open");
  const [pos, setPos] = useState<{ open: Position[]; closed: Position[] }>({ open: [], closed: [] });
  const [trades, setTrades] = useState<ProfileTrade[]>([]);
  const [delay, setDelay] = useState(0);
  const [rank, setRank] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setView(await getProfile(handle, range));
    const t = await getProfileTrades(handle, 40);
    setTrades(t.trades || []);
    setDelay(t.delay ?? 0);
    try {
      const p = (await fetch(`/bot/api/profile/positions?handle=${handle}`).then((r) => r.json())) as typeof pos;
      setPos({ open: p.open || [], closed: p.closed || [] });
    } catch { /* positions are a bonus, never block the page */ }
    try {
      const lb = (await fetch(`/bot/api/profiles/leaderboard?season=${range}&sort=pnl&limit=100`)
        .then((r) => r.json())) as { rows?: { handle: string }[] };
      const i = (lb.rows || []).findIndex((r) => r.handle === handle);
      setRank(i >= 0 ? i + 1 : null);
    } catch { /* rank is decoration */ }
  }, [handle, range]);

  useEffect(() => { void load(); }, [load]);

  const onFollow = async () => {
    const me = hotAddress();
    if (!me) { setMsg("unlock your trading wallet to follow"); return; }
    setBusy(true); setMsg("");
    try {
      const own = await getProfile(handle);
      await follow(me, own.profile?.handle ?? handle, handle);
      setMsg(`following @${handle}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "could not follow");
    } finally { setBusy(false); }
  };

  const p = view?.profile;
  const st = view?.stats;
  // the headline number is what the wallets are holding right now, priced at the last indexed trade — the open
  // positions ARE the portfolio, so summing them is the only figure that matches the Open tab below
  const value = pos.open.reduce((a, r) => a + (r.value ?? 0), 0);
  const profit = st?.pnl_total ?? 0;
  const profitPct = st?.roi ?? null;

  if (view && !p) {
    return (
      <main className="arc-wrap" style={{ padding: "40px 20px" }}>
        <h1 style={{ fontSize: 26 }}>@{handle}</h1>
        <p style={{ color: "var(--arc-muted)" }}>
          No profile with this handle yet. <Link style={{ color: "var(--arc-cobalt)" }} to="/profile">Create yours</Link>.
        </p>
      </main>
    );
  }

  const card: React.CSSProperties = { background: "var(--arc-paper, #0f1218)", border: "1px solid var(--arc-line)", borderRadius: 18 };
  const chip = (on: boolean): React.CSSProperties => ({
    background: on ? "rgba(255,255,255,0.06)" : "transparent",
    border: `1px solid ${on ? "var(--arc-up)" : "var(--arc-line)"}`, borderRadius: 999,
    color: on ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "6px 16px",
  });

  return (
    <main className="arc-wrap" style={{ display: "grid", gap: 14, maxWidth: 1080, padding: "18px 16px 60px" }}>
      {/* banner + avatar + identity */}
      <section style={{ ...card, overflow: "hidden" }}>
        <div style={{
          background: p?.banner ? `center/cover no-repeat url(${p.banner})` : "linear-gradient(160deg, #1b2a4a, #0d1524)",
          height: 190, position: "relative",
        }}>
          <div style={{ bottom: -46, left: 24, position: "absolute" }}>
            {p?.avatar
              ? <img alt="" src={p.avatar} style={{ background: "var(--arc-paper)", border: "3px solid var(--arc-bg, #0a0d14)", borderRadius: "50%", height: 104, objectFit: "cover", width: 104 }} />
              : <div className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", border: "3px solid var(--arc-bg, #0a0d14)", borderRadius: "50%", display: "flex", fontSize: 30, height: 104, justifyContent: "center", width: 104 }}>
                  {handle.slice(0, 2).toUpperCase()}
                </div>}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 14 }}>
            <button className="arc-mono" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/u/${handle}`); setMsg("link copied"); }}
              style={{ background: "rgba(0,0,0,0.45)", border: "1px solid var(--arc-line)", borderRadius: 10, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "7px 12px" }} type="button">
              share
            </button>
            <button className="arc-mono" disabled={busy} onClick={() => void onFollow()}
              style={{ background: "rgba(0,0,0,0.45)", border: "1px solid var(--arc-line)", borderRadius: 10, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "7px 14px" }} type="button">
              {busy ? "signing…" : "follow"}
            </button>
            <a className="arc-mono" href="https://t.me/ArcSniper_bot" rel="noreferrer"
              style={{ background: "var(--arc-cobalt)", border: "none", borderRadius: 10, color: "#fff", fontSize: 12, padding: "7px 14px", textDecoration: "none" }} target="_blank">
              copy-trade
            </a>
          </div>
        </div>

        <div style={{ padding: "58px 24px 20px" }}>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
            <h1 style={{ fontSize: 30, margin: 0 }}>{p?.display || handle}</h1>
            {p?.x_handle && (
              <a href={`https://x.com/${p.x_handle}`} rel="noreferrer" title={p.x_verified ? "verified" : "declared"}
                style={{ alignItems: "center", background: "rgba(255,255,255,0.06)", border: `1px solid ${p.x_verified ? UP : "var(--arc-line)"}`, borderRadius: 8, color: p.x_verified ? UP : "var(--arc-muted)", display: "flex", fontSize: 12, height: 26, justifyContent: "center", textDecoration: "none", width: 30 }} target="_blank">
                𝕏
              </a>
            )}
            {(view?.badges ?? []).map((b) => <BadgePill b={b} key={b.id} />)}
          </div>
          <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 16, marginTop: 8 }}>
            <span><b style={{ color: "var(--arc-ink)" }}>{view?.followers ?? 0}</b> Followers</span>
            <span><b style={{ color: "var(--arc-ink)" }}>{(st?.wallets ?? []).length}</b> Wallets</span>
            <span>Joined {joined(p?.created)}</span>
            {st?.days_active ? <span>{st.days_active}d active</span> : null}
          </div>
          {p?.bio && <p style={{ color: "var(--arc-muted)", margin: "10px 0 0", maxWidth: 680 }}>{p.bio}</p>}
        </div>
      </section>

      {/* the number people came for */}
      <section style={{ ...card, padding: "22px 24px" }}>
        <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>{usd(value, 2)}</div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 8, textTransform: "uppercase" }}>profit</div>
            <div style={{ color: profit >= 0 ? UP : DOWN, fontSize: 17, fontWeight: 700 }}>
              {profit >= 0 ? "+" : ""}{usd(profit, 2)}{profitPct == null ? "" : ` (${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%)`}{" "}
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>{range}</span>
            </div>
            {rank != null && <div style={{ color: UP, fontSize: 14, marginTop: 4 }}>Rank: #{rank}</div>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["7d", "30d", "all"] as const).map((r) => (
              <button className="arc-mono" key={r} onClick={() => setRange(r)} style={chip(range === r)} type="button">
                {r === "7d" ? "1W" : r === "30d" ? "1M" : "ALL"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--arc-line)", display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 18, paddingTop: 16 }}>
          <div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, textTransform: "uppercase" }}>realized</div>
            <div style={{ color: (st?.pnl_realized ?? 0) >= 0 ? UP : DOWN, fontSize: 19, fontWeight: 700 }}>{usd(st?.pnl_realized, 2)}</div>
          </div>
          <div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, textTransform: "uppercase" }}>unrealized</div>
            <div style={{ color: (st?.pnl_unrealized ?? 0) >= 0 ? UP : DOWN, fontSize: 19, fontWeight: 700 }}>{usd(st?.pnl_unrealized, 2)}</div>
          </div>
          <div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, textTransform: "uppercase" }}>buy volume</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{usd(st?.volume, 2)}</div>
          </div>
          <div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, textTransform: "uppercase" }}>win rate</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{st?.winrate == null ? "—" : `${(st.winrate * 100).toFixed(0)}%`}</div>
          </div>
        </div>
      </section>

      {/* tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {([["open", `Open${pos.open.length ? ` ${pos.open.length}` : ""}`],
           ["closed", `Closed${pos.closed.length ? ` ${pos.closed.length}` : ""}`],
           ["activity", "Activity"]] as const).map(([k, label]) => (
          <button className="arc-mono" key={k} onClick={() => setTab(k)} style={chip(tab === k)} type="button">{label}</button>
        ))}
      </div>

      <section style={{ ...card, overflow: "hidden" }}>
        {tab !== "activity" && (
          <>
            {!(tab === "open" ? pos.open : pos.closed).length && (
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 18 }}>
                nothing {tab === "open" ? "open" : "closed"} yet
              </p>
            )}
            {(tab === "open" ? pos.open : pos.closed).map((r, i) => (
              <div key={r.token} style={{ alignItems: "center", borderTop: i ? "1px solid var(--arc-line)" : "none", display: "flex", gap: 10, padding: "11px 16px" }}>
                {r.logo
                  ? <img alt="" src={r.logo} style={{ borderRadius: "50%", height: 24, width: 24 }} />
                  : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", borderRadius: "50%", display: "flex", fontSize: 9, height: 24, justifyContent: "center", width: 24 }}>
                      {(r.symbol || "?").slice(0, 2).toUpperCase()}
                    </span>}
                <Link params={{ ca: r.token }} style={{ color: "var(--arc-ink)", fontSize: 13, fontWeight: 600, textDecoration: "none" }} to="/token/$ca">
                  {r.symbol || `${r.token.slice(0, 6)}…`}
                </Link>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{r.n} tx · {ago(r.last_ts)}</span>
                {tab === "open" && <span className="arc-mono" style={{ fontSize: 12, marginLeft: "auto" }}>{usd(r.value)}</span>}
                {tab === "closed" && <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, marginLeft: "auto" }}>in {usd(r.cost)} · out {usd(r.proceeds)}</span>}
                <span className="arc-mono" style={{ color: r.pnl >= 0 ? UP : DOWN, fontSize: 12, minWidth: 96, textAlign: "right" }}>
                  {r.pnl >= 0 ? "+" : ""}{usd(r.pnl)}{r.pnl_pct == null ? "" : ` (${r.pnl_pct.toFixed(0)}%)`}
                </span>
              </div>
            ))}
          </>
        )}

        {tab === "activity" && (
          <>
            {!!delay && (
              <p className="arc-mono" style={{ borderBottom: "1px solid var(--arc-line)", color: "var(--arc-muted)", fontSize: 11, margin: 0, padding: "10px 16px" }}>
                shown {delay}s after the fact, so followers cannot be front-run into this wallet
              </p>
            )}
            {!trades.length && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 18 }}>no trades yet</p>}
            {trades.map((t, i) => (
              <div key={`${t.ts}-${i}`} style={{ alignItems: "center", borderTop: i ? "1px solid var(--arc-line)" : "none", display: "flex", gap: 10, padding: "10px 16px" }}>
                <span className="arc-mono" style={{ color: t.side === "buy" ? UP : DOWN, fontSize: 11, width: 34 }}>{t.side.toUpperCase()}</span>
                {t.logo ? <img alt="" src={t.logo} style={{ borderRadius: "50%", height: 18, width: 18 }} /> : null}
                <Link params={{ ca: t.token }} style={{ color: "var(--arc-ink)", fontSize: 13, textDecoration: "none" }} to="/token/$ca">
                  {t.symbol || `${t.token.slice(0, 6)}…`}
                </Link>
                <span className="arc-mono" style={{ fontSize: 12, marginLeft: "auto" }}>{usd(t.usdc)}</span>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, textAlign: "right", width: 44 }}>{ago(t.ts)}</span>
              </div>
            ))}
          </>
        )}
      </section>

      {msg && <p className="arc-mono" style={{ color: UP, fontSize: 12, margin: 0 }}>{msg}</p>}

      <section>
        <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginBottom: 6, textTransform: "uppercase" }}>
          wallets · proved by signature
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(st?.wallets ?? []).map((w) => (
            <a className="arc-mono" href={`/insider/${w}`} key={w}
              style={{ border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-cobalt)", fontSize: 11, padding: "5px 10px", textDecoration: "none" }}>
              {w.slice(0, 6)}…{w.slice(-4)}
            </a>
          ))}
        </div>
      </section>

      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
        Computed from Arc swaps by ArcTools. The owner sets the picture and the bio, never the record.{" "}
        <Link style={{ color: "var(--arc-cobalt)" }} to="/leaderboard">Leaderboard →</Link>
      </p>
    </main>
  );
}
