import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { Tags, useWalletLabels } from "@/components/risk";
import "../arc-site.css";

const API = "https://bot-production-4200.up.railway.app";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type XProfile = {
  handle: string; url: string; shared: boolean; launches: number; rugs: number;
  wallets: { wallet: string; verified: boolean; launches: number; rugs: number; tokens: { token: string; symbol: string | null; dumped: boolean }[] }[];
};

export const Route = createFileRoute("/x/$handle")({
  head: ({ params }) => ({ meta: [{ title: `@${params.handle} on Arc · ArcTools` }, { name: "description", content: "Which Arc deployer wallets declared this X account, what they launched and whether they dumped." }] }),
  component: XPage,
});

function XPage() {
  const { handle } = Route.useParams();
  const h = handle.replace(/^@/, "").toLowerCase();
  const [p, setP] = useState<XProfile | null | undefined>(undefined);
  const labels = useWalletLabels((p?.wallets ?? []).map((w) => w.wallet));
  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/x/${h}`).then((r) => r.json()).then((j) => alive && setP(j.error ? null : j)).catch(() => alive && setP(null));
    return () => { alive = false; };
  }, [h]);
  const th: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 11, fontWeight: 400, padding: "6px 8px", textAlign: "left" };
  const td: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 12.5, padding: "8px", verticalAlign: "top" };

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/intel" />
      <section className="arc-section" style={{ maxWidth: 980, paddingTop: 118 }}>
        <Link className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, textDecoration: "none" }} to="/intel">← Intel</Link>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
          <h1 className="arc-mono" style={{ color: "#6cc0ff", fontSize: 26, margin: 0 }}>@{h}</h1>
          {p && p.shared && <span className="arc-mono" style={{ border: "1px dashed var(--arc-muted)", borderRadius: 5, color: "var(--arc-muted)", fontSize: 11, padding: "2px 8px" }} title="Declared by 3+ unrelated deployer wallets — almost certainly a celebrity/project account being spoofed">declared by {p.wallets.length} wallets · likely spoofed</span>}
          {p && p.rugs > 0 && <span className="arc-mono" style={{ background: "rgba(240,83,79,0.18)", border: "1px solid #f0534f", borderRadius: 5, color: "#f0534f", fontSize: 11, padding: "2px 8px" }}>{p.rugs} dumped</span>}
          <span style={{ flex: 1 }} />
          <a className="arc-mono" href={`https://x.com/${h}`} rel="noreferrer" style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-ink)", fontSize: 12, padding: "6px 10px", textDecoration: "none" }} target="_blank">open on X ↗</a>
        </div>
        <p style={{ color: "var(--arc-muted)", fontSize: 13, lineHeight: 1.55, marginTop: 10, maxWidth: 720 }}>
          Every Arc deployer wallet whose token metadata points at this X account, with the outcome of each launch. <b style={{ color: "var(--arc-ink)" }}>✓ verified</b> = written on-chain by the creator on ArcToolsPad / ArcPad. <b style={{ color: "var(--arc-ink)" }}>declared</b> = a link pasted into RadarDex / other pad metadata — anyone can claim any handle, so treat it as a claim until the account itself confirms.
        </p>

        {p === undefined && <p className="arc-mono" style={{ fontSize: 13, marginTop: 20 }}>Loading…</p>}
        {p === null && <p className="arc-mono" style={{ fontSize: 13, marginTop: 20 }}>No Arc deployer has linked this X account in any token metadata we index.</p>}
        {p && p.wallets.length === 0 && <p className="arc-mono" style={{ fontSize: 13, marginTop: 20 }}>No Arc deployer has linked this X account yet.</p>}
        {p && p.wallets.length > 0 && (
          <div style={{ border: "1px solid var(--arc-line)", marginTop: 18 }}>
            <div className="arc-mono" style={{ borderBottom: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", fontSize: 11, gap: 18, letterSpacing: "0.08em", padding: "8px 10px" }}>
              <span>{p.wallets.length} WALLET{p.wallets.length === 1 ? "" : "S"}</span><span>{p.launches} LAUNCH{p.launches === 1 ? "" : "ES"}</span><span style={{ color: p.rugs ? "#f0534f" : undefined }}>{p.rugs} DUMPED</span>
            </div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>wallet</th><th style={th}>status</th><th style={th}>tokens linked to this handle</th><th style={th}>all launches</th><th style={th} /></tr></thead>
              <tbody>
                {p.wallets.map((w) => (
                  <tr key={w.wallet}>
                    <td style={td}>
                      <a className="arc-mono" href={`/insider/${w.wallet}`} style={{ color: "var(--arc-ink)", textDecoration: "none" }}>{short(w.wallet)} →</a>
                      <div style={{ marginTop: 3 }}><Tags labels={labels} max={3} wallet={w.wallet} /></div>
                    </td>
                    <td className="arc-mono" style={{ ...td, color: w.verified ? "var(--arc-up)" : "var(--arc-muted)" }}>{w.verified ? "✓ verified on-chain" : "declared"}</td>
                    <td style={td}>
                      {w.tokens.map((t) => (
                        <a key={t.token} href={`/token/${t.token}`} className="arc-mono" style={{ border: `1px solid ${t.dumped ? "#f0534f" : "var(--arc-line)"}`, borderRadius: 4, color: t.dumped ? "#f0534f" : "var(--arc-ink)", display: "inline-block", fontSize: 11.5, margin: "0 6px 4px 0", padding: "2px 7px", textDecoration: "none" }} title={t.dumped ? "deployer dumped this token" : ""}>
                          {t.symbol ?? short(t.token)}{t.dumped ? " ↓" : ""}
                        </a>
                      ))}
                    </td>
                    <td className="arc-mono" style={td}>{w.launches} · <span style={{ color: w.rugs ? "#f0534f" : "var(--arc-muted)" }}>{w.rugs} dumped</span></td>
                    <td style={td}><a className="arc-mono" href={`https://arc-scan.org/address/${w.wallet}`} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 12 }} target="_blank">explorer ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11.5, marginTop: 16 }}>
          Creator? Launch on <Link style={{ color: "var(--arc-ink)" }} to="/launchpad">ArcToolsPad</Link> or set your token's X link from its creator tools page to get the on-chain ✓ next to your wallet everywhere on ArcTools.
        </p>
      </section>
    </main>
  );
}
