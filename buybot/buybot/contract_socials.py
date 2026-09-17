"""Socials and artwork read out of the token contract itself.

Most Arc tokens never touch a launchpad with an API — a dev deploys an ERC-20 straight into a Uniswap V4 pool and
puts the project's links *inside the contract*: a `website()` / `telegram()` getter, a `tokenURI`-style metadata
document, or simply a hardcoded "https://t.me/…" string sitting in the deployed bytecode. All of it is public and
costs one `eth_getCode` to read, so there is no reason for those tokens to show up blank next to launchpad ones.

Order of attempts per token:
  1. string getters (website / telegram / twitter / social / links / description / metadata / tokenURI)
  2. any URL literal found in the raw bytecode (the most common case — constants are stored verbatim)
  3. a metadata JSON document, when one of the getters points at one (ipfs:// is rewritten to a gateway)

Runs as its own slow background loop, bounded to a small batch, and writes only fields that are still empty.
It never touches the ingest path.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time

import aiohttp
from sqlalchemy import text

from . import db
from .logos import _decode_string, _ipfs_to_http, _rpc, _sel, _verify

SYM_SEL = "0x95d89b41"      # symbol()
NAME_SEL = "0x06fdde03"     # name()

log = logging.getLogger("csocials")

GETTERS = ["website()", "telegram()", "twitter()", "social()", "socials()", "links()",
           "description()", "metadata()", "metadataURI()", "tokenURI()", "uri()", "info()", "getInfo()"]

TG = re.compile(r"(?:https?://)?t\.me/([A-Za-z0-9_+]{3,40})", re.I)
TW = re.compile(r"(?:https?://)?(?:www\.)?(?:twitter|x)\.com/(?!i/|home|share|intent)([A-Za-z0-9_]{2,15})", re.I)
WEB = re.compile(r"https?://(?!t\.me|twitter\.com|x\.com|www\.twitter\.com|www\.x\.com)([A-Za-z0-9.\-]+\.[A-Za-z]{2,12}(?:/[^\s\"'\\)<>]{0,60})?)", re.I)
IMG = re.compile(r"(https?://[^\s\"'\\)<>]+\.(?:png|jpg|jpeg|webp|gif)|ipfs://[A-Za-z0-9]+[^\s\"'\\)<>]*)", re.I)
ASCII = re.compile(rb"[ -~]{8,}")


def _from_text(txt: str) -> dict:
    out: dict[str, str] = {}
    if m := TG.search(txt):
        out["tg"] = m.group(1)
    if m := TW.search(txt):
        out["tw"] = m.group(1)
    if m := WEB.search(txt):
        out["web"] = "https://" + m.group(1) if not m.group(0).startswith("http") else m.group(0)
    if m := IMG.search(txt):
        out["logo"] = _ipfs_to_http(m.group(1))
    return out


async def read_contract(s: aiohttp.ClientSession, token: str) -> dict:
    """Everything the contract is willing to tell us about itself."""
    found: dict[str, str] = {}
    # 1) string getters, one batched multicall-free pass (13 cheap eth_calls, only for tokens we have not checked)
    for sig in GETTERS:
        try:
            res = await _rpc(s, "eth_call", [{"data": _sel(sig), "to": token}, "latest"], 8)
        except Exception:  # noqa
            continue
        val = _decode_string(res)
        if not val or len(val) < 4:
            continue
        found.update({k: v for k, v in _from_text(val).items() if k not in found})
        if val.startswith(("http", "ipfs://")) and not found.get("doc"):
            found["doc"] = _ipfs_to_http(val)
    # 2) raw bytecode literals — where hardcoded links actually live
    if len(found) < 3:
        code = await _rpc(s, "eth_getCode", [token, "latest"], 12)
        if isinstance(code, str) and len(code) > 4:
            try:
                blob = b" ".join(ASCII.findall(bytes.fromhex(code[2:])))
                found.update({k: v for k, v in _from_text(blob.decode("ascii", "ignore")).items() if k not in found})
            except Exception:  # noqa
                pass
    # 3) a metadata document, if one of the getters pointed at it
    if found.get("doc") and len(found) < 4:
        try:
            async with s.get(found["doc"], timeout=aiohttp.ClientTimeout(total=10)) as r:
                doc = await r.json(content_type=None) if r.status == 200 else {}
            if isinstance(doc, dict):
                found.update({k: v for k, v in _from_text(json.dumps(doc)).items() if k not in found})
        except Exception:  # noqa
            pass
    return found


async def sweep_once(limit: int = 250) -> tuple[int, int]:
    """One batch of tokens that trade on a plain pool and still have no socials."""
    rows = await db.fetchall(text("""
        SELECT s.token, s.x_handle, s.tg_handle, s.domain, s.logo
        FROM social_tokens s
        WHERE (s.x_handle IS NULL AND s.tg_handle IS NULL AND s.domain IS NULL)
          AND (s.csocials_checked IS NULL OR s.csocials_checked < :stale)
          AND EXISTS (SELECT 1 FROM swaps w WHERE w.token = s.token AND w.ts > :fresh)
        ORDER BY s.updated DESC NULLS LAST LIMIT :n
    """).bindparams(stale=int(time.time()) - 7 * 86400, fresh=int(time.time()) - 14 * 86400, n=limit))
    if not rows:
        return 0, 0
    hits = 0
    async with aiohttp.ClientSession() as s:
        for r in rows:
            tok = r["token"]
            try:
                got = await read_contract(s, tok)
            except Exception:  # noqa
                got = {}
            # the watchdog counts rows whose symbol is still a hex stub as "garbled" — the contract knows better
            try:
                sym = _decode_string(await _rpc(s, "eth_call", [{"data": SYM_SEL, "to": tok}, "latest"], 8))
                nam = _decode_string(await _rpc(s, "eth_call", [{"data": NAME_SEL, "to": tok}, "latest"], 8))
                if sym or nam:
                    await db.execute(text(
                        "UPDATE social_tokens SET symbol = COALESCE(NULLIF(symbol, ''), :s), name = COALESCE(NULLIF(name, ''), :n) WHERE token = :t"
                    ).bindparams(t=tok, s=(sym or None) and sym[:32], n=(nam or None) and nam[:80]))
                    if sym:
                        await db.execute(text(
                            "INSERT INTO token_symbols (token, symbol) VALUES (:t, :s) ON CONFLICT (token) DO UPDATE "
                            "SET symbol = COALESCE(NULLIF(token_symbols.symbol, ''), EXCLUDED.symbol)"
                        ).bindparams(t=tok, s=sym[:32]))
            except Exception:  # noqa
                pass
            logo = got.get("logo")
            if logo and not await _verify(s, logo):
                logo = None
            if got.get("tw") or got.get("tg") or got.get("web") or logo:
                hits += 1
                await db.execute(text("""
                    UPDATE social_tokens SET
                        x_handle = COALESCE(x_handle, :tw), tg_handle = COALESCE(tg_handle, :tg),
                        domain = COALESCE(domain, :web), logo = COALESCE(logo, :logo),
                        csocials_checked = :now, updated = :now
                    WHERE token = :t
                """).bindparams(t=tok, tw=got.get("tw"), tg=got.get("tg"), web=got.get("web"), logo=logo,
                                now=int(time.time())))
            else:
                await db.execute(text("UPDATE social_tokens SET csocials_checked = :now WHERE token = :t")
                                 .bindparams(t=tok, now=int(time.time())))
            await asyncio.sleep(0.04)                     # the node is next door now; keep a small gap anyway
    return len(rows), hits


async def csocials_loop() -> None:
    await asyncio.sleep(90)
    try:
        await db.execute(text("ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS csocials_checked BIGINT"))
        await db.execute(text("CREATE INDEX IF NOT EXISTS social_tokens_csocials ON social_tokens (csocials_checked)"))
    except Exception as e:  # noqa
        log.warning("csocials init: %s", str(e)[:100])
    while True:
        try:
            from .insider import _lag
            if (_lag.get("blocks") or 0) > 25:            # live ingest always wins
                await asyncio.sleep(20)
                continue
            seen, hits = await sweep_once()
            if seen:
                log.info("contract socials: %s checked, %s filled", seen, hits)
        except Exception as e:  # noqa
            log.warning("csocials loop: %s", str(e)[:120])
        await asyncio.sleep(20)
