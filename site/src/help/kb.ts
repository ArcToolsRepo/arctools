/**
 * ArcTools Help — knowledge base. Plain facts about the site, the bots and Arc. The help agent answers ONLY from these
 * articles (plus a few live API tools). Keep every article short, concrete and up to date: when a feature changes,
 * change it here. `keywords` are matched against the user's question in any of our 5 languages.
 */
export type Article = { id: string; title: string; url?: string; keywords: string[]; body: string };

export const KB: Article[] = [
  {
    id: "what-is", title: "What ArcTools is", url: "/",
    keywords: ["arctools", "what is", "co to", "что такое", "qué es", "是什么", "overview", "about"],
    body: `ArcTools is the all-in-one trading toolkit for the Arc chain (Circle's USDC-native L1, chain id 5042). It has a website (arctools.fun) and Telegram bots. Website: Terminal (screener of every Arc launchpad + one-click buys), token pages with a pro chart, Token Score, Bubble map and limit/TP/SL orders, Scanner, Portfolio, CCTP Bridge, ArcToolsPad launchpad, ARCT staking (Rewards), Insiders leaderboard, Intel, Wallet watchlist, Referrals. Bots: @ArcSniper_bot (sniper, positions, copy-trade, TP/SL), @ArcToolsBuyBot (buy alerts for groups), channels @ARCTrends (trending) and @ArcToolsInsiders (smart-money buys). Community: @arctoolsportal on Telegram, @arctoolsbackup on X.`,
  },
  {
    id: "arc-chain", title: "Arc chain basics", url: "/",
    keywords: ["arc", "chain", "usdc gas", "circle", "5042", "network", "sieć", "сеть", "red", "链", "gas"],
    body: `Arc is Circle's Layer-1 where USDC is the native gas token (no ETH needed). Chain id 5042. Every price on ArcTools is in USDC. Explorer: arc-scan.org. Tokens launch on many launchpads (RadarDex, ArcPad, Warp, Tolly, Archemist, Arguspad, Lift, eve.fun, Ellipse, Sashimi, aka.fun, ArcToolsPad, act.fun, UBI.fun) and trade on Uniswap V3 / V4 pools or bonding curves. Public RPCs are rate-limited and sometimes down; the site shows a red banner under the ticker when the chain or RPCs are down.`,
  },
  {
    id: "terminal", title: "Terminal (screener) — how to use", url: "/trade",
    keywords: ["terminal", "screener", "trade page", "list", "tabs", "trending", "new pair", "filters", "sort", "lista", "терминал", "终端"],
    body: `/trade is the Terminal. Tabs: All (every token, or every token of one launchpad when a source chip is selected), New pair, New <15m, Trending (top by volume), ⚡ Alpha (smart-money screener), Insider picks, ★ Watchlist (your favourites — click ☆ on a row), Holdings (your trading wallet's positions). Source chips filter by launchpad. Filters: min/max MC, min volume; sort by volume, newest, market cap, trades, % change, smart money. Time window buttons 1m…24h/All change the volume/txs columns. Columns: MC, ATH MC, LIQ, volume, txs (buys/sells), SCORE (Token Score 0-100 with grade), DEV/BUNDLE (deployer share, bundle share, dev selling), Smart (net insider flow). Each row has a ⚡ Quick Buy button (amount from the QUICK BUY selector at the top). The search box finds any token by name, symbol or contract address; pasting a full address opens the token page directly. The top ticker shows the top-10 by 24 h volume. 🔔 live toggles buy/sell pop-ups.`,
  },
  {
    id: "quick-buy", title: "Quick Buy and the trading wallet", url: "/trade",
    keywords: ["quick buy", "one click", "buy", "kup", "купить", "comprar", "买", "trading wallet", "hot wallet", "passcode", "create wallet", "import key", "recovery code", "sign with", "browser wallet", "metamask"],
    body: `Buying needs a wallet. Two options in the SIGN WITH selector: ⚡ trading (the in-browser trading wallet) or 🦊 browser (MetaMask/Rabby etc. — every buy opens a popup). The trading wallet is generated in your browser, encrypted with a passcode (PBKDF2 + AES-GCM) and stored only in this browser — it never leaves your device and we cannot recover it. Create it in the right-hand "Trading wallet" box on /trade: set a passcode, then SAVE the private key or the 25-character recovery code shown once. Fund it by sending USDC on Arc to its address. Import an existing key with "import key". It auto-locks after 30 minutes; unlock with the passcode. Quick Buy sends the swap through ArcAggregator (best price across Uniswap V3 tiers, V4 pools and launchpad curves, split across venues when that gives more tokens) with a 1.5% platform fee and 10% default slippage. Export/withdraw: /profile.`,
  },
  {
    id: "token-page", title: "Token page — chart, stats, tabs", url: "/token/<address>",
    keywords: ["token page", "chart", "wykres", "график", "gráfico", "图表", "candles", "indicators", "drawing", "fullscreen", "mcap mode", "price mode", "trades tab", "holders tab", "top traders", "dev tokens", "info"],
    body: `Open any token from the Terminal or by pasting its address in the search box. Left: TradingView-grade chart (candles/hollow/bars/line/area/Heikin-Ashi; MA, EMA, Bollinger, VWAP, RSI, MACD; log/linear/percent scale; drawing tools: level, trend, ray, Fibonacci, measure — drawings are saved per token; resize handle and ⤢ wide mode; 📷 saves a PNG). Toggle Price / MCap axis. Markers on the chart: DB/DS dev buy/sell, IB/IS insider buy/sell, PB/PS pro-wallet trades, KOL avatars where a tracked KOL tweeted about the token. Right: stats (MC, liquidity, 24 h volume, txs, traders, holders, 5m/1h/6h/24h change), the swap panel (Market / Limit / Take profit / Stop loss tabs), then Token Score, Social check, Smart followers, KOL mentions. Bottom tabs: Trades, My position, Holders, Bubble map, Top traders, Dev tokens, Info.`,
  },
  {
    id: "token-score", title: "Token Score (0-100) and DEV / BUNDLE", url: "/trade",
    keywords: ["score", "token score", "grade", "a b c", "dev", "bundle", "rug", "deployer", "top10", "holders", "safe", "bezpieczny", "скам", "seguro", "安全", "risk"],
    body: `Token Score = 100 minus penalties for: deployer's share of supply, bundle share (wallets whose first buy landed within 2 s of the first trade), whale concentration (top-10 holders, LP/vaults excluded), dev selling and bundle selling in 24 h, the deployer's rug history (other tokens he dumped), and low holder count. Grades: A ≥ 85, B ≥ 70, C ≥ 50, D below. ☠ next to a score = this deployer dumped a previous token. It refreshes about every minute; the sniper bot uses the same number for auto-snipe rules and its dump guard. It is a screener signal, not a guarantee — a 100 can still rug.`,
  },
  {
    id: "alpha", title: "⚡ Alpha tab (smart-money screener)", url: "/trade",
    keywords: ["alpha", "fresh alpha", "accumulation", "revival", "smart money", "first call", "stakers unlock", "blurred", "lock"],
    body: `The ⚡ Alpha tab in the Terminal scores tokens from our own swap index: top-100 wallets buying (only buys ≥ $25 count), insider clusters (≥ 2 top wallets within 15 min), unique-buyer acceleration, buy-flow share, KOL mentions, clean dev/bundle. Hard cuts remove dev > 25%, bundle > 20%, top-10 > 75%, any dev selling, deployers with a rug history, and (Fresh) dead tokens (no trade for 10 min, < 8 buyers, sells ≥ 70% of buys, price down > 40% from its high). Modes: Fresh alpha (tokens < 1 h old — usually empty, fires only when real capital enters), Accumulation (older tokens where insiders keep buying while price has not run — the strongest backtest), Revival (quiet token waking up; experimental). Each pick shows its reasons as chips, MC and a "first call" chip: the MC and time when the token first entered the list, written once, with the % change since. Top 3 per mode are free; the full list unlocks for wallets staking 10,000 ARCT (same gate as /insiders). Backtest (5 days): Accumulation ≥ 75 → 2% rug rate vs 39% for a random token, 42% up > 10% after 24 h vs 11%.`,
  },
  {
    id: "bubble-map", title: "Bubble map (connected holders)", url: "/token/<address> → Bubble map",
    keywords: ["bubble", "bubble map", "bubbles", "connected wallets", "cluster", "same funder", "linked wallets", "połączone portfele", "связанные", "conectados", "关联"],
    body: `On every token page, tab "Bubble map": one bubble per top-100 holder (area = share of supply). A line between two wallets is a proven on-chain link: the token moved between them, both got their first USDC from the same wallet, one funded the other, both bought inside the first 2 s (launch bundle), or both are top-100 insiders buying within 15 min. Connected wallets share a colour; grey = no proven link; gold ring = deployer; green ring = known insider; dashed = contract/pool. Header shows the largest connected cluster's share and total supply in clusters. Hover a bubble for details, click to open the wallet profile. Cards below list each cluster with its reasons. Data: arc-scan holders merged with our swap index; refreshed every 10 min.`,
  },
  {
    id: "orders", title: "Limit buy, take profit, stop loss (non-custodial orders)", url: "/token/<address> → Limit / Take profit / Stop loss",
    keywords: ["limit", "limit order", "take profit", "stop loss", "tp", "sl", "zlecenie", "ордер", "orden", "订单", "approve", "allowance", "keeper", "arcorders", "cancel order", "trigger", "mcap trigger"],
    body: `On a token page, the swap panel has tabs Market / Limit / Take profit / Stop loss. Orders need the trading wallet (unlocked). Limit buy: set the market cap (or price, or % below now) at which to buy and the USDC amount. Take profit / Stop loss: set +% / −% (or MC/price) and the token amount to sell. First time per token you approve USDC (buys) or the token (sells) for the ArcOrders contract — one transaction. Then the order is an EIP-712 signature (no gas). Your funds stay in your wallet; the ArcOrders contract (0x1abE31ba5d3c496635EFd35CB0B7f7d86BA30aF2) can only fill inside the price you signed (tolerance: limit 3%, TP 5%, SL 15%). Our keeper checks the market every 8 s and executes through ArcAggregator when the trigger hits — you can close the tab. Fee 1% on fill. Open orders are drawn on the chart (green = limit buy, blue = TP, red = SL) and listed under the form with a cancel button; filled orders show the transaction. Orders expire after 1/3/7/30 days (your choice). If the wallet lacks balance or allowance, the order waits and shows a note.`,
  },
  {
    id: "sniper", title: "@ArcSniper_bot (Telegram sniper)", url: "https://t.me/ArcSniper_bot",
    keywords: ["sniper", "snipe", "telegram bot", "bot", "positions", "pnl", "copy trade", "copy-trade", "auto snipe", "auto-snipe", "rotate wallet", "delete wallet", "trail", "trailing", "guard", "dump guard"],
    body: `@ArcSniper_bot is our Telegram trading bot for Arc. Paste any contract address to get a buy card (amounts 1·5·20·100·custom USDC, chart/scan/explorer links). It snipes launches on every Arc launchpad, keeps positions with live PnL, sells 25/50/100%, sets TP 2/3/5/10× and SL −30/−50%, trailing stops, a deployer-dump guard, auto-snipe rules (by Token Score, launchpad, liquidity), copy-trade of any wallet (deep link ?start=copy_<wallet>), alerts and a CCTP bridge. Wallets: create/import, rotate, delete (with confirmation); keys are encrypted server-side. Fee: 1% per trade. Speed over protection: buys go at market with minOut 0 when the quoter is unreachable. Referral program: 25% of platform fees from people you invite, claimable from 1 USDC.`,
  },
  {
    id: "buybot", title: "@ArcToolsBuyBot (group buy alerts) and channels", url: "https://t.me/ArcToolsBuyBot",
    keywords: ["buybot", "buy bot", "alerts", "group", "add to group", "/add", "trending channel", "arctrends", "boost", "insiders channel", "alert bot"],
    body: `@ArcToolsBuyBot posts buy alerts in your Telegram group: add the bot as admin, then /add <token address>. Alerts show amount, buyer, price, MC, rank on the trending board, project logo and socials. /help lists commands. @ARCTrends is the public trending channel: paid boosts 🚀 on top, then every tracked token by 24 h volume, then fillers; buys ≥ $30 are mirrored there. @ArcToolsInsiders posts smart-money (top-100 wallet) buys in real time. Both channels also announce chain/RPC outages every 5 min and "LIVE again" when Arc recovers.`,
  },
  {
    id: "insiders", title: "Insiders leaderboard and wallet profiles", url: "/insiders",
    keywords: ["insiders", "leaderboard", "top wallets", "smart money", "pnl", "winrate", "wallet profile", "insider/", "copy", "stake to unlock"],
    body: `/insiders ranks the most profitable Arc wallets by on-chain PnL (average-cost realized + unrealized) over 7d/30d/all, across every launchpad and DEX. Filters exclude bots (> 500 tx/day), infrastructure addresses and wallets with < 3 closed positions or < $200 volume. Positions 1-3 are free; 4-100 unlock for wallets staking 10,000 ARCT (connect a wallet to check). Click a wallet → /insider/<address>: stats, tokens, trades, linked X handle; "Copy in sniper" arms copy-trade in @ArcSniper_bot. /wallets lets you follow any wallet (stored in this browser; Telegram alerts for the first 3 free).`,
  },
  {
    id: "staking", title: "ARCT token, staking and rewards", url: "/rewards",
    keywords: ["arct", "staking", "stake", "rewards", "vault", "unlock", "10000", "official token", "arc t", "dividends", "yield"],
    body: `ARCT is the official ArcTools token (address 0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52, trades on RadarDex/Uniswap V3). Stake it on /rewards (vault 0x48ada931c2c220b074c39449b7e70860a3b4c277). Stakers receive 10% of ArcToolsPad trading fees and 5% of every launch supply from ArcToolsPad, distributed in USDC/ARCT via the vault. Staking 10,000 ARCT unlocks the full Insiders leaderboard and the full ⚡ Alpha lists. Unstake any time (see /rewards for the current terms).`,
  },
  {
    id: "launchpad", title: "ArcToolsPad launchpad (create a token)", url: "/launchpad",
    keywords: ["launchpad", "create token", "launch", "deploy token", "arctoolspad", "instant launch", "bonding curve", "graduate", "tax", "stwórz token", "создать токен", "crear token", "发币"],
    body: `/launchpad creates a token on Arc in one transaction. Instant launch fee: 30 USDC (on-chain). Options: buy/sell taxes, reward token for holders, bonding curve that graduates to Uniswap at the target, or instant Uniswap V3 pool. Trading fee on ArcToolsPad: 1% (10% of it to ARCT stakers) and 5% of every launch supply goes to ARCT stakers. Every token launched appears in the Terminal under the ArcToolsPad chip immediately and gets its own page /pad/<address>.`,
  },
  {
    id: "bridge", title: "CCTP bridge", url: "/bridge",
    keywords: ["bridge", "cctp", "usdc bridge", "deposit", "withdraw", "from ethereum", "from base", "most", "мост", "puente", "跨链"],
    body: `/bridge moves USDC to/from Arc via Circle's CCTP (burn on the source chain, mint on Arc). Fee 2% (atomic, collected on-chain). Follow the steps on the page: connect the source wallet, approve USDC, burn, then attest and mint on Arc. CCTP had a scheduled pause until 16.09 — if the page shows a pause notice, wait for it to clear. Alternative: bridge inside @ArcSniper_bot.`,
  },
  {
    id: "portfolio", title: "Portfolio and profile", url: "/portfolio",
    keywords: ["portfolio", "holdings", "balance", "positions", "profile", "history", "export key", "withdraw", "my tokens", "portfel", "портфель", "cartera", "资产"],
    body: `/portfolio shows every token a wallet holds with value and PnL; paste any address or use ?w=<address> in the URL. /profile is your trading-wallet page: balance, trade history, export private key, withdraw USDC, referral code. Holdings tab in the Terminal shows the trading wallet's open positions with one-tap sell.`,
  },
  {
    id: "scanner", title: "Scanner and Intel", url: "/scan",
    keywords: ["scanner", "scan", "check token", "intel", "kol", "x handle", "twitter check", "social check", "x/", "kol mentions"],
    body: `/scan checks any token: pools, liquidity, holders, deployer, socials, Token Score. /intel shows chain-wide KPIs (swaps, volume, tokens, wallets, new launches) and feeds. /x/<handle> shows an X account's Arc footprint: tokens it launched or shilled, smart followers (how many of our 385 tracked Arc KOLs follow it), handle history. Social check on token pages flags reused X/Telegram accounts, fresh domains and missing socials.`,
  },
  {
    id: "referrals", title: "Referrals", url: "/referrals",
    keywords: ["referral", "ref", "invite", "affiliate", "claim", "25%", "polecenia", "реферал", "referido", "推荐"],
    body: `/referrals: get your link, invite traders, earn 25% of the platform fees they pay (sniper, site swaps, ArcToolsPad). Earnings accrue in USDC and are claimable from the page (minimum 1 USDC) with a signature from your trading wallet — the payout is sent on-chain.`,
  },
  {
    id: "fees", title: "All fees", url: "/",
    keywords: ["fee", "fees", "opłaty", "комиссия", "comisión", "费用", "cost", "how much", "percent"],
    body: `Every fee is enforced on-chain and lands in the treasury 0xb35c471b31D636B96f95b84E7A27D69B63235C0D, where a keeper buys ARCT and burns it in the same transaction (see 'ARCT buyback'). Swap tab (/swap) and the Android app: 0.5% per swap. Quick Buy on the Terminal and the token page Market button: 1.5%. Limit / TP / SL orders: 1% on fill. Sniper bot (@ArcSniper_bot): 1% per trade. Bridge (CCTP): 2%. ArcToolsPad: 30 USDC per instant launch, curve launches are free; 1% per pad trade (10% of it to ARCT stakers) and 5% of every launch's supply to stakers. Pay links (ArcClaim): 2% on collection. Referrers earn 25% of the platform fee their invitees pay.`,
  },
  {
    id: "languages", title: "Languages and theme", url: "/",
    keywords: ["language", "polish", "russian", "spanish", "chinese", "język", "язык", "idioma", "语言", "light theme", "dark", "theme"],
    body: `The whole site is available in English, Polish, Spanish, Russian and Chinese: use the 🌐 button (top right, or bottom-right on side-nav pages) or add ?lang=pl|es|ru|zh to any URL. ☀️/🌙 switches light/dark theme. Both are remembered in the browser.`,
  },
  {
    id: "status", title: "System status, outages, RPC problems", url: "/",
    keywords: ["status", "down", "not working", "nie działa", "не работает", "no funciona", "不能用", "rpc", "busy", "429", "loading", "stuck", "outage", "banner", "degraded"],
    body: `Bottom-left "System" pill shows the watchdog state (Running / Degraded) with per-check details on hover: bots, UI, terminal rows, pages, tokens, relay, index, API, display. A red banner under the top ticker means the Arc chain or all public RPCs are down — buys, alerts and orders pause and resume automatically; updates every 5 min on @ARCTrends. If a quote shows "no quote (RPC busy)", the buy still goes through at market. If a page looks stale, hard-refresh (Ctrl+Shift+R). Still broken: tell us in @arctoolsportal.`,
  },
  {
    id: "security", title: "Security and custody", url: "/",
    keywords: ["safe", "security", "custody", "non-custodial", "private key", "seed", "hack", "scam", "trust", "bezpieczeństwo", "безопасность", "seguridad", "安全"],
    body: `Website trading wallet: key generated and encrypted in your browser, never sent to us; lose the passcode and recovery code = lose the wallet. Orders: signature + allowance to the audited-by-us ArcOrders contract; funds stay in your wallet; the contract enforces your price. Sniper bot: keys encrypted server-side with a master key; use a dedicated wallet with only what you trade. We never DM first, never ask for keys or seed phrases. Official links: arctools.fun, @ArcSniper_bot, @ArcToolsBuyBot, @arctoolsportal, @arctoolsbackup on X.`,
  },
  {
    id: "not-found-token", title: "A token is missing or shows no data", url: "/trade",
    keywords: ["missing token", "not found", "no trades indexed", "no data", "brak danych", "нет данных", "sin datos", "找不到", "cannot find", "search"],
    body: `Every ERC-20 on Arc can be found by pasting its contract address in the Terminal search — it opens the token page even if we have no trades indexed. "No trades indexed yet" means our swap index has not seen its pool yet (new pool types are picked up within minutes; tokens paired with a quote token other than USDC, e.g. Arguspad's ARGUS pairs, are converted through the quote's price). Price/MC come from the last indexed swap × total supply. If a token still shows nothing after 15 min, report the address in @arctoolsportal.`,
  },
  {
    id: "buyback", title: "ARCT buyback and burn", url: "/rewards",
    keywords: ["buyback", "burn", "burned", "treasury", "keeper", "deflation", "spalanie", "выкуп", "recompra", "回购"],
    body: `Fees collected by ArcTools do not sit anywhere: a keeper (part of @ArcToolsBuyBot) periodically spends the treasury's USDC on ARCT through ArcAggregator and sends the tokens straight to the burn address 0x…dEaD in the same transaction — it never holds ARCT. Every run is a public tx; /rewards shows the burn counter (tokens burned, % of supply) and the buyback history (runs, USDC spent). The first buyback burned 35,354 ARCT for 10.70 USDC. Fees that feed it: 0.5% swaps, 1.5% quick buys, 1% sniper, 1% pad trades, 2% bridge, 50 USDC per new lock in ArcLocker, 2% pay links.`,
  },
  {
    id: "pay-links", title: "Pay links (send USDC with a link)", url: "/pay",
    keywords: ["pay link", "pay links", "arcclaim", "claim", "send usdc link", "gift", "link", "wyślij link", "ссылка", "enlace de pago", "支付链接"],
    body: `/pay (site) or Pay links (app): lock USDC in the ArcClaim contract 0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6 and share one link — the receiver needs no wallet in advance; they claim to any address from the site, the app or @ArcSniper_bot (/start claim_…). Fee 2% on collection. Links expire after 7 days and refund themselves to the sender; nothing is pooled — every link is its own on-chain record. The claim key lives only in the link, so treat the link like cash.`,
  },
  {
    id: "api-x402", title: "ArcTools API for bots and agents (x402, pay per call)", url: "/api-docs",
    keywords: ["api", "x402", "pay per call", "agent", "bot api", "developer", "endpoint", "token-stats api", "dev-audit api", "sell-sim api", "402", "api key"],
    body: `/api-docs. Four paid endpoints: GET /api/x402/token-stats (0.005 USDC), /api/x402/dev-audit (0.02), /api/x402/sell-sim (0.03), /api/x402/token-report (0.04, all three) — ?token=0x… . No API key and no account: the first call returns HTTP 402 with a PAYMENT-REQUIRED header (price, asset, payTo); the client signs an EIP-712 TransferWithAuthorization for USDC on Arc (EIP-3009, USDC facade 0x3600…0000, name "USDC", version "2", chainId 5042) and retries with an X-PAYMENT header; the data comes back with 200 and the USDC is pulled on-chain by the ArcTools relayer within seconds. The same signed payment re-sent returns the same answer, never a second charge. Nothing is charged for a 402 or an error. Payments go to the treasury and burn ARCT. Free public endpoints on the site stay free for humans (rate-limited). Reference client: scripts/x402_e2e.ts in the public repo; Coinbase x402 client libraries work with the Arc network entry eip155:5042.`,
  },
  {
    id: "predict", title: "ArcPredict (up / down rounds, 2 minutes, USDC)", url: "/predict",
    keywords: ["predict", "prediction", "up or down", "up down", "rounds", "bet", "pancake prediction", "battle", "predykcja", "предикт", "vs"],
    body: `/predict (site) — BTC/USD, ETH/USD and SOL/USD markets, a new round every 2 minutes, around the clock. Pick UP or DOWN before the round locks (one side per wallet per round, min 1 USDC, max 500 USDC). At close the winning side splits the whole pool pro rata minus a 3 % fee that goes to the ARCT buyback treasury; multipliers are shown live on the card. The lock and close prices are the median of Hyperliquid, Binance, Coinbase and Kraken, posted on-chain by the ArcTools operator; every posted price with its sources is on /api/predict/price, so anyone can audit a round. Protections in the contract: a tie or an empty side refunds everyone; if the operator is late by more than the buffer the round is cancelled and refunded (anyone can call cancelRound); pausing never blocks claims; there is no admin withdrawal — funds leave only via claim() or as the fee of a resolved round. Winnings and refunds are claimed on the same page ("Claim"). Contracts: BTC 0x88fb5f7Fd4a9cEeF59AaE3DD5fEE92259E2B10e0, ETH 0x4d235443685AD0273b8Dd3Ebd4F3af9E466afB4d, SOL 0x6D8B07940A378Ea97E9C4caa4Bdab40603639fc4. Not available in the ArcOne app yet.`,
  },
  {
    id: "buy-card", title: "Buy ARCT with a card (MoonPay on-ramp)", url: "/buy",
    keywords: ["buy arct", "card", "credit card", "debit card", "apple pay", "google pay", "fiat", "onramp", "on-ramp", "moonpay", "how to buy", "karta", "kupić", "купить картой"],
    body: `/buy (site) — two steps. 1) Buy USDC with a card, Apple Pay or Google Pay through MoonPay; choose USDC on the Arc network and paste your ArcTools wallet address when MoonPay asks for it (the /buy page copies it for you); it is delivered natively on Arc straight to your own wallet — ArcTools never holds the money. MoonPay does an ID check the first time and shows its own fee inside the widget. Minimum 20 USD/EUR. 2) The same page shows your USDC balance and swaps it to ARCT in one click through the ArcTools aggregator (0.5 % fee to the ARCT buyback treasury, 0.3 USDC kept for gas). No card: buy USDC on any exchange and withdraw it on the Arc network to your wallet (or to Base/Arbitrum and use /bridge), then use step 2. If the card button says the MoonPay account is pending, the exchange route works meanwhile.`,
  },
  {
    id: "perps", title: "ArcPerps: 24/7 leverage up to 3x on tokenized stocks and Arc tokens", url: "/perps",
    keywords: ["perps", "perpetual", "leverage", "long", "short", "margin", "liquidation", "funding", "3x", "2x", "nvda", "tsla", "stocks perps", "dźwignia", "перпы", "плечо"],
    body: `/perps — perpetual futures settled in native USDC on Arc. Markets: tokenized stocks (NVDA, TSLA, CRCL, GME, HIMS from long.supply) and Arc tokens with LP ≥ 100k (ARGUS, TOLLY, ARCOON, WONK, ARCT). Leverage: up to 3x with a live price feed, 2x when a stock has no live feed (weekend / gaps); Arc tokens 2–3x by liquidity. Price: Arc tokens = 5-minute USDC-weighted TWAP of the pool from our index; stocks = Nasdaq + CNBC quotes (regular and extended hours) when fresh and agreeing, otherwise the pool TWAP clamped to ±7 % of the last live price. The operator signs the price and the trader attaches the signature to their own transaction (valid 120 s). Counterparty: longs vs shorts, plus the fund (seeded 800 USDC by the treasury) covering at most 50 % of the imbalance; per-market OI caps. Funding hourly: the heavier side pays up to 0.05 %/h to the lighter side. Liquidation when equity falls to 15 % of initial margin (3x ≈ −28 % move, 2x ≈ −43 %); liquidator earns 0.5 % of notional; remainder to the fund. Fees 0.10 % of notional on open and close: 70 % fund, 30 % treasury (ARCT buyback and burn). v1 = market orders only (no limit/TP/SL yet). Minimum margin 1 USDC. Trade with the trading wallet or MetaMask; positions and history on the page. LP: anyone can deposit USDC into the fund (Fund / LP tab), 24 h lock, withdrawals limited while the fund backs open imbalance. Circuit breaker: if the fund drops 15 % below its seed, new opens pause automatically. Contract 0xCB39e1ec980FF6dC5137141EC5858Fe9D7124291, no admin withdrawal of user funds.`,
  },
  {
    id: "cross-chain-buy", title: "Buy from another chain (ETH / USDC on Base, Arbitrum, Ethereum, OP, BNB, Polygon)", url: "/trade",
    keywords: ["cross-chain", "crosschain", "another chain", "other chain", "from base", "from arbitrum", "from ethereum", "eth on base", "bridge and buy", "relay", "one click", "pay from another chain", "z innej sieci", "с другой сети"],
    body: `Every Quick Buy (⚡) in the Terminal has a ⛓ button next to it, and every token page has "Pay from another chain" above the swap panel. Pick the chain where your money is (Base, Arbitrum, Ethereum, Optimism, BNB Chain or Polygon), pay in the chain's native coin (ETH / BNB / POL) or in USDC, choose how many USDC of the token to buy (1–2000), connect MetaMask / Rabby and sign ONE transaction on that chain. Relay (relay.link) bridges the money and calls the ArcTools aggregator on Arc in the same fill; the token lands in your address on Arc in about 3–10 seconds (we measured 2–5 s on Base). Works for Uniswap V3/V4 tokens and bonding-curve tokens (ArcToolsPad, launchpads) — the same router as Quick Buy. Fees: the normal 1.5 % ArcTools Quick Buy fee (goes to the ARCT buyback) plus Relay's fee, typically 0.05–0.10 USD on a small buy — both shown before you sign. Recipient is your connected wallet by default; you can deliver to your ArcTools trading wallet instead. If the Arc swap cannot execute (pool gone, curve closed), Relay refunds native USDC on Arc to the recipient address — not the original coin on the origin chain; you then simply buy from the Terminal with that USDC. Paying in USDC on the origin chain needs an extra approval signature (site only). In ArcOne: token page ⛓ button or More → Buy from another chain — your ArcOne address is the same on every EVM chain, send ETH there on Base or Arbitrum and tap Pay; the app signs on that chain with the same key.`,
  },
  {
    id: "advertise", title: "Sponsored banner slots (advertise on the Terminal)", url: "/advertise",
    keywords: ["advertise", "advertising", "banner", "ad", "ads", "sponsored", "promotion", "promote", "250 usdc", "reklama", "baner", "реклама", "баннер"],
    body: `Three banner slots under the Terminal heading, on the classic site and on Terminal v2, 7 days each. Price: 250 USDC, or ARCT worth 200 USD at the moment of payment, sent on-chain to the fee treasury (the ARCT buyback wallet) from the advertiser's wallet. Banner file: exactly 1060×144 px (PNG/WebP/JPEG, under 300 KB); the form resizes and center-crops other sizes — check the preview before paying. Every banner is reviewed by a human before it shows: paying is not a right to publish; no link shorteners, no wallet-drainer domains, no impersonating another project. If all 3 slots are taken the banner queues and the form shows when it starts. Rejected banners are refunded by hand. Status of your banners: /advertise, "My banners". Banners are not shown in the ArcOne app.`,
  },
  {
    id: "market", title: "ArcTools Market (services with USDC escrow)", url: "/market",
    keywords: ["market", "marketplace", "escrow", "hire", "freelancer", "logo", "website", "kol", "designer", "developer", "gig", "order", "dispute", "arbiter", "arcwork", "zlecenie", "фриланс"],
    body: `/market (site) — hire people who work on Arc: logo & banner, website, Telegram/Discord setup, KOL post, contract review, other. Buyer pays the listed price into the ArcWork contract (0x74Dfc2012B71a377cCDaAE7b7Acd8Df3Cf1A5706); the USDC stays in escrow until the buyer accepts the delivery. Rules: seller delivers a link/note; buyer accepts → seller is paid minus 2 % fee (1 % if the seller holds 250k ARCT), the fee buys and burns ARCT; buyer silent 72 h after delivery → seller can claim; nothing delivered by deadline + 3 days → buyer cancels and gets 100 % back; either side can dispute → ArcTools (arbiter 0x408c…6fE8) splits the escrow within ~48 h with a public on-chain note, fee only on the seller's share; seller can refund in full any time before completion. Reviews (1–5 stars) are written on-chain by the buyer once per finished order and cannot be edited. Listing a gig is free; sellers publish title/description signed with their trading wallet. ArcTools has no withdrawal function — money leaves only via accept, claim, refund, cancel or resolve. Deep links: /market/gig/ID, /market/order/ID. Not in the ArcOne app yet.`,
  },
  {
    id: "locker", title: "ArcLocker (lock tokens, LP, Uniswap V3 / v4 positions)", url: "/locker",
    keywords: ["locker", "lock", "lp lock", "liquidity lock", "team lock", "vesting", "unlock", "locked liquidity", "v3 position", "v4 position", "nft lock", "arclocker", "blokada", "лок", "bloqueo"],
    body: `/locker (site) or Locker (app, under More). Contract ArcLocker 0x07868eB2E92D4F1D9967f6Dc3B8a8Af5623Dbb94 on Arc. Locks: ERC-20 tokens (project/team allocations, Uniswap V2-style LP tokens) with an optional linear vesting after the unlock date; ERC-721 positions: Uniswap V3 NonfungiblePositionManager NFTs and Uniswap v4 Positions NFTs (or any NFT). The unlock date can only be extended, never shortened; there is no admin key, pause, upgrade or rescue function — nobody (including ArcTools) can release a lock early. The lock owner can extend, transfer the lock to another wallet, withdraw after unlock (vested part for vesting locks), and for V3 positions collect the swap fees while the principal stays locked (v4 positions are fully locked). Fee: 50 USDC per new lock, one-time, paid in native USDC to the treasury (ARCT buyback & burn); extending, collecting and withdrawing are free; project wallets listed by the owner are exempt. Token pages show an ARCLOCKER strip: "LP locked · X% of pool until <date>" (share computed from the position's liquidity vs the pool's active liquidity for V3) and token-lock counts. Flow: approve → lock (two transactions). Find a position id in your wallet's NFT tab.`,
  },
  {
    id: "sell-simulation", title: "Sell simulation (honeypot check)", url: "/trade",
    keywords: ["sell simulation", "honeypot", "cannot exit", "trap", "thin pool", "no exit", "can i sell", "rug", "safety", "symulacja", "ханипот", "trampa"],
    body: `Before you buy, ArcTools simulates a full round trip on-chain (buy, then sell the tokens back) using a probe contract injected via eth_call state override — nothing is deployed and nothing is spent. Verdicts: 'exit OK' — the sell returns what the router quoted; 'thin pool' (amber) — the sell works but price impact eats a large share; 'CANNOT EXIT / trap' (red) — the sell returns far less than the quote, the classic honeypot signature; 'no exit route' — our router cannot sell it at all. A verdict is a disagreement with the quote, not the size of a loss. If real sells are landing on chain while our router fails, the token is marked 'unrouted' rather than trap. The Terminal paints trap rows red and the Buy sheet asks you to confirm before buying one. Results are cached for a few hours per token.`,
  },
  {
    id: "clones", title: "Clone farms (hidden spam tokens)", url: "/trade",
    keywords: ["clone", "clones", "spam", "duplicate", "same name", "farm", "hidden", "klony", "клоны", "clones"],
    body: `Some wallets mint the same token name dozens of times (JEANPHIL: 80 contracts in a few hours) and pump each copy with fake volume so they own every list. ArcTools detects a farm from the trades themselves: one venue, one name, many contracts with near-identical swap counts. Those copies are tagged and hidden from the default Terminal view; the busiest contract of a family (the real one) is never hidden. Search or a launchpad chip still shows everything. You can turn the filter off in the app's Settings.`,
  },
  {
    id: "dev-net", title: "Dev / bundle risk columns", url: "/trade",
    keywords: ["dev", "deployer", "dev sold", "dev net", "bundle", "launch block", "dev holds", "dev %", "deweloper", "разработчик", "desarrollador"],
    body: `DEV/BUNDLE on the Terminal and the SAFETY block on a token page. 'Deployer holds' — the deployer wallet's share of supply. 'Dev net 24h' — what the deployer took OUT in the last 24 hours: sells minus buys. A dev who sold 73 USDC and bought 120 back is +47, not a dumper — the badge shows the net figure, with sold/bought underneath. 'Launch-block wallets' — supply held by wallets that bought within 2 seconds of the first trade, and their net selling. The sniper's dump guard uses the same net numbers and never counts ArcTools' own wallets (treasury, aggregator) as a dev.`,
  },
  {
    id: "android-app", title: "ArcTools Android app", url: "/app",
    keywords: ["app", "android", "apk", "mobile", "phone", "download", "install", "iphone", "ios", "aplikacja", "приложение", "aplicación", "应用"],
    body: `arctools.fun/app: a signed APK you download straight from the site (no Play Store review), Android 7+. Same engine as the site: Trending with launchpad chips and one-tap quick buys (the ⚡ buys the amount chosen in the header; hold it to pick), token pages with candles and the SAFETY block, Swap, a wallet whose key is generated on the phone and encrypted with your passcode (PBKDF2 + AES-GCM, never sent anywhere), Live trades, Top traders, Insiders, Alerts, native Launch (ArcToolsPad), Pay links (create and claim), Referrals, Bridge tracking, ARCT staking, History, Profile. Save the private key when the app shows it — the recovery code only resets a forgotten passcode on the same phone. The app checks for a newer build on launch. iPhone: Apple allows no installs outside the App Store; open /trade2 in Safari and 'Add to Home Screen'.`,
  },
  {
    id: "v2-preview", title: "Terminal v2 preview (/trade2)", url: "/trade2",
    keywords: ["v2", "trade2", "preview", "new design", "rail", "dexscreener style", "switch", "nowy wygląd", "новый дизайн", "nuevo diseño"],
    body: `Every page also exists in a second layout at the *2 addresses (/trade2, /swap2, /token2/…): one terminal frame with a launchpad rail on the left, chart and trades in the middle, stats and the trade panel on the right. Clicking a launchpad in the rail filters the Terminal to that source. A visible 'v1 / v2' switch on both sides carries your page, filters and anchor across; nothing redirects on its own and the classic layout stays the default.`,
  },
  {
    id: "insiders-copy", title: "Insiders and copy-trading", url: "/insiders",
    keywords: ["insider", "insiders", "top traders", "leaderboard", "copy trade", "copy-trade", "follow wallet", "smart money", "kopiuj", "копитрейд"],
    body: `/insiders (site), Insiders / Top traders (app): wallets ranked by realised + unrealised PnL on Arc over 7 or 30 days, with win rate, volume and best trade. Tap a wallet for its trades and public profile (/u/handle or /insider/0x…). Copy-trade from @ArcSniper_bot with the deep link /start copy_<wallet> — the bot mirrors that wallet's buys with your settings. The Terminal's 'Insider picks' tab lists tokens that several ranked insiders are buying right now.`,
  },
  {
    id: "archy", title: "Archy Agent (this assistant)", url: "/",
    keywords: ["archy", "who are you", "kim jesteś", "кто ты", "quién eres", "你是谁", "assistant", "agent", "help chat", "ai"],
    body: `Archy is the ArcTools assistant — the chat you are using now. Open it from "Archy Agent" at the bottom of the left menu, the round button bottom-left on mobile, or the Archy tile in the Android app. Archy answers only about ArcTools and the Arc chain, from ArcTools' own documentation plus live data (token stats, chain status, system status). It does not give financial advice or price predictions, and it can be wrong — verify on-chain. Limit: 20 questions per hour. Humans: Telegram @arctoolsportal.`,
  },
  {
    id: "desktop", title: "Desktop app", url: "/",
    keywords: ["desktop", "app", "download", "windows", "mac", "aplikacja"],
    body: `A desktop app is in the works. No release date yet — announcements on X @arctoolsbackup and @arctoolsportal.`,
  },
];
