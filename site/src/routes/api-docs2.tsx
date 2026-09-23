import { createFileRoute } from "@tanstack/react-router";

import { ApiDocsContent } from "@/components/api-docs-content";
import { DsRail } from "@/components/ds-rail";
import "../arc-site.css";

export const Route = createFileRoute("/api-docs2")({
  head: () => ({ meta: [
    { title: "ArcTools API: pay-per-call data for bots and agents (x402, USDC on Arc)" },
    { name: "description", content: "Token stats, dev audit and sell simulation for any Arc token, paid per request in USDC with the x402 standard. No API key, no account. Every payment burns ARCT." },
  ] }),
  component: () => (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1100, paddingTop: 112 }}><ApiDocsContent /></section>
    </main>
  ),
});
