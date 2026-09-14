"""Referral hooks for the sniper: the ledger lives in the buybot API (shared with the site)."""
import logging
import os

import aiohttp

log = logging.getLogger("ref")
API = os.getenv("REF_API", "https://bot-production-4200.up.railway.app")
AUTH = os.getenv("REF_AUTH", "")
SHARE = float(os.getenv("REF_SHARE", "0.25"))


async def _post(path: str, body: dict, auth: bool = False) -> dict:
    headers = {"X-Ref-Auth": AUTH} if auth else {}
    async with aiohttp.ClientSession() as s:
        async with s.post(API + path, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as r:
            return await r.json(content_type=None)


async def _get(path: str) -> dict:
    async with aiohttp.ClientSession() as s:
        async with s.get(API + path, timeout=aiohttp.ClientTimeout(total=15)) as r:
            return await r.json(content_type=None)


async def bind(tg_id: int, code: str) -> str:
    try:
        return (await _post("/api/ref/bind", {"subject_kind": "tg", "subject_id": str(tg_id), "code": code})).get("result", "error")
    except Exception as e:  # noqa
        log.warning("ref bind: %s", e)
        return "error"


async def credit(tg_id: int, tx: str, fee_usd: float) -> None:
    """Fire-and-forget after a confirmed buy/sell: credits the referrer SHARE of the platform fee."""
    if not AUTH or fee_usd <= 0 or not tx:
        return
    try:
        await _post("/api/ref/credit", {"subject_kind": "tg", "subject_id": str(tg_id), "source": "sniper", "tx": tx, "fee_usd": fee_usd}, auth=True)
    except Exception as e:  # noqa
        log.warning("ref credit: %s", e)


async def stats(tg_id: int) -> dict:
    return await _get(f"/api/ref/stats?tg={tg_id}")


async def set_payout_wallet(tg_id: int, wallet: str) -> None:
    try:
        await _post("/api/ref/payout-wallet", {"tg": str(tg_id), "payout_wallet": wallet})
    except Exception as e:  # noqa
        log.warning("ref payout wallet: %s", e)


async def claim(tg_id: int) -> dict:
    """Pay out this user's pending referral USDC to their payout wallet (buybot ledger does the transfer)."""
    try:
        return await _post("/api/ref/claim", {"tg": str(tg_id)}, auth=True)
    except Exception as e:  # noqa
        return {"error": str(e)[:100]}
