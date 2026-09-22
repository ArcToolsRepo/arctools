import { createFileRoute } from "@tanstack/react-router";

import { DsRail } from "@/components/ds-rail";
import { PredictContent } from "@/components/predict-content";
import "../arc-site.css";

export const Route = createFileRoute("/predict2")({
  head: () => ({ meta: [
    { title: "ArcPredict: up or down in two minutes, paid in USDC on Arc" },
    { name: "description", content: "BTC, ETH and SOL up/down rounds every two minutes on Arc. Parimutuel pools in USDC, 3% fee to ARCT buyback, prices posted on-chain from four exchanges and auditable per round." },
  ] }),
  component: () => (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1240, paddingTop: 112 }}><PredictContent v2 /></section>
    </main>
  ),
});
