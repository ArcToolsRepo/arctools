"""ARCT buyback keeper.

Every swap made on the site pays 0.5% of the USDC side to the treasury (ArcAggregator takes it in the same
transaction).  This loop turns that USDC into burned ARCT:

    treasury USDC  ->  ArcAggregator.buy(ARCT, legs, minOut, DEAD, feeBps = 0)  ->  ARCT lands at 0x…dead

The tokens are sent straight to the dead address by the router, so the buy and the burn are the same transaction
and there is no window where the keeper holds ARCT.  /api/arct-burn already counts the dead balance, so the
public burn counter moves on its own; `buybacks` here only records what THIS loop did, so the site can say
"bought back with swap fees" instead of "burned by someone".

Safety rails, in order of how much they matter:
  * a reserve is never touched — the treasury also pays referral rewards and relayer gas
  * one buyback per interval, capped in USDC, and never more than the fees actually collected since the last run
  * the route is quoted first; a buy that would move the price more than MAX_IMPACT is skipped, not forced
  * minOut is real here (unlike sniping): this is the house's own money and nobody is racing us
"""
from __future__ import annotations

import asyncio
import json
import os
import time

import aiohttp
from eth_account import Account
from sqlalchemy import text

from . import db
from .insider import ARCT, RELAY_RPC

DEAD = "0x000000000000000000000000000000000000dead"
AGGREGATOR = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
CHAIN_ID = 5042

INTERVAL = int(os.getenv("BUYBACK_INTERVAL", "3600"))          # one attempt per hour
MIN_USDC = float(os.getenv("BUYBACK_MIN_USDC", "5"))           # below this a buyback costs more attention than it is worth
MAX_USDC = float(os.getenv("BUYBACK_MAX_USDC", "250"))         # cap per run
RESERVE_USDC = float(os.getenv("BUYBACK_RESERVE_USDC", "150"))  # referral payouts + relayer gas live here
MAX_IMPACT = float(os.getenv("BUYBACK_MAX_IMPACT", "0.15"))    # skip if the buy would move ARCT more than 15%
SITE = os.getenv("SITE_ORIGIN", "https://arctools.fun")
# Spending the treasury is the owner's call, not a side effect of a deploy: until BUYBACK_ENABLED=1 the loop only
# computes and reports the buyback it WOULD make.
ENABLED = os.getenv("BUYBACK_ENABLED", "0") == "1"

_state: dict[str, object] = {"last_ts": None, "last_tx": None, "last_error": None, "runs": 0, "skips": 0}


async def init_tables() -> None:
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS buybacks (
            tx        VARCHAR(80) PRIMARY KEY,
            ts        BIGINT      NOT NULL,
            usdc      DOUBLE PRECISION NOT NULL,
            arct      DOUBLE PRECISION NOT NULL,
            block     BIGINT      NOT NULL DEFAULT 0,
            route     TEXT
        )"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS buybacks_ts ON buybacks (ts DESC)"))


async def _rpc(method: str, params: list) -> object:
    async with aiohttp.ClientSession() as s:
        async with s.post(RELAY_RPC, headers={"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", "")},
                          json={"id": 1, "jsonrpc": "2.0", "method": method, "params": params},
                          timeout=aiohttp.ClientTimeout(total=25)) as r:
            j = await r.json()
    if "error" in j:
        raise RuntimeError(f"{method}: {j['error']}")
    return j.get("result")


async def _balance(addr: str) -> int:
    return int(str(await _rpc("eth_getBalance", [addr, "latest"])), 16)


SWAPPED_TOPIC = None   # computed on first use: Swapped(address,address,bool,uint256,uint256,uint256,uint8)


async def _fees_since_block(from_block: int) -> tuple[float, int]:
    """USDC the router actually took as fees since `from_block`, read from its own Swapped events.

    This is the honest ceiling for a buyback: the treasury also holds bridge fees, pad fees and referral float,
    and none of that was promised to ARCT holders. Only what the aggregator charged on swaps is spent here.
    The node prunes history, so a first run (or a long outage) simply starts from the recent window.
    """
    global SWAPPED_TOPIC
    if SWAPPED_TOPIC is None:
        SWAPPED_TOPIC = "0x" + _keccak("Swapped(address,address,bool,uint256,uint256,uint256,uint8)")
    head = int(str(await _rpc("eth_blockNumber", [])), 16)
    start = max(from_block + 1, head - int(os.getenv("BUYBACK_LOOKBACK_BLOCKS", "120000")))
    total = 0.0
    step = 50_000
    b = start
    while b <= head:
        to = min(b + step - 1, head)
        try:
            logs = await _rpc("eth_getLogs", [{"address": AGGREGATOR, "fromBlock": hex(b), "toBlock": hex(to), "topics": [SWAPPED_TOPIC]}])
        except Exception as e:  # noqa - pruned range or a busy node: skip the window rather than stall the keeper
            _state["last_error"] = f"getLogs {b}-{to}: {str(e)[:90]}"
            b = to + 1
            continue
        for lg in logs or []:
            d = str(lg.get("data") or "0x")[2:]
            if len(d) >= 64 * 4:                     # buy, amountIn, amountOut, fee, legs
                total += int(d[64 * 3:64 * 4], 16) / 1e18
        b = to + 1
    return total, head


async def _route(amount_wei: int) -> dict | None:
    """Ask the site's own router for the best ARCT route — the same code path the Swap tab uses."""
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{SITE}/api/swaproute?token={ARCT}&side=buy&amount={amount_wei}",
                             headers={"User-Agent": "ArcTools-keeper/1.0"},
                             timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status != 200:
                    return None
                j = await r.json()
        return j if j.get("legs") else None
    except Exception:  # noqa
        return None


def _encode_buy(token: str, legs: list[dict], min_out: int, to: str, fee_bps: int) -> str:
    """buy(address,(uint8,address,uint24,(address,address,uint24,int24,address),uint256)[],uint256,address,uint16)"""
    from eth_abi import encode  # local import: only the keeper needs the ABI coder

    leg_tuples = [(
        int(l["venue"]),
        _addr(l.get("target")),
        int(l.get("fee") or 0),
        (
            _addr((l.get("key") or {}).get("currency0")),
            _addr((l.get("key") or {}).get("currency1")),
            int(((l.get("key") or {}).get("fee")) or 0),
            int(((l.get("key") or {}).get("tick_spacing")) or 0),
            _addr((l.get("key") or {}).get("hooks")),
        ),
        int(l["amount"]),
    ) for l in legs]
    sel = "0x" + _keccak("buy(address,(uint8,address,uint24,(address,address,uint24,int24,address),uint256)[],uint256,address,uint16)")[:8]
    body = encode(
        ["address", "(uint8,address,uint24,(address,address,uint24,int24,address),uint256)[]", "uint256", "address", "uint16"],
        [token, leg_tuples, min_out, to, fee_bps],
    ).hex()
    return sel + body


def _addr(a: object) -> str:
    s = str(a or "").strip()
    return s if s.startswith("0x") and len(s) == 42 else "0x" + "0" * 40


def _keccak(sig: str) -> str:
    from eth_utils import keccak
    return keccak(text=sig).hex()


async def run_once(force: bool = False) -> dict:
    """One buyback attempt. Returns a dict describing what happened (for the admin endpoint and the loop log)."""
    key = os.getenv("KEEPER_KEY") or os.getenv("REF_PAYER_KEY") or ""
    if not key:
        return {"ok": False, "reason": "no KEEPER_KEY"}
    acct = Account.from_key(key)
    if acct.address.lower() != TREASURY.lower():
        return {"ok": False, "reason": f"key is {acct.address}, treasury is {TREASURY}"}

    bal_wei = await _balance(TREASURY)
    bal = bal_wei / 1e18
    row = await db.fetchone(text("SELECT COALESCE(MAX(block), 0) AS b FROM buybacks"))
    last_block = int(row["b"] or 0) if row else 0
    earned, head = await _fees_since_block(last_block)

    spend = min(bal - RESERVE_USDC, MAX_USDC, earned if not force else MAX_USDC)
    if spend < MIN_USDC:
        _state["skips"] = int(_state["skips"]) + 1  # type: ignore[arg-type]
        return {"ok": False, "reason": "nothing to spend", "balance": round(bal, 2), "fees_since_last": round(earned, 2), "head": head, "reserve": RESERVE_USDC}

    amount_wei = int(spend * 1e18)
    if not (ENABLED or force):
        return {"ok": False, "reason": "disabled (BUYBACK_ENABLED=0)", "would_spend": round(spend, 2),
                "balance": round(bal, 2), "fees_since_last": round(earned, 2)}
    r = await _route(amount_wei)
    if not r:
        return {"ok": False, "reason": "no route for ARCT"}
    out = int(r.get("out") or 0)
    if out <= 0:
        return {"ok": False, "reason": "no quote"}

    # price impact: compare this buy against a 1 USDC probe. A thin book is a reason to wait, not to eat the spread.
    probe = await _route(int(1e18))
    if probe and int(probe.get("out") or 0) > 0:
        unit_small = int(probe["out"]) / 1e18
        unit_big = (out / 1e18) / spend
        impact = max(0.0, 1 - unit_big / unit_small) if unit_small > 0 else 1.0
        if impact > MAX_IMPACT:
            _state["skips"] = int(_state["skips"]) + 1  # type: ignore[arg-type]
            return {"ok": False, "reason": f"impact {impact:.1%} over cap", "spend": round(spend, 2)}
    else:
        impact = 0.0

    # this is the treasury's own money and nobody front-runs a scheduled buy: keep a real 3% floor
    min_out = out * 97 // 100
    legs = [{"amount": l["amount"], "fee": l.get("fee") or 0, "key": l.get("key"), "target": l.get("target"), "venue": l["venue"]} for l in r["legs"]]
    data = _encode_buy(ARCT, legs, min_out, DEAD, 0)          # fee 0: the treasury does not charge itself

    nonce = int(str(await _rpc("eth_getTransactionCount", [TREASURY, "pending"])), 16)
    gas_price = int(str(await _rpc("eth_gasPrice", [])), 16)
    tx = {"chainId": CHAIN_ID, "data": data, "gas": 1_400_000, "gasPrice": gas_price, "nonce": nonce,
          "to": AGGREGATOR, "value": amount_wei}
    try:
        tx["gas"] = int(int(str(await _rpc("eth_estimateGas", [{k: (hex(v) if isinstance(v, int) else v) for k, v in tx.items() if k != "chainId"}])), 16) * 1.3)
    except Exception as e:  # noqa - estimate is a nicety; the fixed ceiling still works
        _state["last_error"] = f"estimate: {e}"

    signed = acct.sign_transaction(tx)
    tx_hash = str(await _rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex().removeprefix("0x")]))

    got = 0.0
    for _ in range(40):
        await asyncio.sleep(3)
        rc = await _rpc("eth_getTransactionReceipt", [tx_hash])
        if rc:
            if int(str(rc.get("status") or "0x0"), 16) != 1:
                _state["last_error"] = f"reverted {tx_hash}"
                return {"ok": False, "reason": "reverted", "tx": tx_hash}
            # ARCT Transfer(…, DEAD, value) in this receipt is the burn we just caused
            topic = "0x" + _keccak("Transfer(address,address,uint256)")
            for lg in rc.get("logs") or []:
                if str(lg.get("address", "")).lower() == ARCT.lower() and (lg.get("topics") or [""])[0].lower() == topic.lower():
                    tps = lg["topics"]
                    if len(tps) >= 3 and tps[2][-40:].lower() == DEAD[2:].lower():
                        got += int(lg["data"], 16) / 1e18
            break

    await db.execute(text(
        "INSERT INTO buybacks (tx, ts, usdc, arct, block, route) VALUES (:x, :t, :u, :a, :b, :r) ON CONFLICT (tx) DO NOTHING"
    ).bindparams(a=got, b=head, r=" + ".join(str(l.get("label") or l["venue"]) for l in r["legs"]), t=int(time.time()), u=spend, x=tx_hash))
    _state.update({"last_error": None, "last_ts": int(time.time()), "last_tx": tx_hash, "runs": int(_state["runs"]) + 1})  # type: ignore[arg-type]
    return {"ok": True, "arct": round(got, 2), "impact": round(impact, 4), "spend": round(spend, 2), "tx": tx_hash}


async def stats() -> dict:
    row = await db.fetchone(text("SELECT COUNT(*) AS n, COALESCE(SUM(usdc),0) AS u, COALESCE(SUM(arct),0) AS a, MAX(ts) AS t FROM buybacks"))
    return {
        "bought": round(float(row["a"] or 0), 2) if row else 0,
        "burned": round(float(row["a"] or 0), 2) if row else 0,
        "last_ts": int(row["t"]) if row and row["t"] else None,
        "runs": int(row["n"]) if row else 0,
        "usdc_spent": round(float(row["u"] or 0), 2) if row else 0,
        "state": {k: v for k, v in _state.items()},
        "config": {"interval_s": INTERVAL, "max_usdc": MAX_USDC, "min_usdc": MIN_USDC, "reserve_usdc": RESERVE_USDC},
    }


async def buyback_loop() -> None:
    await init_tables()
    await asyncio.sleep(90)                                    # let the indexer warm up first
    while True:
        try:
            out = await run_once()
            if out.get("ok"):
                print(f"[buyback] {out['spend']} USDC -> {out['arct']} ARCT burned {out['tx']}", flush=True)
            elif out.get("reason") not in ("nothing to spend",):
                print(f"[buyback] skipped: {out}", flush=True)
        except Exception as e:  # noqa
            _state["last_error"] = str(e)[:200]
            print(f"[buyback] error: {e}", flush=True)
        await asyncio.sleep(INTERVAL)
