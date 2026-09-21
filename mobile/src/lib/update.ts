/** Self-update without a store: read the site's manifest, download the signed APK into the app's cache and hand it
 *  to Android's package installer. Same signing key + same appId → Android treats it as an update: wallet, watchlist
 *  and settings stay. Android still shows its own "Install?" screen — no app outside Play can skip that. */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { APP_VERSION_CODE } from "../App";

export type Manifest = { version: string; versionCode: number; file: string; size?: number; sha256?: string; built?: string; changelog?: string; minVersionCode?: number };
const BASE = "https://arctools.fun/assets/app/";
let cached: { at: number; m: Manifest | null } = { at: 0, m: null };
const listeners = new Set<() => void>();
export const onUpdateChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = () => listeners.forEach((f) => f());

export async function checkUpdate(force = false): Promise<Manifest | null> {
  if (!force && Date.now() - cached.at < 10 * 60_000) return cached.m;
  try {
    const m = (await (await fetch(BASE + "manifest.json?t=" + Date.now(), { cache: "no-store" })).json()) as Manifest;
    cached = { at: Date.now(), m: (m.versionCode ?? 0) > APP_VERSION_CODE ? m : null };
  } catch { cached = { at: Date.now(), m: null }; }
  emit();
  return cached.m;
}
export const pendingUpdate = () => cached.m;
/** the running build is below the minimum the server still supports (a critical fix shipped) */
export const updateRequired = () => !!cached.m?.minVersionCode && cached.m.minVersionCode > APP_VERSION_CODE;

export type Progress = { phase: "download" | "install" | "done" | "error"; pct: number; msg?: string };

export async function installUpdate(m: Manifest, onProgress: (p: Progress) => void): Promise<void> {
  const url = BASE + m.file;
  if (!Capacitor.isNativePlatform()) { window.open(url, "_blank"); return; }
  onProgress({ phase: "download", pct: 0 });
  const path = `update/${m.file}`;
  try { await Filesystem.mkdir({ path: "update", directory: Directory.Cache, recursive: true }); } catch { /* exists */ }
  const off = await Filesystem.addListener("progress", (e) => {
    if (e.contentLength > 0) onProgress({ phase: "download", pct: Math.round((e.bytes / e.contentLength) * 100) });
  });
  try {
    const r = await Filesystem.downloadFile({ url, path, directory: Directory.Cache, progress: true, recursive: true });
    const uri = r.path ?? (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
    onProgress({ phase: "install", pct: 100 });
    await FileOpener.open({ filePath: uri, contentType: "application/vnd.android.package-archive", openWithDefault: true });
    onProgress({ phase: "done", pct: 100 });
  } catch (e) {
    onProgress({ phase: "error", pct: 0, msg: String((e as Error).message || e).slice(0, 120) });
    throw e;
  } finally { off.remove(); }
}
