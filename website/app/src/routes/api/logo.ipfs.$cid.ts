import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "@/lib/bindings.server";

/**
 * Edge-cached IPFS logo proxy.
 *
 * Launchpad artwork lives on IPFS and public gateways rate-limit hard (ipfs.io / dweb.link answer 429
 * to Cloudflare egress most of the day, pinata takes 5-10 s). Three tiers:
 *   1. Cloudflare edge cache (per colo)          — ms
 *   2. KV (global, 30 days, images <= 1 MB)      — ms, survives colos and deploys
 *   3. gateways in order of measured reliability — first request only
 * A miss is cached for 20 s only, so a rate-limited moment never blanks a logo for minutes.
 */
const GATEWAYS: { url: string; timeout: number }[] = [
  { url: "https://api.radardex.pro/ipfs/", timeout: 6000 },      // Arc-native mirror, ~200 ms
  { url: "https://gateway.pinata.cloud/ipfs/", timeout: 12000 },
  { url: "https://w3s.link/ipfs/", timeout: 8000 },
  { url: "https://ipfs.io/ipfs/", timeout: 6000 },
  { url: "https://dweb.link/ipfs/", timeout: 6000 },
];

const MAX_BYTES = 4 * 1024 * 1024;
const KV_MAX = 1024 * 1024;

export const Route = createFileRoute("/api/logo/ipfs/$cid")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const cid = (params.cid ?? "").trim();
        if (!/^[A-Za-z0-9]{20,80}(\/[\w.\-]{1,64})?$/.test(cid)) {
          return new Response("bad cid", { status: 400 });
        }
        const headers = (type: string, gw: string) => ({
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=2592000, immutable",   // content-addressed: never changes
          "Content-Type": type,
          "X-Logo-Source": gw,
        });

        const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
        const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
        if (cache) {
          const hit = await cache.match(cacheKey);
          if (hit) return hit;
        }
        const kv = bindings().KV;
        if (kv) {
          try {
            const { value, metadata } = await kv.getWithMetadata<{ type: string }>(`logo:${cid}`, "arrayBuffer");
            if (value && value.byteLength > 0) {
              const out = new Response(value, { headers: headers(metadata?.type ?? "image/png", "kv") });
              if (cache) await cache.put(cacheKey, out.clone());
              return out;
            }
          } catch { /* fall through */ }
        }

        for (const gw of GATEWAYS) {
          try {
            const res = await fetch(gw.url + cid, { headers: { Accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(gw.timeout) });
            if (!res.ok) continue;
            const type = res.headers.get("content-type") ?? "image/png";
            if (!type.startsWith("image/")) continue;
            const buf = await res.arrayBuffer();
            if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) continue;
            const out = new Response(buf, { headers: headers(type, new URL(gw.url).host) });
            if (cache) await cache.put(cacheKey, out.clone());
            if (kv && buf.byteLength <= KV_MAX) {
              try { await kv.put(`logo:${cid}`, buf, { expirationTtl: 30 * 86400, metadata: { type } }); } catch { /* ignore */ }
            }
            return out;
          } catch {
            /* try the next gateway */
          }
        }
        // no gateway answered right now: very short negative cache so the monogram is only a blip
        return new Response("unavailable", { headers: { "Cache-Control": "public, max-age=20" }, status: 404 });
      },
    },
  },
});
