/** Archy — the ArcTools help agent, inside the app. Same brain as the site (knowledge base + live tools). */
import { useEffect, useRef, useState } from "react";
import { Header, Icon } from "../components/ui";
import { go } from "../lib/router";
import { tap } from "../lib/native";

type Msg = { role: "user" | "assistant"; content: string; sources?: { title: string; url?: string }[] };
const STARTERS = ["What is the sell simulation?", "How do fees fund ARCT burns?", "How do I claim a pay link?", "Is my key ever sent anywhere?", "What does DEV −$ mean on a row?"];
const HIST = "arct.archy";

export default function Archy() {
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(HIST) || "[]"); } catch { return []; } });
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem(HIST, JSON.stringify(msgs.slice(-30))); end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const ask = async (text: string) => {
    const t = text.trim(); if (!t || busy) return;
    tap(); setQ(""); const next: Msg[] = [...msgs, { role: "user", content: t }]; setMsgs(next); setBusy(true);
    try {
      const r = await fetch("https://arctools.fun/api/help", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.slice(-8).map(({ role, content }) => ({ role, content })) }), signal: AbortSignal.timeout(40_000) });
      const j = (await r.json()) as { reply?: string; sources?: Msg["sources"]; error?: string };
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || j.error || "No answer.", sources: j.sources }]);
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: `Archy is unreachable right now (${String((e as Error).message).slice(0, 60)}). Ask in Telegram @ArcToolsPortal.` }]); }
    finally { setBusy(false); }
  };
  // a source link like /token/0x… or /rewards opens the matching app screen; others are just labels
  const openSrc = (u?: string) => { if (!u) return; const m = u.match(/^\/(token2?|trade2?|swap2?|rewards2?|pay2?|referrals2?|bridge2?|insiders2?|launchpad2?|app)\/?(0x[0-9a-fA-F]{40})?/); if (!m) return; const map: Record<string, string> = { token: "/token", trade: "/", swap: "/swap", rewards: "/rewards", pay: "/pay", referrals: "/referrals", bridge: "/bridge", insiders: "/insiders", launchpad: "/launchpad", app: "/settings" }; const base = map[m[1].replace(/2$/, "")]; go(m[2] ? `${base}/${m[2]}` : base); };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - var(--tab-h) - var(--sab))" }}>
      <Header title="Archy" back right={<button className="icon-btn" onClick={() => { setMsgs([]); localStorage.removeItem(HIST); }} title="clear"><Icon.refresh className="" /></button>} />
      <div style={{ flex: 1, padding: "0 14px 12px" }}>
        {msgs.length === 0 && (
          <div className="card" style={{ margin: "0 0 12px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}><div className="icon-btn" style={{ background: "rgba(59,130,246,0.15)", color: "var(--cobalt)" }}><Icon.eye className="" /></div><div><b>Archy knows ArcTools.</b><div className="muted" style={{ fontSize: 12.5 }}>Fees, safety checks, the wallet, the bots — plus live numbers. Only ArcTools and Arc; nothing else.</div></div></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>{STARTERS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
            <div style={{ maxWidth: "86%", background: m.role === "user" ? "var(--up)" : "var(--bg2)", color: m.role === "user" ? "#04140a" : "var(--ink)", borderRadius: 14, padding: "10px 12px", fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
              {m.content}
              {m.sources && m.sources.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>{m.sources.slice(0, 3).map((s, k) => <button key={k} className="pill" onClick={() => openSrc(s.url)}>{s.title}</button>)}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="muted" style={{ fontSize: 13, padding: "4px 12px" }}>Archy is thinking…</div>}
        <div ref={end} />
      </div>
      <div style={{ position: "sticky", bottom: "calc(var(--tab-h) + var(--sab))", padding: "8px 14px 10px", background: "var(--bg)" }}>
        <div className="field"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)} placeholder="Ask about ArcTools…" enterKeyHint="send" /><button className="icon-btn" disabled={busy || !q.trim()} onClick={() => ask(q)} style={{ background: "var(--up)", color: "#04140a" }}><Icon.send className="" /></button></div>
      </div>
    </div>
  );
}
