/** Self-update without a store: read the site's manifest, download the signed APK into the app's cache, verify its
 *  SHA-256 against the manifest and hand it to Android's package installer. Same signing key + same appId → Android
 *  treats it as an update: wallet, watchlist and settings stay. Android always shows its own "Install?" screen, and
 *  the FIRST time asks to allow ArcOne to install apps (Settings → returns here) — no app outside Play can skip that. */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { Browser } from "@capacitor/browser";
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
export const updateRequired = () => !!cached.m?.minVersionCode && cached.m.minVersionCode > APP_VERSION_CODE;

export type Progress = { phase: "download" | "verify" | "install" | "done" | "error" | "fallback"; pct: number; msg?: string };
export const updateLog: string[] = [];
const log = (s: string) => { updateLog.push(`${new Date().toISOString().slice(11, 19)} ${s}`); if (updateLog.length > 40) updateLog.shift(); };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fallback when the in-app installer path fails: the system browser downloads the APK and Android offers to install it. */
async function fallbackBrowser(url: string, onProgress: (p: Progress) => void, why: string) {
  log(`fallback to browser: ${why}`);
  onProgress({ phase: "fallback", pct: 0, msg: `In-app install unavailable (${why.slice(0, 60)}). Opening the download in your browser — tap the file when it finishes.` });
  try { await Browser.open({ url, presentationStyle: "fullscreen" }); } catch { window.open(url, "_blank"); }
}

export async function installUpdate(m: Manifest, onProgress: (p: Progress) => void): Promise<void> {
  const url = BASE + m.file + "?v=" + m.versionCode;
  if (!Capacitor.isNativePlatform()) { window.open(url, "_blank"); return; }
  updateLog.length = 0; log(`start ${m.version} (${m.versionCode}) from ${url}`);
  onProgress({ phase: "download", pct: 0 });
  const path = `update/${m.file}`;
  let off: { remove: () => Promise<void> } | null = null;
  try {
    try { await Filesystem.mkdir({ path: "update", directory: Directory.Cache, recursive: true }); } catch { /* exists */ }
    try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* none */ }
    off = await Filesystem.addListener("progress", (e) => { if (e.contentLength > 0) onProgress({ phase: "download", pct: Math.round((e.bytes / e.contentLength) * 100) }); });
    const r = await Filesystem.downloadFile({ url, path, directory: Directory.Cache, progress: true, recursive: true });
    log(`downloaded → ${r.path ?? "(no path)"}`);
    const uri = r.path ?? (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
    // size + hash check: a truncated or tampered file must never reach the installer
    const st = await Filesystem.stat({ path, directory: Directory.Cache }).catch(() => null);
    log(`size ${st?.size ?? "?"} (manifest ${m.size ?? "?"})`);
    if (m.size && st && Number(st.size) !== Number(m.size)) throw new Error(`download incomplete: ${st.size} of ${m.size} bytes`);
    if (m.sha256) {
      onProgress({ phase: "verify", pct: 100 });
      const b64 = (await Filesystem.readFile({ path, directory: Directory.Cache })).data as string;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const h = await sha256Hex(bin.buffer);
      log(`sha256 ${h.slice(0, 12)}… (manifest ${m.sha256.slice(0, 12)}…)`);
      if (h !== m.sha256.toLowerCase()) throw new Error("checksum mismatch — file rejected");
    }
    onProgress({ phase: "install", pct: 100, msg: "Opening the Android installer… If Android asks to allow ArcOne to install apps, allow it and come back — the installer opens right after." });
    await FileOpener.open({ filePath: uri, contentType: "application/vnd.android.package-archive", openWithDefault: true });
    log("installer opened");
    onProgress({ phase: "done", pct: 100 });
  } catch (e) {
    const msg = String((e as Error).message || e);
    log(`error: ${msg}`);
    // the download itself failed → nothing to fall back to but the browser; the installer failed → same
    await fallbackBrowser(url, onProgress, msg);
  } finally { await off?.remove().catch(() => undefined); }
}
