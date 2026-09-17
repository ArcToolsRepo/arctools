"""Token claims: let the people who made a token give it its logo and socials.

For a token that never touched a launchpad API there is no free source for artwork — the contract carries nothing,
the explorer has nothing, and the X lookup needs a funded twitterapi.io account. Guessing is worse than blank.

So we let the token's own deployer set it, and prove it with the one thing only they have: the deploy wallet.
They sign a fixed message containing the contract address; we recover the signer and compare it with the address
that actually created the contract. A match applies the metadata immediately and LOCKS the row, so no later
automated guess can overwrite it.

Anyone else can still suggest metadata; those land in a queue and need a nod from the admin over Telegram.
"""
from __future__ import annotations

import logging
import re
import time

import aiohttp
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import text

from . import db

log = logging.getLogger("claims")

CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Cache-Control": "no-store"}
HANDLE = re.compile(r"^@?[A-Za-z0-9_]{1,15}$")
TG = re.compile(r"^@?[A-Za-z0-9_+]{3,40}$")
URL = re.compile(r"^https://[A-Za-z0-9.\-]+\.[A-Za-z]{2,12}(/[^\s]{0,80})?$")
IMG = re.compile(r"^https://[^\s]{6,300}$")


def claim_message(token: str) -> str:
    """The exact text a deployer signs. Chain-bound and token-bound, so a signature cannot be replayed elsewhere."""
    return f"ArcTools token claim\nchain: arc-5042\ntoken: {token.lower()}\nI am the deployer of this token."


async def init() -> None:
    await db.execute(text("""CREATE TABLE IF NOT EXISTS token_claims (
        token VARCHAR(64) PRIMARY KEY, signer VARCHAR(64), logo VARCHAR(300), x_handle VARCHAR(64),
        tg_handle VARCHAR(64), domain VARCHAR(160), ts BIGINT, verified SMALLINT DEFAULT 0, note VARCHAR(160))"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS token_suggestions (
        id SERIAL PRIMARY KEY, token VARCHAR(64), logo VARCHAR(300), x_handle VARCHAR(64), tg_handle VARCHAR(64),
        domain VARCHAR(160), ts BIGINT, ip VARCHAR(64), status VARCHAR(12) DEFAULT 'pending')"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS token_suggestions_status ON token_suggestions (status, ts)"))


async def _deployer_of(token: str) -> str | None:
    """Who created this contract: our own registry first, then the earliest mint/transfer in the index."""
    row = await db.fetchone(text("SELECT deployer FROM social_tokens WHERE token = :t AND deployer IS NOT NULL")
                            .bindparams(t=token))
    if row and row["deployer"]:
        return str(row["deployer"]).lower()
    row = await db.fetchone(text("SELECT wallet FROM swaps WHERE token = :t ORDER BY ts ASC LIMIT 1").bindparams(t=token))
    return str(row["wallet"]).lower() if row and row["wallet"] else None


def _clean(body: dict) -> dict:
    out: dict[str, str] = {}
    logo = (body.get("logo") or "").strip()
    if logo and IMG.match(logo):
        out["logo"] = logo[:300]
    x = (body.get("x_handle") or "").strip().lstrip("@")
    if x and HANDLE.match(x):
        out["x_handle"] = x[:64]
    tg = (body.get("tg_handle") or "").strip().lstrip("@")
    if tg and TG.match(tg):
        out["tg_handle"] = tg[:64]
    web = (body.get("domain") or "").strip()
    if web and URL.match(web):
        out["domain"] = web[:160]
    return out


async def _image_ok(url: str) -> bool:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    return False
                if not (r.headers.get("Content-Type") or "").startswith("image/"):
                    return False
                return int(r.headers.get("Content-Length") or 1) < 4_000_000
    except Exception:  # noqa
        return False


async def api_token_claim(request):
    """POST /api/token-claim {token, signature, logo?, x_handle?, tg_handle?, domain?}

    Applies instantly when the recovered signer is the token's deployer."""
    from aiohttp import web
    try:
        body = await request.json()
    except Exception:  # noqa
        return web.json_response({"error": "bad json"}, status=400, headers=CORS)
    token = (body.get("token") or "").lower()
    sig = (body.get("signature") or "").strip()
    if not re.match(r"^0x[a-f0-9]{40}$", token) or not sig.startswith("0x"):
        return web.json_response({"error": "token and signature are required"}, status=400, headers=CORS)
    fields = _clean(body)
    if not fields:
        return web.json_response({"error": "nothing valid to set: logo must be an https image URL, X/Telegram a handle"},
                                 status=400, headers=CORS)
    try:
        signer = Account.recover_message(encode_defunct(text=claim_message(token)), signature=sig).lower()
    except Exception as e:  # noqa
        return web.json_response({"error": f"signature does not verify: {str(e)[:60]}"}, status=400, headers=CORS)
    deployer = await _deployer_of(token)
    if not deployer:
        return web.json_response({"error": "we do not know this token's deployer yet — try again in a few minutes"},
                                 status=409, headers=CORS)
    if signer != deployer:
        return web.json_response({"error": "that wallet did not deploy this token", "signer": signer,
                                  "deployer": deployer}, status=403, headers=CORS)
    if fields.get("logo") and not await _image_ok(fields["logo"]):
        return web.json_response({"error": "the logo URL did not return an image"}, status=400, headers=CORS)

    now = int(time.time())
    await db.execute(text("""
        INSERT INTO token_claims (token, signer, logo, x_handle, tg_handle, domain, ts, verified, note)
        VALUES (:t, :s, :l, :x, :g, :d, :n, 1, 'deployer signature')
        ON CONFLICT (token) DO UPDATE SET signer = EXCLUDED.signer, logo = COALESCE(EXCLUDED.logo, token_claims.logo),
            x_handle = COALESCE(EXCLUDED.x_handle, token_claims.x_handle),
            tg_handle = COALESCE(EXCLUDED.tg_handle, token_claims.tg_handle),
            domain = COALESCE(EXCLUDED.domain, token_claims.domain), ts = EXCLUDED.ts, verified = 1
    """).bindparams(t=token, s=signer, l=fields.get("logo"), x=fields.get("x_handle"),
                    g=fields.get("tg_handle"), d=fields.get("domain"), n=now))
    # a verified claim outranks anything automated, and locks the row against later guesses
    await db.execute(text("""
        INSERT INTO social_tokens (token, symbol, name, logo, x_handle, tg_handle, domain, ident_locked, ident_checked, ident_src, updated)
        VALUES (:t, '', '', :l, :x, :g, :d, 1, :n, 'claim', :n)
        ON CONFLICT (token) DO UPDATE SET
            logo = COALESCE(EXCLUDED.logo, social_tokens.logo),
            x_handle = COALESCE(EXCLUDED.x_handle, social_tokens.x_handle),
            tg_handle = COALESCE(EXCLUDED.tg_handle, social_tokens.tg_handle),
            domain = COALESCE(EXCLUDED.domain, social_tokens.domain),
            ident_locked = 1, ident_src = 'claim', updated = EXCLUDED.updated
    """).bindparams(t=token, l=fields.get("logo"), x=fields.get("x_handle"), g=fields.get("tg_handle"),
                    d=fields.get("domain"), n=now))
    if fields.get("logo"):
        await db.execute(text("UPDATE social_tokens SET logo = :l, logo_src = 'claim', logo_checked = :far WHERE token = :t")
                         .bindparams(t=token, l=fields["logo"], far=now + 10 * 365 * 86400))
    log.warning("token claim accepted: %s by %s %s", token[:12], signer[:12], list(fields))
    return web.json_response({"ok": True, "applied": fields, "signer": signer}, headers=CORS)


async def api_identity_suggest(request):
    """POST /api/identity-suggest — anyone can propose metadata; it waits for an admin nod."""
    from aiohttp import web
    try:
        body = await request.json()
    except Exception:  # noqa
        return web.json_response({"error": "bad json"}, status=400, headers=CORS)
    token = (body.get("token") or "").lower()
    if not re.match(r"^0x[a-f0-9]{40}$", token):
        return web.json_response({"error": "bad token"}, status=400, headers=CORS)
    fields = _clean(body)
    if not fields:
        return web.json_response({"error": "nothing valid to suggest"}, status=400, headers=CORS)
    ip = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For", "").split(",")[0] or "?"
    recent = await db.fetchone(text("SELECT count(*) c FROM token_suggestions WHERE ip = :i AND ts > :s")
                               .bindparams(i=ip[:64], s=int(time.time()) - 3600))
    if recent and int(recent["c"]) >= 10:
        return web.json_response({"error": "too many suggestions from this address, try later"}, status=429, headers=CORS)
    await db.execute(text("""INSERT INTO token_suggestions (token, logo, x_handle, tg_handle, domain, ts, ip)
        VALUES (:t, :l, :x, :g, :d, :n, :i)""").bindparams(
        t=token, l=fields.get("logo"), x=fields.get("x_handle"), g=fields.get("tg_handle"),
        d=fields.get("domain"), n=int(time.time()), i=ip[:64]))
    return web.json_response({"ok": True, "queued": fields,
                              "note": "thanks — an admin reviews this; a deployer signature applies instantly instead"},
                             headers=CORS)


async def api_claim_message(request):
    """GET /api/claim-message?token=0x… — the exact text the deployer has to sign."""
    from aiohttp import web
    token = (request.query.get("token") or "").lower()
    if not re.match(r"^0x[a-f0-9]{40}$", token):
        return web.json_response({"error": "bad token"}, status=400, headers=CORS)
    return web.json_response({"message": claim_message(token), "deployer": await _deployer_of(token)}, headers=CORS)


async def api_suggestions(request):
    """GET /api/suggestions — pending queue (admin view)."""
    from aiohttp import web
    rows = await db.fetchall(text("SELECT id, token, logo, x_handle, tg_handle, domain, ts, status "
                                  "FROM token_suggestions ORDER BY ts DESC LIMIT 50"))
    claims = await db.fetchall(text("SELECT token, signer, logo, x_handle, ts FROM token_claims ORDER BY ts DESC LIMIT 20"))
    return web.json_response({"pending": [dict(r) for r in rows if r["status"] == "pending"],
                              "claims": [dict(r) for r in claims]}, headers=CORS)


def register(app) -> None:
    app.router.add_post("/api/token-claim", api_token_claim)
    app.router.add_post("/api/identity-suggest", api_identity_suggest)
    app.router.add_get("/api/claim-message", api_claim_message)
    app.router.add_get("/api/suggestions", api_suggestions)
