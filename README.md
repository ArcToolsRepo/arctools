# ArcTools — the all-in-one toolkit for Arc (chain 5042)

Everything settles in native USDC. Live at **https://arctools.fun**.

## Components

| Dir | What | Runs on |
|---|---|---|
| `website/` | arctools.fun — token explorer, rug scanner, portfolio, CCTP bridge, **ArcToolsPad launchpad**, ARCT staking rewards. React 19 + TanStack Start on Cloudflare Workers (D1 for pad metadata). | Higgsfield apps platform |
| `sniper-bot/` | `@ArcSniper_bot` — Maestro-style Telegram sniper: CA-paste buy panels, launch sniping (RadarDex / ArcPad / Warp / ArcToolsPad / UniV3), live PnL, TP, panic sell, CCTP bridge, copy-trade. Python + aiogram + web3. | Railway (+ Postgres) |
| `buybot/` | `@ArcToolsBuyBot` — buy alerts for token groups (V3/V2/ArcToolsPad venues), media, socials, min-buy; **@ARCTrends** trending board (tracked tokens + top-mcap fillers, paid boosts, buy mirrors with logos). | Railway (+ Postgres) |
| `rpc-relay/` | CORS-enabled read-only JSON-RPC relay (arc-scan → Infura fallback) + gas faucet endpoint. | Railway |
| `sniper-bot/contracts/` | Solidity: `ArcPad.sol` (launchpad v2 — curve trading, custom taxes, reward-token swaps, 5% supply drops to ARCT stakers via `ArcRewardsVault`), `ArcBridgeFeeProxy.sol`, deploy/test scripts. | Arc mainnet |

## Deployed contracts (Arc mainnet, chain 5042)

- ArcPadLaunchpad v2: `0x1EaAD48260eECC7624666F1dFec202b2D75257fE`
- ArcRewardsVault v2: `0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd`
- ArcBridgeFeeProxy: `0xA42c4BEee84CEd9f2ea15b3981B8A321943b7Bec`
- $ARCT: `0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52`

## Secrets (NEVER commit)

All secrets come from env vars:

- `DEPLOYER_KEY` — contract deploy scripts
- `BOT_TOKEN`, `DATABASE_URL` — both bots (Railway env)
- `FAUCET_KEY`, `FAUCET_AUTH` — rpc-relay gas faucet
- `ARC_RPC_URLS` — sniper RPC list
- Website: `FAUCET_AUTH` via platform secrets

## Fees

1% per sniper trade · 2% per bridge (atomic) · launchpad: 1% per trade (10% of it → ARCT stakers) + 5% of every launch supply → ARCT stakers.
