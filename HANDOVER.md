# ArcTools — dokument przekazania (kontynuacja w nowym czacie)

Wklej ten plik na start nowego czatu. Zawiera pełny stan projektu na 10.09.2026.

---

## 1. Co to jest

Ekosystem narzędzi tradingowych dla **Arc (Circle L1, chain ID 5042, mainnet, gaz = natywne USDC)**.
Właściciel pisze po polsku, UI produktów po angielsku. Fee: 1% od trade'u snipera, 2% od bridge, 1% od trade'u na launchpadzie (10% z tego dla stakerów ARCT).

## 2. Komponenty i gdzie żyją

| Komponent | Co robi | Hosting |
|---|---|---|
| **Strona arctools.fun** | feed/explorer, scanner, portfolio, bridge, ArcToolsPad (launchpad), rewards (staking), **insiders** (smart money) | **Cloudflare Worker `arctools-site`** na koncie usera (konto: `fa6c629eb1cfc4c5286d0c1735702f20`, zone arctools.fun: `c9fce4cd51c291f608cb976fc5d83f1f`). Deploy: `bunx wrangler deploy --name arctools-site` z katalogu `app/`. Backup URL: arctools-site.stablepump-ops.workers.dev |
| **@ArcSniper_bot** | sniper: CA→panel kupna, snipe launchy, PnL, TP, panic, bridge, copy-trade | Railway projekt **ArcTools**, service `bot` |
| **@ArcToolsBuyBot** | buy alerty w grupach, trending @ARCTrends, boosty, **Arc Insider API** | Railway projekt **ArcBuyBot**, service `bot`. API: `https://bot-production-4200.up.railway.app` |
| **RPC relay** | read-only JSON-RPC z CORS + gas faucet | Railway projekt **ArcTools**, service `rpc` → `https://rpc-production-ba7a.up.railway.app` |
| **GitHub** | monorepo kodu | `https://github.com/ArcToolsRepo/arctools` (prywatne) |

Repo strony (platforma Higgsfield, wciąż działa jako git remote): katalog `arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779`, website_id `ef3a81ae-051b-4d54-aab9-d6c0fabc7779`.
**UWAGA:** deploy przez platformę Higgsfield ma awarię od kilku godzin → **deployujemy przez wrangler na Cloudflare usera** (patrz wyżej).

## 3. Adresy on-chain (Arc, 5042)

- **$ARCT** (token projektu): `0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52`
- **ArcPadLaunchpad v2**: `0x1EaAD48260eECC7624666F1dFec202b2D75257fE`
- **ArcRewardsVault v2**: `0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd`
- **ArcBridgeFeeProxy**: `0xA42c4BEee84CEd9f2ea15b3981B8A321943b7Bec`
- Fee wallet / treasury: `0xb35c471b31D636B96f95b84E7A27D69B63235C0D`
- Deployer + faucet wallet: `0x408c3d3Fd36fdF84888f343417787D8710E76fE8` (klucz ujawniony w starym czacie → traktować jako spalony, używany tylko do automatyki)
- USDC facade: `0x3600000000000000000000000000000000000000` (6 dec ERC-20, natywnie 1e18)
- UniV3 factory `0xf0db7b58379503491d857dB50AC9ece64c653918`, SwapRouter02 `0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77`, QuoterV2 `0x7dfd4f31be6814d2906bde155c3e1b146eac1468`, Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`
- Tokeny testowe pada: APDEMO `0xc27200409092Ec7630bA34755865655BD4236c02`, MALA (launch usera)

## 4. Kluczowe realia techniczne (nie odkrywać ponownie)

- **RPC**: `rpc.arc-scan.org` blokuje IP Cloudflare (429) → strona używa **relaya na Railway** (primary), potem Infura (klucz publiczny, dzienny limit), potem arc-scan. Boty: arc-scan primary + Infura fallback z kwarantanną 10 min.
- **`eth_getLogs` ma limit 10 000 bloków** i 128 KB payloadu na request (multicall chunk ≤ 200 calli).
- Cache serwerowy strony: `memo()` w `arc-api.ts` — **stale-while-revalidate** (p95 pod obciążeniem 50 userów = ~120 ms, test obciążeniowy zrobiony).
- Sociale/logo tokenów: screener `https://api.radardex.pro/tokens` (mcap, txnsAll, holderCount, icon, socials, launchpad), Tolly: `https://api.tollylabs.com/tokens`, holders: `https://api.arc-scan.org/v1/tokens/<ca>/holders`, portfel: `https://api.arc-scan.org/v1/address/<addr>/tokens`.
- Kontrakty kompilować: solc 0.8.24 z `~/.solcx/`, **`via_ir=True`** (stack too deep), pobieranie z `binaries.soliditylang.org` (solc-bin jest zablokowany DNS-owo).
- web3.py w sandboxie: `signed.rawTransaction` (nie `raw_transaction`), zawsze podawać `from` przy `build_transaction`, symulować `eth_call` przed wysyłką.

## 5. Stan funkcji (wszystko live, chyba że zaznaczono)

**Strona:** feed z zakładkami Top (ranking mcap, rotacja) / ArcToolsPad / Tolly / RadarDex / ArcPad / Warp / New pools (mix wszystkich padów ≤15 min) · przypięty OFFICIAL ARCT · świece z eventów · scanner z fallbackiem pool z padów · portfolio (pełne holdingi z indeksera arc-scan) · bridge z **ostrzeżeniem o pauzie CCTP do 16.09** · launchpad (create z taxami, reward token USDC/ARCT/custom, logo, sociale) · token page (mcap$, TX, holders, progress, swap, edytor logo dla twórcy) · rewards (staking ARCT, dropy 5%) · **/insiders** (leaderboard smart money, gate 10 000 ARCT, przycisk Copy) · ticker buyów/trendingu · wersja mobilna (nav 2-rzędowy, statyczny hero) · faucet gazowy (UI gotowe, **wymaga D1 — patrz TODO**).

**Sniper:** globalny CA-paste, panel kupna, snipe padów (config-only w `pads.json`, ArcToolsPad dodany), wycena pozycji z fallbackiem na curve, walidacja "to portfel, nie token", failover RPC z kwarantanną, gaz cache 3 s + równoległy nonce, deep-link `?start=copy_<wallet>` → uzbraja copy-trade.

**Buybot:** alerty buy z **logo projektu** + sociale (screener → on-chain meta), trending @ARCTrends: boosty 🚀 na górze (płatne, gwarantowane), potem każdy śledzony token (dodanie bota = miejsce od razu + ogłoszenie na kanale), potem fillery top-mcap z ≥50 transakcji; mirror zakupów **≥ $30** na kanał; płatności boostów w DM (nie w grupie); ranking #N w alertach.

**Arc Insider (nowe):** ingest chain-wide wszystkich swapów (V3/V2/pad) do tabeli `swaps`, resumowalny backfill 30 dni (w toku, ~13 h), job `wallet_stats` co 10 min (PnL avg-cost realized+unrealized, winrate, filtry: ≥3 zamknięte pozycje, ≥$200 wolumenu, bez botów >500 tx/d i adresów infrastruktury), API `/api/insiders?range=7d|30d|all` + `/api/insider/<wallet>`.

## 6. TODO / następne kroki

1. **D1 na nowym Workerze** — token CF nie ma uprawnienia D1 (błąd „Authentication error"). Bez bazy nie działa: zapis logo/socjali tokenów ArcToolsPada i faucet gazowy (UI mówi „storage offline"). Fix: user dodaje do tokenu CF permission **Account → D1 → Edit**, wtedy: utworzyć bazę `arctools-db`, dodać binding `DB` w `wrangler.jsonc`, ustawić sekret `FAUCET_AUTH` (`bunx wrangler secret put FAUCET_AUTH`, wartość musi być identyczna jak zmienna `FAUCET_AUTH` w Railway service `rpc`), redeploy.
2. Poczekać na backfill Insidera (~13 h) → leaderboard sam się zapełni; potem strona profilu `/insiders/:wallet` i kanał @ArcInsiders (plan MVP w pliku `arc-insider-mvp-plan.md`).
3. Zdjąć ostrzeżenie o bridge po 16.09 (strona `/bridge` + menu w sniperze).
4. Marketing: gotowe posty na X (8 sztuk) i grafiki wygenerowane w starym czacie; konto X projektu: **@ArcToolsBackup**.
5. Rozważyć własny płatny RPC (Infura publiczna ma limit) i limit orders w sniperze (kolejny brakujący tool na Arc).

## 7. Poświadczenia — user wkleja w nowym czacie

Nie zapisuję ich w tym pliku. Do kontynuacji pracy potrzebne będą:
- token Cloudflare (z uprawnieniem Workers + **D1 Edit**),
- Railway API tokens: projekt **ArcTools** (sniper + rpc) i **ArcBuyBot**,
- token GitHub (jeśli mirrorujemy kod),
- (opcjonalnie) dostęp do repo strony na platformie Higgsfield — pobierany komendą `website_repo_access` z website_id z sekcji 2.
