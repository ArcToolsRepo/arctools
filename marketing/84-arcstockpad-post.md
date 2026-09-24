# 84 - ArcStockpad added to ArcTools (graphic: assets/84-arcstockpad.png, robot: assets/84-robot.png job 9cf6458d)

## X post (main)
ArcStockpad is now in ArcTools.

Coins paired with USDC or a real stock token (NVDA, CRCL, GME, SPY, AAPL, AMC, SPCX, HIMS, cirBTC) on a hook-owned Uniswap V4 bonding curve. Bonded at 17,000 USDC FDV, liquidity locked from block one, LP fees split 80/20 to creators/holders and their treasury.

What changes for you:
- every ArcStockpad launch shows in the Terminal with its own chip and filter
- @ArcSniper_bot snipes them, @ArcToolsBuyBot alerts carry the ArcStockpad label
- one-click buys at the best price across venues, same 1.5% Quick Buy fee as everywhere else

30 launches indexed so far (v2.4, v2.3 and v2.2 factories), two already graduated: $ASPAD and $NOVA.

26 launchpads tracked on Arc. arctools.fun/trade2

## Reply (technical)
ArcStockpad launches go through a bootstrap contract, so the factory shows no direct transactions. We read launchCount()/getLaunch(i) on the factory 0x79Cc...08ea (plus the legacy v2.3 and v2.2 factories) and label the hooked V4 pools 0xe92F...2840 / 0x73Fa...2840 / 0xcfBf...A840. All contracts source-verified on explorer.arc.io.

## Notes
- Numbers from arcstockpad.com/explore and the factory on 24 Sep 2026: 27 + 2 + 1 launches, graduated ASPAD (MC $171k) and NOVA.
- Wording: "coins paired with a stock token" (their pairing), not "trade stocks". No "partnership": we index them like every other pad.
- Robot: gpt_image_2_5 quality high 3:2, robot ref dc7f9996, right third, no text. Their mark = X avatar @ARCSTOCKPAD (downloaded, never generated).
