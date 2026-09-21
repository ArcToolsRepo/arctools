/** Thin wrappers over Capacitor plugins. Every call is a no-op in a plain browser, so the same bundle runs at /m/. */
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Browser } from "@capacitor/browser";
import { getPrefs } from "./store";

export const isNative = () => Capacitor.isNativePlatform();

export async function initNative(onBack: () => boolean) {
  if (!isNative()) return;
  try { await StatusBar.setStyle({ style: Style.Dark }); await StatusBar.setBackgroundColor({ color: "#0a0c10" }); } catch { /* not on all devices */ }
  // hardware back: let the app handle it; if the app is at its root, minimise instead of killing the WebView
  App.addListener("backButton", () => { if (!onBack()) App.minimizeApp(); });
}

export const tap = () => { if (isNative() && getPrefs().haptics) Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined); };
export const buzzOk = () => { if (isNative() && getPrefs().haptics) Haptics.notification({ type: NotificationType.Success }).catch(() => undefined); };
export const buzzErr = () => { if (isNative() && getPrefs().haptics) Haptics.notification({ type: NotificationType.Error }).catch(() => undefined); };

/** Open a web page WITHOUT leaving the app: Capacitor's in-app browser sheet (Chrome Custom Tab on Android).
 *  Every external link in the app goes through here; a plain <a target=_blank> would hand the user to Chrome. */
export function openUrl(url: string) {
  if (isNative()) { void Browser.open({ url, toolbarColor: "#0a0c10", presentationStyle: "popover" }); }
  else window.open(url, "_blank", "noopener");
}
