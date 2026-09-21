import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArcNav } from "@/components/arc-nav";

/** /app — download page for the Android build. The APK is served from /assets/app/ with its SHA-256 next to it. */
type Manifest = { version: string; versionCode: number; file: string; size: number; sha256: string; built: string; minAndroid: string };

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "ArcTools for Android: the Terminal and your wallet, in your pocket" }, { name: "description", content: "Download the ArcTools Android app straight from arctools.fun. Every Arc launchpad, one-click buys, a wallet that never leaves your phone." }] }),
  component: AppPage,
});

function AppPage() {
  const [m, setM] = useState<Manifest | null>(null);
  const [os, setOs] = useState<"android" | "ios" | "other">("other");
  useEffect(() => {
    fetch("/assets/app/manifest.json", { cache: "no-store" }).then((r) => r.json()).then(setM).catch(() => undefined);
    const ua = navigator.userAgent; setOs(/android/i.test(ua) ? "android" : /iphone|ipad/i.test(ua) ? "ios" : "other");
  }, []);
  return (
    <main className="arc-body">
      <ArcNav />
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 80px" }}>
        <p className="arc-eyebrow">Android · direct download</p>
        <h1 className="arc-h2" style={{ fontSize: 36, margin: "6px 0 10px" }}>ArcTools in your pocket.</h1>
        <p style={{ color: "var(--arc-muted)", fontSize: 16, lineHeight: 1.5, margin: 0 }}>Every Arc launchpad in one list, one-tap buys, the token page with chart and safety checks, and a wallet whose key never leaves your phone. The same engine as the site — as an app.</p>

        <div style={{ background: "var(--arc-paper)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 18, margin: "22px 0" }}>
          {m ? (
            <>
              <a className="arc-cta" href={`/assets/app/${m.file}`} download style={{ display: "inline-block", fontSize: 17, padding: "12px 22px" }}>Download ArcTools {m.version} (.apk · {(m.size / 1024 / 1024).toFixed(1)} MB)</a>
              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11.5, marginTop: 12, wordBreak: "break-all" }}>SHA-256 {m.sha256}<br />built {m.built} · Android {m.minAndroid}+ · versionCode {m.versionCode}</div>
            </>
          ) : <span style={{ color: "var(--arc-muted)" }}>Loading the latest build…</span>}
        </div>

        {os === "ios" && <div style={{ background: "rgba(245,197,66,0.08)", border: "1px solid rgba(245,197,66,0.35)", borderRadius: 12, padding: 14, marginBottom: 18, fontSize: 14 }}><b>On iPhone?</b> Apple does not allow installing apps outside the App Store. Open <a href="/trade2" style={{ color: "var(--arc-cobalt)" }}>arctools.fun/trade2</a> in Safari, tap Share → <b>Add to Home Screen</b>. You get the icon and full screen; the wallet works the same way.</div>}

        <h2 style={{ fontSize: 18, margin: "24px 0 8px" }}>Install in three taps</h2>
        <ol style={{ color: "var(--arc-muted)", fontSize: 15, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
          <li>Tap Download. Android asks whether to keep the file — keep it.</li>
          <li>Open the file. If Android says "install unknown apps is not allowed", tap Settings and allow it for your browser — once.</li>
          <li>Install. The ArcTools icon appears on your home screen.</li>
        </ol>

        <h2 style={{ fontSize: 18, margin: "24px 0 8px" }}>Why not the Play Store?</h2>
        <p style={{ color: "var(--arc-muted)", fontSize: 15, lineHeight: 1.6, margin: 0 }}>Because you should not have to wait for a review to trade. A direct APK is how GMGN, Photon and most trading terminals ship. The file above is signed with our release key — the fingerprint is <span className="arc-mono" style={{ fontSize: 12 }}>91:B4:D8:45…42:0F:79</span>. The app checks for a newer build on start and offers it; nothing installs without you tapping.</p>

        <h2 style={{ fontSize: 18, margin: "24px 0 8px" }}>Your keys</h2>
        <p style={{ color: "var(--arc-muted)", fontSize: 15, lineHeight: 1.6, margin: 0 }}>The wallet is generated on the phone and encrypted with your passcode (PBKDF2 + AES-GCM). It is never sent to us. Save the private key when the app shows it — the recovery code only resets a forgotten passcode on the same phone. Lose both and nobody can help.</p>

        <p style={{ color: "var(--arc-muted)", fontSize: 12.5, marginTop: 28 }}>Fees in the app are the same as on the site: 0.5 % per swap → ARCT buyback and burn. Internal review only — no third-party audit.</p>
      </section>
    </main>
  );
}
