import { createFileRoute } from "@tanstack/react-router";

import { AdvertiseContent } from "@/components/advertise-content";
import { DsRail } from "@/components/ds-rail";
import "../arc-site.css";

export const Route = createFileRoute("/advertise2")({
  head: () => ({ meta: [
    { title: "Advertise on ArcTools: banner slots at the top of the Terminal" },
    { name: "description", content: "Three sponsored banner slots under the Terminal heading, 7 days each. 250 USDC or ARCT worth 200 USD, paid on-chain to the fee treasury. Every banner is reviewed before it shows." },
  ] }),
  component: () => (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1100, paddingTop: 112 }}><AdvertiseContent v2 /></section>
    </main>
  ),
});
