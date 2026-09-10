# ArcTools — sniper + narzędzia dla sieci ARC (Circle)

Telegram bot: sniper (Tolly / Warp / Arcpad / Sharc / Uniswap V3), feed nowych par,
portfolio/PnL, alerty (graduacja / deployer / whale), copy-trade, bridge CCTP v2.
Wszystko na inline przyciskach. Gas = natywne USDC.

## Ekosystem ARC mainnet (wpisane w konfigi)

Infra (kanoniczna):
- USDC facade (ERC-20, 6 dec, widok na natywne USDC): `0x3600000000000000000000000000000000000000`
- Uniswap V3 Factory: `0xf0db7b58379503491d857dB50AC9ece64c653918`
- SwapRouter02: `0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77`
- QuoterV2: `0x7dfd4f31be6814d2906bde155c3e1b146eac1468`

Pady (pads.example.json):
- **RadarDex** (live): fabryki V2 `0x4B63…C93a`, Reflection `0x2d93…b2F8`, V1 legacy `0xdc6f…f5eE`;
  event `TokenLaunched` topic0 `0x851d681a…1d66`, token w topics[1]; launch prosto do V3 (1%),
  LP locked forever. API: `https://api.radardex.pro/tokenlist.json` / `/launches` / `/token/{addr}`.
- **ArcPad** (live): ArcCurvePad `0x24196CD6…6F29`, event `TokenCreated` topic0 `0x875522b0…1255`;
  pool V3 1%. UWAGA anti-snipe: pierwsze 1200 blokow (~2 min) max 2% supply na portfel.
  API: `arcpad.meme/api/tokens`, `/api/token/{addr}/live` (SSE).
- **Warp** (live): Launch factory `0x0dCad158…1255` (z bundla JS), WarpDex router `0x9D93c1B2…A9D7`;
  bonding curve per token — buy leci na kontrakt curve z eventu. Topic0 i sygnatury buy/sell
  ZWERYFIKUJ na pierwszym launchu (arc-scan.org → tx → Logs / calldata) — patrz nizej.
- **UniswapV3** (catch-all): standardowy `PoolCreated` na kanonicznej fabryce — lapie launche
  Tolly (routuja przez wspolny V3) i wszystko inne.

## Zasady działania snipera
- **Sell tax ignorowany** — minOut=0, brak symulacji blokującej. Szybkość > ochrona.
- Kupno na padach V3 (RadarDex/ArcPad/Tolly): approve USDC facade → `exactInputSingle`
  na SwapRouter02 (kwoty w 6 dec). Approve robi się raz na portfel (MAX) przy pierwszym buy.
- Kupno na curve (Warp): payable call na kontrakt curve, natywne value (1e18).
- Pre-estymacja gazu z fallbackiem 800k — buy nie odpada na estymacji.
- Race-broadcast: podpisana tx leci równolegle na wszystkie RPC z `ARC_RPC_URLS`.
- Tryby: **Instant**, **Na event** (TokenLaunched/TokenCreated/PoolCreated), **Na migrację**.
- Multi-wallet: kwota × N portfeli, kupno równoległe.

## Setup (Railway albo VPS)
```bash
pip install -r requirements.txt
cp .env.example .env        # uzupełnij
cp pads.example.json pads.json   # uzupełnij adresy padów
python main.py
```

### .env — minimum
- `BOT_TOKEN` — z @BotFather
- `MASTER_KEY` — `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`
- `ARC_RPC_URLS` — Twoje mainnetowe RPC (po przecinku; im więcej, tym szybszy race)
- `ARC_CHAIN_ID` — mainnet ARC
- `WRAPPED_USDC`, `UNIV3_FACTORY`, `UNIV3_ROUTER`, `UNIV3_QUOTER` — adresy z ARC mainnet
- `DATABASE_URL` — na Railway: `postgresql+asyncpg://...` (domyślnie SQLite)
- `FEED_CHANNEL_ID` — opcjonalny kanał publiczny na feed nowych par

### pads.json
Dla każdego pada: `factory` (kontrakt fabryki/curve), `event_topic`
(keccak eventu tworzenia tokena — weź z arcscan z pierwszego launchu),
`token_arg_index` (skąd w evencie wyciągnąć CA; -1 = UniV3 PoolCreated),
dla curve: `curve_buy_signature` / `curve_sell_signature` /
`curve_progress_signature` / `migration_topic`, dla instant_pool: `router` + `router_kind`
(`v2` | `univ3`).

Jak zdobyć topic: otwórz na arcscan tx pierwszego launchu na danym padzie →
Logs → skopiuj `topics[0]`. Sygnatury buy/sell: z zakładki Contract (jeśli
zweryfikowany) albo z calldata udanych transakcji kupna.

## Bridge CCTP v2
ETH/Base/Arbitrum → ARC, ten sam adres. Wymaga `ARC_CCTP_DOMAIN` (Circle publikuje
przy mainnecie) + RPC sieci źródłowych. Flow: approve → depositForBurn →
attestation (Iris API) → receiveMessage na ARC.

## Uwagi
- Ten sam ticker może istnieć na wielu padach — zawsze operuj na CA.
- Wartość natywna liczona wg 1e18; jeśli ARC używa 1e6 dla natywnego USDC,
  zmień `usdc_to_wei` w `pads.py` i `/1e18` w `chain.py`/`sniper.py`/`alerts.py`.
  Sprawdź pierwszą tx: jeśli kwoty wyglądają ×10^12 za małe/duże — to to.
- Klucze prywatne szyfrowane Fernetem (`MASTER_KEY`) w DB.
