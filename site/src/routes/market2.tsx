import { createFileRoute } from "@tanstack/react-router";

import { DsRail } from "@/components/ds-rail";
import { MarketContent } from "@/components/market-content";
import "../arc-site.css";

export const Route = createFileRoute("/market2")({
  head: () => ({ meta: [
    { title: "ArcTools Market: hire for your token with USDC escrow on Arc" },
    { name: "description", content: "Logos, websites, Telegram setups, KOL posts and contract reviews for Arc token teams. USDC held in escrow until you accept the delivery; disputes split by ArcTools; on-chain reviews. 2% fee to ARCT buyback." },
  ] }),
  component: () => (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1240, paddingTop: 112 }}><MarketContent v2 /></section>
    </main>
  ),
});
