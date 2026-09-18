# 54 — Pay links on the website + how-to

## Main post (thread-ready; each block = one post)

1/
Pay links are now on the website too: arctools.fun/pay

Send USDC to anyone with a link. They pick the wallet, we pay the gas, uncollected money comes back to you. Here is exactly how it works.

2/ How to send
Open arctools.fun/pay. Unlock your trading wallet or connect MetaMask / Rabby (the site switches it to Arc for you — the amount is native USDC on Arc, never ETH). Type the amount, pick how long the link stays valid (1 hour to 30 days), hit Create. You get two links: a web link and a Telegram link. Copy either.

In the sniper bot it is one line: /send 5 (5 USDC, valid 3 days) or /send 20 24 (20 USDC, valid 24 hours). /links shows every link you made and its state.

3/ How to collect
Open the link. Paste any Arc / EVM address, or tap "Use my browser wallet", or "Open in Telegram" to have @ArcSniper_bot create a wallet for you and drop the USDC in it. Press Collect. No gas needed, no prior wallet needed — we send the transaction. Done in under two seconds.

4/ What you see afterwards
Your links panel on /pay shows every link this wallet created, live from the chain: open with a countdown, collected with the recipient and the transaction, or returned. Totals: sent, collected, open, returned.

5/ Rules
- Minimum 0.1 USDC. Fee 2% at collection (a 5 USDC link pays 4.90).
- Anyone holding the link can collect it: share it with the person you mean, do not post it publicly unless you want the fastest clicker to win.
- If nobody collects before the expiry you chose, the USDC returns to the sender automatically. No action needed.
- Every link is its own on-chain record: who funded it, who collected it, when. Nothing is pooled or mixed. Contract 0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6

6/ Use it for
- Onboarding: send a friend their first 5 USDC on Arc before they even have a wallet. The Telegram link makes the wallet for them.
- Giveaways: winners do not need to DM you an address. Post a link per winner in DMs, each one collects where they want.
- Group airdrops: /send 1 x 20 in the bot, drop the links in the group.
- Tips: reply to a good post with a 2 USDC link.
- Splitting a bill or paying a freelancer who has not told you which chain they use: they decide at collection time.
- Bots and agents: the same link is a plain URL — anything that can post a message can pay.

7/ Also shipped today
- /pay tab on the site with create, live tracking and collect.
- Telegram deep links fixed (the code format now passes Telegram's start-parameter rules).
- The site forces the Arc network before any browser-wallet transaction — a wallet left on Ethereum used to display the USDC amount as ETH.

arctools.fun/pay

## Short single post

Pay links are on the website: arctools.fun/pay. Send USDC to anyone with a link, from your trading or browser wallet. They paste an address (or open it in Telegram and get a wallet made for them), we pay the gas, uncollected links return to you. 2% at collection, every link visible on-chain. Bot: /send 5.

## Notes
- Telegram deep-link format changed from claim_<id>.<key> to claim_<id>_<key> — links created BEFORE 11:04 UTC today with the old dot format do not open in Telegram; their WEB links still work, and the bot now accepts both formats if pasted.
