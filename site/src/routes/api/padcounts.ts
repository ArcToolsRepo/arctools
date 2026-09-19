import { createFileRoute } from "@tanstack/react-router";

/** GET /api/padcounts — how many tokens each launchpad carries, counted off the cached Terminal list.
 *  Feeds the launchpad rail on the token page: the rail must not pull the whole 4.8 MB list for 14 numbers. */
export const Route = createFileRoute("/api/padcounts")({
  server: {
    handlers: {
      GET: async () => {
        const { listAllTokensImpl, memo } = await import("@/lib/arc-api");
        const rows = await memo("padcounts:v1", 300_000, async () => {
          const all = await memo("list:__all", 60_000, listAllTokensImpl, (v) => v.length > 50);
          const counts = new Map<string, number>();
          for (const t of all) {
            const pad = (t.pad ?? "").trim();
            if (!pad) continue;
            counts.set(pad, (counts.get(pad) ?? 0) + 1);
          }
          return [...counts.entries()]
            .map(([pad, n]) => ({ n, pad }))
            .sort((a, b) => b.n - a.n)
            .slice(0, 24);
        }, (v) => v.length > 0);
        const total = rows.reduce((a, r) => a + r.n, 0);
        return Response.json({ rows, total }, {
          headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
        });
      },
    },
  },
});
