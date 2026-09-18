import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

/** RPC diagnostics: runs INSIDE the worker, rendered server-side so a plain
 * curl of /diag shows exactly what the worker sees. */
const diag = createServerFn({ method: "GET" }).handler(async () => {
  const endpoints = [
    "https://rpc-production-ba7a.up.railway.app",
    "https://rpc.arc-scan.org",
    "https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8",
  ];
  const out: Record<string, string> = {};
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_blockNumber", params: [] }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)",
        },
        method: "POST",
      });
      const text = await res.text();
      out[url] = `HTTP ${res.status}: ${text.slice(0, 160)}`;
    } catch (e) {
      out[url] = "FETCH ERROR: " + (e instanceof Error ? e.message : String(e));
    }
  }
  return out;
});

export const Route = createFileRoute("/diag")({
  loader: () => diag(),
  component: DiagPage,
});

function DiagPage() {
  const data = Route.useLoaderData();
  return <pre style={{ fontSize: 12, padding: 24, whiteSpace: "pre-wrap" }}>{JSON.stringify(data, null, 2)}</pre>;
}
