/** GET /api/locks?token=0x… | ?owner=0x… → { locks: LockRow[] } straight from ArcLocker (memo 60 s per key). */
import { createFileRoute } from "@tanstack/react-router";
import { locksForToken, locksOf } from "@/lib/arc-locker";

export const Route = createFileRoute("/api/locks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const token = (u.searchParams.get("token") ?? "").toLowerCase(); const owner = (u.searchParams.get("owner") ?? "").toLowerCase();
        const key = token || owner;
        if (!/^0x[0-9a-f]{40}$/.test(key)) return Response.json({ error: "token or owner" }, { status: 400 });
        const { memo } = await import("@/lib/arc-api");
        const locks = await memo(`locks:${token ? "t" : "o"}:${key}`, 60_000, () => (token ? locksForToken(key) : locksOf(key)), () => true);
        return Response.json({ locks, contract: "0x07868eB2E92D4F1D9967f6Dc3B8a8Af5623Dbb94" }, { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=30, s-maxage=60" } });
      },
    },
  },
});
