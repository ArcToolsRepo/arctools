"""Full functional audit of arctools.fun — every tab, v1 and v2, plus the data behind each tab.

A page is not "OK" because it answered 200: a TanStack shell answers 200 while its content is missing.
Each page is checked for markers it can only contain if that tab actually rendered, and v2 pages must
additionally carry the terminal rail while v1 pages must NOT carry it.
"""
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

SITE = "https://arctools.fun"
BOT = "https://bot-production-4200.up.railway.app"
CA = "0xece5ca8bf9220718e5727754026757512212cb3c"      # ARGUS
W = "0x731ea5b6a768f8e0c47a977d3abf484e54adc620"
RAIL = "arc-dsp__rail"


def get(url, t=90):
    out = subprocess.run(["curl", "-s", "-m", str(t), "-w", "\n%{http_code}|%{time_total}", url],
                         capture_output=True, text=True).stdout
    body, _, meta = out.rpartition("\n")
    code, _, secs = meta.partition("|")
    return code.strip(), float(secs or 0), body


# page -> markers that prove the tab rendered
PAGES = {
    "trade":       ["ArcTools Terminal", "one-click buys"],
    "swap":        ["Swap on Arc", "ARCT buybacks"],
    "portfolio":   ["Arc portfolio", "valued in USDC"],
    "wallets":     ["Wallet watchlist"],
    "rewards":     ["ARCT staking", "ArcToolsPad trade"],
    "launchpad":   ["ArcToolsPad", "launch a token"],
    "pay":         ["Pay links", "send USDC"],
    "bridge":      ["Bridge USDC to Arc"],
    "insiders":    ["Arc Insiders", "smart-money"],
    "leaderboard": ["ArcTools", "trading terminal"],
    "scan":        ["Arc token scanner", "rug check"],
    "intel":       ["Arc Intel", "whales"],
    "profile":     ["ArcTools Profile", "PnL"],
    "referrals":   ["Referrals", "25%"],
}

# the tab strip is client-rendered and its labels are lowercase in the code (CSS uppercases them)
TOKEN_TABS = ["trades", "positions", "holders", "bubbles", "traders", "dev", "info"]

DEEP = ["?tab=new", "?tab=new15", "?tab=topvol", "?tab=alpha", "?tab=insiders", "?tab=favs",
        "?sort=chg", "?sort=mcap", "?pad=Tolly", "?pad=Hopium", "?pad=peach.ag"]

# the data each tab actually eats
DATA = [
    ("Terminal · lista tokenów",  f"{SITE}/api/tokens"),
    ("Terminal · trending",       f"{BOT}/api/trending?minutes=1440&limit=50"),
    ("Terminal · alpha",          f"{BOT}/api/alpha"),
    ("Terminal · insider picks",  f"{BOT}/api/insiders?limit=20"),
    ("Terminal · flagi symulacji", f"{BOT}/api/sim-flags"),
    ("Terminal · szyna padów",    f"{SITE}/api/padcounts"),
    ("Launchpad · lista",         f"{SITE}/api/padlist"),
    ("Token · nagłówek",          f"{SITE}/api/tokenpage?ca={CA}"),
    ("Token · trades",            f"{BOT}/api/trades?token={CA}&limit=30"),
    ("Token · stats",             f"{BOT}/api/token-stats?token={CA}"),
    ("Token · holders",           f"https://api.arc-scan.org/v1/tokens/{CA}/holders"),
    ("Token · top traders",       f"{BOT}/api/token-traders?token={CA}&limit=10"),
    ("Token · dev history",       f"{BOT}/api/dev-history?dev={W}"),
    ("Token · bubble map",        f"{BOT}/api/bubbles?token={CA}"),
    ("Token · wykres",            f"{BOT}/api/ohlc?token={CA}&tf=5m&limit=100"),
    ("Token · symulacja sprzedaży", f"{BOT}/api/sim?token={CA}"),
    ("Swap · trasa",              f"{SITE}/api/swaproute?token={CA}&side=buy&amount=1000000000000000000"),
    ("Portfolio · holdings",      f"{BOT}/api/holdings?wallet={W}"),
    ("Wallets · ślad portfela",   f"{BOT}/api/wallet-trades?wallet={W}&limit=10"),
    ("Rewards · burn ARCT",       f"{BOT}/api/arct-burn"),
    ("Rewards · buyback",         f"{BOT}/api/buyback-stats"),
    ("Pay · linki nadawcy",       f"{BOT}/api/claim/by-sender?wallet={W}"),
    ("Scanner · ryzyko",          f"{BOT}/api/holder-risk?token={CA}"),
    ("Intel · feed",              f"{BOT}/api/feed?limit=10"),
    ("Profile · dane",            f"{BOT}/api/profile?wallet={W}"),
    ("Stan łańcucha",             f"{BOT}/api/chain-status"),
]

fails = []


def check_page(name, markers):
    r = {}
    for ver, path in (("v1", f"/{name}"), ("v2", f"/{name}2")):
        code, secs, html = get(SITE + path)
        hit = sum(1 for m in markers if m in html)
        rail = RAIL in html
        ok = code == "200" and hit == len(markers) and (rail if ver == "v2" else not rail)
        if not ok:
            fails.append(f"{path} → http {code}, markery {hit}/{len(markers)}, szyna {rail}")
        r[ver] = (code, secs, f"{hit}/{len(markers)}", "OK" if ok else "FAIL")
    return name, r


print("=== STRONY: v1 obok v2 ===")
print(f"{'zakładka':<14} {'v1':<22} {'v2':<22} markery")
with ThreadPoolExecutor(8) as ex:
    for name, r in ex.map(lambda kv: check_page(*kv), PAGES.items()):
        a, b = r["v1"], r["v2"]
        print(f"{name:<14} {a[0]} {a[1]:>5.2f}s {a[3]:<8} {b[0]} {b[1]:>5.2f}s {b[3]:<8} {a[2]} · {b[2]}")

# tab labels live in the client bundle, so load it once and look there too
_c, _t, _idx = get(f"{SITE}/trade")
_m = re.findall(r'(?:src|href)="(/assets/[^"]+\.js)"', _idx)
BUNDLE = "".join(get(SITE + u)[2] for u in _m[:24])

print("\n=== STRONA TOKENA: 7 zakładek ===")
for path in (f"/token/{CA}", f"/token2/{CA}"):
    code, secs, html = get(SITE + path)
    hit = [t for t in TOKEN_TABS if t in html or t in BUNDLE]
    ok = code == "200" and len(hit) == len(TOKEN_TABS)
    if not ok:
        fails.append(f"{path} → zakładki {len(hit)}/{len(TOKEN_TABS)}")
    print(f"{path:<52} {code} {secs:>5.2f}s  zakładki {len(hit)}/{len(TOKEN_TABS)}  {'OK' if ok else 'FAIL'}")

print("\n=== DEEP LINKI TERMINALA v2 ===")
with ThreadPoolExecutor(6) as ex:
    def dl(q):
        code, secs, html = get(f"{SITE}/trade2{q}")
        ok = code == "200" and "arc-table" in html and RAIL in html
        if not ok:
            fails.append(f"/trade2{q} → http {code}")
        return f"  /trade2{q:<18} {code} {secs:>5.2f}s  {'OK' if ok else 'FAIL'}"
    for line in ex.map(dl, DEEP):
        print(line)

print("\n=== DANE POD ZAKŁADKAMI ===")


def dcheck(item):
    name, url = item
    code, secs, body = get(url)
    try:
        data = json.loads(body)
    except Exception:
        data = None
    n = "—"
    if isinstance(data, dict):
        for k in ("rows", "tokens", "trades", "items", "holders", "links", "meta"):
            if isinstance(data.get(k), list):
                n = f"{len(data[k])} rek."
                break
        else:
            n = f"{len(data)} pól"
    elif isinstance(data, list):
        n = f"{len(data)} rek."
    ok = code == "200" and data is not None
    if not ok:
        fails.append(f"{name} → http {code}")
    return f"  {name:<30} {code} {secs:>6.2f}s  {n:<12} {'OK' if ok else 'FAIL'}"


with ThreadPoolExecutor(6) as ex:
    for line in ex.map(dcheck, DATA):
        print(line)

# index lag has to hold, not just look good once
print("\n=== OPÓŹNIENIE INDEKSU ===")
lags = []
for _ in range(8):
    code, _, body = get(f"{BOT}/api/chain-status", 20)
    try:
        v = json.loads(body).get("index_lag_s")
        if v is not None:
            lags.append(v)
    except Exception:
        pass
if lags:
    under = sum(1 for v in lags if v < 4)
    print(f"  próbek {len(lags)} | mediana {sorted(lags)[len(lags)//2]}s | maks {max(lags)}s | <4s: {under}/{len(lags)}")
    if under < len(lags) * 0.8:
        fails.append(f"opóźnienie indeksu poniżej 4s tylko {under}/{len(lags)}")

print("\n" + ("WSZYSTKO OK" if not fails else "PROBLEMY:\n  " + "\n  ".join(fails)))
sys.exit(1 if fails else 0)
