import { useEffect, useState } from "react";

/** Token Score / rug database / wallet labels — read from the ArcTools risk engine (buybot). */
const API = "https://bot-production-4200.up.railway.app";

export type Risk = {
  holders: number; top10: number | null; top1: number | null; dev: string | null; dev_pct: number | null; bundle_pct: number | null; bundlers: number;
  bundle_wallets?: string[]; dev_rugs?: number; dev_launches?: number; dev_sold_usd?: number; dev_sells?: number; dev_last_sell?: number | null;
  bundle_sold_usd?: number; bundle_sells?: number; bundle_last_sell?: number | null; bundle_sellers?: number; lookalike?: boolean; score?: number; grade?: "A" | "B" | "C" | "D"; flags?: string[];
};
export type DevHistory = { dev: string; launches: number; rugs: number; tokens: { token: string; symbol: string | null; dev_sold_usd: number; drawdown: number | null; dumped: boolean; first_ts: number; swaps: number }[] };
export type Label = { kind: "insider" | "dev" | "ruger" | "fresh" | "whale" | "bundle" | "bot"; text: string };

export const gradeColor = (g?: string | null) => (g === "A" ? "var(--arc-up)" : g === "B" ? "#7cc4ff" : g === "C" ? "#f5c542" : g === "D" ? "#f0534f" : "var(--arc-muted)");
const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);

/** Compact score pill for table rows. */
export function ScoreBadge({ risk, size = 12 }: { risk?: Risk | null; size?: number }) {
  if (!risk || risk.score == null) return <span style={{ color: "var(--arc-muted)" }}>…</span>;
  const c = gradeColor(risk.grade);
  const title = (risk.flags?.length ? risk.flags.join(" · ") : "no red flags") + `\nscore ${risk.score}/100 · grade ${risk.grade}`;
  return (
    <span className="arc-mono" style={{ alignItems: "center", background: `${c}22`, border: `1px solid ${c}`, borderRadius: 5, color: c, display: "inline-flex", fontSize: size, fontWeight: 700, gap: 4, lineHeight: 1, padding: "3px 6px", whiteSpace: "nowrap" }} title={title}>
      {risk.grade} <span style={{ fontWeight: 500, opacity: 0.9 }}>{risk.score}</span>
      {(risk.dev_rugs ?? 0) > 0 && <span title={`deployer dumped ${risk.dev_rugs} token(s) before`}>☠</span>}
    </span>
  );
}

/** Full risk read-out for the token page. */
/** long.supply wrapped stock: a Token Score makes no sense (supply = what the team minted); show what the risk actually is. */
export function StockCard({ stock, token }: { stock: { symbol: string; usd: number; vault: string; underlying: string }; token: string }) {
  return (
    <section style={{ border: "1px solid #7cc4ff", marginTop: 14, padding: 14 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
        <div className="arc-mono" style={{ background: "rgba(124,196,255,0.14)", border: "2px solid #7cc4ff", borderRadius: 10, color: "#7cc4ff", fontSize: 18, fontWeight: 800, lineHeight: 1, padding: "12px 10px" }}>IOU</div>
        <div style={{ flex: 1 }}>
          <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em" }}>WRAPPED STOCK · long.supply</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Custodial claim on the Robinhood-Chain <b>{stock.symbol}</b> token held in long.supply’s vault. Not a share, no shareholder rights. Reference price ${stock.usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}.</div>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", fontSize: 12, marginTop: 10, paddingTop: 8 }}>
        <div>Risk = trust in one team’s wallets (mint / redeem / vault are manual) + Robinhood pausing or upgrading the underlying. No audit, no on-chain proof of reserves beyond their keeper’s self-report.</div>
        <div className="arc-mono" style={{ fontSize: 11, marginTop: 6 }}>
          vault (Robinhood Chain) <span style={{ color: "var(--arc-ink)" }}>{stock.vault.slice(0, 10)}…{stock.vault.slice(-4)}</span> · underlying <span style={{ color: "var(--arc-ink)" }}>{stock.underlying.slice(0, 10)}…{stock.underlying.slice(-4)}</span>
          {" · "}<a href="https://long.supply/bridge" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">bridge / redeem ↗</a>
          {" · "}<a href={`https://arc-scan.org/token/${token}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">holders ↗</a>
        </div>
      </div>
    </section>
  );
}

export function RiskCard({ token, official = false }: { token: string; official?: boolean }) {
  const [risk, setRisk] = useState<Risk | null>(null);
  const [hist, setHist] = useState<DevHistory | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API}/api/holder-risk?tokens=${token.toLowerCase()}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const k = j.risk?.[token.toLowerCase()] as Risk | undefined;
      if (k) { setRisk(k); if (k.dev) void fetch(`${API}/api/dev-history?dev=${k.dev}`).then((r) => r.json()).then((h) => alive && setHist(h)).catch(() => null); }
      else setErr(true);
    }).catch(() => alive && setErr(true));
    void load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);
  const c = gradeColor(risk?.grade);
  const Row = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => (
    <div style={{ display: "flex", fontSize: 12, justifyContent: "space-between", padding: "3px 0" }}>
      <span style={{ color: "var(--arc-muted)" }}>{k}</span><span className="arc-mono" style={{ color: warn ? "#f0534f" : "var(--arc-ink)" }}>{v}</span>
    </div>
  );
  return (
    <section style={{ border: `1px solid ${risk ? c : "var(--arc-line)"}`, marginTop: 14, padding: 14 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
        <div className="arc-mono" style={{ background: `${c}22`, border: `2px solid ${c}`, borderRadius: 10, color: c, fontSize: 22, fontWeight: 800, lineHeight: 1, padding: "10px 12px", textAlign: "center" }}>
          {risk?.grade ?? "…"}<div style={{ fontSize: 11, fontWeight: 500, marginTop: 3 }}>{risk?.score ?? "—"}/100</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em" }}>TOKEN SCORE</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {err ? "risk engine unavailable" : !risk ? "reading dev, bundle, holders, rug history…" : risk.flags?.length ? risk.flags.join(" · ") : official ? "official ArcTools token" : "no red flags found"}
          </div>
        </div>
      </div>
      {risk && (
        <div style={{ borderTop: "1px solid var(--arc-line)", marginTop: 10, paddingTop: 8 }}>
          <Row k="deployer holds" v={risk.dev_pct == null ? "—" : `${risk.dev_pct.toFixed(risk.dev_pct < 1 ? 1 : 0)}%`} warn={(risk.dev_pct ?? 0) > 15} />
          <Row k={`bundle (${risk.bundlers} launch-block wallets)`} v={risk.bundle_pct == null ? "—" : `${risk.bundle_pct.toFixed(risk.bundle_pct < 1 ? 1 : 0)}%`} warn={(risk.bundle_pct ?? 0) > 25} />
          <Row k="top-10 holders (LP/vaults excluded)" v={risk.top10 == null ? "—" : `${risk.top10.toFixed(0)}%`} warn={!official && (risk.top10 ?? 0) > 60} />
          <Row k="dev sold · 24h" v={risk.dev_sold_usd ? `${usd(risk.dev_sold_usd)} (${risk.dev_sells}×)` : "nothing"} warn={!!risk.dev_sold_usd} />
          <Row k="bundle sold · 24h" v={risk.bundle_sold_usd ? `${usd(risk.bundle_sold_usd)} by ${risk.bundle_sellers}` : "nothing"} warn={!!risk.bundle_sold_usd} />
          <Row k="deployer history" v={hist ? `${hist.launches} launch${hist.launches === 1 ? "" : "es"} · ${hist.rugs} dumped` : risk.dev ? "…" : "unknown deployer"} warn={(risk.dev_rugs ?? 0) > 0} />
          {risk.dev && (
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 4 }}>
              deployer <a href={`https://arc-scan.org/address/${risk.dev}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{risk.dev.slice(0, 8)}…{risk.dev.slice(-4)}</a>
              {" · "}<a href={`/wallets?add=${risk.dev}`} style={{ color: "var(--arc-cobalt)" }}>watch</a>
            </div>
          )}
          {hist && hist.tokens.filter((t) => t.dumped).length > 0 && (
            <div style={{ background: "rgba(240,83,79,0.08)", border: "1px solid #f0534f", borderRadius: 6, fontSize: 12, marginTop: 8, padding: "6px 8px" }}>
              <b style={{ color: "#f0534f" }}>☠ this deployer dumped before:</b>{" "}
              {hist.tokens.filter((t) => t.dumped).slice(0, 4).map((t) => (
                <a key={t.token} href={`/token/${t.token}`} style={{ color: "var(--arc-ink)", marginRight: 8 }}>{t.symbol ?? t.token.slice(0, 8)} <span className="arc-mono" style={{ color: "var(--arc-muted)" }}>(took {usd(t.dev_sold_usd)}{t.drawdown != null ? `, −${((1 - t.drawdown) * 100).toFixed(0)}% from peak` : ""})</span></a>
              ))}
            </div>
          )}
          <div style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 8 }}>
            Score = 100 − penalties for deployer share, bundle share, whale concentration, dev / bundle selling, the deployer’s rug history and holder count. Refreshes every minute; the sniper bot reads the same number for auto-snipe rules and the dump guard.
          </div>
        </div>
      )}
    </section>
  );
}

const TAG_STYLE: Record<Label["kind"], { bg: string; fg: string }> = {
  insider: { bg: "rgba(46,124,255,0.18)", fg: "var(--arc-cobalt)" }, dev: { bg: "rgba(245,197,66,0.16)", fg: "#f5c542" }, ruger: { bg: "rgba(240,83,79,0.18)", fg: "#f0534f" },
  fresh: { bg: "rgba(255,255,255,0.08)", fg: "var(--arc-muted)" }, whale: { bg: "rgba(34,197,128,0.14)", fg: "var(--arc-up)" }, bundle: { bg: "rgba(240,83,79,0.12)", fg: "#f0534f" }, bot: { bg: "rgba(255,255,255,0.08)", fg: "var(--arc-muted)" },
};

export function Tag({ l, wallet }: { l: Label; wallet?: string }) {
  const s = TAG_STYLE[l.kind] ?? TAG_STYLE.fresh;
  const el = <span className="arc-mono" style={{ background: s.bg, border: `1px solid ${s.fg}`, borderRadius: 4, color: s.fg, fontSize: 9.5, lineHeight: 1, marginLeft: 5, padding: "2px 5px", whiteSpace: "nowrap" }}>{l.text}</span>;
  return l.kind === "insider" && wallet ? <a href={`/insider/${wallet}`} style={{ textDecoration: "none" }} title="Insider profile">{el}</a> : el;
}

/** Batch label loader: pass all wallets visible; render <Tags wallet=…/> per row. */
export function useWalletLabels(wallets: string[], token?: string): Record<string, Label[]> {
  const [labels, setLabels] = useState<Record<string, Label[]>>({});
  const key = [...new Set(wallets.map((w) => w.toLowerCase()))].filter((w) => !(w in labels)).slice(0, 80).join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetch(`${API}/api/wallet-labels?wallets=${key}${token ? `&token=${token.toLowerCase()}` : ""}`).then((r) => r.json()).then((j) => { if (alive) setLabels((o) => ({ ...o, ...(j.labels ?? {}) })); }).catch(() => null);
    return () => { alive = false; };
  }, [key, token]);
  return labels;
}

export function Tags({ labels, wallet, max = 2 }: { labels: Record<string, Label[]>; wallet: string; max?: number }) {
  const ls = labels[wallet.toLowerCase()];
  if (!ls?.length) return null;
  return <>{ls.slice(0, max).map((l, i) => <Tag key={i} l={l} wallet={wallet} />)}</>;
}
