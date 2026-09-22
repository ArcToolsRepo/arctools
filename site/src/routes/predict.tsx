import { createFileRoute } from "@tanstack/react-router";

import { ArcNav } from "@/components/arc-nav";
import { PredictContent } from "@/components/predict-content";
import "../arc-site.css";

export const Route = createFileRoute("/predict")({
  head: () => ({ meta: [
    { title: "ArcPredict: up or down in two minutes, paid in USDC on Arc" },
    { name: "description", content: "BTC, ETH and SOL up/down rounds every two minutes on Arc. Parimutuel pools in USDC, 3% fee to ARCT buyback, prices posted on-chain from four exchanges and auditable per round." },
  ] }),
  component: () => (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/predict" />
      <section className="arc-section" style={{ maxWidth: 1240, paddingTop: 112 }}><PredictContent /></section>
    </main>
  ),
});
