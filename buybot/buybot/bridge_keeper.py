"""Finishes CCTP bridges that the browser could not finish.

Our bridge burns USDC on the source chain with `mintRecipient = destinationCaller = ArcBridgeFeeProxyV2`. That is
what makes the mint atomic with the 2% fee and stops a public relayer from dropping funds inside the proxy — but it
also means **only the proxy can complete the transfer**. If the user closes the tab before Circle's attestation is
ready, nobody ever calls it: the USDC is burned on the source chain and never appears on Arc.

Attestation timing is why this bites: a standard (finalized) transfer needs ~13-19 min on Ethereum and several
minutes on Arbitrum, while the page only polls for 10 minutes. From Base it usually lands in time — which is
exactly why the bridge looked like "Base works, the other chains do not".

This keeper closes that hole. Every cycle it:
  1. scans each source chain for DepositForBurn events aimed at domain 26 with our proxy as destinationCaller,
  2. asks Circle's Iris API for the attestation of those transactions,
  3. calls receiveMessage on the proxy from the keeper wallet, which mints and forwards to the real recipient.

The user can close the tab the moment the burn is signed. Everything is idempotent: a message already used reverts
harmlessly and is marked done.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import aiohttp
from eth_account import Account
from eth_utils import keccak
from sqlalchemy import text

from . import db

log = logging.getLogger("bridge_keeper")

ARC_RPC = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
PROXY = "0x292DDAeD9B959Cbe4df5ac35c52da1977E29916e"
TOKEN_MESSENGER = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"      # same address on every CCTP v2 chain
ARC_DOMAIN = 26
IRIS = "https://iris-api.circle.com/v2/messages"
KEY = os.getenv("BRIDGE_OWNER_KEY", "")
DEPOSIT_TOPIC = "0x" + keccak(text="DepositForBurn(address,uint256,address,bytes32,uint32,bytes32,bytes32,uint256,uint32,bytes)").hex()
RECEIVE_SEL = "0x" + keccak(text="bridgeReceive(bytes,bytes)")[:4].hex()

# public RPCs that answer without a key; each entry is tried in order
SOURCES: dict[int, dict] = {
    0: {"name": "Ethereum", "rpcs": ["https://rpc.mevblocker.io", "https://mainnet.gateway.tenderly.co", "https://eth.merkle.io", "https://ethereum-rpc.publicnode.com"], "span": 600, "block_time": 12.0},
    3: {"name": "Arbitrum", "rpcs": ["https://arbitrum-one.publicnode.com", "https://arb1.arbitrum.io/rpc"], "span": 20000, "block_time": 0.25},
    6: {"name": "Base", "rpcs": ["https://base.publicnode.com", "https://mainnet.base.org"], "span": 4000, "block_time": 2.0},
}


async def _rpc(s: aiohttp.ClientSession, urls: list[str] | str, method: str, params: list, timeout: float = 25):
    for u in ([urls] if isinstance(urls, str) else urls):
        try:
            async with s.post(u, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                              headers={"Content-Type": "application/json", "User-Agent": "ArcTools/1.0"},
                              timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                j = await r.json(content_type=None)
            if isinstance(j, dict) and "result" in j:
                return j["result"]
        except Exception:  # noqa
            continue
    return None


async def init() -> None:
    await db.execute(text("""CREATE TABLE IF NOT EXISTS bridge_pending (
        src_domain INTEGER NOT NULL, tx VARCHAR(80) NOT NULL, amount DOUBLE PRECISION, recipient VARCHAR(64),
        seen_ts BIGINT, done_ts BIGINT, arc_tx VARCHAR(80), attempts INTEGER DEFAULT 0, note VARCHAR(160),
        PRIMARY KEY (src_domain, tx))"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS bridge_pending_open ON bridge_pending (done_ts)"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS bridge_cursor (src_domain INTEGER PRIMARY KEY, block BIGINT)"))
    try:
        await db.execute(text("ALTER TABLE bridge_cursor ADD COLUMN IF NOT EXISTS backfilled SMALLINT DEFAULT 0"))
    except Exception:  # noqa
        pass


def _words(data: str) -> list[str]:
    d = data[2:] if data.startswith("0x") else data
    return [d[i * 64:(i + 1) * 64] for i in range(len(d) // 64)]


async def scan_source(s: aiohttp.ClientSession, domain: int) -> int:
    """Record every burn of ours on this chain that still needs a mint on Arc."""
    cfg = SOURCES[domain]
    head = await _rpc(s, cfg["rpcs"], "eth_blockNumber", [])
    if not head:
        return 0
    head = int(head, 16)
    row = await db.fetchone(text("SELECT block, backfilled FROM bridge_cursor WHERE src_domain = :d").bindparams(d=domain))
    frm = int(row["block"]) + 1 if row and row["block"] else head - cfg["span"]
    frm = max(frm, head - cfg["span"] * 6)                     # never walk back more than a few windows
    if not row or not row.get("backfilled"):
        # first run after the parser fix: the old reading never matched a burn, so walk 14 days back once
        frm = head - int(14 * 86400 / cfg["block_time"])
    found = 0
    span = cfg["span"]; fails = 0
    while frm <= head:
        to = min(head, frm + span)
        logs = await _rpc(s, cfg["rpcs"], "eth_getLogs",
                          [{"address": TOKEN_MESSENGER, "topics": [DEPOSIT_TOPIC], "fromBlock": hex(frm), "toBlock": hex(to)}], 45)
        if logs is None:
            # public RPCs answer 413 / "too many results" for a busy window: shrink and retry, give up for this cycle
            # only after several shrinks (the cursor keeps the last good block, so nothing is skipped)
            fails += 1
            if fails > 6:
                log.warning("bridge keeper: %s getLogs keeps failing at block %s (span %s)", cfg["name"], frm, span)
                return found
            span = max(250, span // 2)
            await asyncio.sleep(1.5)
            continue
        for lg in logs:
            w = _words(lg.get("data") or "")
            if len(w) < 7:
                continue
            # CCTP v2 DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor,
            #   bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger,
            #   bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)
            # → data words: amount, mintRecipient, destinationDomain, destTokenMessenger, destinationCaller, maxFee, hookData…
            # (the old reading had domain and recipient swapped, so no burn ever matched and nothing was finished)
            try:
                amount = int(w[0], 16) / 1e6
                dest = int(w[2], 16)
                recipient = "0x" + lg["topics"][2][-40:]          # depositor = who the proxy pays on Arc (messageSender)
                caller = "0x" + w[4][-40:]
            except Exception:  # noqa
                continue
            if dest != ARC_DOMAIN or caller.lower() != PROXY.lower():
                continue
            await db.execute(text(
                "INSERT INTO bridge_pending (src_domain, tx, amount, recipient, seen_ts) VALUES (:d, :t, :a, :r, :n) "
                "ON CONFLICT (src_domain, tx) DO NOTHING"
            ).bindparams(d=domain, t=lg["transactionHash"].lower(), a=amount, r=recipient.lower(), n=int(time.time())))
            found += 1
        await db.execute(text("INSERT INTO bridge_cursor (src_domain, block, backfilled) VALUES (:d, :b, 1) "
                              "ON CONFLICT (src_domain) DO UPDATE SET block = EXCLUDED.block, backfilled = 1").bindparams(d=domain, b=to))
        frm = to + 1
        await asyncio.sleep(0.4)                                 # public RPCs throttle bursts of getLogs
    return found


async def _attestation(s: aiohttp.ClientSession, domain: int, tx: str) -> tuple[str, str, str] | None:
    try:
        async with s.get(f"{IRIS}/{domain}", params={"transactionHash": tx},
                         timeout=aiohttp.ClientTimeout(total=20)) as r:
            if r.status != 200:
                return None
            j = await r.json(content_type=None)
    except Exception:  # noqa
        return None
    for m in (j.get("messages") or []):
        if m.get("status") == "complete" and m.get("message") and m.get("attestation"):
            return m["message"], m["attestation"], m.get("eventNonce") or ""
    return None


USED_SEL = "0x" + keccak(text="usedNonces(bytes32)")[:4].hex()
TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"   # MessageTransmitterV2 on Arc


async def _minted(s: aiohttp.ClientSession, nonce: str) -> bool | None:
    if not nonce:
        return None
    r = await _rpc(s, ARC_RPC, "eth_call", [{"to": TRANSMITTER, "data": USED_SEL + nonce[2:].rjust(64, "0")}, "latest"])
    return None if not r else int(r, 16) != 0


async def _reattest(s: aiohttp.ClientSession, nonce: str) -> bool:
    """A fast-transfer message (maxFee > 0) expires after a while; Circle re-signs it on request. Free, idempotent."""
    try:
        async with s.post(f"https://iris-api.circle.com/v2/reattest/{nonce}", json={}, timeout=aiohttp.ClientTimeout(total=20)) as r:
            return r.status == 200
    except Exception:  # noqa
        return False


def _encode_receive(message: str, attestation: str) -> str:
    m = message[2:] if message.startswith("0x") else message
    a = attestation[2:] if attestation.startswith("0x") else attestation
    mp = m.ljust(-(-len(m) // 64) * 64, "0")
    ap = a.ljust(-(-len(a) // 64) * 64, "0")
    off1 = 64
    off2 = off1 + 32 + len(mp) // 2
    return (RECEIVE_SEL + hex(off1)[2:].rjust(64, "0") + hex(off2)[2:].rjust(64, "0")
            + hex(len(m) // 2)[2:].rjust(64, "0") + mp
            + hex(len(a) // 2)[2:].rjust(64, "0") + ap)


async def complete_one(s: aiohttp.ClientSession, row: dict) -> bool:
    got = await _attestation(s, int(row["src_domain"]), row["tx"])
    if not got:
        return False
    message, attestation, ev_nonce = got
    if await _minted(s, ev_nonce):                              # the browser (or someone) already finished it
        await db.execute(text("UPDATE bridge_pending SET done_ts = :n, note = 'already minted' WHERE src_domain = :d AND tx = :t")
                         .bindparams(d=row["src_domain"], t=row["tx"], n=int(time.time())))
        return False
    data = _encode_receive(message, attestation)
    acct = Account.from_key(KEY)
    nonce = int(await _rpc(s, ARC_RPC, "eth_getTransactionCount", [acct.address, "pending"]) or "0x0", 16)
    gas = await _rpc(s, ARC_RPC, "eth_estimateGas", [{"from": acct.address, "to": PROXY, "data": data}])
    if not gas:
        # not minted, yet the call reverts → almost always "Message expired and must be re-signed": ask Circle for a
        # fresh signature and retry next cycle
        ok = await _reattest(s, ev_nonce) if ev_nonce else False
        await db.execute(text("UPDATE bridge_pending SET attempts = attempts + 1, note = :n WHERE src_domain = :d AND tx = :t")
                         .bindparams(d=row["src_domain"], t=row["tx"], n="estimateGas refused; re-attestation " + ("requested" if ok else "failed")))
        return False
    price = int(await _rpc(s, ARC_RPC, "eth_gasPrice", []) or "0x0", 16) or 10 ** 9
    tx = {"chainId": 5042, "data": data, "gas": int(int(gas, 16) * 1.3), "gasPrice": price,
          "nonce": nonce, "to": PROXY, "value": 0}
    signed = Account.sign_transaction(tx, KEY)
    sent = await _rpc(s, ARC_RPC, "eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
    if not sent:
        await db.execute(text("UPDATE bridge_pending SET attempts = attempts + 1 WHERE src_domain = :d AND tx = :t")
                         .bindparams(d=row["src_domain"], t=row["tx"]))
        return False
    await db.execute(text("UPDATE bridge_pending SET done_ts = :n, arc_tx = :a, note = 'completed by keeper' "
                          "WHERE src_domain = :d AND tx = :t")
                     .bindparams(d=row["src_domain"], t=row["tx"], n=int(time.time()), a=sent))
    log.warning("bridge keeper: finished %s $%s -> %s (arc %s)", SOURCES[int(row["src_domain"])]["name"],
                round(float(row["amount"] or 0), 2), row["recipient"], sent)
    return True


async def keeper_loop() -> None:
    if not KEY:
        log.warning("BRIDGE_OWNER_KEY not set — bridge keeper disabled")
        return
    await init()
    await asyncio.sleep(45)
    while True:
        try:
            async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) ArcTools-bridge-keeper/1.0", "Accept": "application/json"}) as s:
                for domain in SOURCES:
                    try:
                        n = await scan_source(s, domain)
                        if n:
                            log.info("bridge keeper: %s new burn(s) on %s", n, SOURCES[domain]["name"])
                    except Exception as e:  # noqa
                        log.warning("scan %s: %s", SOURCES[domain]["name"], str(e)[:90])
                open_rows = await db.fetchall(text(
                    "SELECT src_domain, tx, amount, recipient FROM bridge_pending "
                    "WHERE done_ts IS NULL AND attempts < 40 ORDER BY seen_ts LIMIT 20"))
                for r in open_rows:
                    try:
                        await complete_one(s, dict(r))
                    except Exception as e:  # noqa
                        log.warning("complete %s: %s", r["tx"][:14], str(e)[:90])
                    await asyncio.sleep(1)
        except Exception as e:  # noqa
            log.warning("bridge keeper: %s", str(e)[:120])
        await asyncio.sleep(60)


async def api_bridge_pending(request):
    """GET /api/bridge-pending — what the keeper still owes, so support questions have an answer."""
    from aiohttp import web
    rows = await db.fetchall(text(
        "SELECT src_domain, tx, amount, recipient, seen_ts, done_ts, arc_tx, attempts, note FROM bridge_pending "
        "ORDER BY seen_ts DESC LIMIT 50"))
    out = [dict(r) for r in rows]
    return web.json_response({
        "open": [r for r in out if not r["done_ts"]],
        "recent_done": [r for r in out if r["done_ts"]][:10],
        "sources": {str(k): v["name"] for k, v in SOURCES.items()},
    }, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})
