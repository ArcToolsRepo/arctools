import { createFileRoute } from "@tanstack/react-router";

import { ArcNav } from "@/components/arc-nav";
import { PerpsContent } from "@/components/perps-content";
import "../arc-site.css";

export const Route = createFileRoute("/perps")({
  head: () => ({ meta: [
    { title: "ArcPerps: 24/7 leverage on tokenized stocks and Arc tokens, up to 3x, in USDC" },
    { name: "description", content: "Long or short NVDA, TSLA, CRCL, ARGUS, TOLLY and more with up to 3x leverage, 24/7, settled in native USDC on Arc. Peer-to-pool with a fee-funded insurance fund, hourly funding, 0.1 % fees to the ARCT buyback." },
  ] }),
  component: () => (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/perps" />
      <section className="arc-section" style={{ maxWidth: 1400, paddingTop: 112 }}>
        <h1 className="arc-h1" style={{ marginBottom: 4 }}>ArcPerps</h1>
        <p className="arc-body" style={{ color: "var(--arc-muted)", marginBottom: 12 }}>24/7 leverage up to 3x on tokenized stocks and the deepest Arc tokens. Settled in USDC, peer-to-pool, funding hourly. v1: market orders.</p>
        <PerpsContent />
      </section>
    </main>
  ),
});
