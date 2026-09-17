/**
 * Public trader profile: /u/<handle>
 *
 * Everything on this page is computed by us from the chain — the visitor can trust the numbers exactly as far
 * as they trust the chain, because the profile owner cannot type any of them in. What the owner controls is the
 * picture, the bio and which wallets are attached (each proved by a signature).
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

const usd = (n?: number | null) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
const pct = (n?: number | null) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);
const ago = (ts?: number) => {
  if (!ts) return "—";
  const d = Math.max(0, Date.now() / 1000 - ts);
  return d < 3600 ? `${Math.round(d / 60)}m` : d < 172800 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
};

const TONE: Record<string, string> = {
  cobalt: "var(--arc-cobalt)", gold: "#d9a441", up: "var(--arc-up)", pink: "#ff5fd2", ink: "var(--arc-ink)",
};

function BadgePill({ b }: { b: Badge }) {
  const c = TONE[b.tone] ?? "var(--arc-muted)";
  return (
    <span className="arc-mono" style={{ border: `1px solid ${c}`, borderRadius: 999, color: c, fontSize: 10, padding: "3px 9px" }}>
      {b.label}
    </span>
  );
}

function Tile({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div style={{ border: "1px solid var(--arc-line)", borderRadius: 12, padding: "12px 14px" }}>
      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" }}>{k}</div>
      <div style={{ color: tone ?? "var(--arc-ink)", fontSize: 21, fontWeight: 700, marginTop: 4 }}>{v}</div>
    </div>
  );
}

function ProfilePage() {
  const { handle } = Route.useParams();
  const [view, setView] = useState<ProfileView | null>(null);
  const [range, setRange] = useState<"7d" | "30d" | "all">("all");
  const [trades, setTrades] = useState<ProfileTrade[]>([]);
  const [delay, setDelay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setView(await getProfile(handle, range));
    const t = await getProfileTrades(handle, 30);
    setTrades(t.trades || []);
    setDelay(t.delay ?? 0);
  }, [handle, range]);

  useEffect(() => { void load(); }, [load]);

  const onFollow = async () => {
    const me = hotAddress();
    if (!me) { setMsg("unlock your trading wallet to follow"); return; }
    setBusy(true); setMsg("");
    try {
      const own = await getProfile(handle);            // the follower signs with their own handle if they have one
      const mine = own.profile?.handle ?? handle;
      await follow(me, mine, handle);
      setMsg(`following @${handle} — you will see their buys marked on charts`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "could not follow");
    } finally { setBusy(false); }
  };

  const p = view?.profile;
  const st = view?.stats;

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

  return (
    <main className="arc-wrap" style={{ display: "grid", gap: 18, padding: "28px 20px 60px" }}>
      <header style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 16 }}>
        {p?.avatar
          ? <img alt="" src={p.avatar} style={{ borderRadius: 16, height: 84, objectFit: "cover", width: 84 }} />
          : <div className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", borderRadius: 16, display: "flex", fontSize: 26, height: 84, justifyContent: "center", width: 84 }}>
              {handle.slice(0, 2).toUpperCase()}
            </div>}
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
            <h1 style={{ fontSize: 28, margin: 0 }}>{p?.display || `@${handle}`}</h1>
            <span className="arc-mono" style={{ color: "var(--arc-muted)" }}>@{handle}</span>
            {p?.x_handle && (
              <a className="arc-mono" href={`https://x.com/${p.x_handle}`} rel="noreferrer" style={{ color: p.x_verified ? "var(--arc-up)" : "var(--arc-muted)", fontSize: 12, textDecoration: "none" }} target="_blank">
                𝕏 @{p.x_handle} {p.x_verified ? "· verified" : "· declared"}
              </a>
            )}
          </div>
          {p?.bio && <p style={{ color: "var(--arc-muted)", margin: 0, maxWidth: 620 }}>{p.bio}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(view?.badges ?? []).map((b) => <BadgePill b={b} key={b.id} />)}
          </div>
        </div>
        <div style={{ display: "grid", gap: 6, marginLeft: "auto" }}>
          <button className="arc-mono" disabled={busy} onClick={() => void onFollow()}
            style={{ background: "var(--arc-cobalt)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 12, padding: "9px 18px" }} type="button">
            {busy ? "signing…" : "follow"}
          </button>
          <a className="arc-mono" href="https://t.me/ArcSniper_bot" rel="noreferrer"
            style={{ border: "1px solid var(--arc-line)", borderRadius: 10, color: "var(--arc-ink)", fontSize: 12, padding: "9px 18px", textAlign: "center", textDecoration: "none" }} target="_blank">
            copy-trade
          </a>
          <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, textAlign: "center" }}>
            {view?.followers ?? 0} followers
          </span>
        </div>
      </header>

      {msg && <p className="arc-mono" style={{ color: "var(--arc-up)", fontSize: 12, margin: 0 }}>{msg}</p>}

      <div style={{ display: "flex", gap: 6 }}>
        {(["7d", "30d", "all"] as const).map((r) => (
          <button className="arc-mono" key={r} onClick={() => setRange(r)}
            style={{ background: range === r ? "var(--arc-cobalt)" : "transparent", border: "1px solid var(--arc-line)", borderRadius: 999, color: range === r ? "#fff" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "4px 12px" }} type="button">
            {r}
          </button>
        ))}
      </div>

      <section style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Tile k="PnL total" tone={(st?.pnl_total ?? 0) >= 0 ? "var(--arc-up)" : "var(--arc-down, #f0534f)"} v={usd(st?.pnl_total)} />
        <Tile k="PnL realized" v={usd(st?.pnl_realized)} />
        <Tile k="ROI on volume" v={st?.roi == null ? "—" : `${st.roi.toFixed(1)}%`} />
        <Tile k="win rate" v={pct(st?.winrate)} />
        <Tile k="closed trades" v={String(st?.closed ?? 0)} />
        <Tile k="volume" v={usd(st?.volume)} />
        <Tile k="days active" v={String(st?.days_active ?? 0)} />
        <Tile k="best call" v={st?.best_symbol ? `${st.best_symbol} ${usd(st.best_pnl)}` : "—"} />
      </section>

      <section>
        <h2 style={{ fontSize: 14, margin: "6px 0" }}>
          Wallets <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>· proved by signature</span>
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(st?.wallets ?? []).map((w) => (
            <a className="arc-mono" href={`/insider/${w}`} key={w}
              style={{ border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-cobalt)", fontSize: 11, padding: "5px 10px", textDecoration: "none" }}>
              {w.slice(0, 6)}…{w.slice(-4)}
            </a>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 14, margin: "6px 0" }}>
          Recent trades{" "}
          <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
            {delay ? `· shown ${delay}s after the fact, so followers cannot be front-run into` : ""}
          </span>
        </h2>
        <div style={{ border: "1px solid var(--arc-line)", borderRadius: 12, overflow: "hidden" }}>
          {!trades.length && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 14 }}>no trades yet</p>}
          {trades.map((t, i) => (
            <div key={`${t.ts}-${i}`} style={{ alignItems: "center", borderTop: i ? "1px solid var(--arc-line)" : "none", display: "flex", gap: 10, padding: "9px 12px" }}>
              <span className="arc-mono" style={{ color: t.side === "buy" ? "var(--arc-up)" : "var(--arc-down, #f0534f)", fontSize: 11, width: 34 }}>
                {t.side.toUpperCase()}
              </span>
              {t.logo ? <img alt="" src={t.logo} style={{ borderRadius: "50%", height: 18, width: 18 }} /> : null}
              <Link params={{ ca: t.token }} style={{ color: "var(--arc-ink)", fontSize: 13, textDecoration: "none" }} to="/token/$ca">
                {t.symbol || `${t.token.slice(0, 6)}…`}
              </Link>
              <span className="arc-mono" style={{ fontSize: 12, marginLeft: "auto" }}>{usd(t.usdc)}</span>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, width: 42, textAlign: "right" }}>{ago(t.ts)}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
        Numbers are computed from Arc swaps by ArcTools. A profile owner can change the picture and the bio, never the record.{" "}
        <Link style={{ color: "var(--arc-cobalt)" }} to="/leaderboard">See the leaderboard →</Link>
      </p>
    </main>
  );
}
