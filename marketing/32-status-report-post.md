# 32 — Status report / all systems operational

Image: `32-status-report.png` (1600x900)
Full audit: `audit-2026-09-15.md`

## Website text — "System report" block (paste on the site / in the docs)

### Everything checked, every 3 minutes

ArcTools runs its own watchdog. Every three minutes it re-checks eleven things — the Terminal rows, the token pages, the swap index, the RPC relay, both Telegram bots and, most importantly, **what real visitors actually see on screen** — and repairs what it can on its own: cache warm-ups, supply refetches across three RPCs, Token Score recomputes, pool backfills.

Right now: **11 / 11 green.**

**Last 24 hours**
- 26.8M requests served, 0 errors, 1.05 ms median worker CPU
- 35 406 swaps indexed across Arc for $3.31M — 1 170 tokens, 3 888 wallets, 477 brand-new tokens
- 3 708 buy alerts delivered to Telegram groups
- every tab rendered 95–100 % filled cells in real users' browsers

**All time**
- 244 003 swaps · $35.30M volume · 4 126 tokens · 12 903 wallets
- 5 824 V3/V2 pools, 863 V4 pools, 453 non-USDC quote pools indexed
- 1 643 tokens listed from 16 launchpad sources, 86 % with logos
- 528 KOLs tracked, 8 839 buy alerts sent, 5.01M ARCT staked

**Verified tab by tab:** Terminal · Token pages · Intel · Insiders · Portfolio · Profile · Wallets · Launchpad · Rewards · Scanner · Bridge · Referrals.

Live status is the pill in the bottom-left corner of every page — hover it for the per-check detail and bot latency.

## Short X post (fits 280)

ArcTools status report — all systems operational.

Last 24h: 26.8M requests, 0 errors. 35 406 swaps indexed for $3.31M across 1 170 tokens and 3 888 wallets. 3 708 buy alerts delivered.

All time: 244K swaps, $35.3M, 12 903 wallets, 4 126 tokens, 5 824 pools.

11/11 checks green.

## First reply (link)

arctools.fun — the System pill (bottom-left of every page) shows all eleven checks live, including one that measures what visitors actually see on screen, not just what the APIs return.

## Long version (X Premium)

ArcTools status report, 15 Sep 2026. All systems operational, 11 of 11 checks green.

What runs every 3 minutes:
- Terminal rows: market cap, liquidity, Token Score and dev/bundle share on the top 60 tokens — below threshold, it repairs on the spot (supply refetched across three RPCs, risk recomputed)
- what users see: every page pings the watchdog 8 s after it settles with the count of filled vs placeholder cells. A tab that looks empty to visitors raises an alarm even when every API answers fine
- swap index lag, RPC relay health, token list quality and logo coverage, launchpad list, both Telegram bots' latency and fill rate

Last 24 hours: 26 788 328 requests served with 0 errors and 1.05 ms median CPU. 35 406 swaps indexed across Arc for $3.31M — 1 170 tokens, 3 888 wallets, 477 tokens that traded for the first time. 3 708 buy alerts delivered.

All time: 244 003 swaps, $35.30M volume, 4 126 tokens, 12 903 wallets, 5 824 V3/V2 pools plus 863 V4 pools and 453 non-USDC quote pools, 1 643 tokens listed from 16 launchpad sources, 528 KOLs tracked, 5.01M ARCT staked.

Every tab verified end to end: Terminal, token pages, Intel, Insiders, Portfolio, Profile, Wallets, Launchpad, Rewards, Scanner, Bridge, Referrals.

arctools.fun

## Telegram (caption)

🟢 ArcTools status report — 11/11 checks green

24h: 26.8M requests · 0 errors · 35 406 swaps indexed ($3.31M) · 3 708 buy alerts
All time: 244K swaps · $35.3M · 12 903 wallets · 4 126 tokens · 5 824 pools

Every tab verified: Terminal, token pages, Intel, Insiders, Portfolio, Launchpad, Rewards, Scanner, Bridge, Referrals.

👉 arctools.fun
