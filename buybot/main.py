import asyncio
import logging
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties

from buybot.config import CFG
from buybot import balances, bridge_watch, insider_alerts, rules, watchlist, db, insider, social, watcher, trending, kols
from buybot.handlers import router

logging.getLogger("web3.manager.RequestManager").setLevel(logging.CRITICAL)  # failover jest obslugiwany w chain.py; ERROR to szum
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("main")


async def main():
    assert CFG.bot_token, "BOT_TOKEN not set"
    await db.init_db()
    bot = Bot(CFG.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
    dp = Dispatcher()
    dp.include_router(router)
    dp.include_router(watchlist.router)
    dp.include_router(rules.router)

    me = await bot.get_me()
    CFG.bot_username = me.username
    watcher.bot = bot
    trending.bot = bot

    # bottom command menu (the button next to the message box)
    from aiogram.types import BotCommand, BotCommandScopeAllPrivateChats, BotCommandScopeAllGroupChats
    await bot.set_my_commands([
        BotCommand(command="start", description="Start / setup guide"),
        BotCommand(command="add", description="Track a token (in group): /add 0x..."),
        BotCommand(command="settings", description="Min buy + emoji (in group)"),
        BotCommand(command="boost", description="Trending boost prices"),
        BotCommand(command="paid", description="Confirm boost payment: /paid 0xTX"),
        BotCommand(command="remove", description="Stop tracking (in group)"),
    ], scope=BotCommandScopeAllPrivateChats())
    await bot.set_my_commands([
        BotCommand(command="add", description="Track a token: /add 0x..."),
        BotCommand(command="help", description="Setup guide"),
        BotCommand(command="settings", description="Min buy + emoji"),
        BotCommand(command="boost", description="Trending boost"),
        BotCommand(command="paid", description="Confirm payment: /paid 0xTX"),
        BotCommand(command="remove", description="Stop tracking"),
    ], scope=BotCommandScopeAllGroupChats())

    social.bot = bot
    insider_alerts.bot = bot
    kols.bot = bot
    bridge_watch.bot = bot
    watchlist.bot = bot
    rules.bot = bot
    await insider.start_api()
    tasks = [
        asyncio.create_task(watcher.watcher_loop(), name="watcher"),
        asyncio.create_task(trending.trending_loop(), name="trending"),
        asyncio.create_task(insider.ingest_loop(), name="insider-ingest"),
        asyncio.create_task(insider.stats_loop(), name="insider-stats"),
        asyncio.create_task(insider.repair_loop(), name="insider-repair"),
        asyncio.create_task(social.registry_loop(), name="social-registry"),
        asyncio.create_task(insider_alerts.alerts_loop(), name="insider-alerts"),
        asyncio.create_task(bridge_watch.watch_loop(), name="bridge-watch"),
        asyncio.create_task(watchlist.alerts_loop(), name="watchlist"),
        asyncio.create_task(rules.rules_loop(), name="rules"),
        asyncio.create_task(balances.snapshot_loop(), name="balances"),
    ]
    log.info("ArcBuyBot start as @%s | rpc x%s | trend channel %s",
             me.username, len(CFG.rpc_urls), CFG.trend_channel_id or "-")
    try:
        await dp.start_polling(bot, allowed_updates=["message", "callback_query", "my_chat_member"])
    finally:
        for t in tasks:
            t.cancel()


if __name__ == "__main__":
    asyncio.run(main())
