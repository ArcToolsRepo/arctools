import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { getToasts, useStore, getToken, getTrend, getHot, getRisk, isWatched, getLogo, getPrefs } from "../lib/store";
import { usd, pct, ago, short } from "../lib/fmt";
import { go } from "../lib/router";
import { openUrl } from "../lib/native";

// ---- icons: thin-stroke, 22px, currentColor ----
const I = (d: string) => (p: { className?: string; style?: React.CSSProperties }) => (
  <svg className={p.className} style={p.style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const Icon = {
  fire: I("M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 1-3s0 3 2 3 1-6 2-10z"),
  star: I("M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"),
  swap: I("M7 4v13m0 0l-3-3m3 3l3-3M17 20V7m0 0l3 3m-3-3l-3 3"),
  wallet: I("M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0V6a2 2 0 0 1 2-2h11M16 14h.5"),
  more: I("M4 6h16M4 12h16M4 18h16"),
  search: I("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4-4"),
  back: I("M15 5l-7 7 7 7"),
  chev: I("M9 5l7 7-7 7"),
  send: I("M22 2L11 13M22 2l-7 20-4-9-9-4z"),
  receive: I("M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"),
  copy: I("M8 8h12v12H8zM4 16V4h12"),
  qr: I("M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h3v3h-3zm4 4h3v3h-3z"),
  lock: I("M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z"),
  key: I("M14 3a7 7 0 1 0 1.7 13.8L21 12l-2-2-2 2-2-2 1-1a7 7 0 0 0-2-6z"),
  shield: I("M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"),
  bell: I("M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"),
  users: I("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm11 10v-2a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8"),
  rocket: I("M5 15c-1 3-1 5-1 5s2 0 5-1m-4-4l9-9c2-2 6-2 6-2s0 4-2 6l-9 9zm5-1l-4-4"),
  link: I("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  gift: I("M20 12v9H4v-9m-1-5h18v5H3zm9 0v14m0-14c-2-3-5-3-5-1s5 1 5 1zm0 0c2-3 5-3 5-1s-5 1-5 1z"),
  bridge: I("M2 12h20M4 12v6M20 12v6M7 12V8a5 5 0 0 1 10 0v4"),
  flame: I("M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 1-3s0 3 2 3 1-6 2-10z"),
  user: I("M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"),
  gear: I("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8-3l-2 1 .3 2.2-2 .8-1.5-1.6-2.2.6-.6 2H11l-.6-2-2.2-.6L6.7 16l-2-.8L5 13l-2-1 2-1-.3-2.2 2-.8 1.5 1.6 2.2-.6.6-2H13l.6 2 2.2.6 1.5-1.6 2 .8L19 11z"),
  check: I("M5 12l5 5L20 7"),
  x: I("M6 6l12 12M18 6L6 18"),
  refresh: I("M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"),
  external: I("M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"),
  eye: I("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"),
  bolt: I("M13 2L4 14h7l-1 8 9-12h-7z"),
  chart: I("M4 20V10m6 10V4m6 16v-7m6 7V8"),
};

export function Logo({ ca, size = 44, src }: { ca: string; size?: number; src?: string | null }) {
  const t = getToken(ca); const tr = getTrend(ca) ?? getHot(ca);
  const sym = (t?.symbol || tr?.symbol || "?").toUpperCase();
  const [err, setErr] = useState(false);
  return (
    <div className="logo" style={{ width: size, height: size, fontSize: size * 0.32 }}>
      {(src || getLogo(ca)) && !err ? <img alt="" src={(src || getLogo(ca))!} onError={() => setErr(true)} loading="lazy" /> : sym.slice(0, 2)}
    </div>
  );
}

/** the row: logo · name/age/pad · MC/change · buy */
export function TokenRow({ ca, onBuy, onQuick, showRisk = true }: { ca: string; onBuy?: (ca: string) => void; onQuick?: (ca: string) => void; showRisk?: boolean }) {
  const press = useRef<number>(0);
  const t = getToken(ca); const tr = getHot(ca) ?? getTrend(ca); const rk = showRisk ? getRisk(ca) : undefined;
  const sym = t?.symbol || tr?.symbol || short(ca);
  const name = t?.name && t.name !== sym ? t.name : "";
  const mcap = tr?.mcap ?? t?.mcapUsd ?? null;
  const born = t?.createdAt ? Date.parse(t.createdAt) / 1000 : tr?.first_ts ?? null;
  const devNet = rk?.dev_net_usd ?? ((rk?.dev_sold_usd ?? 0) - (rk?.dev_bought_usd ?? 0));
  return (
    <div className="row" onClick={() => go(`/token/${ca}`)}>
      <Logo ca={ca} />
      <div className="row-main">
        <div className="row-name"><b>{sym}</b>{name && <span>{name}</span>}</div>
        <div className="row-sub">
          <span className="age">{ago(born)}</span>
          {t?.pad && <span>{t.pad}</span>}
          {tr && <span className="num">{tr.traders} 👥</span>}
          {rk?.dev_pct != null && rk.dev_pct >= 5 && <span className="dev">dev {rk.dev_pct.toFixed(0)}%</span>}
          {devNet > 50 && <span className="dev">DEV −{usd(devNet)}</span>}
          {isWatched(ca) && <span style={{ color: "var(--amber)" }}>★</span>}
        </div>
      </div>
      <div className="row-right">
        <div className="row-mc">{usd(mcap)}</div>
        <div className={`row-chg ${tr?.chg != null ? (tr.chg >= 0 ? "up" : "down") : "muted"}`}>{pct(tr?.chg)}</div>
        {onBuy && (
          <button className="buy" title="tap: quick buy · hold: choose amount"
            onPointerDown={(e) => { e.stopPropagation(); press.current = Date.now(); }}
            onPointerUp={(e) => { e.stopPropagation(); const held = Date.now() - press.current; press.current = 0; if (held > 450 || !onQuick) onBuy(ca); else onQuick(ca); }}
            onClick={(e) => e.stopPropagation()}>
            <Icon.bolt className="" />{onQuick && <span style={{ fontSize: 10, marginLeft: 3 }}>{getPrefs().quickBuy}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const ts = useStore(getToasts);
  return (
    <div className="toasts">
      {ts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
          {t.tx && <button onClick={() => openUrl(`https://arc-scan.org/tx/${t.tx}`)} className="mono" style={{ display: "block", color: "var(--cobalt)", fontSize: 11, marginTop: 4 }}>{short(t.tx, 8)} ↗</button>}
        </div>
      ))}
    </div>
  );
}

export const BRAND = "ArcOne";

export function Header({ title, back, right }: { title: string; back?: boolean; right?: ReactNode }) {
  return (
    <div className="top">
      <div className="top-row">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {back && <button className="icon-btn" onClick={() => history.back()}><Icon.back className="" /></button>}
          {title === BRAND ? <div className="brand"><h1>{BRAND}</h1><span>powered by ArcTools</span></div> : <h1>{title}</h1>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>{right}</div>
      </div>
    </div>
  );
}

export function Skeleton({ n = 8 }: { n?: number }) {
  return <>{Array.from({ length: n }).map((_, i) => (
    <div key={i} className="row"><div className="skeleton" style={{ width: 44, height: 44, borderRadius: 12 }} />
      <div><div className="skeleton" style={{ width: 120, height: 14 }} /><div className="skeleton" style={{ width: 80, height: 10, marginTop: 8 }} /></div>
      <div className="skeleton" style={{ width: 60, height: 28 }} /></div>
  ))}</>;
}
