import { useEffect, useRef, useState } from "react";

import { BurnCounter } from "@/components/burn-counter";
import { LANGS, setLang, setTheme, usePrefs } from "@/lib/i18n";

/** Language (5) + light/dark switch. `fixed` = pinned to the top-right corner (side-nav pages); otherwise inline in the top nav. */
export function PrefsBar({ fixed }: { fixed?: boolean }) {
  const { lang, theme, t } = usePrefs();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  const cur = LANGS.find(([k]) => k === lang) ?? LANGS[0];
  const btn: React.CSSProperties = { alignItems: "center", background: "var(--arc-paper-deep)", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", display: "inline-flex", fontSize: 12, gap: 6, height: 30, padding: "0 10px" };
  return (
    <div className={"arc-prefs arc-mono" + (fixed ? " arc-prefs--fixed" : "")} ref={box} style={fixed ? { alignItems: "center", display: "flex", gap: 6, position: "fixed", right: 14, top: 36, zIndex: 60 } : { alignItems: "center", display: "flex", gap: 6 }}>
      <BurnCounter />
      <div style={{ position: "relative" }}>
        <button aria-haspopup="listbox" onClick={() => setOpen((v) => !v)} style={btn} title={t("Language")} type="button">
          🌐 {cur[1]}
        </button>
        {open && (
          <div role="listbox" style={{ background: "var(--arc-paper-deep)", border: "1px solid var(--arc-line)", borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.35)", minWidth: 150, padding: 4, position: "absolute", right: 0, top: 36 }}>
            {LANGS.map(([k, short, name]) => (
              <button aria-selected={k === lang} key={k} onClick={() => { setLang(k); setOpen(false); }} role="option" type="button"
                style={{ alignItems: "center", background: k === lang ? "rgba(34,197,94,0.14)" : "transparent", border: "none", borderRadius: 7, color: "var(--arc-ink)", cursor: "pointer", display: "flex", fontSize: 12, gap: 10, justifyContent: "space-between", padding: "8px 10px", width: "100%" }}>
                <span>{name}</span><span style={{ color: k === lang ? "var(--arc-up)" : "var(--arc-muted)" }}>{k === lang ? "✓" : short}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button aria-label={theme === "dark" ? t("Light theme") : t("Dark theme")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={{ ...btn, padding: "0 9px" }} title={theme === "dark" ? t("Light theme") : t("Dark theme")} type="button">
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    </div>
  );
}
