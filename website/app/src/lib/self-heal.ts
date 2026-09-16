/**
 * Self-heal: runs from the Worker cron every 20 min (wrangler triggers.crons) and on demand via /api/heal?run=1.
 * Independent of the buybot (so it still works when the buybot is the thing that is down).
 *
 *  probes: site HTML, Terminal SSR, buybot /health + /api/status + /api/tasks (index lag), relay /stats,
 *          /api/swaproute (quotes), chain status
 *  fixes:  buybot down ×2 → Railway deploymentRestart; index lag > 20k and not shrinking ×2 → restart buybot;
 *          relay down ×2 → restart relay; warms the KV caches (Terminal list, trending) so users never hit a cold SSR
 *  alerts: Telegram to the admin (rate-limited 1/h per condition) on every action and on failures it cannot fix
 *  report: KV heal:last (GET /api/heal)
 */
import { BOT_ORIGIN } from "./bot-api";

export type HealEnv = {
  KV?: { get(k: string, t: "text"): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
  RAILWAY_TOKEN_BUYBOT?: string;
  RAILWAY_TOKEN_ARCTOOLS?: string;
  TG_ALERT_TOKEN?: string;
  TG_ADMIN_ID?: string;
  WARM_AUTH?: string;
};

const SITE = "https://arctools.fun";
// A Worker cannot fetch its own zone over the network (Cloudflare answers 522/1042). server.ts registers an in-process
// dispatcher so the site probes run through the real handler instead.
let _selfFetch: ((req: Request) => Promise<Response>) | null = null;
export function setSelfFetch(fn: ((req: Request) => Promise<Response>) | null) { _selfFetch = fn; }
const RELAY = "https://rpc-production-ba7a.up.railway.app";
const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";
const RAILWAY = {
  buybot: { service: "2cf10d75-c7ba-4c12-8249-95895ba3a81d", env: "28e3572f-1c24-4c4b-848a-f4ea0717dbb8", token: "RAILWAY_TOKEN_BUYBOT" as const },
  relay: { service: "91274ffb-7c31-4e26-93cc-d10e3aca37e9", env: "72239485-6902-4c40-b6b3-2893beaf00d5", token: "RAILWAY_TOKEN_ARCTOOLS" as const },
  sniper: { service: "28d1da2a-b65b-4313-b159-c1f894fd5d8b", env: "72239485-6902-4c40-b6b3-2893beaf00d5", token: "RAILWAY_TOKEN_ARCTOOLS" as const },
};
const RESTART_COOLDOWN_S = 30 * 60;

type Check = { name: string; ok: boolean; ms: number; detail: string };
export type HealReport = { ts: number; ok: boolean; checks: Check[]; actions: string[]; alerts: string[] };

async function timed(name: string, fn: () => Promise<string>): Promise<Check> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t, detail };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t, detail: String((e as Error).message ?? e).slice(0, 160) };
  }
}

async function get(url: string, ms = 8000, init?: RequestInit): Promise<Response> {
  if (_selfFetch && url.startsWith(SITE)) {
    return await Promise.race([
      _selfFetch(new Request(url, { headers: { "user-agent": "arctools-selfheal/1.0" } })),
      new Promise<Response>((_, rej) => setTimeout(() => rej(new Error(`self timeout ${ms} ms`)), ms)),
    ]);
  }
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms), headers: { "user-agent": "arctools-selfheal/1.0", ...(init?.headers ?? {}) } });
  return r;
}

async function kvNum(env: HealEnv, k: string): Promise<number> {
  const v = await env.KV?.get(k, "text");
  return v ? Number(v) || 0 : 0;
}
async function kvSet(env: HealEnv, k: string, v: string | number, ttl?: number) {
  await env.KV?.put(k, String(v), ttl ? { expirationTtl: ttl } : undefined);
}

/** consecutive failure counter: returns the new count (0 on success) */
async function bump(env: HealEnv, key: string, ok: boolean): Promise<number> {
  if (ok) { await kvSet(env, `heal:fail:${key}`, 0, 86400); return 0; }
  const n = (await kvNum(env, `heal:fail:${key}`)) + 1;
  await kvSet(env, `heal:fail:${key}`, n, 86400);
  return n;
}

async function railwayRestart(env: HealEnv, which: keyof typeof RAILWAY): Promise<string> {
  const cfg = RAILWAY[which];
  const token = env[cfg.token];
  if (!token) return `${which}: no Railway token configured`;
  const cd = await kvNum(env, `heal:restart:${which}`);
  if (Date.now() / 1000 - cd < RESTART_COOLDOWN_S) return `${which}: restart skipped (cooldown ${Math.round(RESTART_COOLDOWN_S - Date.now() / 1000 + cd)} s)`;
  const gql = async (query: string, variables: Record<string, unknown>) => {
    const r = await get("https://backboard.railway.com/graphql/v2", 15000, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }),
    });
    return (await r.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  };
  const q = await gql(
    `query($s:String!,$e:String!){ deployments(input:{serviceId:$s, environmentId:$e}, first:1){ edges{ node{ id status } } } }`,
    { s: cfg.service, e: cfg.env },
  );
  const dep = ((q.data?.deployments as { edges?: { node: { id: string; status: string } }[] } | undefined)?.edges ?? [])[0]?.node;
  if (!dep) return `${which}: no deployment found (${q.errors?.[0]?.message ?? "?"})`;
  const m = await gql(`mutation($id:String!){ deploymentRestart(id:$id) }`, { id: dep.id });
  await kvSet(env, `heal:restart:${which}`, Math.floor(Date.now() / 1000), 86400);
  return m.errors?.length ? `${which}: restart failed: ${m.errors[0].message}` : `${which}: RESTARTED deployment ${dep.id.slice(0, 8)} (was ${dep.status})`;
}

async function telegram(env: HealEnv, key: string, text: string, alerts: string[]) {
  alerts.push(text);
  if (!env.TG_ALERT_TOKEN || !env.TG_ADMIN_ID) return;
  const last = await kvNum(env, `heal:alert:${key}`);
  if (Date.now() / 1000 - last < 3600) return;       // 1 alert / h / condition
  await kvSet(env, `heal:alert:${key}`, Math.floor(Date.now() / 1000), 86400);
  try {
    await get(`https://api.telegram.org/bot${env.TG_ALERT_TOKEN}/sendMessage`, 8000, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_ADMIN_ID, text: `🛠 self-heal\n${text}`, disable_web_page_preview: true }),
    });
  } catch { /* alert channel down: nothing else to do */ }
}

export async function selfHeal(env: HealEnv): Promise<HealReport> {
  const actions: string[] = []; const alerts: string[] = [];
  const checks = await Promise.all([
    timed("site", async () => { const r = await get(`${SITE}/`, 12000); const t = await r.text(); if (r.status !== 200 || !t.includes("ArcTools")) throw new Error(`HTTP ${r.status}`); return `HTTP 200, ${Math.round(t.length / 1024)} kB`; }),
    timed("terminal", async () => { const r = await get(`${SITE}/trade`, 15000); if (r.status !== 200) throw new Error(`HTTP ${r.status}`); return "HTTP 200"; }),
    timed("buybot", async () => { const r = await get(`${BOT_ORIGIN}/health`, 10000); if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 60)}`); return "HTTP 200"; }),
    timed("index", async () => {
      const r = await get(`${BOT_ORIGIN}/api/tasks`, 10000); const j = (await r.json()) as { ingest?: { blocks?: number; phase?: string } };
      const lag = j.ingest?.blocks ?? -1; if (lag < 0) throw new Error("no ingest info"); return `lag ${lag} blocks, ${j.ingest?.phase}`;
    }),
    timed("watchdog", async () => { const r = await get(`${BOT_ORIGIN}/api/status`, 10000); const j = (await r.json()) as { state?: string; checks?: Record<string, { ok: boolean; detail: string }> }; const bad = Object.entries(j.checks ?? {}).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.detail.slice(0, 50)}`); return `${j.state}${bad.length ? " — " + bad.join(" | ") : ""}`; }),
    timed("relay", async () => { const r = await get(`${RELAY}/stats`, 10000); if (r.status !== 200) throw new Error(`HTTP ${r.status}`); const j = (await r.json()) as { ok?: number; fail?: number; cooldown?: Record<string, number> }; return `ok ${j.ok} fail ${j.fail} cooldown ${Object.keys(j.cooldown ?? {}).length}`; }),
    timed("quotes", async () => { const r = await get(`${SITE}/api/swaproute?token=${ARCT}&side=buy&amount=1000000000000000000`, 15000); const j = (await r.json()) as { legs?: unknown[]; out?: string; error?: string }; if (!j.legs?.length) throw new Error(j.error ?? "no route"); return `${j.legs.length} leg(s), out ${j.out}`; }),
    timed("chain", async () => { const r = await get(`${BOT_ORIGIN}/api/chain-status`, 10000); const j = (await r.json()) as { down?: boolean; last_block?: number; stale_s?: number }; return `${j.down ? "DOWN" : "live"} block ${j.last_block} stale ${j.stale_s}s`; }),
  ]);
  const c = Object.fromEntries(checks.map((x) => [x.name, x]));

  // --- buybot down → restart after 2 consecutive misses
  const nb = await bump(env, "buybot", c.buybot.ok);
  if (nb >= 2) { const a = await railwayRestart(env, "buybot"); actions.push(a); await telegram(env, "buybot", `buybot /health failing ×${nb} (${c.buybot.detail}) → ${a}`, alerts); }

  // --- index stuck (lag > 20k and not shrinking twice in a row) → restart buybot
  const lagNow = c.index.ok ? Number(c.index.detail.match(/lag (\d+)/)?.[1] ?? -1) : -1;
  if (lagNow >= 0) {
    const lagPrev = await kvNum(env, "heal:lag:prev");
    await kvSet(env, "heal:lag:prev", lagNow, 86400);
    const stuck = lagNow > 20_000 && lagPrev > 0 && lagNow >= lagPrev;
    const ns = await bump(env, "indexstuck", !stuck);
    if (ns >= 2) { const a = await railwayRestart(env, "buybot"); actions.push(a); await telegram(env, "index", `index lag ${lagNow} not shrinking (prev ${lagPrev}) → ${a}`, alerts); }
    else if (lagNow > 20_000) await telegram(env, "indexlag", `index lag ${lagNow} blocks (prev ${lagPrev})`, alerts);
  }

  // --- relay down → restart after 2 misses
  const nr = await bump(env, "relay", c.relay.ok);
  if (nr >= 2) { const a = await railwayRestart(env, "relay"); actions.push(a); await telegram(env, "relay", `relay /stats failing ×${nr} (${c.relay.detail}) → ${a}`, alerts); }

  // --- things we cannot fix from here: tell the admin
  if (!c.site.ok || !c.terminal.ok) await telegram(env, "site", `site probe failed: / ${c.site.detail} · /trade ${c.terminal.detail}`, alerts);
  if (!c.quotes.ok && c.relay.ok) await telegram(env, "quotes", `swap quotes failing: ${c.quotes.detail}`, alerts);
  if (c.watchdog.ok && /degraded|down/i.test(c.watchdog.detail)) { const n = await bump(env, "watchdog", false); if (n >= 3) await telegram(env, "watchdog", `watchdog ${c.watchdog.detail}`, alerts); } else await bump(env, "watchdog", true);

  // --- warm the caches users hit first (cold SSR is the other source of slow / failed loads)
  await Promise.allSettled([
    get(`${SITE}/api/tokens`, 20000), get(`${BOT_ORIGIN}/api/trending?minutes=0&limit=400`, 20000), get(`${BOT_ORIGIN}/api/alpha?mode=accum&limit=20`, 20000),
    get(`${SITE}/token/${ARCT}`, 20000),
  ]);

  const report: HealReport = { ts: Math.floor(Date.now() / 1000), ok: checks.every((x) => x.ok), checks, actions, alerts };
  await kvSet(env, "heal:last", JSON.stringify(report), 7 * 86400);
  return report;
}
