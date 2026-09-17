/**
 * Public trader profile: /u/<handle>
 *
 * Three columns, the way trader pages are actually read: the ranking on the left so you always know who else
 * is out there, the person in the middle, and their best calls on the right. On a narrow screen the columns
 * stack — ranking first would bury the profile you clicked, so the profile leads and the rails follow.
 *
 * Every number is computed by us from Arc swaps. The owner controls the picture, the banner and the bio.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import {
  type Badge, type LeaderRow, type ProfileTrade, type ProfileView,
  follow, getLeaderboard, getProfile, getProfileTrades,
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
type TopTrade = {
  token: string; symbol: string | null; name: string | null; logo: string | null; closed: boolean;
  last_ts: number; spent: number; value: number; pnl: number; pnl_pct: number | null;
  entry_mc: number | null; now_mc: number | null;
};

const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";
const usd = (n?: number | null, dp?: number) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, {
    maximumFractionDigits: dp ?? (Math.abs(n) < 100 ? 2 : 0), minimumFractionDigits: dp ?? 0 })}`;
const cap = (n?: number | null) =>
  n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
const ago = (ts?: number) => {
  if (!ts) return "—";
  const d = Math.max(0, Date.now() / 1000 - ts);
  return d < 3600 ? `${Math.round(d / 60)}m` : d < 172800 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
};
const joined = (ts?: number) =>
  ts ? new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const TONE: Record<string, string> = {
  cobalt: "var(--arc-cobalt)", gold: "#d9a441", up: UP, pink: "#ff5fd2", ink: "var(--arc-ink)",
};
const CARD: React.CSSProperties = { background: "var(--arc-paper, #0f1218)", border: "1px solid var(--arc-line)", borderRadius: 16 };

function Avatar({ src, label, size = 36, round = true }: { src?: string | null; label: string; size?: number; round?: boolean }) {
  if (src) return <img alt="" src={src} style={{ borderRadius: round ? "50%" : 8, flex: "none", height: size, objectFit: "cover", width: size }} />;
  return (
    <span className="arc-mono" style={{
      alignItems: "center", background: "var(--arc-line)", borderRadius: round ? "50%" : 8, color: "var(--arc-muted)",
      display: "flex", flex: "none", fontSize: size / 3, height: size, justifyContent: "center", width: size,
    }}>{label.slice(0, 2).toUpperCase()}</span>
  );
}

function ProfilePage() {
  const { handle } = Route.useParams();
  const [view, setView] = useState<ProfileView | null>(null);
  const [range, setRange] = useState<"7d" | "30d" | "all">("all");
  const [tab, setTab] = useState<"open" | "closed" | "activity">("open");
  const [pos, setPos] = useState<{ open: Position[]; closed: Position[] }>({ open: [], closed: [] });
  const [trades, setTrades] = useState<ProfileTrade[]>([]);
  const [top, setTop] = useState<TopTrade[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [boardSort, setBoardSort] = useState<"pnl" | "volume">("pnl");
  const [delay, setDelay] = useState(0);
  const [rank, setRank] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setView(await getProfile(handle, range));
    const t = await getProfileTrades(handle, 40);
    setTrades(t.trades || []); setDelay(t.delay ?? 0);
    try {
      const p = (await fetch(`/bot/api/profile/positions?handle=${handle}`).then((r) => r.json())) as typeof pos;
      setPos({ open: p.open || [], closed: p.closed || [] });
    } catch { /* positions are a bonus */ }
    try {
      const tt = (await fetch(`/bot/api/profiles/top-trades?handle=${handle}`).then((r) => r.json())) as { rows?: TopTrade[] };
      setTop(tt.rows ?? []);
    } catch { /* ditto */ }
  }, [handle, range]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let alive = true;
    void getLeaderboard(range, boardSort, true).then((j) => {
      if (!alive) return;
      setBoard(j.rows || []);
      const i = (j.rows || []).findIndex((r) => r.handle === handle);
      setRank(i >= 0 ? i + 1 : null);
    });
    return () => { alive = false; };
  }, [range, boardSort, handle]);

  const onFollow = async () => {
    const me = hotAddress();
    if (!me) { setMsg("unlock your trading wallet to follow"); return; }
    setBusy(true); setMsg("");
    try {
      const own = await getProfile(handle);
      await follow(me, own.profile?.handle ?? handle, handle);
      setMsg(`following @${handle}`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "could not follow"); }
    finally { setBusy(false); }
  };

  const p = view?.profile;
  const st = view?.stats;
  const value = pos.open.reduce((a, r) => a + (r.value ?? 0), 0);
  const profit = st?.pnl_total ?? 0;

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

  const chip = (on: boolean): React.CSSProperties => ({
    background: on ? "rgba(255,255,255,0.06)" : "transparent",
    border: `1px solid ${on ? UP : "var(--arc-line)"}`, borderRadius: 999,
    color: on ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "6px 15px",
  });

  return (
    <main style={{
      display: "grid", gap: 14, margin: "0 auto", maxWidth: 1560, padding: "16px 14px 60px",
      gridTemplateColumns: "minmax(0, 1fr)",
    }}>
      <div className="arc-u-grid" style={{ display: "grid", gap: 14 }}>
        {/* LEFT — the ranking */}
        <aside style={{ ...CARD, alignSelf: "start", overflow: "hidden" }}>
          <div style={{ alignItems: "center", display: "flex", gap: 14, padding: "14px 16px 6px" }}>
            <h2 style={{ fontSize: 17, margin: 0 }}>Top Profit</h2>
            <button className="arc-mono" onClick={() => setBoardSort(boardSort === "pnl" ? "volume" : "pnl")}
              style={{ background: "transparent", border: "none", color: boardSort === "volume" ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 15 }} type="button">
              Top volume
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, padding: "0 16px 10px" }}>
            <span className="arc-mono" style={{ ...chip(true), cursor: "default" }}>{boardSort === "pnl" ? "Profit" : "Volume"}</span>
            {(["7d", "30d", "all"] as const).map((r) => (
              <button className="arc-mono" key={r} onClick={() => setRange(r)} style={chip(range === r)} type="button">
                {r === "7d" ? "1W" : r === "30d" ? "1M" : "ALL"}
              </button>
            ))}
          </div>
          <div style={{ maxHeight: 760, overflowY: "auto" }}>
            {!board.length && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "10px 16px" }}>no ranked traders yet</p>}
            {board.map((r, i) => (
              <Link key={r.handle} params={{ handle: r.handle }} to="/u/$handle"
                style={{
                  alignItems: "center", background: r.handle === handle ? "rgba(46,124,255,0.10)" : "transparent",
                  color: "var(--arc-ink)", display: "flex", gap: 10, padding: "7px 16px", textDecoration: "none",
                }}>
                <span className="arc-mono" style={{ color: i < 3 ? "#d9a441" : "var(--arc-muted)", fontSize: 12, width: 18 }}>{i + 1}</span>
                <Avatar label={r.handle} size={26} src={r.avatar} />
                <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.display || r.handle}
                </span>
                <span className="arc-mono" style={{ color: (r.pnl_total ?? 0) >= 0 ? UP : DOWN, fontSize: 12, marginLeft: "auto" }}>
                  {(r.pnl_total ?? 0) >= 0 ? "+" : ""}{usd(boardSort === "pnl" ? r.pnl_total : r.volume)}
                </span>
              </Link>
            ))}
          </div>
        </aside>

        {/* CENTER — the person */}
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <section style={{ ...CARD, overflow: "hidden" }}>
            <div style={{
              background: p?.banner ? `center/cover no-repeat url(${p.banner})` : "linear-gradient(160deg, #1b2a4a, #0d1524)",
              height: 176, position: "relative",
            }}>
              <div style={{ bottom: -44, left: 22, position: "absolute" }}>
                <span style={{ border: "3px solid var(--arc-bg, #0a0d14)", borderRadius: "50%", display: "block" }}>
                  <Avatar label={handle} size={98} src={p?.avatar} />
                </span>
              </div>
              <div style={{ bottom: 12, display: "flex", gap: 8, position: "absolute", right: 14 }}>
                <button className="arc-mono" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/u/${handle}`); setMsg("link copied"); }}
                  style={{ background: "rgba(0,0,0,0.5)", border: "1px solid var(--arc-line)", borderRadius: 10, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "7px 12px" }} type="button">
                  share
                </button>
                <button className="arc-mono" disabled={busy} onClick={() => void onFollow()}
                  style={{ background: "rgba(0,0,0,0.5)", border: "1px solid var(--arc-line)", borderRadius: 10, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "7px 14px" }} type="button">
                  {busy ? "signing…" : "follow"}
                </button>
                <a className="arc-mono" href="https://t.me/ArcSniper_bot" rel="noreferrer"
                  style={{ background: "var(--arc-cobalt)", borderRadius: 10, color: "#fff", fontSize: 12, padding: "7px 14px", textDecoration: "none" }} target="_blank">
                  copy-trade
                </a>
              </div>
            </div>
            <div style={{ padding: "52px 22px 18px" }}>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
                <h1 style={{ fontSize: 27, margin: 0 }}>{p?.display || handle}</h1>
                {p?.x_handle && (
                  <a href={`https://x.com/${p.x_handle}`} rel="noreferrer" target="_blank" title={p.x_verified ? "verified" : "declared"}
                    style={{ alignItems: "center", background: "rgba(255,255,255,0.06)", border: `1px solid ${p.x_verified ? UP : "var(--arc-line)"}`, borderRadius: 8, color: p.x_verified ? UP : "var(--arc-muted)", display: "flex", fontSize: 12, height: 26, justifyContent: "center", textDecoration: "none", width: 30 }}>
                    𝕏
                  </a>
                )}
                {(view?.badges ?? []).map((b: Badge) => (
                  <span className="arc-mono" key={b.id} style={{ border: `1px solid ${TONE[b.tone] ?? "var(--arc-muted)"}`, borderRadius: 999, color: TONE[b.tone] ?? "var(--arc-muted)", fontSize: 10, padding: "2px 8px" }}>
                    {b.label}
                  </span>
                ))}
              </div>
              <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 16, marginTop: 8 }}>
                <span><b style={{ color: "var(--arc-ink)" }}>{view?.followers ?? 0}</b> Followers</span>
                <span><b style={{ color: "var(--arc-ink)" }}>{(st?.wallets ?? []).length}</b> Wallets</span>
                <span>Joined {joined(p?.created)}</span>
              </div>
              {p?.bio && <p style={{ color: "var(--arc-muted)", margin: "10px 0 0" }}>{p.bio}</p>}
            </div>
          </section>

          <section style={{ ...CARD, padding: "20px 22px" }}>
            <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -0.8 }}>{usd(value, 2)}</div>
                <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 8, textTransform: "uppercase" }}>profit</div>
                <div style={{ color: profit >= 0 ? UP : DOWN, fontSize: 17, fontWeight: 700 }}>
                  {profit >= 0 ? "+" : ""}{usd(profit, 2)}{st?.roi == null ? "" : ` (${st.roi >= 0 ? "+" : ""}${st.roi.toFixed(2)}%)`}{" "}
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>{range === "7d" ? "1W" : range === "30d" ? "1M" : "ALL"}</span>
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
            <div style={{ borderTop: "1px solid var(--arc-line)", display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 16, paddingTop: 14 }}>
              {[["realized", usd(st?.pnl_realized, 2), (st?.pnl_realized ?? 0) >= 0 ? UP : DOWN],
                ["unrealized", usd(st?.pnl_unrealized, 2), (st?.pnl_unrealized ?? 0) >= 0 ? UP : DOWN],
                ["buy volume", usd(st?.volume, 2), "var(--arc-ink)"]].map(([k, v, c]) => (
                <div key={k as string}>
                  <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" }}>{k}</div>
                  <div style={{ color: c as string, fontSize: 19, fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>
          </section>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {([["open", `Open${pos.open.length ? ` ${pos.open.length}` : ""}`],
               ["closed", `Closed${pos.closed.length ? ` ${pos.closed.length}` : ""}`],
               ["activity", "Activity"]] as const).map(([k, label]) => (
              <button className="arc-mono" key={k} onClick={() => setTab(k)} style={chip(tab === k)} type="button">{label}</button>
            ))}
          </div>

          <section style={{ ...CARD, overflow: "hidden" }}>
            {tab !== "activity" && (
              <>
                <div className="arc-mono" style={{ borderBottom: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", fontSize: 10, gap: 10, padding: "8px 16px", textTransform: "uppercase" }}>
                  <span style={{ flex: 1 }}>token</span><span style={{ width: 90, textAlign: "right" }}>size</span>
                  <span style={{ width: 110, textAlign: "right" }}>position</span><span style={{ width: 120, textAlign: "right" }}>profit</span>
                </div>
                {!(tab === "open" ? pos.open : pos.closed).length && (
                  <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>nothing {tab} yet</p>
                )}
                {(tab === "open" ? pos.open : pos.closed).map((r) => (
                  <div key={r.token} style={{ borderTop: "1px solid var(--arc-line)", padding: "10px 16px" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
                      <Avatar label={r.symbol || "?"} size={30} src={r.logo} />
                      <div style={{ display: "grid", flex: 1, minWidth: 0 }}>
                        <Link params={{ ca: r.token }} style={{ color: "var(--arc-ink)", fontSize: 13, fontWeight: 600, textDecoration: "none" }} to="/token/$ca">
                          {r.symbol || `${r.token.slice(0, 6)}…`}
                        </Link>
                        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>
                          {tab === "open" ? `Last trade ${ago(r.last_ts)}` : `Closed ${ago(r.last_ts)} ago`} · {r.n} tx
                        </span>
                      </div>
                      <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, textAlign: "right", width: 90 }}>
                        {tab === "open" ? (r.held ? `${(r.held / 1e6).toFixed(1)}M` : "—") : "closed"}
                      </span>
                      <span className="arc-mono" style={{ fontSize: 12, textAlign: "right", width: 110 }}>{usd(tab === "open" ? r.value : r.proceeds)}</span>
                      <span className="arc-mono" style={{ color: r.pnl >= 0 ? UP : DOWN, fontSize: 12, textAlign: "right", width: 120 }}>
                        {r.pnl >= 0 ? "+" : ""}{usd(r.pnl)}{r.pnl_pct == null ? "" : ` (${r.pnl_pct.toFixed(0)}%)`}
                      </span>
                    </div>
                    <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 4 }}>Spent {usd(r.cost)}</div>
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
                {!trades.length && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>no trades yet</p>}
                {trades.map((t, i) => (
                  <div key={`${t.ts}-${i}`} style={{ alignItems: "center", borderTop: i ? "1px solid var(--arc-line)" : "none", display: "flex", gap: 10, padding: "9px 16px" }}>
                    <span className="arc-mono" style={{ color: t.side === "buy" ? UP : DOWN, fontSize: 11, width: 34 }}>{t.side.toUpperCase()}</span>
                    <Avatar label={t.symbol || "?"} size={18} src={t.logo} />
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
        </div>

        {/* RIGHT — best calls */}
        <aside style={{ ...CARD, alignSelf: "start", overflow: "hidden" }}>
          <h2 style={{ fontSize: 17, margin: 0, padding: "14px 16px 8px" }}>Top trades</h2>
          <div style={{ display: "grid", gap: 8, maxHeight: 820, overflowY: "auto", padding: "0 12px 12px" }}>
            {!top.length && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "6px 4px" }}>no trades to rank yet</p>}
            {top.map((r, i) => (
              <div key={r.token} style={{ border: "1px solid var(--arc-line)", borderRadius: 12, padding: 10, position: "relative" }}>
                <span className="arc-mono" style={{
                  background: i < 3 ? "#d9a441" : "var(--arc-line)", borderRadius: 6, color: i < 3 ? "#1a1204" : "var(--arc-muted)",
                  fontSize: 10, left: 10, padding: "1px 6px", position: "absolute", top: -9,
                }}>#{i + 1}</span>
                <div style={{ alignItems: "center", display: "flex", gap: 9, marginTop: 4 }}>
                  <Avatar label={r.symbol || "?"} size={32} src={r.logo} />
                  <div style={{ display: "grid", flex: 1, minWidth: 0 }}>
                    <Link params={{ ca: r.token }} style={{ color: "var(--arc-ink)", fontSize: 13, fontWeight: 600, textDecoration: "none" }} to="/token/$ca">
                      {r.symbol || `${r.token.slice(0, 6)}…`}
                    </Link>
                    <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>
                      {r.closed ? `Closed ${ago(r.last_ts)} ago` : `Last trade ${ago(r.last_ts)}`}
                    </span>
                  </div>
                  <div style={{ display: "grid", textAlign: "right" }}>
                    <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 9, textTransform: "uppercase" }}>profit</span>
                    <span className="arc-mono" style={{ color: r.pnl >= 0 ? UP : DOWN, fontSize: 12, fontWeight: 700 }}>
                      {r.pnl >= 0 ? "+" : ""}{usd(r.pnl)}
                    </span>
                  </div>
                </div>
                <div className="arc-mono" style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 10, gap: "3px 8px", justifyContent: "space-between", marginTop: 8, paddingTop: 7 }}>
                  <span>Spent {usd(r.spent)}</span>
                  {r.entry_mc && r.now_mc
                    ? <span>Avg entry {cap(r.entry_mc)} MC → {cap(r.now_mc)} MC</span>
                    : <span>{r.closed ? "closed" : `holding ${usd(r.value)}`}</span>}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
        Computed from Arc swaps by ArcTools. The owner sets the picture and the bio, never the record.{" "}
        <Link style={{ color: "var(--arc-cobalt)" }} to="/leaderboard">Full leaderboard →</Link>
      </p>
    </main>
  );
}
