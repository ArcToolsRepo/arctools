import asyncio
import logging
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties

from arctools.config import CFG
from arctools import db, sniper, alerts, feed
from arctools.ui.handlers import router

logging.getLogger("web3.manager.RequestManager").setLevel(logging.CRITICAL)  # failover jest obslugiwany w chain.py; ERROR to szum
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("main")


async def main():
    assert CFG.bot_token, "BOT_TOKEN nieustawiony"
    assert CFG.master_key, "MASTER_KEY nieustawiony"
    assert CFG.rpc_urls, "ARC_RPC_URLS nieustawione"

    await db.init_db()
    bot = Bot(CFG.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
    dp = Dispatcher()
    dp.include_router(router)

    # bottom command menu (the button next to the message box)
    from aiogram.types import BotCommand
    await bot.set_my_commands([
        BotCommand(command="start", description="Open the sniper menu"),
    ])

    async def notify(tg_id: int, text: str, markup=None):
        try:
            await bot.send_message(tg_id, text, disable_web_page_preview=True, reply_markup=markup)
        except Exception as e:  # noqa
            log.warning("notify %s: %s", tg_id, e)

    sniper.notify = notify
    alerts.notify = notify
    feed.bot = bot
    sniper.feed_publish = feed.publish_new_token

    tasks = [
        asyncio.create_task(sniper.watcher_loop(), name="watcher"),
        asyncio.create_task(alerts.alerts_loop(), name="alerts"),
        asyncio.create_task(alerts.tp_loop(), name="tp"),
        asyncio.create_task(alerts.watch_tx_loop(), name="watch_tx"),
    ]
    log.info("ArcTools start | chain %s | rpc x%s", CFG.chain_id, len(CFG.rpc_urls))
    try:
        await dp.start_polling(bot)
    finally:
        for t in tasks:
            t.cancel()


if __name__ == "__main__":
    asyncio.run(main())
