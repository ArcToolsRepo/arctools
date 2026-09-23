import { createFileRoute } from "@tanstack/react-router";

import { ArcNav } from "@/components/arc-nav";
import { MarketContent } from "@/components/market-content";
import "../arc-site.css";

export const Route = createFileRoute("/market_/gig/$id")({
  head: () => ({ meta: [
    { title: "ArcTools Market: hire for your token with USDC escrow on Arc" },
    { name: "description", content: "Logos, websites, Telegram setups, KOL posts and contract reviews for Arc token teams. USDC held in escrow until you accept the delivery; disputes split by ArcTools; on-chain reviews. 2% fee to ARCT buyback." },
  ] }),
  component: () => {
    const { id } = Route.useParams();
    return (
      <main className="arc-site" style={{ minHeight: "100dvh" }}>
        <ArcNav active="/market" />
        <section className="arc-section" style={{ maxWidth: 1240, paddingTop: 112 }}><MarketContent initial={{ kind: "gig", id: Number(id) }} /></section>
      </main>
    );
  },
});
