import { useEffect, useRef, useState } from "react";

/**
 * ArcTools Help — chat drawer (right side). Opened from the "? Help" item in the side nav, the mobile "?" button, or
 * anywhere via `openHelp("optional question")` / window event "arc-help". Answers come from /api/help (KB + live tools).
 */
type Msg = { role: "user" | "assistant"; content: string; sources?: { title: string; url?: string }[] };

const SUGGESTIONS = [
  "How do I create the trading wallet?",
  "How do limit orders and take profit work?",
  "What does Token Score mean?",
  "What is the Bubble map?",
  "How do I add the buy bot to my group?",
  "Is Arc down right now?",
];

export function openHelp(question?: string) {
  window.dispatchEvent(new CustomEvent("arc-help", { detail: { question } }));
}

function renderText(t: string) {
  // paths (/trade, /token/…) and t.me links → clickable; keep it tiny, no markdown lib
  const parts = t.split(/(\s\/[a-z][\w/.<>-]*|https?:\/\/\S+|@[A-Za-z0-9_]{4,})/g);
  return parts.map((p, i) => {
    if (/^\s\/[a-z]/.test(p)) { const path = p.trim().replace(/[.,)]+$/, ""); return <span key={i}> <a href={path.includes("<") ? "/trade" : path} style={{ color: "var(--arc-cobalt)" }}>{path}</a></span>; }
    if (/^https?:\/\//.test(p)) return <a href={p.replace(/[.,)]+$/, "")} key={i} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{p}</a>;
    if (/^@/.test(p)) return <a href={`https://t.me/${p.slice(1)}`} key={i} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{p}</a>;
    return <span key={i}>{p}</span>;
  });
}

export function HelpDrawer() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: Event) => { setOpen(true); const d = (e as CustomEvent<{ question?: string }>).detail; if (d?.question) void ask(d.question); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("arc-help", on); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("arc-help", on); window.removeEventListener("keydown", esc); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, busy]);

  const ask = async (text: string) => {
    const t = text.trim(); if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setQ(""); setBusy(true);
    try {
      const j = await fetch("/api/help", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }) }).then((r) => r.json()) as { reply?: string; sources?: Msg["sources"]; error?: string };
      setMsgs((m) => [...m, { role: "assistant", content: j.reply ?? j.error ?? "No answer.", sources: j.sources }]);
    } catch { setMsgs((m) => [...m, { role: "assistant", content: "Network error — try again or ask in Telegram @arctoolsportal." }]); }
    setBusy(false);
  };


  // Archy follows you down the page: the launcher eases toward the pointer's height (damped, never jumpy) and
  // falls back to tracking the scroll position on touch devices, where there is no cursor to follow.
  const fab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // no cursor to follow on a touch screen; parking the button at 75% of the viewport put it on top of the
    // wallet form's primary button. It stays in its corner there.
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let want = window.innerHeight - 70;
    let have = want;
    let raf = 0;
    const clamp = (v: number) => Math.max(70, Math.min(window.innerHeight - 70, v));
    const onMove = (e: PointerEvent) => { want = clamp(e.clientY); };
    const onScroll = () => { if (!matchMedia("(pointer: fine)").matches) want = clamp(window.innerHeight * 0.75); };
    const tick = () => {
      have += (want - have) * 0.08;                       // damping: it trails the cursor, it does not chase it
      const el = fab.current;
      if (el) el.style.transform = `translateY(${Math.round(have - (window.innerHeight - 70))}px)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); window.removeEventListener("scroll", onScroll); };
  }, []);
  return (
    <>
      {/* mobile / no-sidebar launcher: bottom-left (bottom-right is taken by the status pill and live toasts) */}
      <button aria-label="Archy Agent" className="arc-help-fab" onClick={() => setOpen(true)} ref={fab} type="button"
        style={{
          // inline so the launcher cannot be switched off by a stylesheet that only expected a mobile FAB
          alignItems: "center", background: "rgba(46,124,255,0.18)", border: "1px solid var(--arc-cobalt)",
          borderRadius: "50%", bottom: 16, boxShadow: "0 6px 18px rgba(0,0,0,0.45)", cursor: "pointer",
          display: "flex", height: 46, justifyContent: "center", left: 12, padding: 0, position: "fixed",
          width: 46, zIndex: 1100,
        }}><img alt="Archy" src="/archy.png" style={{ borderRadius: "50%", height: 38, width: 38 }} /></button>
      {open && (
        <div aria-modal className="arc-help" role="dialog">
          <div className="arc-help__scrim" onClick={() => setOpen(false)} />
          <aside className="arc-help__panel">
            <header className="arc-help__head">
              <span style={{ alignItems: "center", display: "inline-flex", gap: 8 }}>
                <img alt="" src="/archy.png" style={{ borderRadius: "50%", height: 28, width: 28 }} />
                <b>Archy Agent</b>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>ArcTools &amp; Arc only · EN PL ES RU ZH</span>
              </span>
              <button aria-label="Close" className="arc-mono" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 16 }} type="button">✕</button>
            </header>
            <div className="arc-help__list" ref={listRef}>
              {msgs.length === 0 && (
                <div>
                  <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13, margin: "4px 0 10px" }}>Hi, I am Archy. Ask how to do something or where to find it. I answer only about ArcTools and the Arc chain, from our own docs and live data — no price calls, no financial advice.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {SUGGESTIONS.map((s) => <button className="arc-mono" key={s} onClick={() => void ask(s)} style={{ background: "rgba(46,124,255,0.08)", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "6px 10px", textAlign: "left" }} type="button">{s}</button>)}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div className={"arc-help__msg arc-help__msg--" + m.role} key={i}>
                  <div className="arc-help__bubble">{m.role === "assistant" ? renderText(m.content) : m.content}</div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 4 }}>
                      {m.sources.map((s) => <span key={s.title} style={{ marginRight: 8 }}>{s.url && !s.url.includes("<") ? <a href={s.url} style={{ color: "var(--arc-cobalt)" }}>{s.title}</a> : s.title}</span>)}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="arc-help__msg arc-help__msg--assistant"><div className="arc-help__bubble"><span className="arc-alpha-bar" /></div></div>}
            </div>
            <form className="arc-help__form" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
              <input className="arc-mono" disabled={busy} maxLength={600} onChange={(e) => setQ(e.target.value)} placeholder="Ask Archy about ArcTools or Arc…" ref={inputRef} value={q} />
              <button className="arc-cta" disabled={busy || !q.trim()} style={{ fontSize: 12, padding: "8px 14px" }} type="submit">Ask</button>
            </form>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "6px 14px 10px" }}>Answers can be wrong — verify on-chain. Not financial advice. Humans: <a href="https://t.me/arctoolsportal" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">@arctoolsportal</a></p>
          </aside>
        </div>
      )}
    </>
  );
}
