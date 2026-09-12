/**
 * Runtime holder for the shared memo cache. The Worker entry (src/server.ts) stores the KV binding
 * and the request's waitUntil here on every request; memo() in arc-api.ts reads them. Kept free of
 * any server-only import so arc-api.ts stays importable from client bundles.
 */
export type KVLike = {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};
let _kv: KVLike | null = null;
let _waitUntil: ((p: Promise<unknown>) => void) | null = null;

export function setMemoRuntime(kv: KVLike | null | undefined, waitUntil?: (p: Promise<unknown>) => void) {
  if (kv) _kv = kv;
  if (waitUntil) _waitUntil = waitUntil;
}
export function memoKV(): KVLike | null { return _kv; }
/** Keep a background promise alive past the response (Workers kill orphans otherwise). */
export function keepAlive(p: Promise<unknown>) {
  try { _waitUntil?.(p); } catch { /* ignore */ }
  void p.catch(() => null);
}
