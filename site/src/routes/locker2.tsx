import { createFileRoute } from "@tanstack/react-router";

import { DsRail } from "@/components/ds-rail";
import { LockerContent } from "./locker";
import "../arc-site.css";

export const Route = createFileRoute("/locker2")({
  head: () => ({ meta: [
    { title: "ArcLocker: lock tokens, LP and Uniswap positions on Arc" },
    { name: "description", content: "Time-lock tokens, Uniswap V2 LP and Uniswap V3 / v4 positions on Arc. Extend-only, no admin key over your assets, every lock shows on the token page. 50 USDC per lock." },
  ] }),
  component: Locker2,
});

function Locker2() {
  return (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1100, paddingTop: 112 }}>
        <LockerContent />
      </section>
    </main>
  );
}
