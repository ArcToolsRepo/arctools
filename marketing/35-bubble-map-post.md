# 35 — Bubble map + Orders (X post)

Attach: `35-bubble-map.png`. No emoji. Link in first reply. Claims below are exactly what is live.

---

## Post

Two new things on every ArcTools token page.

Bubble map: who is connected to whom among the top 100 holders. A line between two wallets means a proven on-chain link: same funder, direct funding, token moved between them, bought in the launch bundle, or both in an insider buy window. Connected wallets share a colour, and you see what share of supply the largest cluster controls.

Orders: limit buy at a market cap, take profit, stop loss. Set them from the trading wallet, close the tab. Non-custodial.

---

## Reply 1 (link)

arctools.fun/trade, open any token, tab "Bubble map". Orders live under the swap panel and are drawn on the chart: green line limit buy, blue take profit, red stop loss.

---

## Reply 2 (how orders work)

Your funds stay in your wallet. An order is a signature plus an allowance to the ArcOrders contract. Our keeper watches price and market cap every 8 seconds and calls the contract when your trigger hits. The contract refuses any fill worse than the rate you signed, so the keeper can decide when, never at what price. Cancel any time. 1% fee on fill, same as the sniper.

Contract: 0x1abE31ba5d3c496635EFd35CB0B7f7d86BA30aF2

---

## Reply 3 (example)

COOL right now: 45.6% of supply sits in 10 connected clusters. The largest is 27 wallets holding 16.5%, all first funded by one wallet and buying inside the same insider windows. That is the kind of thing a holder list never shows you.

---

## Long version (X Premium)

Two features shipped today on every ArcTools token page.

Bubble map. We take the top 100 holders and connect the wallets we can prove are related. Five kinds of evidence, each shown on hover: the token moved between them, both got their first USDC from the same wallet, one wallet funded the other, both bought inside the first two seconds of trading, or both are top-100 insiders buying inside the same 15-minute window. Connected wallets become one colour, singles stay grey, bubble area is share of supply, gold ring is the deployer, green ring is a known insider. The header tells you the number that matters: how much of the supply the largest connected cluster controls. On COOL today that is 16.5% in 27 wallets with a single funder, 45.6% of supply across 10 clusters.

Orders. Limit buy at a market cap or price, take profit and stop loss as a percent, market cap or price. You sign the order with the trading wallet (no gas) and grant a one-time allowance to the ArcOrders contract. Funds never leave your wallet. Our keeper checks the market every 8 seconds and executes through ArcAggregator when the trigger hits. The contract enforces your minimum rate, so we can choose when to fill, never at what price. Open orders are drawn on the chart as dashed lines, filled orders show up with the transaction, cancel is one click. 1% fee on fill.

Both live now at arctools.fun. The sniper bot keeps its own TP/SL for Telegram users; this is the same idea for the website, without custody.
