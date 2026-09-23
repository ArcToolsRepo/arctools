# 80 — Cross-chain buy (Relay + ArcAggregator)

## Main post

ETH on Base. Token on Arc. One signature.

Every Quick Buy in the ArcTools Terminal now has a chain-link button, and every token page has "Pay from another chain". Pick where your money is - Base, Arbitrum, Ethereum, Optimism, BNB Chain or Polygon - pay in ETH, BNB, POL or USDC, choose 1 to 2,000 USDC of the token, sign once. Relay bridges it and calls the ArcTools aggregator on Arc in the same fill. The token is in your wallet before you switch tabs.

No bridge first. No swap first. No gas on Arc first.

Measured on mainnet today, from the site: Base to ARCT in 4.6 s, Base to an ArcToolsPad bonding-curve token in 2.4 s, Arbitrum to ARCT in under 3 s. Fees are the same 1.5 % as Quick Buy (it goes to the ARCT buyback) plus Relay's fee, about five cents on a small buy. Both shown before you sign.

Works for Uniswap V3 and V4 tokens and for launchpad curves - it is the same router as Quick Buy. If the Arc swap cannot execute, Relay refunds USDC on Arc to your address.

arctools.fun/trade

## Short variant

New in the ArcTools Terminal: buy any Arc token straight from ETH on Base, Arbitrum, Ethereum, OP, BNB or Polygon. One signature, token on Arc in 2-5 s (measured today). Same 1.5 % fee, Relay does the bridging. arctools.fun/trade

## Notes
- Bridging provider is Relay (relay.link); say "bridging by Relay", never "partnership".
- Do not claim "first on Arc".
- Numbers are from three mainnet fills on 2026-09-23 (see arctools/relay_e2e.py output).
