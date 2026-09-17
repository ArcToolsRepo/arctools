/**
 * Profile editor — built as the profile itself.
 *
 * The form IS the page you are creating: the same banner, the same avatar breaking out of it, the same value
 * card and tabs that strangers will see at /u/<handle>. Two reasons that matters. Filling a blank form and
 * hoping is how people end up with a profile they immediately want to delete; and the numbers shown here are
 * already the real ones, read from the chain for the connected wallet, so nobody has to publish a handle just
 * to discover what their record looks like.
 *
 * Pictures can be chosen before the profile exists. They are held in the browser and uploaded the moment the
 * profile is created, because the server ties an image to an existing profile and checks the signature.
 */
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { hotAddress, isUnlocked } from "@/lib/arc-hotwallet";
import {
  type LeaderRow, type ProfileView, addWallet, finishXVerify, getProfileByWallet, removeWallet, saveProfile, startXVerify,
  getLeaderboard, uploadProfileImage,
} from "@/lib/arc-profile";

const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";
const usd = (n?: number | null, dp = 2) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;

type Position = {
  token: string; symbol: string | null; logo: string | null; value?: number; held?: number; cost?: number;
  proceeds?: number; n?: number; last_ts?: number; pnl: number; pnl_pct: number | null;
};
type TopTrade = {
  token: string; symbol: string | null; logo: string | null; closed: boolean; last_ts: number;
  spent: number; value: number; pnl: number; entry_mc: number | null; now_mc: number | null;
};
const cap = (n?: number | null) =>
  n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
const ago = (ts?: number) => {
  if (!ts) return "—";
  const d = Math.max(0, Date.now() / 1000 - ts);
  return d < 3600 ? `${Math.round(d / 60)}m` : d < 172800 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
};

export function ProfileEditor() {
  const [me, setMe] = useState<string | null>(null);
  const [view, setView] = useState<ProfileView | null>(null);
  const [handle, setHandle] = useState("");
  const [display, setDisplay] = useState("");
  const [bio, setBio] = useState("");
  const [xh, setXh] = useState("");
  const [publicPos, setPublicPos] = useState(false);
  const [delay, setDelay] = useState(60);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Position[]>([]);
  const [closedPos, setClosedPos] = useState<Position[]>([]);
  const [topTrades, setTopTrades] = useState<TopTrade[]>([]);
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [board, setBoard] = useState<LeaderRow[]>([]);

  // chosen pictures live here until there is a profile to attach them to
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  // while a picture is in flight, the periodic profile refresh must not put the OLD url back on screen
  const [uploading, setUploading] = useState<{ avatar: boolean; banner: boolean }>({ avatar: false, banner: false });
  const uploadingRef = useRef(uploading);
  useEffect(() => { uploadingRef.current = uploading; }, [uploading]);

  const load = useCallback(async () => {
    const w = isUnlocked() ? hotAddress() : null;
    setMe(w);
    if (!w) return;
    const v = await getProfileByWallet(w);
    if (v.profile) {
      setView(v);
      setHandle(v.profile.handle);
      setDisplay(v.profile.display ?? "");
      setBio(v.profile.bio ?? "");
      setXh(v.profile.x_handle ?? "");
      setPublicPos(!!v.profile.public_positions);
      setDelay(v.profile.feed_delay ?? 60);
      if (v.profile.avatar && !uploadingRef.current.avatar) setAvatarUrl(v.profile.avatar);
      if (v.profile.banner && !uploadingRef.current.banner) setBannerUrl(v.profile.banner);
    } else {
      // no profile yet: preview the wallet's real record so the card is never an empty mock-up
      try {
        const prev = (await fetch(`/bot/api/profile?wallet=${w.toLowerCase()}&preview=1`).then((r) => r.json())) as ProfileView;
        if (prev.stats || prev.profile) setView(prev);
      } catch { /* preview is a nicety */ }
    }
    try {
      const q = v.profile ? `handle=${v.profile.handle}` : `wallet=${w.toLowerCase()}`;
      const p = (await fetch(`/bot/api/profile/positions?${q}`).then((r) => r.json())) as { open?: Position[]; closed?: Position[] };
      if (p.open || p.closed) { setOpen(p.open ?? []); setClosedPos(p.closed ?? []); }
      if (v.profile) {
        const tt = (await fetch(`/bot/api/profiles/top-trades?handle=${v.profile.handle}`).then((r) => r.json())) as { rows?: TopTrade[] };
        if (tt.rows) setTopTrades(tt.rows);
      }
    } catch { /* positions are a bonus */ }
  }, []);

  useEffect(() => {
    void getLeaderboard("all", "pnl", true).then((j) => setBoard(j.rows || []));
  }, []);

  useEffect(() => {
    void load();
    let stop = () => {};
    void import("@/lib/arc-hotwallet").then((m) => { stop = m.onHotChange(() => void load()); });
    return () => stop();
  }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg("");
    try { setMsg(await fn()); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  };

  const pick = (kind: "avatar" | "banner") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setMsg("that image is over 20 MB"); return; }
    const url = URL.createObjectURL(f);
    if (kind === "avatar") { setAvatarFile(f); setAvatarUrl(url); } else { setBannerFile(f); setBannerUrl(url); }
    // an existing profile can upload straight away; a new one waits for the profile to exist
    if (view?.profile && me) {
      const h = view.profile.handle;
      setUploading((u) => ({ ...u, [kind]: true }));
      void act(async () => {
        try {
          const r = await uploadProfileImage(me, h, kind, f);
          // the server url already carries ?v=<ts>; a second stamp guarantees the <img> refetches even if
          // the browser cached the previous version at the same path
          const fresh = `${r.url}${r.url.includes("?") ? "&" : "?"}r=${Date.now()}`;
          if (kind === "avatar") setAvatarUrl(fresh); else setBannerUrl(fresh);
          return `${kind} updated (${Math.round(r.bytes / 1024)} KB)`;
        } finally {
          setUploading((u) => ({ ...u, [kind]: false }));
        }
      });
    } else {
      setMsg(`${kind} ready — it uploads when you create the profile`);
    }
  };

  const onSave = () => act(async () => {
    if (!me) throw new Error("unlock your trading wallet first");
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw new Error("handle: 3-20 characters, a-z 0-9 _");
    const adopting = !!view?.profile?.seeded;
    await saveProfile(me, handle, { display, bio, x_handle: xh.replace(/^@/, ""), public_positions: publicPos ? 1 : 0, feed_delay: delay });
    let extra = adopting ? " · claimed, it is yours now" : "";
    for (const [kind, file] of [["avatar", avatarFile], ["banner", bannerFile]] as const) {
      if (!file) continue;
      const r = await uploadProfileImage(me, handle, kind, file);
      if (kind === "avatar") setAvatarUrl(r.url); else setBannerUrl(r.url);
      extra += ` · ${kind} uploaded`;
    }
    setAvatarFile(null); setBannerFile(null);
    return `live at /u/${handle}${extra}`;
  });

  const onAddWallet = () => act(async () => {
    if (!me) throw new Error("unlock a wallet first");
    await addWallet(me, handle);
    return `wallet ${me.slice(0, 6)}… attached`;
  });

  const onRemoveWallet = (w: string) => act(async () => {
    await removeWallet(w, handle);
    return `wallet ${w.slice(0, 6)}… detached`;
  });

  const onXStart = () => act(async () => {
    if (!me) throw new Error("unlock your wallet first");
    const r = await startXVerify(me, handle);
    setCode(r.code);
    return `post this on @${xh}: "${r.post}" then press verify X`;
  });

  const onXVerify = () => act(async () => {
    if (!me) throw new Error("unlock your wallet first");
    const r = await finishXVerify(me, handle);
    if (!r.ok) throw new Error(r.error || "code not found in your recent posts");
    return `@${r.verified} verified`;
  });

  if (!me) {
    return (
      <section style={{ border: "1px solid var(--arc-line)", borderRadius: 12, marginBottom: 14, padding: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Public profile</h2>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>
          Unlock your trading wallet to create one. The wallet signs the profile, which is what proves the record is yours.
        </p>
      </section>
    );
  }

  const st = view?.stats;
  const value = open.reduce((a, r) => a + (r.value ?? 0), 0);
  const profit = st?.pnl_total ?? 0;
  const exists = !!view?.profile;

  const inp: React.CSSProperties = {
    background: "rgba(0,0,0,0.35)", border: "1px solid var(--arc-line)", borderRadius: 8,
    color: "var(--arc-ink)", fontSize: 13, padding: "7px 10px", width: "100%",
  };
  const lbl: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" };
  const cardBox: React.CSSProperties = { background: "var(--arc-paper, #0f1218)", border: "1px solid var(--arc-line)", borderRadius: 18 };

  return (
    <section style={{ display: "grid", gap: 12, marginBottom: 18 }}>
      <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>{view?.profile?.seeded ? "Claim your public profile" : exists ? "Your public profile" : "Create your public profile"}</h2>
        {exists && (
          <Link className="arc-mono" params={{ handle }} style={{ color: "var(--arc-cobalt)", fontSize: 12 }} to="/u/$handle">
            /u/{handle} →
          </Link>
        )}
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: "auto" }}>
          this is exactly what strangers will see
        </span>
      </div>

      <div className="arc-u-grid" style={{ display: "grid", gap: 14 }}>
      {/* left rail: who else is on the board, same list the public profile shows */}
      <aside style={{ ...cardBox, alignSelf: "start", overflow: "hidden" }}>
        <h3 style={{ fontSize: 16, margin: 0, padding: "14px 16px 8px" }}>Top Profit</h3>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {!board.length && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "6px 16px 14px" }}>no ranked traders yet</p>}
          {board.map((r, i) => (
            <a href={`/u/${r.handle}`} key={r.handle}
              style={{ alignItems: "center", color: "var(--arc-ink)", display: "flex", gap: 10, padding: "7px 16px", textDecoration: "none" }}>
              <span className="arc-mono" style={{ color: i < 3 ? "#d9a441" : "var(--arc-muted)", fontSize: 12, width: 18 }}>{i + 1}</span>
              {r.avatar
                ? <img alt="" src={r.avatar} style={{ borderRadius: "50%", height: 24, objectFit: "cover", width: 24 }} />
                : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", borderRadius: "50%", display: "flex", fontSize: 9, height: 24, justifyContent: "center", width: 24 }}>{r.handle.slice(0, 2).toUpperCase()}</span>}
              <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.display || r.handle}</span>
              <span className="arc-mono" style={{ color: (r.pnl_total ?? 0) >= 0 ? UP : DOWN, fontSize: 12, marginLeft: "auto" }}>
                {(r.pnl_total ?? 0) >= 0 ? "+" : ""}{usd(r.pnl_total, 0)}
              </span>
            </a>
          ))}
        </div>
      </aside>

      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>

      {/* the card being built */}
      <div style={{ ...cardBox, overflow: "hidden" }}>
        <div style={{
          background: bannerUrl ? `center/cover no-repeat url(${bannerUrl})` : "linear-gradient(160deg, #1b2a4a, #0d1524)",
          height: 170, position: "relative",
        }}>
          <label className="arc-mono" title="upload a banner from your computer or phone"
            style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 11, padding: "6px 11px", position: "absolute", right: 12, top: 12 }}>
            <input accept="image/*" disabled={uploading.banner} onChange={pick("banner")} style={{ display: "none" }} type="file" />
            {uploading.banner ? "uploading…" : bannerUrl ? "change banner" : "upload banner"}
          </label>
          <label title="upload an avatar from your computer or phone"
            style={{ bottom: -44, cursor: "pointer", display: "block", left: 22, position: "absolute" }}>
            <input accept="image/*" disabled={uploading.avatar} onChange={pick("avatar")} style={{ display: "none" }} type="file" />
            {uploading.avatar && (
              <span className="arc-mono" style={{ background: "rgba(0,0,0,0.6)", borderRadius: "50%", color: "#fff", display: "grid", fontSize: 10, height: 100, inset: 0, placeItems: "center", position: "absolute", width: 100 }}>
                uploading…
              </span>
            )}
            {avatarUrl
              ? <img alt="" src={avatarUrl} style={{ background: "var(--arc-paper)", border: "3px solid var(--arc-bg, #0a0d14)", borderRadius: "50%", height: 100, objectFit: "cover", objectPosition: "center top", width: 100 }} />
              : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", border: "3px solid var(--arc-bg, #0a0d14)", borderRadius: "50%", color: "var(--arc-muted)", display: "flex", fontSize: 11, height: 100, justifyContent: "center", textAlign: "center", width: 100 }}>
                  upload<br />avatar
                </span>}
          </label>
        </div>

        <div style={{ display: "grid", gap: 12, padding: "54px 22px 18px" }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>display name</span>
              <input onChange={(e) => setDisplay(e.target.value)} placeholder="Satoshi" style={inp} value={display} />
            </label>
            <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>handle · /u/…</span>
              <input disabled={exists} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="satoshi_arc" style={inp} value={handle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>X handle</span>
              <input onChange={(e) => setXh(e.target.value)} placeholder="@yourhandle" style={inp} value={xh} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>bio</span>
            <input onChange={(e) => setBio(e.target.value.slice(0, 280))} placeholder="what you trade and why" style={inp} value={bio} />
          </label>
          <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 16 }}>
            <span><b style={{ color: "var(--arc-ink)" }}>{view?.followers ?? 0}</b> Followers</span>
            <span><b style={{ color: "var(--arc-ink)" }}>{(st?.wallets ?? [me]).length}</b> Wallets</span>
            <span>{st?.days_active ? `${st.days_active}d active` : "new"}</span>
          </div>
        </div>
      </div>

      {/* the numbers, already real */}
      <div style={{ ...cardBox, padding: "18px 22px" }}>
        <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }}>{usd(value)}</div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 6, textTransform: "uppercase" }}>profit</div>
            <div style={{ color: profit >= 0 ? UP : DOWN, fontSize: 16, fontWeight: 700 }}>
              {profit >= 0 ? "+" : ""}{usd(profit)}{st?.roi == null ? "" : ` (${st.roi >= 0 ? "+" : ""}${st.roi.toFixed(2)}%)`}
            </div>
          </div>
          <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
            {exists ? "your record" : "your record · already computed from the chain"}
          </span>
        </div>
        <div style={{ borderTop: "1px solid var(--arc-line)", display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 14, paddingTop: 14 }}>
          {[["realized", usd(st?.pnl_realized), (st?.pnl_realized ?? 0) >= 0 ? UP : DOWN],
            ["unrealized", usd(st?.pnl_unrealized), (st?.pnl_unrealized ?? 0) >= 0 ? UP : DOWN],
            ["buy volume", usd(st?.volume), "var(--arc-ink)"],
            ["win rate", st?.winrate == null ? "—" : `${(st.winrate * 100).toFixed(0)}%`, "var(--arc-ink)"]].map(([k, v, c]) => (
            <div key={k as string}>
              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" }}>{k}</div>
              <div style={{ color: c as string, fontSize: 17, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* the same tabs and rows the public page shows, so nothing about the result is a surprise */}
      <div style={{ display: "flex", gap: 8 }}>
        {([["open", `Open${open.length ? ` ${open.length}` : ""}`], ["closed", `Closed${closedPos.length ? ` ${closedPos.length}` : ""}`]] as const).map(([k, label]) => (
          <button className="arc-mono" key={k} onClick={() => setTab(k)} type="button"
            style={{ background: tab === k ? "rgba(255,255,255,0.06)" : "transparent", border: `1px solid ${tab === k ? UP : "var(--arc-line)"}`, borderRadius: 999, color: tab === k ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "6px 15px" }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ ...cardBox, overflow: "hidden" }}>
        <div className="arc-mono" style={{ borderBottom: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", fontSize: 10, gap: 10, padding: "8px 16px", textTransform: "uppercase" }}>
          <span style={{ flex: 1 }}>token</span><span style={{ width: 80, textAlign: "right" }}>size</span>
          <span style={{ width: 100, textAlign: "right" }}>position</span><span style={{ width: 110, textAlign: "right" }}>profit</span>
        </div>
        {!(tab === "open" ? open : closedPos).length && (
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 14 }}>nothing {tab} yet</p>
        )}
        {(tab === "open" ? open : closedPos).slice(0, 12).map((r) => (
          <div key={r.token} style={{ borderTop: "1px solid var(--arc-line)", padding: "9px 16px" }}>
            <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
              {r.logo
                ? <img alt="" src={r.logo} style={{ borderRadius: "50%", height: 26, width: 26 }} />
                : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", borderRadius: "50%", display: "flex", fontSize: 9, height: 26, justifyContent: "center", width: 26 }}>{(r.symbol || "?").slice(0, 2).toUpperCase()}</span>}
              <div style={{ display: "grid", flex: 1, minWidth: 0 }}>
                <a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>{r.symbol || `${r.token.slice(0, 6)}…`}</a>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>
                  {tab === "open" ? `Last trade ${ago(r.last_ts)}` : `Closed ${ago(r.last_ts)} ago`} · Spent {usd(r.cost)}
                </span>
              </div>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, textAlign: "right", width: 80 }}>
                {tab === "open" ? (r.held ? `${(r.held / 1e6).toFixed(1)}M` : "—") : "closed"}
              </span>
              <span className="arc-mono" style={{ fontSize: 12, textAlign: "right", width: 100 }}>{usd(tab === "open" ? r.value : r.proceeds)}</span>
              <span className="arc-mono" style={{ color: r.pnl >= 0 ? UP : DOWN, fontSize: 12, textAlign: "right", width: 110 }}>
                {r.pnl >= 0 ? "+" : ""}{usd(r.pnl)}{r.pnl_pct == null ? "" : ` (${r.pnl_pct.toFixed(0)}%)`}
              </span>
            </div>
          </div>
        ))}
      </div>

      {!!topTrades.length && (
        <div style={{ ...cardBox, overflow: "hidden" }}>
          <h3 style={{ fontSize: 15, margin: 0, padding: "12px 16px 6px" }}>Top trades</h3>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", padding: "0 12px 12px" }}>
            {topTrades.slice(0, 6).map((r, i) => (
              <div key={r.token} style={{ border: "1px solid var(--arc-line)", borderRadius: 12, padding: 10, position: "relative" }}>
                <span className="arc-mono" style={{ background: i < 3 ? "#d9a441" : "var(--arc-line)", borderRadius: 6, color: i < 3 ? "#1a1204" : "var(--arc-muted)", fontSize: 10, left: 10, padding: "1px 6px", position: "absolute", top: -9 }}>#{i + 1}</span>
                <div style={{ alignItems: "center", display: "flex", gap: 9, marginTop: 4 }}>
                  {r.logo
                    ? <img alt="" src={r.logo} style={{ borderRadius: "50%", height: 28, width: 28 }} />
                    : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", borderRadius: "50%", display: "flex", fontSize: 9, height: 28, justifyContent: "center", width: 28 }}>{(r.symbol || "?").slice(0, 2).toUpperCase()}</span>}
                  <div style={{ display: "grid", flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.symbol || `${r.token.slice(0, 6)}…`}</span>
                    <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>{r.closed ? `Closed ${ago(r.last_ts)} ago` : `Last trade ${ago(r.last_ts)}`}</span>
                  </div>
                  <span className="arc-mono" style={{ color: r.pnl >= 0 ? UP : DOWN, fontSize: 12, fontWeight: 700 }}>{r.pnl >= 0 ? "+" : ""}{usd(r.pnl)}</span>
                </div>
                <div className="arc-mono" style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 10, gap: "3px 8px", justifyContent: "space-between", marginTop: 8, paddingTop: 7 }}>
                  <span>Spent {usd(r.spent)}</span>
                  {r.entry_mc && r.now_mc ? <span>Avg entry {cap(r.entry_mc)} MC → {cap(r.now_mc)} MC</span> : <span>{r.closed ? "closed" : `holding ${usd(r.value)}`}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* privacy, then commit */}
      <p className="arc-mono" style={{ background: "rgba(240,83,79,0.08)", border: "1px solid rgba(240,83,79,0.3)", borderRadius: 8, color: "var(--arc-muted)", fontSize: 11, margin: 0, padding: "8px 10px" }}>
        Publishing links these wallets to a public name: every trade they ever made, their PnL and their holdings.
        The chain keeps that forever — detaching a wallet later hides it here, not on the chain.
      </p>

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 14 }}>
        <label className="arc-mono" style={{ alignItems: "center", display: "flex", fontSize: 12, gap: 6 }}>
          <input checked={publicPos} onChange={(e) => setPublicPos(e.target.checked)} type="checkbox" />
          show open positions publicly
        </label>
        <label className="arc-mono" style={{ alignItems: "center", display: "flex", fontSize: 12, gap: 6 }}>
          feed delay
          <select onChange={(e) => setDelay(Number(e.target.value))} style={{ ...inp, padding: "4px 8px", width: "auto" }} value={delay}>
            <option value={0}>instant</option>
            <option value={60}>60 s</option>
            <option value={300}>5 min</option>
            <option value={900}>15 min</option>
          </select>
          <span style={{ color: "var(--arc-muted)" }}>stops your own followers front-running you</span>
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="arc-mono" disabled={busy} onClick={onSave}
          style={{ background: "var(--arc-cobalt)", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 12, padding: "9px 18px" }} type="button">
          {busy ? "signing…" : view?.profile?.seeded ? "claim this profile" : exists ? "save changes" : "create profile"}
        </button>
        {exists && (
          <>
            <button className="arc-mono" disabled={busy} onClick={onAddWallet}
              style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "9px 16px" }} type="button">
              attach this wallet
            </button>
            <button className="arc-mono" disabled={busy || !xh} onClick={onXStart}
              style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "9px 16px" }} type="button">
              get X code
            </button>
            {code && (
              <button className="arc-mono" disabled={busy} onClick={onXVerify}
                style={{ background: UP, border: "none", borderRadius: 8, color: "#04140a", cursor: "pointer", fontSize: 12, padding: "9px 16px" }} type="button">
                verify X
              </button>
            )}
          </>
        )}
      </div>

      {msg && <p className="arc-mono" style={{ color: UP, fontSize: 12, margin: 0, wordBreak: "break-word" }}>{msg}</p>}

      {!!(view?.stats?.wallets ?? []).length && exists && (
        <div style={{ display: "grid", gap: 6 }}>
          <span className="arc-mono" style={lbl}>attached wallets</span>
          {(view?.stats?.wallets ?? []).map((w) => (
            <div className="arc-mono" key={w} style={{ alignItems: "center", display: "flex", fontSize: 11, gap: 8 }}>
              <span>{w}</span>
              <button className="arc-mono" disabled={busy} onClick={() => onRemoveWallet(w)}
                style={{ background: "transparent", border: "none", color: DOWN, cursor: "pointer", fontSize: 11 }} type="button">
                detach
              </button>
            </div>
          ))}
        </div>
      )}
      </div>

      {/* right rail: the best calls, exactly as the public page ranks them */}
      <aside style={{ ...cardBox, alignSelf: "start", overflow: "hidden" }}>
        <h3 style={{ fontSize: 16, margin: 0, padding: "14px 16px 8px" }}>Top trades</h3>
        <div style={{ display: "grid", gap: 8, maxHeight: 520, overflowY: "auto", padding: "0 12px 12px" }}>
          {!topTrades.length && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "2px 4px" }}>no trades to rank yet</p>}
          {topTrades.slice(0, 8).map((r, i) => (
            <div key={r.token} style={{ border: "1px solid var(--arc-line)", borderRadius: 12, padding: 10, position: "relative" }}>
              <span className="arc-mono" style={{ background: i < 3 ? "#d9a441" : "var(--arc-line)", borderRadius: 6, color: i < 3 ? "#1a1204" : "var(--arc-muted)", fontSize: 10, left: 10, padding: "1px 6px", position: "absolute", top: -9 }}>#{i + 1}</span>
              <div style={{ alignItems: "center", display: "flex", gap: 9, marginTop: 4 }}>
                {r.logo
                  ? <img alt="" src={r.logo} style={{ borderRadius: "50%", height: 28, width: 28 }} />
                  : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", borderRadius: "50%", display: "flex", fontSize: 9, height: 28, justifyContent: "center", width: 28 }}>{(r.symbol || "?").slice(0, 2).toUpperCase()}</span>}
                <div style={{ display: "grid", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.symbol || `${r.token.slice(0, 6)}…`}</span>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>{r.closed ? `Closed ${ago(r.last_ts)} ago` : `Last trade ${ago(r.last_ts)}`}</span>
                </div>
                <span className="arc-mono" style={{ color: r.pnl >= 0 ? UP : DOWN, fontSize: 12, fontWeight: 700 }}>{r.pnl >= 0 ? "+" : ""}{usd(r.pnl)}</span>
              </div>
              <div className="arc-mono" style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 10, gap: "3px 8px", justifyContent: "space-between", marginTop: 8, paddingTop: 7 }}>
                <span>Spent {usd(r.spent)}</span>
                {r.entry_mc && r.now_mc ? <span>Avg entry {cap(r.entry_mc)} MC → {cap(r.now_mc)} MC</span> : <span>{r.closed ? "closed" : `holding ${usd(r.value)}`}</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>

      
      </div>
    </section>
  );
}

/** Trades of the profiles this wallet follows — each still behind that profile's own delay. */
export function FollowingFeed() {
  const [rows, setRows] = useState<Array<{ ts: number; token: string; side: string; usdc: number; handle: string; symbol: string | null; logo: string | null }>>([]);
  useEffect(() => {
    const w = hotAddress();
    if (!w) return;
    let alive = true;
    const load = () => fetch(`/bot/api/profile/following-feed?wallet=${w.toLowerCase()}&limit=20`)
      .then((r) => r.json())
      .then((j: { trades?: typeof rows }) => { if (alive) setRows(j.trades ?? []); })
      .catch(() => null);
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 45_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!rows.length) return null;
  return (
    <section style={{ border: "1px solid var(--arc-line)", borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
      <h2 style={{ borderBottom: "1px solid var(--arc-line)", fontSize: 15, margin: 0, padding: "12px 16px" }}>Traders you follow</h2>
      {rows.map((r, i) => (
        <div key={`${r.ts}-${i}`} style={{ alignItems: "center", borderTop: i ? "1px solid var(--arc-line)" : "none", display: "flex", gap: 10, padding: "8px 16px" }}>
          <a className="arc-mono" href={`/u/${r.handle}`} style={{ color: "var(--arc-cobalt)", fontSize: 11, textDecoration: "none", width: 96 }}>@{r.handle}</a>
          <span className="arc-mono" style={{ color: r.side === "buy" ? UP : DOWN, fontSize: 11, width: 32 }}>{r.side.toUpperCase()}</span>
          {r.logo ? <img alt="" src={r.logo} style={{ borderRadius: "50%", height: 16, width: 16 }} /> : null}
          <a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)", fontSize: 12, textDecoration: "none" }}>{r.symbol || `${r.token.slice(0, 6)}…`}</a>
          <span className="arc-mono" style={{ fontSize: 11, marginLeft: "auto" }}>${r.usdc < 100 ? r.usdc.toFixed(2) : Math.round(r.usdc).toLocaleString()}</span>
        </div>
      ))}
    </section>
  );
}
