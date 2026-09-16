import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "@/lib/bindings.server";
import { selfHeal, type HealEnv } from "@/lib/self-heal";

/** GET /api/heal → last self-heal report (cron every 20 min). GET /api/heal?run=1&k=<WARM_AUTH> → run now. */
export const Route = createFileRoute("/api/heal")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const env = bindings() as unknown as HealEnv;
        const u = new URL(request.url);
        const hdr = { "content-type": "application/json", "cache-control": "no-store" };
        if (u.searchParams.get("run")) {
          if (env.WARM_AUTH && u.searchParams.get("k") !== env.WARM_AUTH) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: hdr });
          return new Response(JSON.stringify(await selfHeal(env)), { headers: hdr });
        }
        const last = await env.KV?.get("heal:last", "text");
        return new Response(last ?? JSON.stringify({ ts: 0, ok: null, checks: [], actions: [], alerts: [], note: "no run yet" }), { headers: hdr });
      },
    },
  },
});
