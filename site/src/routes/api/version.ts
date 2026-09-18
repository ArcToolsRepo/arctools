import { createFileRoute } from "@tanstack/react-router";

/** GET /api/version — build id of the deployed bundle; open tabs compare it with their own and reload when stale. */
export const Route = createFileRoute("/api/version")({
  server: { handlers: { GET: () => new Response(JSON.stringify({ build: __BUILD_ID__ }), { headers: { "content-type": "application/json", "cache-control": "no-store" } }) } },
});
