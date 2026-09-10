import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


def _list(key: str) -> list[str]:
    return [x.strip() for x in os.getenv(key, "").split(",") if x.strip()]


@dataclass
class Config:
    bot_token: str = os.getenv("BOT_TOKEN", "")
    rpc_urls: list[str] = field(default_factory=lambda: _list("ARC_RPC_URLS") or [
        "https://rpc.arc-scan.org",
        "https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8",
    ])
    chain_id: int = int(os.getenv("ARC_CHAIN_ID", "5042"))
    explorer: str = os.getenv("ARC_EXPLORER", "https://arc-scan.org").rstrip("/")
    database_url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///buybot.db")

    # venues
    usdc: str = "0x3600000000000000000000000000000000000000"
    univ3_factory: str = "0xf0db7b58379503491d857dB50AC9ece64c653918"
    univ3_quoter: str = "0x7dfd4f31be6814d2906bde155c3e1b146eac1468"
    dyor_v2_factory: str = os.getenv("DYOR_FACTORY", "0x61a425AB7E1F6B3FA1eb6Af6162CF471fA0E7C62")
    warp_dex_factory: str = os.getenv("WARP_DEX_FACTORY", "0x32330C2400a6e0830D56661169eBB6C147E3577a")

    # payments / boosts (native USDC on Arc)
    fee_wallet: str = os.getenv("FEE_WALLET", "0xb35c471b31D636B96f95b84E7A27D69B63235C0D")
    boost_24h_usdc: float = float(os.getenv("BOOST_24H_USDC", "25"))
    boost_3d_usdc: float = float(os.getenv("BOOST_3D_USDC", "60"))
    boost_7d_usdc: float = float(os.getenv("BOOST_7D_USDC", "120"))

    trend_channel_id: str = os.getenv("TREND_CHANNEL_ID", "")
    poll_interval: float = float(os.getenv("POLL_INTERVAL", "1.0"))
    max_block_range: int = int(os.getenv("MAX_BLOCK_RANGE", "2000"))
    trend_interval: int = int(os.getenv("TREND_INTERVAL", "300"))
    bot_username: str = os.getenv("BOT_USERNAME", "")  # filled at runtime


CFG = Config()
