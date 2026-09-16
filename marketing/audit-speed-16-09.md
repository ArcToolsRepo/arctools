# ArcTools — audyt wydajności całej platformy (16.09.2026, 13:00 UTC)

Zakres: strona (Cloudflare Worker + SSR), API buybota (Railway), baza Postgres, indeks swapów, relay RPC, własny node,
sniper, frontend (bundle/CSS/media), stream SSE, huntery w tle. Tylko pomiary i propozycje — nic nie zmieniałem.

## 1. Co zmierzyłem

### Strony (TTFB, drugi odczyt „ciepły")
| Strona | TTFB | HTML | Uwagi |
|---|---|---|---|
| `/` | 0,26–0,43 s (raz 2,8 s) | 30 KB | skok do 2,8 s = timeout 2,5 s na `chain-status` w root loaderze |
| `/trade` | 2,3 s zimno / 1,0 s ciepło | **4,24 MB** | 16 752 adresów tokenów zserializowanych w HTML |
| `/token/<ca>` | 0,29 s | 38 KB | dobrze |
| `/insiders` | 0,41 s | 249 KB | pełna tablica w SSR — OK, ale można ciąć do 100 wierszy |
| pozostałe (/intel /rewards /bridge /scan /portfolio /profile /wallets /referrals /x/…) | 0,26–0,33 s | 12–25 KB | dobrze |
| `/launchpad` | 0,71 s zimno | 17 KB | on-chain odczyt ArcPad w SSR |

### API buybota (Railway, bezpośrednio)
| Endpoint | Czas | Ocena |
|---|---|---|
| ohlc / trades / token-stats / holder-risk / liq / token-meta / movers / insiders | 0,24–0,43 s | dobrze |
| trending 60 m | 1,2 s (zimno) | do precompute |
| stats (2 tokeny, 24 h) | 1,3 s | do precompute |
| whales 60 m | 1,0 s | do precompute |
| v4pool | 1,1 s | eth_call w request path |
| venue-tokens v2 | 0,8 s | OK |
| pad-tokens | **2,6 s** | 8 824 wierszy JSON za każdym razem |
| kols | **3,1 s** | policzalne raz na 10 min |
| **alpha accum** | **21 s zimno** (cache 45 s) | najwolniejszy endpoint |
| **bubbles ARCT** | **timeout 60 s** | prewarm nie obejmuje ARCT / zimny compute nie do użycia |

### Baza (Railway Postgres)
- `swaps`: **2,33 M wierszy, 1,27 GB** (+ ~1,2 M/dzień przy obecnym spamie), 305 k martwych krotek; indeksy 685 MB.
- `kol_following` 272 MB (2 M krawędzi).
- **`shared_buffers` = 128 MB, `work_mem` = 4 MB** przy bazie 1,65 GB → każde zapytanie okienkowe po `swaps` idzie z dysku, sorty spadają na dysk. To jest główny hamulec trending/stats/alpha/whales.
- `pg_stat_statements` wyłączone — nie widzimy, które zapytania zjadają czas.
- Pula: 20+20 (API) + 4+4 (ingest); przy 100 `max_connections` jest zapas.

### Indeks / node / relay / stream
- Ingest przez `eth_getBlockReceipts`: 300 bloków w 12,8 s, lag 9–70 bloków. OK.
- Node: p50 437 ms, p95 1,3 s (godzina) — **rośnie pod naszym własnym ruchem** (indeks + huntery + site); relay p50 346 ms.
- Relay, top wywołujący (od restartu): site multicall `0x82ad56cb` 35 747; site quoty aggregatora 20 756; **pasożyt Windows-UA `eth_getBalance` 21 450** (nadal wali, ale ograniczony per-IP); buybot `getBlockByNumber` 20 647 (już zbędne po receipts); **logo hunter `eth_getCode` 18 848** (binary-search bloku utworzenia = 25 wywołań na token).
- Stream SSE: 65 klientów, 48 k eventów, **9 236 dropów** (kolejka 200/klient — klienci na Terminalu z topikiem `*` nie nadążają).

### Frontend
- JS: `index` 363 KB, `app` 286 KB, `lightweight-charts` 194 KB, **`i18n-dict` 156 KB**, `token` 94 KB, `trade` 59 KB. 12 modułów preloadowanych na `/trade`.
- **CSS: 476 KB** przy 52 KB źródeł — reszta to nieużywany szablon/Tailwind; 30 `@font-face`.
- `public/`: 23 MB, w tym 4 filmy sceny ×2 (desktop+mobile) ≈ 18 MB (landing scroll-scrub), `positions-panel.png` 1,9 MB, `og-cover-v2.png` 680 KB, `archy.png` 377 KB (512 px).
- HTML `no-store` (celowo, po deployach) — każdy wejście = pełny SSR.

## 2. Propozycje przyspieszeń (wg wpływu / wysiłku)

### A. Duży wpływ, mały wysiłek
1. **`/trade`: SSR ≤ 120 wierszy, reszta z `/api/tokens` na kliencie.** 4,2 MB → ~150 KB. Największa pojedyncza poprawka odczuwalna dla użytkownika (mobile: 2–5 s ściągania + 1 s parsowania). Trend do 100 wierszy w SSR. Loader: 1,5 s cap już jest.
2. **Postgres: `work_mem` 64 MB tylko dla ciężkich zapytań** (`SET LOCAL work_mem` w sesji trending/stats/alpha/whales/kols) + włączyć `pg_stat_statements`. Zero ryzyka, sorty w RAM.
3. **Precompute w tle zamiast liczenia na request**: pętla co 30 s liczy `trending` dla okien (5m/60m/6h/24h/all) i `whales`, wynik trzymany w pamięci → 1,2 s → 5 ms; `kols` co 10 min; `pad-tokens` cache 60 s (2,6 s → ms). `_cached` SWR już jest — brakuje tylko wywołania „z zegara", żeby pierwszy klient też nie czekał.
4. **Alpha: liczyć w pętli** (co 45 s, jak dotąd TTL) na tabeli zagregowanej (patrz C1); zimne 21 s znika z request path. Do czasu C1 — pętla + cache stale.
5. **Bubbles: prewarm rozszerzyć o ARCT i top-50 wolumenu 24 h**, cold compute ograniczyć (limit holderów 100, timeout 20 s, zwrot częściowy). Dziś zimny token = 60 s i timeout.
6. **Root loader `chain-status`: timeout 2,5 s → 600 ms + memo KV 20 s.** Usuwa losowe 2,8 s na dowolnej stronie.
7. **Logo hunter: blok utworzenia z arc-scan API / z `pad_tokens.tx` zamiast 25× `eth_getCode`** — zdejmuje ~19 k wywołań z noda; równolegle zbić do 4 przy lagu > 200.
8. **Buybot `getBlockByNumber` w innych pętlach** (sender-fill, `_window_clock`): po receipts sender-fill ma pusty backlog — wyłączyć, gdy `pending=0`; `_window_clock` → 2 wywołania/okno zostają.
9. **Relay: zablokować UA pasożyta** (21 k `eth_getBalance`, ten sam Windows UA od tygodnia) — reguła po UA + brak klucza → 429 natychmiast. Odciąża arc-scan i node.

### B. Średni wpływ
10. **CSS 476 → ~80 KB**: purge nieużywanych klas szablonu (Tailwind content config na `src/**`), wywalić `@font-face` niewykorzystywanych krojów (zostawić Inter/IBM Plex Mono). Render-blocking na każdej stronie.
11. **`i18n-dict` 156 KB ładować per język** (5 plików) — dziś jeden plik z 5 językami; dla EN w ogóle nie ładować (kod już to przewiduje — dict lazy — ale bundle jest jeden).
12. **Stream `*` (Terminal): agregować** — wysyłać co 1 s paczkę zamiast każdego swapu; kolejka 200 → 500; usuwa 9 k dropów i skoki CPU na kliencie.
13. **`/insiders` SSR: 100 wierszy** + paginacja po stronie klienta (249 KB → 40 KB).
14. **Obrazy `public/`**: `positions-panel.png` 1,9 MB → WebP ~150 KB; `archy.png` 377 KB → 60 KB; `og-cover` → JPG 150 KB. Filmy landingowe są już lazy i per-urządzenie — zostawić.
15. **Cloudflare Cache dla `/api/tokens`, `/api/tokenpage`, `/bot/api/trending`**: `Cache-Control: public, s-maxage=15, stale-while-revalidate=60` na krawędzi → 0 obliczeń w Workerze dla większości odczytów. Dziś Worker odpowiada w ~0,2–0,5 s, ale każdy request to praca.
16. **Node pod obciążeniem (p95 1,3 s)**: (a) drugi node lub read-replica dla „ciężkiego” ruchu (indeks) vs „lekkiego” (site/sniper); (b) na razie: kolejność w site Worker: relay → node (relay ma micro-batching), a indeks bezpośrednio na node. Alternatywa zero-kosztowa: reth `--rpc.max-connections` i `--rpc.gascap` sprawdzić, oraz czy node ma dysk NVMe (getBlockReceipts to I/O).

### C. Strukturalne (największy zysk długoterminowo)
17. **Tabele zagregowane utrzymywane przez ingest**: `swaps_1m(token, minute, o,h,l,c,v,vb,n, traders)` i `token_day(token, day, vol, buys, sells, traders, first_ts, ath)`. Trending/stats/alpha/movers/whales/ohlc liczą się z nich (tysiące wierszy zamiast milionów). Przy 1,2 M swapów/dzień to jedyna droga, żeby za miesiąc nie mieć 40 M wierszy w każdym zapytaniu.
18. **Retencja `swaps`**: surowe swapy > 30 dni do tabeli archiwalnej (albo partycjonowanie po miesiącu) — indeksy 685 MB przestają rosnąć bez końca; `swaps_1m` trzyma pełną historię wykresów.
19. **Plan Postgresa**: przy 1,65 GB bazy 128 MB `shared_buffers` to za mało; jeden stopień wyżej na Railway (lub Neon/Supabase z 1–2 GB RAM) da 3–5× na zapytaniach okienkowych bez zmiany kodu.
20. **Sniper**: race_send na 4 RPC jest OK; jedyne, co przyspieszy „od kliknięcia do bloku”, to pominąć `estimateGas` (stały gas limit per venue — dane mamy z historii) i cache `gasPrice` 5 s (już jest). Zysk ~150–300 ms na buy.

## 3. Co jest w porządku (nie ruszać)
- Token page: SSR 0,29 s, chart/trades/stats API 0,3–0,4 s, stream z bloku < 1 s.
- Ingest po receipts: 9× zapas nad tempem chaina, wallet w każdym swapie.
- Self-heal (9/9), watchdog `running`, rpc-monitor, dedykowana pula ingestu, SWR cache.
- Strony statyczne 0,26–0,33 s.

## 4. Sugerowana kolejność
Dzień 1: A1, A2, A6, A9 (2 h łącznie, zero ryzyka).
Dzień 2: A3, A4, A5, A7, A8, B12.
Tydzień: C17 + C18 (agregaty + retencja), potem B10/B11/B14/B15.
Decyzja biznesowa: C19 (większy Postgres) i B16 (drugi node) — to koszty, nie kod.
