import { createFileRoute } from "@tanstack/react-router";

import { AdvertiseContent } from "@/components/advertise-content";
import { ArcNav } from "@/components/arc-nav";
import "../arc-site.css";

export const Route = createFileRoute("/advertise")({
  head: () => ({ meta: [
    { title: "Advertise on ArcTools: banner slots at the top of the Terminal" },
    { name: "description", content: "Three sponsored banner slots under the Terminal heading, 7 days each. 250 USDC or ARCT worth 200 USD, paid on-chain to the fee treasury. Every banner is reviewed before it shows." },
  ] }),
  component: () => (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/advertise" />
      <section className="arc-section" style={{ maxWidth: 1100, paddingTop: 112 }}><AdvertiseContent /></section>
    </main>
  ),
});
