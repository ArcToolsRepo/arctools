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
    body: `Site swaps (Quick Buy / token page Market): 1.5% via ArcAggregator. Limit / TP / SL orders: 1% on fill. Sniper bot: 1% per trade. Bridge: 2%. ArcToolsPad: 30 USDC per instant launch, 1% per trade (10% of it to ARCT stakers), 5% of launch supply to stakers. Referrers get 25% of the platform fee from their invitees. All fees are enforced on-chain; treasury 0xb35c471b31D636B96f95b84E7A27D69B63235C0D.`,
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
    id: "archy", title: "Archy Agent (this assistant)", url: "/",
    keywords: ["archy", "who are you", "kim jesteś", "кто ты", "quién eres", "你是谁", "assistant", "agent", "help chat", "ai"],
    body: `Archy is the ArcTools assistant — the chat you are using now. Open it from "Archy Agent" at the bottom of the left menu (or the round button bottom-left on mobile). Archy answers only about ArcTools and the Arc chain, from ArcTools' own documentation plus live data (token stats, chain status, system status). It does not give financial advice or price predictions, and it can be wrong — verify on-chain. Limit: 20 questions per hour. Humans: Telegram @arctoolsportal.`,
  },
  {
    id: "desktop", title: "Desktop app", url: "/",
    keywords: ["desktop", "app", "download", "windows", "mac", "aplikacja"],
    body: `A desktop app is in the works. No release date yet — announcements on X @arctoolsbackup and @arctoolsportal.`,
  },
];
