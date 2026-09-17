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
import { useCallback, useEffect, useState } from "react";

import { hotAddress, isUnlocked } from "@/lib/arc-hotwallet";
import {
  type ProfileView, addWallet, finishXVerify, getProfileByWallet, removeWallet, saveProfile, startXVerify,
  uploadProfileImage,
} from "@/lib/arc-profile";

const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";
const usd = (n?: number | null, dp = 2) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;

type Position = { token: string; symbol: string | null; logo: string | null; value?: number; pnl: number; pnl_pct: number | null };

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

  // chosen pictures live here until there is a profile to attach them to
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");

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
      if (v.profile.avatar) setAvatarUrl(v.profile.avatar);
      if (v.profile.banner) setBannerUrl(v.profile.banner);
    } else {
      // no profile yet: preview the wallet's real record so the card is never an empty mock-up
      try {
        const prev = (await fetch(`/bot/api/profile?wallet=${w.toLowerCase()}&preview=1`).then((r) => r.json())) as ProfileView;
        setView(prev);
      } catch { /* preview is a nicety */ }
    }
    try {
      const q = v.profile ? `handle=${v.profile.handle}` : `wallet=${w.toLowerCase()}`;
      const p = (await fetch(`/bot/api/profile/positions?${q}`).then((r) => r.json())) as { open?: Position[] };
      setOpen(p.open ?? []);
    } catch { /* positions are a bonus */ }
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
      void act(async () => {
        const r = await uploadProfileImage(me, view.profile!.handle, kind, f);
        if (kind === "avatar") setAvatarUrl(r.url); else setBannerUrl(r.url);
        return `${kind} updated (${Math.round(r.bytes / 1024)} KB)`;
      });
    } else {
      setMsg(`${kind} ready — it uploads when you create the profile`);
    }
  };

  const onSave = () => act(async () => {
    if (!me) throw new Error("unlock your trading wallet first");
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw new Error("handle: 3-20 characters, a-z 0-9 _");
    await saveProfile(me, handle, { display, bio, x_handle: xh.replace(/^@/, ""), public_positions: publicPos ? 1 : 0, feed_delay: delay });
    let extra = "";
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
      <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{exists ? "Your public profile" : "Create your public profile"}</h2>
        {exists && (
          <Link className="arc-mono" params={{ handle }} style={{ color: "var(--arc-cobalt)", fontSize: 11 }} to="/u/$handle">
            /u/{handle} →
          </Link>
        )}
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: "auto" }}>
          this is exactly what strangers will see
        </span>
      </div>

      {/* the card being built */}
      <div style={{ ...cardBox, overflow: "hidden" }}>
        <label style={{
          background: bannerUrl ? `center/cover no-repeat url(${bannerUrl})` : "linear-gradient(160deg, #1b2a4a, #0d1524)",
          cursor: "pointer", display: "block", height: 170, position: "relative",
        }} title="click to upload a banner">
          <input accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick("banner")} style={{ display: "none" }} type="file" />
          <span className="arc-mono" style={{ background: "rgba(0,0,0,0.5)", borderRadius: 8, color: "#fff", fontSize: 11, padding: "5px 10px", position: "absolute", right: 12, top: 12 }}>
            {bannerUrl ? "change banner" : "upload banner"}
          </span>
          <span style={{ bottom: -44, left: 22, position: "absolute" }}>
            <label style={{ cursor: "pointer", display: "block", position: "relative" }} title="click to upload an avatar">
              <input accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick("avatar")} style={{ display: "none" }} type="file" />
              {avatarUrl
                ? <img alt="" src={avatarUrl} style={{ background: "var(--arc-paper)", border: "3px solid var(--arc-bg, #0a0d14)", borderRadius: "50%", height: 100, objectFit: "cover", width: 100 }} />
                : <span className="arc-mono" style={{ alignItems: "center", background: "var(--arc-line)", border: "3px solid var(--arc-bg, #0a0d14)", borderRadius: "50%", color: "var(--arc-muted)", display: "flex", fontSize: 11, height: 100, justifyContent: "center", textAlign: "center", width: 100 }}>
                    upload<br />avatar
                  </span>}
            </label>
          </span>
        </label>

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
          {busy ? "signing…" : exists ? "save changes" : "create profile"}
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
