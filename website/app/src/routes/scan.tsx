import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { scanToken, type ScanReport } from "@/lib/arc-api";
import "../arc-site.css";

export const Route = createFileRoute("/scan")({
  validateSearch: (s: Record<string, unknown>): { ca?: string } =>
    typeof s.ca === "string" ? { ca: s.ca } : {},
  head: () => ({
    meta: [
      { title: "Arc token scanner: the first rug check on Arc" },
      {
        name: "description",
        content:
          "Paste a contract address and get the safety read: renounce, mint, pause, V3 pool liquidity, price and ticker clones.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: ScanPage,
});

function Row({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const color = good === true ? "var(--arc-cobalt)" : good === false ? "var(--arc-error)" : "var(--arc-ink)";
  return (
    <div
      style={{
        borderBottom: "1px solid var(--arc-line)",
        display: "flex",
        gap: 16,
        justifyContent: "space-between",
        padding: "12px 0",
      }}
    >
      <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, textTransform: "uppercase" }}>
        {label}
      </span>
      <span className="arc-mono" style={{ color, fontSize: 13, textAlign: "right", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

function ScanPage() {
  const { ca: caParam } = Route.useSearch();
  const [ca, setCa] = useState(caParam ?? "");
  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (address: string) => {
    if (!address) return;
    setBusy(true);
    setError(null);
    setReport(null);
    const res = await scanToken({ data: { token: address } });
    setBusy(false);
    if ("error" in res) setError(res.error);
    else setReport(res);
  };

  useEffect(() => {
    if (caParam) void run(caParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caParam]);

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/scan" />
      <section className="arc-section" style={{ maxWidth: 760, paddingTop: 130 }}>
        <p className="arc-eyebrow">Rug check</p>
        <h1 className="arc-h2">Scan before you fire</h1>
        <p className="arc-body">
          The safety read for any Arc token: ownership, mint and pause levers in the bytecode, the USDC pool and its
          real liquidity, spot price, and how many tokens share the same ticker.
        </p>

        <div style={{ display: "flex", gap: 12, margin: "26px 0" }}>
          <input
            className="arc-mono"
            onChange={(e) => setCa(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run(ca)}
            placeholder="0x… token contract address"
            style={{ background: "transparent", border: "1px solid var(--arc-line)", flex: 1, fontSize: 14, padding: "12px 14px" }}
            value={ca}
          />
          <button
            className="arc-cta"
            disabled={busy}
            onClick={() => void run(ca)}
            style={{ border: "none", cursor: busy ? "wait" : "pointer" }}
            type="button"
          >
            {busy ? "Scanning..." : "Scan"}
          </button>
        </div>

        {error && (
          <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 13 }}>
            {error}
          </p>
        )}

        {report && (
          <div style={{ border: "1px solid var(--arc-line)", padding: 24 }}>
            <h2 style={{ fontSize: 24, margin: "0 0 4px" }}>
              {report.name} <span className="arc-mono" style={{ fontSize: 15 }}>({report.symbol})</span>
            </h2>
            <Row good={report.renounced} label="Ownership" value={report.renounced ? "renounced / no owner" : `owner: ${report.owner}`} />
            <Row good={!report.mintable} label="Mint function" value={report.mintable ? "present in bytecode" : "not found"} />
            <Row good={!report.pausable} label="Pause function" value={report.pausable ? "present in bytecode" : "not found"} />
            <Row good={report.pool !== null} label="USDC V3 pool" value={report.pool ?? "none found (curve-stage token?)"} />
            <Row
              good={report.liquidityUsdc === null ? null : report.liquidityUsdc > 1000}
              label="Pool USDC liquidity"
              value={report.liquidityUsdc === null ? "n/a" : `${report.liquidityUsdc.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`}
            />
            <Row label="Price (1M tokens)" value={report.price1m === null ? "no quote" : `${report.price1m.toFixed(4)} USDC`} />
            <Row label="Total supply" value={Number(report.totalSupply).toLocaleString()} />
            <Row
              good={report.clones <= 1}
              label="Ticker clones"
              value={report.clones <= 1 ? "unique on RadarDex list" : `${report.clones} tokens share this ticker`}
            />
            <Row good={report.radarBadge ? true : null} label="RadarDex launch" value={report.radarBadge ? "yes (locked LP model)" : "not on the RadarDex list"} />
            <div style={{ display: "flex", gap: 16, marginTop: 18 }}>
              <a
                className="arc-link-tick"
                href={`https://t.me/ArcSniper_bot?start=ca_${ca.trim().slice(2)}`}
                rel="noreferrer"
                target="_blank"
              >
                Snipe it
              </a>
              <a className="arc-link-dotted" href={`https://arc-scan.org/address/${ca.trim()}`} rel="noreferrer" target="_blank">
                arc-scan
              </a>
            </div>
            <p className="arc-body" style={{ fontSize: 13, marginTop: 16 }}>
              A clean read is not a guarantee. Locked liquidity removes the classic rug, not market risk.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
