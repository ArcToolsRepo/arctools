import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "@/lib/bindings.server";

/** Serves an ArcToolsPad token logo (stored in D1 as a data URL) as raw image
 *  bytes, so Telegram bots and embeds can use a plain https URL. */
export const Route = createFileRoute("/api/pad-logo/$ca")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const ca = (params.ca ?? "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(ca)) {
          return new Response("bad address", { status: 400 });
        }
        try {
          const db = bindings().DB;
          if (!db) return new Response("no storage", { status: 404 });
          const row = (await db
            .prepare("SELECT image FROM pad_meta WHERE token = ?")
            .bind(ca)
            .first()) as { image?: string } | null;
          const img = row?.image ?? "";
          const m = img.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
          if (!m) return new Response("no logo", { status: 404 });
          const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
          return new Response(bytes, {
            headers: {
              "Cache-Control": "public, max-age=300",
              "Content-Type": m[1],
            },
          });
        } catch {
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});
