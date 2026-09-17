/**
 * Profile editor, shown on /profile.
 *
 * The wallet signs every change, so the server never has to trust this form. The preview at the top is not
 * decoration: attaching a wallet to a public handle is irreversible in practice (the chain remembers), so the
 * user should see what strangers will see before they press save.
 */
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { hotAddress, isUnlocked } from "@/lib/arc-hotwallet";
import {
  type ProfileView, addWallet, finishXVerify, getProfileByWallet, removeWallet, saveProfile, startXVerify,
} from "@/lib/arc-profile";

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
    <section style={{ border: "1px solid var(--arc-line)", borderRadius: 12, marginTop: 12, overflow: "hidden" }}>
      <h2 style={{ borderBottom: "1px solid var(--arc-line)", fontSize: 15, margin: 0, padding: "12px 16px" }}>Traders you follow</h2>
      {rows.map((r, i) => (
        <div key={`${r.ts}-${i}`} style={{ alignItems: "center", borderTop: i ? "1px solid var(--arc-line)" : "none", display: "flex", gap: 10, padding: "8px 16px" }}>
          <a className="arc-mono" href={`/u/${r.handle}`} style={{ color: "var(--arc-cobalt)", fontSize: 11, textDecoration: "none", width: 96 }}>@{r.handle}</a>
          <span className="arc-mono" style={{ color: r.side === "buy" ? "var(--arc-up)" : "var(--arc-down, #f0534f)", fontSize: 11, width: 32 }}>{r.side.toUpperCase()}</span>
          {r.logo ? <img alt="" src={r.logo} style={{ borderRadius: "50%", height: 16, width: 16 }} /> : null}
          <a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)", fontSize: 12, textDecoration: "none" }}>{r.symbol || `${r.token.slice(0, 6)}…`}</a>
          <span className="arc-mono" style={{ fontSize: 11, marginLeft: "auto" }}>${r.usdc < 100 ? r.usdc.toFixed(2) : Math.round(r.usdc).toLocaleString()}</span>
        </div>
      ))}
    </section>
  );
}

export function ProfileEditor() {
  const [me, setMe] = useState<string | null>(null);
  const [view, setView] = useState<ProfileView | null>(null);
  const [handle, setHandle] = useState("");
  const [display, setDisplay] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [xh, setXh] = useState("");
  const [publicPos, setPublicPos] = useState(false);
  const [delay, setDelay] = useState(60);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const w = hotAddress();
    setMe(w);
    if (!w) return;
    const v = await getProfileByWallet(w);
    setView(v);
    if (v.profile) {
      setHandle(v.profile.handle);
      setDisplay(v.profile.display ?? "");
      setBio(v.profile.bio ?? "");
      setAvatar(v.profile.avatar ?? "");
      setXh(v.profile.x_handle ?? "");
      setPublicPos(!!v.profile.public_positions);
      setDelay(v.profile.feed_delay ?? 60);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg("");
    try { setMsg(await fn()); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  };

  const onSave = () => act(async () => {
    if (!me) throw new Error("unlock your trading wallet first");
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw new Error("handle: 3-20 chars, a-z 0-9 _");
    await saveProfile(me, handle, { display, bio, avatar, x_handle: xh.replace(/^@/, ""), public_positions: publicPos ? 1 : 0, feed_delay: delay });
    return `saved — your profile is live at /u/${handle}`;
  });

  const onAddWallet = () => act(async () => {
    if (!me) throw new Error("unlock a wallet first");
    await addWallet(me, handle);
    return `wallet ${me.slice(0, 6)}… attached to @${handle}`;
  });

  const onRemoveWallet = (w: string) => act(async () => {
    await removeWallet(w, handle);
    return `wallet ${w.slice(0, 6)}… detached`;
  });

  const onXStart = () => act(async () => {
    if (!me) throw new Error("unlock your wallet first");
    const r = await startXVerify(me, handle);
    setCode(r.code);
    return `post this on @${xh}: "${r.post}" then press verify`;
  });

  const onXVerify = () => act(async () => {
    if (!me) throw new Error("unlock your wallet first");
    const r = await finishXVerify(me, handle);
    if (!r.ok) throw new Error(r.error || "code not found in your recent posts");
    return `@${r.verified} verified`;
  });

  const lbl: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" };
  const inp: React.CSSProperties = {
    background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)",
    fontSize: 13, padding: "8px 10px", width: "100%",
  };

  if (!me && !isUnlocked()) {
    return (
      <section style={{ border: "1px solid var(--arc-line)", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Public profile</h2>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>
          Unlock your trading wallet to create one. The wallet signs the profile, which is what proves the record is yours.
        </p>
      </section>
    );
  }

  return (
    <section style={{ border: "1px solid var(--arc-line)", borderRadius: 12, display: "grid", gap: 12, padding: 16 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Public profile</h2>
        {view?.profile && (
          <Link className="arc-mono" params={{ handle: view.profile.handle }} style={{ color: "var(--arc-cobalt)", fontSize: 11 }} to="/u/$handle">
            /u/{view.profile.handle} →
          </Link>
        )}
      </div>

      <p className="arc-mono" style={{ background: "rgba(240,83,79,0.08)", border: "1px solid rgba(240,83,79,0.3)", borderRadius: 8, color: "var(--arc-muted)", fontSize: 11, margin: 0, padding: "8px 10px" }}>
        What a stranger will see: every trade these wallets ever made, their PnL, and the tokens they hold.
        The chain keeps that forever — detaching a wallet later hides it here, not on the chain.
      </p>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>handle</span>
          <input disabled={!!view?.profile} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="satoshi_arc" style={inp} value={handle} />
        </label>
        <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>display name</span>
          <input onChange={(e) => setDisplay(e.target.value)} placeholder="Satoshi" style={inp} value={display} />
        </label>
        <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>avatar url</span>
          <input onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" style={inp} value={avatar} />
        </label>
        <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>X handle</span>
          <input onChange={(e) => setXh(e.target.value)} placeholder="@yourhandle" style={inp} value={xh} />
        </label>
      </div>

      <label style={{ display: "grid", gap: 4 }}><span className="arc-mono" style={lbl}>bio</span>
        <textarea onChange={(e) => setBio(e.target.value.slice(0, 280))} rows={2} style={{ ...inp, resize: "vertical" }} value={bio} />
      </label>

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 16 }}>
        <label className="arc-mono" style={{ alignItems: "center", display: "flex", fontSize: 12, gap: 6 }}>
          <input checked={publicPos} onChange={(e) => setPublicPos(e.target.checked)} type="checkbox" />
          show my open positions publicly
        </label>
        <label className="arc-mono" style={{ alignItems: "center", display: "flex", fontSize: 12, gap: 6 }}>
          feed delay
          <select onChange={(e) => setDelay(Number(e.target.value))} style={{ ...inp, padding: "4px 8px", width: "auto" }} value={delay}>
            <option value={0}>instant</option>
            <option value={60}>60 s</option>
            <option value={300}>5 min</option>
            <option value={900}>15 min</option>
          </select>
          <span style={{ color: "var(--arc-muted)" }}>protects you from being front-run by your own followers</span>
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="arc-mono" disabled={busy} onClick={onSave}
          style={{ background: "var(--arc-cobalt)", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 12, padding: "8px 16px" }} type="button">
          {busy ? "signing…" : view?.profile ? "save changes" : "create profile"}
        </button>
        {view?.profile && (
          <>
            <button className="arc-mono" disabled={busy} onClick={onAddWallet}
              style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "8px 16px" }} type="button">
              attach this wallet
            </button>
            <button className="arc-mono" disabled={busy || !xh} onClick={onXStart}
              style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "8px 16px" }} type="button">
              get X code
            </button>
            {code && (
              <button className="arc-mono" disabled={busy} onClick={onXVerify}
                style={{ background: "var(--arc-up)", border: "none", borderRadius: 8, color: "#04140a", cursor: "pointer", fontSize: 12, padding: "8px 16px" }} type="button">
                verify X
              </button>
            )}
          </>
        )}
      </div>

      {msg && <p className="arc-mono" style={{ color: "var(--arc-up)", fontSize: 12, margin: 0, wordBreak: "break-word" }}>{msg}</p>}

      {!!(view?.stats?.wallets ?? []).length && (
        <div style={{ display: "grid", gap: 6 }}>
          <span className="arc-mono" style={lbl}>attached wallets</span>
          {(view?.stats?.wallets ?? []).map((w) => (
            <div className="arc-mono" key={w} style={{ alignItems: "center", display: "flex", fontSize: 11, gap: 8 }}>
              <span>{w}</span>
              <button className="arc-mono" disabled={busy} onClick={() => onRemoveWallet(w)}
                style={{ background: "transparent", border: "none", color: "var(--arc-down, #f0534f)", cursor: "pointer", fontSize: 11 }} type="button">
                detach
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
