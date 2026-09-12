from cryptography.fernet import Fernet
from eth_account import Account
from sqlalchemy import select, insert, delete
from .config import CFG
from . import db

_fernet = Fernet(CFG.master_key.encode()) if CFG.master_key else None


def enc(pk: str) -> str:
    return _fernet.encrypt(pk.encode()).decode()


def dec(blob: str) -> str:
    return _fernet.decrypt(blob.encode()).decode()


async def create_wallet(tg_id: int, label: str = "") -> dict:
    acct = Account.create()
    await db.execute(insert(db.wallets).values(
        tg_id=tg_id, address=acct.address, enc_pk=enc(acct.key.hex()), label=label))
    return {"address": acct.address}


async def import_wallet(tg_id: int, pk: str, label: str = "") -> dict:
    acct = Account.from_key(pk)
    await db.execute(insert(db.wallets).values(
        tg_id=tg_id, address=acct.address, enc_pk=enc(pk), label=label))
    return {"address": acct.address}


async def list_wallets(tg_id: int) -> list[dict]:
    return await db.fetchall(select(db.wallets).where(db.wallets.c.tg_id == tg_id))


async def get_wallet(wallet_id: int) -> dict | None:
    return await db.fetchone(select(db.wallets).where(db.wallets.c.id == wallet_id))


async def delete_wallet(wallet_id: int, tg_id: int):
    await db.execute(delete(db.wallets).where(
        (db.wallets.c.id == wallet_id) & (db.wallets.c.tg_id == tg_id)))


async def active_wallet(tg_id: int) -> dict | None:
    u = await db.get_user(tg_id)
    ws = await list_wallets(tg_id)
    if not ws:
        return None
    for w in ws:
        if w["id"] == u["active_wallet"]:
            return w
    return ws[0]


def account_of(w: dict) -> Account:
    return Account.from_key(dec(w["enc_pk"]))
