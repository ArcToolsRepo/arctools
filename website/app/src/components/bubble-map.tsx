import { useEffect, useMemo, useRef, useState } from "react";

import { BOT_API } from "@/lib/bot-api";

/**
 * Bubble map of a token's top holders: one bubble per wallet (area ∝ share), a line between two wallets when we can prove
 * a connection (token transfer, same funder, direct funding, launch bundle, insider buy window). Connected wallets share
 * a colour; grey = no proven link. Force layout on a <canvas>, no dependency.
 */

type Node = { address: string; share: number; balance: number; kind: "eoa" | "contract" | "pool"; label: string | null; cluster: number | null; funder: string | null; tags: string[] };
type Edge = { a: string; b: string; why: string[] };
type Cluster = { id: string; wallets: string[]; share: number; reasons: Record<string, number> };
type Data = { token: string; holders: number; eoa: number; nodes: Node[]; edges: Edge[]; clusters: Cluster[]; largest_cluster_pct: number; clustered_pct: number; took_ms: number; error?: string };

const PALETTE = ["#2e7cff", "#22c580", "#f5c542", "#f0534f", "#9b7bff", "#ff8a3d", "#2ad4c8", "#e46fd2", "#8ecae6", "#c8e64a"];
const WHY: Record<string, string> = { transfer: "sent the token to each other", funding: "funded by the same wallet", funded_by: "one funded the other", bundle: "bought in the launch bundle (first 2 s)", insider: "insider cluster buy window" };

type P = { x: number; y: number; vx: number; vy: number; r: number };

export function BubbleMap({ token, deployer }: { token: string; deployer?: string | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<Node | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [showEoaOnly, setShowEoaOnly] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Map<string, P>>(new Map());
  const raf = useRef(0);
  const mouse = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null);
    fetch(`${BOT_API}/api/bubbles?token=${token}`).then((r) => r.json()).then((j: Data) => { if (!alive) return; if (j.error && !j.nodes?.length) setErr(j.error); else setData(j); }).catch((e) => alive && setErr(String(e)));
    return () => { alive = false; };
  }, [token]);

  const nodes = useMemo(() => (data?.nodes ?? []).filter((n) => !showEoaOnly || n.kind === "eoa"), [data, showEoaOnly]);
  const edges = useMemo(() => { const s = new Set(nodes.map((n) => n.address)); return (data?.edges ?? []).filter((e) => s.has(e.a) && s.has(e.b)); }, [data, nodes]);
  const byAddr = useMemo(() => new Map(nodes.map((n) => [n.address, n])), [nodes]);

  // ---- layout + draw loop
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || nodes.length === 0) return;
    const W = cv.clientWidth, H = Math.max(360, Math.min(640, cv.clientWidth * 0.62));
    const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`;
    const ctx = cv.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const maxShare = Math.max(...nodes.map((n) => n.share), 0.01);
    const rOf = (n: Node) => 6 + Math.sqrt(n.share / maxShare) * Math.min(46, W / 14);
    const pos = posRef.current;
    // cluster centres spread on a ring, singles in the middle ring
    const clusters = [...new Set(nodes.map((n) => n.cluster).filter((c): c is number => c != null))];
    const centre = (n: Node) => {
      if (n.cluster == null) { const i = nodes.indexOf(n); const a = (i / nodes.length) * Math.PI * 2; return { x: W / 2 + Math.cos(a) * W * 0.34, y: H / 2 + Math.sin(a) * H * 0.34 }; }
      const k = clusters.indexOf(n.cluster); const a = (k / Math.max(1, clusters.length)) * Math.PI * 2 - Math.PI / 2;
      return { x: W / 2 + Math.cos(a) * W * 0.18, y: H / 2 + Math.sin(a) * H * 0.16 };
    };
    for (const n of nodes) {
      if (!pos.has(n.address)) { const c = centre(n); pos.set(n.address, { x: c.x + (Math.random() - 0.5) * 40, y: c.y + (Math.random() - 0.5) * 40, vx: 0, vy: 0, r: rOf(n) }); }
      else pos.get(n.address)!.r = rOf(n);
    }
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    let tick = 0;
    const step = () => {
      tick++;
      const alpha = Math.max(0.02, 0.5 * Math.exp(-tick / 90));
      // forces: gravity to cluster centre, repulsion, edge springs
      for (const n of nodes) { const p = pos.get(n.address)!; const c = centre(n); p.vx += (c.x - p.x) * 0.012 * alpha; p.vy += (c.y - p.y) * 0.012 * alpha; }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].address)!, b = pos.get(nodes[j].address)!;
        let dx = b.x - a.x, dy = b.y - a.y; let d = Math.hypot(dx, dy) || 0.01; const min = a.r + b.r + 4;
        if (d < min) { const f = (min - d) / d * 0.5 * alpha; dx *= f; dy *= f; a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy; }
      }
      for (const e of edges) {
        const a = pos.get(e.a), b = pos.get(e.b); if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, want = a.r + b.r + 18; const f = (d - want) / d * 0.04 * alpha;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of nodes) { const p = pos.get(n.address)!; p.vx *= 0.8; p.vy *= 0.8; p.x = Math.max(p.r, Math.min(W - p.r, p.x + p.vx)); p.y = Math.max(p.r, Math.min(H - p.r, p.y + p.vy)); }
      // hover
      let hv: Node | null = null;
      if (mouse.current) for (const n of nodes) { const p = pos.get(n.address)!; if (Math.hypot(mouse.current.x - p.x, mouse.current.y - p.y) <= p.r) { hv = n; break; } }
      if (hv !== hover) setHover(hv);
      // draw
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      for (const e of edges) {
        const a = pos.get(e.a), b = pos.get(e.b); if (!a || !b) continue;
        const na = byAddr.get(e.a)!; const col = na.cluster != null ? PALETTE[na.cluster % PALETTE.length] : "#888";
        const hot = hover && (hover.address === e.a || hover.address === e.b);
        ctx.strokeStyle = hot ? col : col + (isDark ? "66" : "55"); ctx.lineWidth = hot ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const n of nodes) {
        const p = pos.get(n.address)!;
        const col = n.cluster != null ? PALETTE[n.cluster % PALETTE.length] : (isDark ? "#3a4256" : "#c9d1e0");
        const dim = sel != null && n.cluster !== sel;
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = col + (n.cluster != null ? "cc" : "ff"); ctx.fill();
        if (n.address === deployer?.toLowerCase()) { ctx.lineWidth = 2.5; ctx.strokeStyle = "#f5c542"; ctx.stroke(); }
        else if (n.tags.some((t) => /insider/.test(t))) { ctx.lineWidth = 2; ctx.strokeStyle = "#22c580"; ctx.stroke(); }
        else if (n.kind !== "eoa") { ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeStyle = isDark ? "#8a94a8" : "#5a6478"; ctx.stroke(); ctx.setLineDash([]); }
        if (hover?.address === n.address) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); }
        if (p.r >= 13) {
          ctx.fillStyle = isDark ? "#e8ecf5" : "#0e1118"; ctx.font = `${p.r >= 22 ? 11 : 9}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(`${n.share.toFixed(n.share >= 10 ? 0 : 1)}%`, p.x, p.y);
        }
        ctx.globalAlpha = 1;
      }
      if (tick < 400 || mouse.current) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [nodes, edges, byAddr, hover, sel, deployer]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top }; if (!raf.current) return; };
  const onLeave = () => { mouse.current = null; setHover(null); };
  const onClick = () => { if (hover) window.open(`/insider/${hover.address}`, "_blank"); };

  if (err) return <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 14 }}>Bubble map unavailable: {err}</p>;
  if (!data) return <div style={{ padding: 14 }}><span className="arc-alpha-bar" /> <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>mapping holder connections (funding, transfers, bundles)…</span></div>;

  const cl = data.clusters;
  return (
    <div>
      <div className="arc-mono" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, padding: "10px 12px 4px" }}>
        <span style={{ fontSize: 12 }}><b style={{ color: data.largest_cluster_pct >= 25 ? "var(--arc-down)" : data.largest_cluster_pct >= 10 ? "#f5c542" : "var(--arc-up)" }}>{data.largest_cluster_pct.toFixed(1)}%</b> <span style={{ color: "var(--arc-muted)" }}>largest connected cluster</span></span>
        <span style={{ fontSize: 12 }}><b>{data.clustered_pct.toFixed(1)}%</b> <span style={{ color: "var(--arc-muted)" }}>of supply in {cl.length} cluster{cl.length === 1 ? "" : "s"}</span></span>
        <span style={{ color: "var(--arc-muted)", fontSize: 11 }}>top {data.holders} holders · {data.eoa} wallets</span>
        <label className="arc-mono" style={{ color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, marginLeft: "auto" }}><input checked={showEoaOnly} onChange={(e) => setShowEoaOnly(e.target.checked)} type="checkbox" /> hide pools &amp; contracts</label>
      </div>
      <div style={{ position: "relative" }}>
        <canvas onClick={onClick} onMouseLeave={onLeave} onMouseMove={onMove} ref={canvasRef} style={{ cursor: hover ? "pointer" : "default", display: "block", width: "100%" }} />
        {hover && (
          <div className="arc-mono" style={{ background: "#0b0f17", border: "1px solid var(--arc-line)", borderRadius: 8, color: "#e8ecf5", fontSize: 11, left: Math.min((mouse.current?.x ?? 0) + 14, (canvasRef.current?.clientWidth ?? 400) - 260), padding: "8px 10px", pointerEvents: "none", position: "absolute", top: (mouse.current?.y ?? 0) + 14, width: 250, zIndex: 5 }}>
            <div style={{ fontWeight: 700 }}>{hover.address.slice(0, 8)}…{hover.address.slice(-6)} {hover.label ? `· ${hover.label}` : hover.kind !== "eoa" ? `· ${hover.kind}` : ""}</div>
            <div>{hover.share.toFixed(2)}% of supply · {hover.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            {hover.address === deployer?.toLowerCase() && <div style={{ color: "#f5c542" }}>deployer</div>}
            {hover.tags.length > 0 && <div style={{ color: "var(--arc-up)" }}>{hover.tags.join(" · ")}</div>}
            {hover.funder && <div style={{ color: "var(--arc-muted)" }}>funded by {hover.funder.slice(0, 8)}…{byAddr.has(hover.funder) ? " (also a holder)" : ""}</div>}
            {hover.cluster != null && (() => { const c = cl[hover.cluster]; return c ? <div style={{ color: PALETTE[hover.cluster % PALETTE.length] }}>cluster #{hover.cluster + 1}: {c.wallets.length} wallets · {c.share.toFixed(1)}% · {Object.keys(c.reasons).map((k) => WHY[k] ?? k).join(", ")}</div> : null; })()}
            <div style={{ color: "var(--arc-muted)", marginTop: 4 }}>click → wallet profile</div>
          </div>
        )}
      </div>
      {cl.length > 0 && (
        <div style={{ borderTop: "1px solid var(--arc-line)", display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", padding: 10 }}>
          {cl.slice(0, 8).map((c, i) => (
            <button className="arc-mono" key={c.id} onClick={() => setSel(sel === i ? null : i)} style={{ background: sel === i ? "rgba(255,255,255,0.06)" : "transparent", border: "1px solid " + (sel === i ? PALETTE[i % PALETTE.length] : "var(--arc-line)"), borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 11, padding: "8px 10px", textAlign: "left" }} type="button">
              <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                <span style={{ background: PALETTE[i % PALETTE.length], borderRadius: "50%", display: "inline-block", height: 10, width: 10 }} />
                <b>cluster #{i + 1}</b> · {c.wallets.length} wallets · <b style={{ color: c.share >= 25 ? "var(--arc-down)" : c.share >= 10 ? "#f5c542" : "var(--arc-ink)" }}>{c.share.toFixed(2)}%</b>
              </div>
              <div style={{ color: "var(--arc-muted)", marginTop: 3 }}>{Object.entries(c.reasons).map(([k, n]) => `${WHY[k] ?? k} (${n})`).join(" · ")}</div>
            </button>
          ))}
        </div>
      )}
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0, padding: "6px 12px 10px" }}>
        Bubble area = share of supply. A line means a proven on-chain link: the token moved between the wallets, both were first funded by the same wallet, one funded the other, both bought in the first 2 s, or both are top-100 insiders buying within 15 min. Gold ring = deployer, green ring = insider, dashed = contract/pool.
      </p>
    </div>
  );
}
