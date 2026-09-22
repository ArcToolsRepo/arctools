import { createFileRoute } from "@tanstack/react-router";

import { BuyContent } from "@/components/buy-content";
import { DsRail } from "@/components/ds-rail";
import "../arc-site.css";

export const Route = createFileRoute("/buy2")({
  head: () => ({ meta: [
    { title: "Buy ARCT with a card: USDC on Arc via MoonPay, then one-click swap" },
    { name: "description", content: "Buy USDC with a card, Apple Pay or Google Pay, delivered natively on Arc to your own wallet, then swap it to ARCT in one click. 0.5% swap fee to ARCT buyback." },
  ] }),
  component: () => (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1100, paddingTop: 112 }}><BuyContent v2 /></section>
    </main>
  ),
});
