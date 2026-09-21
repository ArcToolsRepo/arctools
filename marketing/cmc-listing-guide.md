# CoinMarketCap — weryfikacja listingu ARCT, krok po kroku

## Gdzie jesteśmy (stan na 2026-09-21)

- ARCT **już jest w CMC jako "Unverified Listing"** przez DexScan:
  https://dex.coinmarketcap.com/token/arc/0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52/
  (tytuł "ARCT Real-time On-chain Arc DEX Data", venue "Uniswap V3 (Arc)"). To znaczy, że CMC śledzi Arc
  i nasz rynek — warunek B.3 ("actively traded on a tracked exchange") jest spełniony.
- Nie ma strony coinmarketcap.com/currencies/arctools — o to walczymy: **Verified Listing** (nazwa, logo,
  linki, opis, supply, a docelowo pełna strona z rankingiem).
- CMC pisze wprost: formularz online jest JEDYNĄ drogą. Każdy, kto pisze do Ciebie na Telegramie/mailu
  "z CMC" i obiecuje szybkie verified/supply za pieniądze — scam (mają listę takich osób w Listings Criteria).
  Nic nie płacimy nikomu.

## Co już przygotowane (gotowe do wklejenia)

| Pole | Wartość |
|---|---|
| Project name | ArcTools |
| Ticker | ARCT |
| Chain | Arc (Circle L1, chain ID 5042) — w formularzu wybierz "Arc"; jeśli brak, "Other" + wpisz "Arc (chain id 5042)" |
| Contract | 0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52 |
| Decimals | 18 |
| Explorer | https://arc-scan.org/token/0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52 |
| Website | https://arctools.fun |
| Docs / whitepaper | https://arctools.fun/#how-it-works (opis produktów + fee) oraz https://github.com/ArcToolsRepo/arctools (README) |
| Source code | https://github.com/ArcToolsRepo/arctools |
| X | https://x.com/ArcToolsBackup (wpisz to konto, które jest w stopce strony — musi się zgadzać 1:1) |
| Telegram | https://t.me/ArcToolsPortal (grupa), https://t.me/ARCTrends (kanał) |
| Logo 200×200 PNG transparent | https://arctools.fun/assets/brand/arct-200.png |
| Logo 512×512 | https://arctools.fun/assets/brand/arct-512.png |
| Total supply API | https://arctools.fun/api/supply?q=total  → sama liczba (964234817.60…) |
| Circulating supply API | https://arctools.fun/api/supply?q=circulating → sama liczba (953712519.55…) |
| Supply JSON (dla nich do wglądu) | https://arctools.fun/api/supply?q=json |
| Max supply | brak (nie ma funkcji mint; total tylko spada przez burn) — wpisz "No max supply; total supply is deflationary (buyback and burn), no mint function" |
| Launch date | data pierwszego transferu z arc-scan (sprawdź na explorerze; ok. 2026-09-11) |
| Launch type | Fair launch on ArcPad (bonding curve → Uniswap V3), no presale, no ICO, no VC allocation |
| Category / tags | DeFi, DEX aggregator, Trading tools, Launchpad, Arc ecosystem |
| Market pair URL | https://dex.coinmarketcap.com/token/arc/0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52/ + Uniswap V3 pool ARCT/USDC (arc-scan link do poola) |
| Other trackers (dowód traction) | mexc.com/price/arctools, coinbase.com/price/arctools, bybit.com/en/price/arctools, cryptorank.io/price/arctools/usd, livecoinwatch.com/price/ArcTools-__ARCT, coinstats.app/coins/arctools |

### Supply — jak to uzasadniamy (pole "Supply documentation")
- Total supply = `totalSupply()` kontraktu. Kontrakt nie ma `owner()` ani `mint` — supply może tylko spadać.
- Spalone dotychczas: ~57.7M ARCT (5.77 %), w tym 21.9M na 0x…dead i reszta przez `burn()` (zdejmuje z totalSupply).
  Źródło: https://arctools.fun/bot/api/arct-burn
- Non-circulating: wyłącznie skarbiec 0xb35c471b31D636B96f95b84E7A27D69B63235C0D (10.5M ARCT). Skarbiec zbiera
  fee w USDC i kupuje ARCT, które pali w tej samej transakcji (keeper). Nie sprzedaje ARCT.
- Circulating = total − treasury. Zestakowane ARCT w vaultcie 0x48aDA931C2C220B074c39449B7e70860A3B4C277
  należą do użytkowników → liczone jako circulating.
- Brak vestingu, brak team allocation, brak locków — nie ma co dokumentować poza powyższym. Napisz to wprost;
  CMC lubi krótkie, sprawdzalne zdania z adresami.

## Krok po kroku

### 1. Konto i formularz
1. Zaloguj się na coinmarketcap.com kontem, którego NIE zgubisz (odpowiedzi przychodzą na ten e-mail; użyj
   maila w domenie arctools.fun jeśli masz — to wzmacnia "Credibility").
2. Wejdź: https://support.coinmarketcap.com/hc/en-us/requests/new → "Request Form".
3. "What is your request about?" → **[New Listing] Add cryptoasset**.
   (Nie "Update" — nie mamy jeszcze strony currencies/; DexScan page to nie to samo.)

### 2. Sekcje formularza (co wpisać)
- **Subject**: `[New Listing] ArcTools (ARCT) — Arc chain (5042)`
- **Relationship with the project**: Founder / core team.
- **Project launch date, platform, contract, decimals, explorer** — z tabeli.
- **Project description** (≤ 3 zdania na start; pełny opis w polu "Detailed description"):
  > ArcTools (arctools.fun) is a non-custodial trading terminal and analytics suite for Arc, Circle's USDC-gas
  > Layer-1. It aggregates 24 Arc launchpads and DEXs into one table and one swap, with a Telegram sniper, a
  > launchpad (ArcToolsPad), a CCTP bridge and an Android app. ARCT is the platform token: staking earns a share
  > of launchpad fees, and every platform fee funds ARCT buyback and burn.
- **Detailed description**: użyj tekstu z sekcji "Opis" na dole tego pliku.
- **Supply**: total/circulating URL-e + uzasadnienie z sekcji Supply powyżej.
- **Markets**: DexScan URL + pool Uniswap V3 na arc-scan + zdanie: "24h volume ~$200–230K on Uniswap V3 (Arc),
  tracked by CMC DexScan; also tracked by MEXC, Bybit, Coinbase price pages, CryptoRank, LiveCoinWatch."
- **Socials**: X, Telegram, GitHub — dokładnie te same URL-e, co w stopce strony (sprawdzają zgodność; różnica =
  opóźnienie).
- **Logo**: link do arct-200.png (i załącz plik).
- **Proof of ownership**: patrz krok 3.

### 3. Dowód, że to Ty (najczęstszy powód odbicia)
CMC sprawdza, czy prośba pochodzi "od prawowitego źródła". Zrób WSZYSTKIE trzy, zanim wyślesz:
1. **Tweet z oficjalnego konta X** (tego ze stopki):
   > We have submitted ArcTools (ARCT) to @CoinMarketCap for a verified listing. Contract:
   > 0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52 (Arc). Request ID will be attached once issued.
   Po wysłaniu formularza dostaniesz numer zgłoszenia — dopisz go w odpowiedzi pod tweetem. Link do tweeta wklej
   w formularzu.
2. **Plik na stronie**: mogę wystawić https://arctools.fun/.well-known/cmc-verification.txt z treścią, jaką
   podasz (np. numer zgłoszenia + kontrakt). Daj znać po wysłaniu — 2 minuty.
3. **Wpis w README na GitHubie**: sekcja "Official links" z X/TG/stroną/kontraktem — trzy niezależne źródła
   mówiące to samo.

### 4. Po wysłaniu
- Odpowiedź przychodzi mailem z support.coinmarketcap.com, typowo 2–10 dni roboczych; przy "traction" szybciej.
- Zwykle pierwsza odpowiedź to prośba o doprecyzowanie supply lub o dowód własności. Odpowiadaj W TYM SAMYM
  tickecie, krótko, z linkami. Nowy ticket = kolejka od zera.
- Jeśli dostaniesz "Untracked listing" zamiast "Tracked": to i tak strona currencies/arctools z logo/linkami.
  Tracked (ranking, market cap na liście) wymaga "material volume" na śledzonym rynku — Uniswap V3 (Arc) to spełnia;
  jeśli odmówią, poproś o wskazanie brakującego kryterium (B.3) z linkiem do DexScan.
- Osobno: **CoinGecko** — jesteśmy tam już (agregatory MEXC/CoinStats/LiveCoinWatch ciągną z CG). Sprawdź,
  czy strona CG ma poprawne logo/linki; jeśli nie, formularz "Update" na coingecko.com/en/request-form.

## Czego NIE robić
- Nie kupuj "guaranteed listing / fast-track supply verification" — CMC publicznie wymienia takie oferty jako scam.
- Nie wysyłaj kilku zgłoszeń naraz.
- Nie używaj słowa "audited" (przegląd wewnętrzny). "Open source, code public" — tak.
- Nie wpisuj "listed on Coinbase/Binance" — to strony cenowe. Napisz "tracked by".

## Opis (Detailed description — do wklejenia)

ArcTools (arctools.fun) is a non-custodial trading terminal and analytics suite built for Arc, the Layer-1
launched by Circle with native USDC gas (chain ID 5042). The Terminal lists new pairs, trending tokens and
insider picks from 24 Arc venues (ArcToolsPad, ArcPad, RadarDex, Warp, Tolly, Archemist, Arguspad, act.fun,
UBI.fun, Uniswap V3/V4, long.supply, Lift, eve.fun, Klik, Minara, pools.trade, Sashimi, faze.fun, sharc.fun,
creo.family, peach.ag, hopium.gg) with one-click buys through an in-browser trading wallet or MetaMask/Rabby.
Token pages show live charts, dev-buy/dev-sell activity, insider trades, holder bubble maps, a sell simulation
(honeypot probe) and a token score. The swap aggregator routes across Uniswap V3, V4 and bonding curves with
split routing. Additional products: a Telegram sniper bot (@ArcSniper_bot), a group buy bot, the ArcToolsPad
launchpad, an on-chain limit-order engine (ArcOrders), a Circle CCTP v2 bridge from Ethereum/Base/Arbitrum,
USDC pay links (ArcClaim), public trader profiles, and the ArcOne Android app (arctools.fun/app).
The full source is public at github.com/ArcToolsRepo/arctools.

ARCT is the ArcTools platform token on Arc. Fair-launched on ArcPad (bonding curve, then Uniswap V3), no
presale, no team allocation, no mint function. Utility: staking ARCT earns a share of ArcToolsPad fees plus 5 %
of every token supply launched through the pad (arctools.fun/rewards); holding 10,000 ARCT gates the Insiders
smart-money leaderboard. Every platform fee (1 % sniper and launchpad trades, 0.5–1.5 % swaps, 2 % bridge and
pay links) is collected in USDC by the treasury and used to buy ARCT and burn it in the same transaction;
5.77 % of the supply has been burned to date (arctools.fun/bot/api/arct-burn).
