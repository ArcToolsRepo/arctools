import { createFileRoute } from "@tanstack/react-router";

import { ArcNav } from "@/components/arc-nav";
import { PerpsPreview } from "@/components/perps-preview";
import "../arc-site.css";

/** ArcPerps — design preview, not linked from navigation; contracts not deployed. */
export const Route = createFileRoute("/perps")({
  head: () => ({ meta: [{ title: "ArcPerps (preview): 24/7 leverage on tokenized stocks and Arc tokens" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/perps" />
      <section className="arc-section" style={{ maxWidth: 1360, paddingTop: 112 }}>
        <h1 className="arc-h1" style={{ marginBottom: 6 }}>ArcPerps <span style={{ color: "var(--arc-muted)", fontSize: 18, fontWeight: 400 }}>preview</span></h1>
        <p className="arc-body" style={{ color: "var(--arc-muted)", marginBottom: 16 }}>24/7 leverage up to 3x on tokenized stocks and the deepest Arc tokens. Peer-to-peer with a fee-funded insurance fund; price source follows the market clock.</p>
        <PerpsPreview />
      </section>
    </main>
  ),
});
