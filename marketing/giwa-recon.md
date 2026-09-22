# GIWA Chain — rozpoznanie (stan na 22.09.2026)

## 1. Czym jest GIWA
- Ethereum L2 na **OP Stack** budowane przez **Dunamu** (operator Upbit — największej giełdy w Korei, ~10M+ użytkowników). Zapowiedziane wrzesień 2025, testnet od jesieni 2025.
- 4.05.2026 (Consensus Miami): MoU Dunamu ↔ Optimism Foundation — GIWA ma być **pierwszym chainem na „Self-Managed" tierze OP Enterprise** (Dunamu kontroluje sequencer i decyzje sieci; Optimism daje monitoring i backup sequencer). Umowy wiążące „w toku", równolegle audyty i benchmarki.
- **Mainnet: nie ma, daty nie ma.** Docs: „GIWA Mainnet is currently under development. See you soon". Wszystkie źródła z maja 2026: „expected soon, no final date". Program akceleracyjny GASOK zakłada „Private Mainnet Deployment" dla zespołów w **sierpniu–wrześniu 2026** i Demoday na Korea Blockchain Week w **październiku 2026** → realistycznie mainnet publiczny Q4 2026 lub później.
- Firma: Dunamu, Business Registration 119-86-54968, Gangnam-daero 369, Seul.

## 2. Parametry sieci (testnet — jedyna istniejąca)
| | |
|---|---|
| Nazwa | GIWA Sepolia |
| Chain ID | **91342** (0x164ce) |
| L1 | Ethereum Sepolia (sourceId 11155111) |
| RPC | `https://sepolia-rpc.giwa.io` (publiczny, **rate-limited, „not for production"**); Flashblocks RPC `https://sepolia-rpc-flashblocks.giwa.io` (pre-confirmacje ~200 ms) |
| Blok | **1 s** |
| Gas | **ETH** (Sepolia ETH). W przyszłości Paymaster → opłaty w stablecoinach (zapowiedź, nie ma). Gas price ~0.01 gwei |
| Explorer | **Blockscout** `https://sepolia-explorer.giwa.io` (API v2 działa, bez klucza) |
| Bridge | `https://sepolia-bridge.giwa.io` (standard OP bridge; portal L1 `0x956962C34687A954e611A83619ABaA37Ce6bC78A`) |
| Faucet | GIWA Playground („Claim Test ETH", przez portfel w przeglądarce) — brak API faucetu |
| eth_getLogs | limit **10 000 bloków** na zapytanie (u nas na Arc 100k) |

Predeploye (genesis, adresy OP-standard): WETH9 `0x4200…0006`, Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`, Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`, CreateX `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`, Create2Deployer, Arachnid proxy, Safe, ERC-4337 EntryPoint v0.6/v0.7, EAS `0x4200…0021`, L2StandardBridge `0x4200…0010`.

Kontrakty ekosystemu GIWA: **VerifiedToken** (testowy token, faucet 24 h) `0xBCdB22f56642DE57624CfC2fBb9eE398cF3CA268`, **UPNameRegistry** (`nazwa.up.id` — Upbit Web3 Names) `0x091D00004f21eb2Fc30964A8a4995692d9b49628`, **Dojang** (atestacje EAS: „off-chain info as on-chain attestations", np. KYC Upbit) — kluczowe dla „GIWA Wallet in-app onboarding".

## 3. Waluta natywna
- **ETH** (Sepolia ETH na testnecie). Nie ma tokena GIWA. Nie ma natywnego USDC — na testnecie tylko mocki („USD Coin (Mock)" `0x0491d01B7baA35ACFD321ba73A2D4c713faE3865`, 136k holderów, deploy społecznościowy).
- Na mainnecie spodziewane: ETH gas, bridged USDC/USDT przez OP bridge; potem Paymaster ze stablecoinami (KRW-stable? Dunamu jest w konsorcjum won-stablecoin — spekulacja, nie fakt).

## 4. Skala testnetu (Blockscout, dziś)
- 36.7M bloków, **309M transakcji**, **152M adresów**, 5.5M tx/dobę.
- To w większości **farming airdropu**: tokeny „$개죽이" (100M holderów!), ZEOUL (5.45M), GASOK (4.34M), 까치/kachi (2M+1M), creatorx.me (814k) — masowe airdropy, boty sybilowe. Liczby użytkowników nie mówią nic o realnym popycie.

## 5. DEX-y i launchpady — co naprawdę jest
**Kanoniczny Uniswap: NIE MA.** Sprawdzone on-chain: brak kodu pod UniswapV3Factory `0x1F98…`, v4 PoolManager `0x0000…4444`, SwapRouter `0xE592…`, UniversalRouter `0x3fC9…`, V2 Factory `0x5C69…`. Uniswap Labs nie wdrożył GIWA (testnet).

**Forki wdrożone przez zespoły hackathonowe/GASOK** (Blockscout „verified", ~50 kontraktów każdego typu, prawie wszystkie **0 tx**):
- `UniswapV3Factory` ×2 (`0x268FB4Ab…`, `0x1C437d4b…`) — 0 tx.
- `UniversalRouter` ×2, `SwapRouter` ×3, `SwapRouter02` `0xCCCa53b4…` (4 tx), `WethFeeRouter` `0x9bFCC4bF…` (7 tx), `TerminalRouter` (0 tx).
- Launchpady: `MemeLaunchpad` `0x07449f54…` (28 tx), `LaunchpadV2Factory` (1 tx), ~50 `BondingCurve`, `VerifiedDojangLaunchpad` (launch tylko dla zweryfikowanych przez Dojang — ciekawy wzorzec pod Upbit KYC), `SocialTokenAllocationFactory` ×6.

**Projekty z działającym frontendem (GASOK Track):**
- **gasok.fun** — „Token launchpad on GIWA. Liquidity locked in Uniswap V3 from the first block. Non-custodial." Live na Sepolii: **39 tokenów**, „24h volume $32.7K" (testnetowe ETH liczone po cenie USD — fikcja), model pump.fun (bonding → „To target %" → graduacja do własnego forka V3). Ma „Terminal". Najbliższy konkurent ArcTools/ArcToolsPad na GIWA.
- **zeoul.xyz** — „A modern DEX for GIWA" (Next.js, WalletConnect); token ZEOUL 5.45M holderów (airdrop). Własny fork AMM.
- **kachi.xyz**, **creatorx.me**, **giwa-dex.vercel.app** (społecznościowy swap/liquidity), Syndix (paymaster/reader), vaulty — projekty pod granty.
- Żaden nie ma realnej płynności (testnet). Żaden nie jest „oficjalny".

**Wniosek**: na GIWA dziś nie ma nic do indeksowania w sensie rynku. Stan jak Arc w tygodniu 0 — z tą różnicą, że 152M sybilowych adresów zaśmieca dane.

## 6. Program GASOK (GIWA Accelerator for Sustainable On-chain Kernel)
- 5 tracków: DeFi/RWA, Consumer/Social, GIWA-Native, AI/Web3, Mass Adoption; do 3 zespołów na track; do **100k USD** na zespół (20k po Demoday + 80k KPI-based); pakiet builderów (RPC, audyty, cloud), biuro w Seulu, **„GIWA Wallet In-App Native Deployment Opportunity"** (= dystrybucja do użytkowników Upbit — to jest prawdziwa nagroda).
- Harmonogram: Pitch maj 2026 → MVP/testnet cze–lip → Market readiness + **private mainnet** sie–wrz → **Demoday KBW październik 2026** → Growth.
- **Aplikacje ZAMKNIĘTE** (strona: „APPLICATIONS CLOSED"). Kolejny nabór nieznany.
- Kryteria zaznaczają „GIWA Wallet integration" — Dunamu myśli o GIWA jako o ekosystemie **w aplikacji Upbit**, nie o otwartym degen-chainie.

## 7. Co to znaczy dla ArcTools
1. **Mainnet nie istnieje i nie ma daty.** Budowanie „1:1 z Arc" na testnecie to praca na środowisku, które zostanie zresetowane (nowe adresy, nowe RPC, prawdopodobnie nowe DEX-y). Wszystko, co wdrożymy (fork DEX, Pad, Locker), będzie do ponownego deployu.
2. **Brak kanonicznego Uniswapa** → aggregator i indekser V3/v4 nie mają celu; musielibyśmy sami postawić rynek (fork V2/V3), co na mainnecie zrobi ktoś inny (Uniswap/Velodrome/Dunamu) i nasz fork będzie martwy.
3. **Gas w ETH, brak USDC** → cała warstwa „USDC-native" (ceny, fee, Quick Buy, MoonPay `usdc_arc`, ArcClaim, bannery) wymaga refaktoru na ETH/WETH; USDC dojdzie dopiero z bridge'em na mainnecie.
4. **Dystrybucja jest w aplikacji Upbit (GIWA Wallet)**, nie w przeglądarce. Terminal webowy dla Koreańczyków bez integracji z GIWA Wallet będzie miał ułamek zasięgu gasok.fun, jeśli ten wejdzie do GASOK.
5. **Dane są zatrute** przez farmy sybilowe — Insider clusters, trader profiles, „New pairs" na testnecie będą śmieciem.

### Rekomendacja
- **Teraz**: nie wdrażać kontraktów ani indeksera na GIWA Sepolia. Zrobić **refaktor chain-config** (jeden `chains.ts` / `chains.py`: RPC, chainId, WETH/USDC, DEX-y, explorer, block anchor, gas token, decimals) w bocie, stronie, sniperze i apce — tak, żeby dodanie chaina było konfigiem + deployem kontraktów. To ~1 tydzień i zwraca się na każdym kolejnym chainie (nie tylko GIWA).
- **Przygotować „GIWA day-0 kit"**: skrypty deployu ArcAggregator/ArcOrders/ArcLocker/ArcToolsPad pod ETH-gas (parametryzacja fee token), tryb indeksera dla dowolnej fabryki V2/V3 wykrytej z bytecode, strona z przełącznikiem sieci ukrytym za flagą. Przetestować na **Base Sepolia** lub lokalnym Anvilu — środowisko z prawdziwym Uniswapem, zamiast GIWA Sepolia.
- **Śledzić**: docs.giwa.io/contracts (pojawienie się „Mainnet Contracts"), X Dunamu/GIWA, ogłoszenia Uniswap Labs o deployu, kolejny nabór GASOK (warto aplikować — „GIWA Wallet in-app" to jedyna realna dystrybucja).
- **Alternatywa o wyższym zwrocie w tym samym czasie**: chain z działającym mainnetem i Uniswapem, gdzie brakuje terminala (Tempo — `usdce_tempo` w MoonPay, chainId 4217, USDC-natywny jak Arc; HyperEVM). Ten sam refaktor otwiera oba.

## 8. Szybka ściąga adresów
- RPC: `https://sepolia-rpc.giwa.io` · chainId 91342 · explorer `https://sepolia-explorer.giwa.io` · bridge `https://sepolia-bridge.giwa.io`
- WETH9 `0x4200000000000000000000000000000000000006` · Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` · Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- Mock USDC `0x0491d01B7baA35ACFD321ba73A2D4c713faE3865` (społecznościowy) · VerifiedToken `0xBCdB22f56642DE57624CfC2fBb9eE398cF3CA268`
- Forki: UniswapV3Factory `0x268FB4Ab2F1689819Ac6f55F434F1213f1127Eb4`, `0x1C437d4bb341400c1e69389EeEB39b72AeedF261`; SwapRouter02 `0xCCCa53b4df27519b7Ffb8c7BEbD43b76dcaD3b5d`; MemeLaunchpad `0x07449f540887A3aC4763044bb999a5C68Ae460B6`
- Projekty: gasok.fun (launchpad), zeoul.xyz (DEX), kachi.xyz, creatorx.me, giwa-dex.vercel.app
- Portfele nasze na GIWA Sepolia: deployer `0x408c3d3F…6fE8` 0 ETH, E2E `0x731eA5B6…c620` 0 ETH (Sepolia L1 też 0)
