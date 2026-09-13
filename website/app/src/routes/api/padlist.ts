import { createFileRoute } from "@tanstack/react-router";

import { rpc } from "@/lib/arc-api";
import { padList } from "@/lib/arcpad";

/** GET /api/padlist — raw ArcToolsPad launch list (v2 + v3.1) as the Terminal ingests it. */
export const Route = createFileRoute("/api/padlist")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t0 = Date.now();
        const rows = await padList();
        const dbg = new URL(request.url).searchParams.get("dbg");
        let launch: unknown = null;
        if (dbg) launch = await rpc("eth_call", [{ data: "0x214013ca" + dbg.toLowerCase().replace(/^0x/, "").padStart(64, "0"), to: "0x2726AeC64D8a9BC41B9940dDA5D21c889458B348" }, "latest"]).catch((e: Error) => "ERR " + e.message);
        return Response.json({ ms: Date.now() - t0, count: rows.length, launch, rows }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
      },
    },
  },
});
