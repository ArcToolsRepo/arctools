"""Feed nowych par: post na kanal + zapis do KV (ostatnie N tokenow do wyboru w bocie)."""
import json
import time
import logging
from .config import CFG
from .chain import CHAIN
from . import db

log = logging.getLogger("feed")
bot = None  # ustawiane w main


async def publish_new_token(token: str, pad_name: str):
    sym, name = "?", ""
    try:
        erc = CHAIN.erc20(token)
        sym = await erc.functions.symbol().call()
    except Exception:  # noqa
        pass
    # zapis do listy ostatnich
    raw = await db.kv_get("recent_tokens", "[]")
    recent = json.loads(raw)
    recent.insert(0, {"token": token, "symbol": sym, "pad": pad_name, "ts": int(time.time())})
    await db.kv_set("recent_tokens", json.dumps(recent[:30]))

    if bot and CFG.feed_channel_id:
        txt = (f"🆕 <b>New token on {pad_name}</b>\n"
               f"<b>{sym}</b>\n"
               f"CA: <code>{token}</code>\n"
               f"<a href='{CFG.explorer}/address/{token}'>arc-scan</a>\n\n"
               f"⚠️ The same ticker can exist on several venues. The CA is the identity.")
        try:
            await bot.send_message(CFG.feed_channel_id, txt, parse_mode="HTML",
                                   disable_web_page_preview=True)
        except Exception as e:  # noqa
            log.warning("feed post: %s", e)


async def recent_tokens() -> list[dict]:
    return json.loads(await db.kv_get("recent_tokens", "[]"))
