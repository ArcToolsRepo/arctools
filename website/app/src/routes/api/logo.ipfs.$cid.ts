import { createFileRoute } from "@tanstack/react-router";

/**
 * Edge-cached IPFS logo proxy.
 *
 * Launchpad artwork (Warp writes `ipfs://…` into its TokenCreated event) is
 * ~200 KB per file and public gateways rate-limit hard: a feed with 40 tokens
 * fired 40 direct gateway requests per visitor and most of them failed, so the
 * UI fell back to letter monograms. Here the FIRST request pays the gateway
 * fetch, the bytes land in the Cloudflare edge cache, and every later visitor
 * is served locally. Gateways are tried in order until one answers.
 */
const GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
];

const MAX_BYTES = 4 * 1024 * 1024;

export const Route = createFileRoute("/api/logo/ipfs/$cid")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const cid = (params.cid ?? "").trim();
        // only a bare CID (optionally with one path segment) — never a full URL
        if (!/^[A-Za-z0-9]{20,80}(\/[\w.\-]{1,64})?$/.test(cid)) {
          return new Response("bad cid", { status: 400 });
        }

        const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
        const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
        if (cache) {
          const hit = await cache.match(cacheKey);
          if (hit) return hit;
        }

        for (const gw of GATEWAYS) {
          try {
            const res = await fetch(gw + cid, {
              headers: { Accept: "image/*" },
              signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) continue;
            const type = res.headers.get("content-type") ?? "image/png";
            if (!type.startsWith("image/")) continue;
            const buf = await res.arrayBuffer();
            if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) continue;
            const out = new Response(buf, {
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
                "Content-Type": type,
                "X-Logo-Gateway": new URL(gw).host,
              },
            });
            if (cache) await cache.put(cacheKey, out.clone());
            return out;
          } catch {
            /* try the next gateway */
          }
        }
        // no gateway answered: short negative cache so the UI shows its monogram
        return new Response("unavailable", {
          headers: { "Cache-Control": "public, max-age=300" },
          status: 404,
        });
      },
    },
  },
});
