// build step: per-language dictionaries → public/i18n/<lang>.json (see src/lib/i18n-dom.ts)
import { mkdirSync, writeFileSync } from "node:fs";
import { ROWS } from "../src/lib/i18n-dict";
const idx = { pl: 1, es: 2, ru: 3, zh: 4 } as const;
mkdirSync("public/i18n", { recursive: true });
for (const [lang, i] of Object.entries(idx)) {
  const out: Record<string, string> = {};
  for (const r of ROWS) { const v = r[i]; if (v && v !== r[0]) out[r[0]] = v; }
  writeFileSync(`public/i18n/${lang}.json`, JSON.stringify(out));
  console.log(lang, Object.keys(out).length, "entries", (JSON.stringify(out).length / 1024).toFixed(0), "KB");
}
