import { createFileRoute } from "@tanstack/react-router";

import { ArcNav } from "@/components/arc-nav";
import { BuyContent } from "@/components/buy-content";
import "../arc-site.css";

export const Route = createFileRoute("/buy")({
  head: () => ({ meta: [
    { title: "Buy ARCT with a card: USDC on Arc via MoonPay, then one-click swap" },
    { name: "description", content: "Buy USDC with a card, Apple Pay or Google Pay, delivered natively on Arc to your own wallet, then swap it to ARCT in one click. 0.5% swap fee to ARCT buyback." },
  ] }),
  component: () => (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/buy" />
      <section className="arc-section" style={{ maxWidth: 1100, paddingTop: 112 }}><BuyContent /></section>
    </main>
  ),
});
