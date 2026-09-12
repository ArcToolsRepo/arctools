import json
import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


def _env_list(key: str) -> list[str]:
    raw = os.getenv(key, "")
    return [x.strip() for x in raw.split(",") if x.strip()]


@dataclass
class Config:
    bot_token: str = os.getenv("BOT_TOKEN", "")
    master_key: str = os.getenv("MASTER_KEY", "")
    admin_ids: list[int] = field(default_factory=lambda: [int(x) for x in _env_list("ADMIN_IDS")])

    rpc_urls: list[str] = field(default_factory=lambda: _env_list("ARC_RPC_URLS"))
    wss_url: str = os.getenv("ARC_WSS_URL", "")
    chain_id: int = int(os.getenv("ARC_CHAIN_ID", "5042"))
    explorer: str = os.getenv("ARC_EXPLORER", "https://arc-scan.org").rstrip("/")

    wrapped_usdc: str = os.getenv("WRAPPED_USDC", "0x3600000000000000000000000000000000000000")
    univ3_factory: str = os.getenv("UNIV3_FACTORY", "0xf0db7b58379503491d857dB50AC9ece64c653918")
    univ3_router: str = os.getenv("UNIV3_ROUTER", "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77")
    univ3_quoter: str = os.getenv("UNIV3_QUOTER", "0x7dfd4f31be6814d2906bde155c3e1b146eac1468")

    feed_channel_id: str = os.getenv("FEED_CHANNEL_ID", "")
    database_url: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///arctools.db")

    eth_rpc: str = os.getenv("ETH_RPC", "")
    base_rpc: str = os.getenv("BASE_RPC", "")
    arb_rpc: str = os.getenv("ARB_RPC", "")
    arc_cctp_domain: str = os.getenv("ARC_CCTP_DOMAIN", "")
    iris_api: str = os.getenv("IRIS_API", "https://iris-api.circle.com").rstrip("/")

    default_buy_usdc: float = float(os.getenv("DEFAULT_BUY_USDC", "50"))
    default_slippage: int = int(os.getenv("DEFAULT_SLIPPAGE", "25"))
    gas_mult: dict = field(default_factory=lambda: {
        "normal": float(os.getenv("GAS_MULT_NORMAL", "1.1")),
        "fast": float(os.getenv("GAS_MULT_FAST", "1.5")),
        "turbo": float(os.getenv("GAS_MULT_TURBO", "3.0")),
    })
    poll_interval: float = float(os.getenv("POLL_INTERVAL", "0.4"))
    max_block_range: int = int(os.getenv("MAX_BLOCK_RANGE", "500"))
    whale_min_usdc: float = float(os.getenv("WHALE_MIN_USDC", "1000"))

    # service fees
    fee_wallet: str = os.getenv("FEE_WALLET", "0xb35c471b31D636B96f95b84E7A27D69B63235C0D")
    trade_fee_bps: int = int(os.getenv("TRADE_FEE_BPS", "100"))    # 1% per sniper trade
    bridge_fee_bps: int = int(os.getenv("BRIDGE_FEE_BPS", "200"))  # 2% per bridge

    # USDC natywne na ARC: 6 decimals, msg.value
    usdc_decimals: int = 6


CFG = Config()


def load_pads() -> list[dict]:
    path = os.getenv("PADS_FILE", "pads.json")
    if not os.path.exists(path):
        path = "pads.example.json"
    with open(path) as f:
        data = json.load(f)
    pads = []
    for p in data.get("pads", []):
        for k, v in list(p.items()):
            if isinstance(v, str) and v.startswith("env:"):
                p[k] = os.getenv(v[4:], "")
        if p.get("enabled"):
            pads.append(p)
    return pads
