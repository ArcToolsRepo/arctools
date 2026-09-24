# ArcTools — the all-in-one toolkit for Arc (chain 5042)

Everything settles in native USDC. Live at **https://arctools.fun**. Bots: **@ArcSniper_bot**, **@ArcToolsBuyBot**, **@ARCTrends**. Android app: **ArcOne** (arctools.fun/app).

## Components

| Dir | What | Runs on |
|---|---|---|
| `site/` | arctools.fun — Terminal (screener of 26 launchpads, one-click buys through ArcAggregator, cross-chain Quick Buy via Relay), token pages with live charts, rug scanner, portfolio, CCTP bridge, ArcToolsPad launchpad, ARCT staking, Insiders, trader profiles, ArcLocker, ArcPredict, ArcTools Market (ArcWork), **ArcTools Perps**, /swap, /pay (ArcClaim), MoonPay on-ramp, banner slots, x402 paid API, Archy agent (KB in `src/help/kb.ts`), 5-language i18n. React 19 + TanStack Start on Cloudflare Workers (D1). | Cloudflare Workers |
| `sniper/` | `@ArcSniper_bot` — Maestro-style Telegram sniper: CA-paste buy/position cards, launch sniping on every pad, PnL, TP/SL, orders engine, CCTP bridge, copy-trade, alerts, referrals (25 %), auto-snipe rules, USDC pay links, deployer-dump guard. Python + aiogram + web3. Solidity in `sniper/contracts/`. | Railway (+ Postgres) |
| `buybot/` | `@ArcToolsBuyBot` + `@ARCTrends` + the **Arc Insider** index: swap indexer for V2/V3/V4 (hooked pools) and every launchpad curve, HTTP API (UDF charts, stream, token meta/stats, OHLC, trades, clusters, holdings, pads, dev audit, logo hunter, ArcSim, DexScreener sweep), risk engine, clone-farm detector, buyback keeper, bridge keeper, ArcPredict operator, x402 relayer, ArcWork API, **ArcTools Perps operator/keeper** (`buybot/perps.py`). | Railway (+ Postgres) |
| `rpc-relay/` | CORS JSON-RPC relay with read cache, in-flight dedupe, multi-upstream broadcast and a gas faucet. | Railway |
| `mobile/` | **ArcOne** Android app (Capacitor): trading wallet, Terminal, token pages, Predict, Market, cross-chain buy. | APK on arctools.fun |
| `marketing/` | Post copy (`NN-*-post.md`), compose scripts (`src/compose_NN.py`, shared `src/kit.py`), video pipelines (`video/`, `video-perps/`). | — |
| `docs/` | Public docs (x402 API, launchpad integration notes). | — |

## Deployed contracts (Arc mainnet, chain 5042)

| Contract | Address |
|---|---|
| $ARCT | `0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52` |
| ArcPad v3.1 (ArcToolsPad) | `0x2726AeC64D8a9BC41B9940dDA5D21c889458B348` |
| ArcRewardsVault v2 | `0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd` |
| ArcAggregator v3 | `0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A` |
| ArcOrders | `0x1abE31ba5d3c496635EFd35CB0B7f7d86BA30aF2` |
| ArcClaim (USDC pay links) | `0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6` |
| ArcLocker v1.1 | `0x07868eB2E92D4F1D9967f6Dc3B8a8Af5623Dbb94` |
| ArcPredict | see `sniper/contracts/ArcPredict.deploy.json` |
| ArcWork (Market escrow) | `0x74Dfc2012B71a377cCDaAE7b7Acd8Df3Cf1A5706` |
| **ArcPerps v1** | `0xCB39e1ec980FF6dC5137141EC5858Fe9D7124291` |
| ArcBridgeFeeProxy v2 | see `sniper/contracts/` |
| Treasury (fees → ARCT buyback + burn) | `0xb35c471b31D636B96f95b84E7A27D69B63235C0D` |

Sources, ABIs, deploy and test scripts live in `sniper/contracts/` (Solidity 0.8.x, tested against a fork of mainnet state).

## ArcTools Perps (v1)

24/7 perpetuals settled in USDC: tokenized stocks (NVDA, TSLA, CRCL, GME, HIMS) and Arc tokens (ARGUS, TOLLY, ARCT), up to 3x. Pull oracle: the operator signs `(chainId, contract, market, price, live, ts)`; the trader attaches the signature to their own tx (valid 120 s). Stocks use Nasdaq + CNBC quotes when fresh and agreeing, else the pool TWAP clamped to a ±7 % corridor at 2x. Peer-to-pool: longs vs shorts plus a fund covering at most 50 % of the imbalance, per-market OI caps, 2,000 USDC per position in the UI. Funding hourly (heavier side pays up to 0.05 %/h). Liquidation at 15 % of initial margin, 0.5 % of notional to the liquidator. Fees 0.1 % open / 0.1 % close: 70 % fund, 30 % treasury. Circuit breaker pauses new opens at −15 % of the fund seed. No admin path to user funds.

## Launchpads tracked (26)

RadarDex, ArcPad, Warp, ArcToolsPad, Uniswap V3/V4, Archemist, Arguspad, act.fun, long.supply (stocks), Lift, eve.fun, Klik, Minara, pools.trade, Tolly, UBI.fun, Sashimi, faze.fun, sharc.fun, creo.family, peach.ag, Hopium, foci.family, wonk.fun, DYORSwap, Ellipse, **ArcStockpad**. Adding a pad is config-only: `buybot/buybot/pads_registry.py` (`FACTORIES`; use `"enum": "getLaunch"` when launches are not direct factory txs), `buybot/buybot/venues.py` (`V4_HOOKS`), `site/src/lib/arc-api.ts` (`V4_HOOK_PADS`), `buybot/buybot/logos.py` (`PAD_PAGES`).

## Fees

1 % sniper · 2 % bridge · 1 % ArcToolsPad trade · 1.5 % Quick Buy (also cross-chain) · 0.5 % /swap, app and /buy swap · 1 % ArcOrders · 30 USDC instant launch · 2 % ArcClaim · 50 USDC per ArcLocker lock · 250 USDC or 200 USD in ARCT per 7-day banner · 3 % ArcPredict · x402 0.005–0.04 USDC per call · 2 % ArcWork (1 % for sellers holding ≥ 250k ARCT) · ArcPerps 0.1 % open / close (30 % treasury, 70 % LP fund). Referral 25 %. All fees are enforced on-chain and flow to the treasury for ARCT buyback + burn.

## Secrets (NEVER commit)

Everything comes from env vars / platform secrets: `DEPLOYER_KEY`, `BOT_TOKEN`, `DATABASE_URL`, `INGEST_KEY`, `RELAY_KEY`, `SEND_AUTH`, `FAUCET_*`, `PREDICT_OPERATOR_KEY`, `X402_*`, `BRIDGE_OWNER_KEY`, `PERPS_OPERATOR_KEY`, `PERPS_ADMIN_KEY`, `MOONPAY_*`, `OPENROUTER_API_KEY`, `E2E_KEY` (test scripts). Local `.*_key` files are git-ignored.

## Notes for integrators

- Public API: https://arctools.fun/api-docs (x402-paid endpoints) and the free `/bot/api/*` proxy (token-meta, token-stats, ohlc, trades, pads, padcounts, perps/*).
- Relay RPC never caches pending receipts (`result: null`), so UIs can poll `eth_getTransactionReceipt` right after broadcast.
