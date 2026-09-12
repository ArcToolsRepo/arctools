"""Auto-snipe rules: buy every new launch that passes the user's filters, hands-free.

A rule = venues + risk filters + size. `evaluate_new_token()` is called from the launch watcher for every
fresh token; it pulls the ArcTools risk read-out (/api/holder-risk → score, dev %, bundle %, rug history,
holders) and the site token page (liquidity, mcap), then fires execute_buy with turbo gas and attaches the
user's protection orders (TP / SL / trailing / dump guard). Daily cap + max open positions keep it bounded.

Copy-trade filters live here too (kv `cpf:<tg_id>`): min_usd of the leader's buy, max open copies, size
mode (flat | proportional %), mirror_sells.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import aiohttp
from sqlalchemy import BigInteger, Column, Float, Integer, String, Table, Text, insert, select, update

from . import db

log = logging.getLogger("autosnipe")
notify = None

INDEX_API = "https://bot-production-4200.up.railway.app"
SITE_API = "https://arctools.fun"

autorules = Table("autorules", db.meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("name", String(32), default="rule"),
    Column("pads", String(256), default="*"),        # csv of pad names or *
    Column("amount_usdc", Float, default=5),
    Column("min_score", Integer, default=60),
    Column("max_dev_pct", Float, default=10),
    Column("max_bundle_pct", Float, default=20),
    Column("min_liq_usd", Float, default=500),
    Column("max_mcap_usd", Float, default=0),        # 0 = any
    Column("min_holders", Integer, default=0),
    Column("no_rugger", Integer, default=1),
    Column("max_per_day", Integer, default=10),
    Column("max_open", Integer, default=5),
    Column("enabled", Integer, default=1),
    Column("fired_today", Integer, default=0),
    Column("day", String(10), default=""),
    Column("last_result", Text, default=""),
    Column("created_at", BigInteger),
)

_seen: dict[str, float] = {}

DEFAULT_CPF = {"min_usd": 0.0, "max_open": 0, "mode": "flat", "pct": 10.0, "mirror_sells": 1}


async def get_cpf(tg_id: int) -> dict:
    d = dict(DEFAULT_CPF)
    raw = await db.kv_get(f"cpf:{tg_id}", "")
    if raw:
        try:
            d.update(json.loads(raw))
        except Exception:  # noqa
            pass
    return d


async def set_cpf(tg_id: int, **kw) -> dict:
    d = await get_cpf(tg_id)
    d.update(kw)
    await db.kv_set(f"cpf:{tg_id}", json.dumps(d))
    return d


async def _risk(token: str) -> dict | None:
    """holder-risk with a couple of retries — a brand-new token may need ~10 s before the index has its first swap."""
    for attempt in range(3):
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(f"{INDEX_API}/api/holder-risk", params={"tokens": token}, timeout=aiohttp.ClientTimeout(total=25)) as r:
                    if r.status == 200:
                        j = await r.json()
                        k = (j.get("risk") or {}).get(token.lower())
                        if k:
                            return k
        except Exception as e:  # noqa
            log.debug("risk %s: %s", token, e)
        await asyncio.sleep(5)
    return None


async def _page(token: str) -> dict:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{SITE_API}/api/tokenpage", params={"ca": token}, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status == 200:
                    return await r.json()
    except Exception:  # noqa
        pass
    return {}


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def check_rule(rule: dict, k: dict, page: dict, pad_name: str) -> tuple[bool, str]:
    pads = [p.strip() for p in (rule["pads"] or "*").split(",") if p.strip()]
    if pads and "*" not in pads and pad_name not in pads:
        return False, f"venue {pad_name} not in rule"
    sc = k.get("score")
    if sc is not None and sc < int(rule["min_score"] or 0):
        return False, f"score {sc} < {rule['min_score']}"
    dv = k.get("dev_pct")
    if dv is not None and dv > float(rule["max_dev_pct"] or 100):
        return False, f"dev {dv:.0f}% > {rule['max_dev_pct']:g}%"
    bd = k.get("bundle_pct")
    if bd is not None and bd > float(rule["max_bundle_pct"] or 100):
        return False, f"bundle {bd:.0f}% > {rule['max_bundle_pct']:g}%"
    if int(rule["no_rugger"] or 0) and (k.get("dev_rugs") or 0) > 0:
        return False, f"dev dumped {k['dev_rugs']} token(s) before"
    if (k.get("dev_sold_usd") or 0) > 0:
        return False, f"dev already sold ${k['dev_sold_usd']:,.0f}"
    liq = page.get("liquidityUsdc")
    if liq is not None and float(rule["min_liq_usd"] or 0) > 0 and float(liq) < float(rule["min_liq_usd"]):
        return False, f"liq ${float(liq):,.0f} < ${rule['min_liq_usd']:,.0f}"
    mc = page.get("mcapUsd")
    if mc and float(rule["max_mcap_usd"] or 0) > 0 and float(mc) > float(rule["max_mcap_usd"]):
        return False, f"mcap ${float(mc):,.0f} > ${rule['max_mcap_usd']:,.0f}"
    hold = k.get("holders") or 0
    if int(rule["min_holders"] or 0) and hold < int(rule["min_holders"]):
        return False, f"holders {hold} < {rule['min_holders']}"
    return True, f"score {sc} · dev {dv if dv is not None else '?'}% · bundle {bd if bd is not None else '?'}% · liq ${float(liq or 0):,.0f}"


async def evaluate_new_token(token: str, pad_name: str, curve=None) -> None:
    token = token.lower()
    now = time.time()
    if token in _seen and now - _seen[token] < 3600:
        return
    _seen[token] = now
    rules = await db.fetchall(select(autorules).where(autorules.c.enabled == 1))
    if not rules:
        return
    # let the first swaps land so dev / bundle / liquidity are measurable
    await asyncio.sleep(8)
    k = await _risk(token) or {}
    page = await _page(token)
    from . import sniper, wallets as W
    from .pads import auto_pad, pad_by_name
    for rule in rules:
        try:
            if rule["day"] != _today():
                await db.execute(update(autorules).where(autorules.c.id == rule["id"]).values(day=_today(), fired_today=0))
                rule = dict(rule, day=_today(), fired_today=0)
            if int(rule["fired_today"] or 0) >= int(rule["max_per_day"] or 10):
                continue
            n_open = len(await db.fetchall(select(db.positions.c.id).where((db.positions.c.tg_id == rule["tg_id"]) & (db.positions.c.status == "open"))))
            if int(rule["max_open"] or 0) and n_open >= int(rule["max_open"]):
                continue
            ok, why = check_rule(rule, k, page, pad_name)
            if not ok:
                await db.execute(update(autorules).where(autorules.c.id == rule["id"]).values(last_result=f"skip {page.get('symbol') or token[:8]}: {why}"))
                continue
            u = await db.get_user(rule["tg_id"])
            w = await W.active_wallet(rule["tg_id"])
            if not w:
                continue
            pad = pad_by_name(pad_name)
            key = curve
            if pad is None:
                pad, key = await auto_pad(token)
            res = await sniper.execute_buy(rule["tg_id"], token, pad, float(rule["amount_usdc"]), u["slippage"], "turbo", [w["id"]], curve=key)
            filled = any(r.get("ok") for r in res)
            await db.execute(update(autorules).where(autorules.c.id == rule["id"]).values(
                fired_today=int(rule["fired_today"] or 0) + 1, last_result=f"{'buy' if filled else 'fail'} {page.get('symbol') or token[:8]}: {why}"))
            made = next((r.get("protect") for r in res if r.get("ok")), None) or []
            if notify:
                from .ui.keyboards import kb
                await notify(rule["tg_id"],
                             f"🤖 AUTO-SNIPE <b>{rule['name']}</b> {'FILLED' if filled else 'FAILED'}\n"
                             f"<b>{page.get('symbol') or '?'}</b> on {pad_name} · {rule['amount_usdc']:g} USDC\n{why}\n"
                             + "\n".join(f"{'✅' if r.get('ok') else '❌'} <code>{r.get('tx', r.get('err'))}</code>" for r in res)
                             + (f"\n🛡 attached: {', '.join(made)}" if made else ""),
                             kb([[("📊 Positions", "portfolio"), ("🤖 Rules", "auto")]]))
        except Exception as e:  # noqa
            log.warning("autosnipe rule %s: %s", rule.get("id"), e)


def describe_rule(r: dict) -> str:
    pads = r["pads"] if r["pads"] and r["pads"] != "*" else "all venues"
    return (f"{'🟢' if r['enabled'] else '⚪'} <b>{r['name']}</b> — {r['amount_usdc']:g} USDC on {pads}\n"
            f"   score ≥ {r['min_score']} · dev ≤ {r['max_dev_pct']:g}% · bundle ≤ {r['max_bundle_pct']:g}% · liq ≥ ${r['min_liq_usd']:,.0f}"
            + (f" · mc ≤ ${r['max_mcap_usd']:,.0f}" if r["max_mcap_usd"] else "")
            + (" · no ruggers" if r["no_rugger"] else "")
            + f"\n   max {r['max_per_day']}/day, {r['max_open']} open · today {r['fired_today'] if r['day'] == _today() else 0}"
            + (f"\n   last: {r['last_result'][:90]}" if r["last_result"] else ""))
