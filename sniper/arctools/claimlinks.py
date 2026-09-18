"""USDC payment links (ArcClaim). A link carries a one-time key; whoever opens it names the wallet that gets paid.

Sender side runs from the user's sniper wallet (they hold USDC). Claim side never needs gas: the link key signs the
recipient address and the buybot relayer submits the transaction, so a brand-new wallet can collect.
Fee: 2 % taken by the contract at claim time, to the ArcTools treasury."""
import base64
import os
import time

import aiohttp
from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import Column, Integer, String, BigInteger, Table, select, insert, update
from web3 import Web3

from . import db
from .chain import CHAIN
from .wallets import enc, dec

CLAIM = "0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6"
CHAIN_ID = 5042
FEE_BPS = 200
MIN_USDC = 0.1
RELAY = os.getenv("CLAIM_RELAY", "https://bot-production-4200.up.railway.app")
BOT = os.getenv("BOT_USERNAME", "ArcSniper_bot")
SITE_CLAIM = "https://arctools.fun/bot/claim/"

SEL_CREATE = Web3.keccak(text="create(address,uint64)")[:4]
TOPIC_CREATED = Web3.keccak(text="Created(uint256,address,address,uint256,uint64)")

claimlinks = Table("claimlinks", db.meta,
    Column("id", Integer, primary_key=True),            # on-chain link id
    Column("tg_id", BigInteger, index=True),
    Column("sender", String(64)),
    Column("amount_usdc", String(32)),
    Column("expiry", BigInteger),
    Column("enc_key", String(256)),                     # link key, encrypted like wallet keys — lets the sender re-show the link
    Column("status", String(12), default="open"),       # open | claimed | refunded
    Column("recipient", String(64), nullable=True),
    Column("tx", String(80), nullable=True),
    Column("created", BigInteger),
)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def encode_code(link_id: int, key: bytes) -> str:
    """`<id>.<key>` — 32-byte key as base64url (43 chars). Fits Telegram's 64-char start payload with the claim_ prefix."""
    return f"{link_id}.{_b64(key)}"


def decode_code(code: str) -> tuple[int, bytes] | None:
    try:
        i, k = code.split(".", 1)
        key = _unb64(k)
        if len(key) != 32 or int(i) <= 0:
            return None
        return int(i), key
    except Exception:  # noqa
        return None


def links_for(code: str) -> dict:
    return {"bot": f"https://t.me/{BOT}?start=claim_{code}", "site": f"{SITE_CLAIM}#{code}"}


def digest(link_id: int, recipient: str) -> bytes:
    return Web3.keccak(encode(["string", "uint256", "address", "uint256", "address"],
                              ["ArcClaim", CHAIN_ID, CLAIM, link_id, Web3.to_checksum_address(recipient)]))


def sign_claim(key: bytes, link_id: int, recipient: str) -> str:
    return Account.sign_message(encode_defunct(primitive=digest(link_id, recipient)), key).signature.hex()


async def create(tg_id: int, acct: Account, amount_usdc: float, ttl_hours: int = 72) -> dict:
    """Park `amount_usdc` from the user's wallet; returns {id, code, links, expiry, tx}."""
    if amount_usdc < MIN_USDC:
        raise ValueError(f"minimum is {MIN_USDC} USDC")
    ttl = max(1, min(90 * 24, int(ttl_hours))) * 3600
    key = os.urandom(32)
    key_addr = Account.from_key(key).address
    data = SEL_CREATE + encode(["address", "uint64"], [key_addr, ttl])
    value = int(round(amount_usdc * 1e18))
    tx = await CHAIN.build_tx(acct, CLAIM, data, value_wei=value, gas_mode="normal")
    h = await CHAIN.send(acct, tx)
    rcpt = await CHAIN.wait_receipt(h, timeout=60)
    if rcpt["status"] != 1:
        raise RuntimeError("create reverted")
    link_id = None
    for lg in rcpt["logs"]:
        if lg["address"].lower() == CLAIM.lower() and lg["topics"] and bytes(lg["topics"][0]) == TOPIC_CREATED:
            link_id = int.from_bytes(bytes(lg["topics"][1]), "big")
    if link_id is None:
        raise RuntimeError("Created event missing")
    expiry = int(time.time()) + ttl
    await db.execute(insert(claimlinks).values(
        id=link_id, tg_id=tg_id, sender=acct.address, amount_usdc=f"{amount_usdc:.6f}", expiry=expiry,
        enc_key=enc(key.hex()), status="open", created=int(time.time())))
    code = encode_code(link_id, key)
    return {"id": link_id, "code": code, "links": links_for(code), "expiry": expiry, "tx": h if h.startswith("0x") else "0x" + h}


async def status(link_id: int) -> dict | None:
    """Read the link from the relayer (which reads the chain) — one place decides what a link's state is."""
    async with aiohttp.ClientSession() as s:
        async with s.get(f"{RELAY}/api/claim/{link_id}", timeout=aiohttp.ClientTimeout(total=15)) as r:
            if r.status != 200:
                return None
            return await r.json()


async def claim(code: str, recipient: str) -> dict:
    """Sign the recipient with the link key and hand the transaction to the relayer (gas is on us)."""
    parsed = decode_code(code)
    if not parsed:
        raise ValueError("bad code")
    link_id, key = parsed
    sig = sign_claim(key, link_id, recipient)
    async with aiohttp.ClientSession() as s:
        async with s.post(f"{RELAY}/api/claim/submit", json={"id": link_id, "recipient": recipient, "sig": sig},
                          timeout=aiohttp.ClientTimeout(total=90)) as r:
            j = await r.json()
    if r.status != 200 or j.get("error"):
        raise RuntimeError(j.get("error") or f"relay {r.status}")
    return j


async def mark(link_id: int, **vals):
    await db.execute(update(claimlinks).where(claimlinks.c.id == link_id).values(**vals))


async def mine(tg_id: int, limit: int = 10) -> list[dict]:
    return await db.fetchall(select(claimlinks).where(claimlinks.c.tg_id == tg_id).order_by(claimlinks.c.created.desc()).limit(limit))


def code_of(row: dict) -> str:
    return encode_code(int(row["id"]), bytes.fromhex(dec(row["enc_key"])))
