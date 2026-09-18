"""Full regression of the profile feature against production.

Covers every endpoint the pages call, the security paths, the shapes the front-end depends on, and the edge
cases that bit us this week (empty stats for fresh wallets, leaderboard filtering everyone out, nested-label
uploads). Signs with the E2E wallet; never touches other people's profiles.
"""
import base64
import io
import json
import subprocess
import sys
import time

from eth_account import Account
from eth_account.messages import encode_defunct
from PIL import Image, ImageDraw

BASE = "https://arctools.fun/bot"
SITE = "https://arctools.fun"
KEY = open("/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools/.e2e_wallet").read().strip().split("\n")[0].strip()
ACC = Account.from_key(KEY)
H = "e2etrader"
ok = fail = 0


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  PASS  {name}")
    else:
        fail += 1; print(f"  FAIL  {name} :: {str(detail)[:160]}")


def msg(action, handle, wallet, ts):
    return f"ArcTools profile\naction: {action}\nhandle: {handle}\nwallet: {wallet.lower()}\nts: {ts}"


def sign(acc, action, handle, ts):
    return "0x" + acc.sign_message(encode_defunct(text=msg(action, handle, acc.address, ts))).signature.hex().lstrip("0x")


def curl(args, timeout=60):
    return subprocess.run(["curl", "-s", "-m", str(timeout)] + args, capture_output=True, text=True).stdout


def post(path, body):
    out = curl(["-X", "POST", f"{BASE}{path}", "-H", "Content-Type: application/json", "-d", json.dumps(body)])
    try:
        return json.loads(out)
    except Exception:
        return {"raw": out[:200]}


def get(path, base=BASE):
    out = curl([f"{base}{path}"])
    try:
        return json.loads(out)
    except Exception:
        return {"raw": out[:200]}


def status(url):
    return curl(["-o", "/dev/null", "-w", "%{http_code} %{time_total}", url]).split()


def img_b64(w, h):
    im = Image.new("RGB", (w, h), (40, 60, 120)); ImageDraw.Draw(im).ellipse((w * .3, h * .2, w * .7, h * .8), fill=(230, 230, 240))
    b = io.BytesIO(); im.save(b, "PNG"); return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


print(f"wallet {ACC.address}\n")

print("[ reads ]")
p = get(f"/api/profile?handle={H}")
check("profile by handle", (p.get("profile") or {}).get("handle") == H, p)
check("profile has stats + badges + followers", isinstance(p.get("stats"), dict) and isinstance(p.get("badges"), list) and "followers" in p, list(p))
st = p.get("stats") or {}
for k in ("pnl_total", "pnl_realized", "pnl_unrealized", "volume", "trades", "closed", "wallets", "days_active"):
    check(f"stats.{k} present", k in st, list(st)[:8])
check("stats.wallets contains the E2E wallet", ACC.address.lower() in [w.lower() for w in st.get("wallets", [])], st.get("wallets"))
byw = get(f"/api/profile?wallet={ACC.address.lower()}")
check("profile by wallet", (byw.get("profile") or {}).get("handle") == H, byw)
pv = get("/api/profile?wallet=0xb35c471b31d636b96f95b84e7a27d69b63235c0d&preview=1")
check("preview for a wallet without a profile", pv.get("preview") is True and pv.get("profile") is None, pv)
check("preview stats are computed (non-zero trades)", (pv.get("stats") or {}).get("trades", 0) > 0, pv.get("stats"))
bad = get("/api/profile?handle=NOPE!!")
check("invalid handle → 400/error", "error" in bad or bad.get("profile") is None, bad)
none = get("/api/profile?handle=zzz_no_such_profile_zzz")
check("unknown handle → profile null", none.get("profile") is None, none)

print("\n[ positions / trades / top ]")
pos = get(f"/api/profile/positions?handle={H}")
check("positions shape", isinstance(pos.get("open"), list) and isinstance(pos.get("closed"), list), list(pos))
if pos.get("open"):
    r = pos["open"][0]
    for k in ("token", "symbol", "value", "pnl", "pnl_pct", "held", "cost", "n", "last_ts"):
        check(f"open position has {k}", k in r, list(r))
posw = get("/api/profile/positions?wallet=0xb35c471b31d636b96f95b84e7a27d69b63235c0d")
check("positions by bare wallet", isinstance(posw.get("open"), list), posw)
tr = get(f"/api/profile/trades?handle={H}&limit=5")
check("trades shape + delay", isinstance(tr.get("trades"), list) and "delay" in tr, tr)
tt = get(f"/api/profiles/top-trades?handle={H}")
check("top trades shape", isinstance(tt.get("rows"), list), tt)
if tt.get("rows"):
    r = tt["rows"][0]
    for k in ("token", "pnl", "spent", "closed", "entry_mc", "now_mc", "last_ts"):
        check(f"top trade has {k}", k in r, list(r))
    check("top trades sorted by pnl desc", all(tt["rows"][i]["pnl"] >= tt["rows"][i + 1]["pnl"] for i in range(len(tt["rows"]) - 1)), [x["pnl"] for x in tt["rows"]])

print("\n[ leaderboard ]")
for season in ("7d", "30d", "all"):
    lb = get(f"/api/profiles/leaderboard?season={season}&sort=pnl&limit=20")
    rows = lb.get("rows") or []
    check(f"leaderboard {season} lists profiles", len(rows) >= 1, lb)
    check(f"leaderboard {season} rows carry ranked flag", all("ranked" in r for r in rows), rows[:1])
    check(f"leaderboard {season} no null pnl", all(r.get("pnl_total") is not None for r in rows), [r.get("pnl_total") for r in rows])
    check(f"leaderboard {season} sorted by pnl", all((rows[i].get("pnl_total") or 0) >= (rows[i + 1].get("pnl_total") or 0) for i in range(len(rows) - 1)), [r.get("pnl_total") for r in rows])
for sort in ("roi", "winrate", "volume"):
    lb = get(f"/api/profiles/leaderboard?season=all&sort={sort}&limit=5")
    check(f"leaderboard sort={sort} responds", isinstance(lb.get("rows"), list), lb)

print("\n[ search ]")
for q, want in (("e2e", H), ("trader", H), ("arctoolsfun", H)):
    s = get(f"/api/profiles/search?q={q}")
    check(f"search '{q}' finds {want}", any(r.get("handle") == want for r in (s.get("rows") or [])), s)
s = get("/api/profiles/search?q=x")
check("search too short → empty", (s.get("rows") or []) == [], s)

print("\n[ auth & writes ]")
ts = int(time.time())
r = post("/api/profile/save", {"handle": H, "wallet": ACC.address, "ts": ts, "sig": sign(ACC, "save", H, ts),
                               "display": "E2E Trader", "bio": "automated test profile", "x_handle": "arctoolsfun"})
check("save with valid signature", r.get("ok"), r)
forged = post("/api/profile/save", {"handle": H, "wallet": ACC.address, "ts": ts, "sig": "0x" + "22" * 65, "display": "hacked"})
check("forged signature rejected", "error" in forged, forged)
stale = post("/api/profile/save", {"handle": H, "wallet": ACC.address, "ts": ts - 3600, "sig": sign(ACC, "save", H, ts - 3600)})
check("stale signature rejected", "error" in stale, stale)
other = Account.create(); ts2 = int(time.time())
hijack = post("/api/profile/save", {"handle": H, "wallet": other.address, "ts": ts2, "sig": sign(other, "save", H, ts2), "display": "hijack"})
check("stranger cannot edit an existing profile", "error" in hijack, hijack)
ts3 = int(time.time())
res = post("/api/profile/save", {"handle": "arc", "wallet": other.address, "ts": ts3, "sig": sign(other, "save", "arc", ts3)})
check("reserved handle refused", "error" in res, res)
wrong_action = post("/api/profile/save", {"handle": H, "wallet": ACC.address, "ts": ts, "sig": sign(ACC, "follow", H, ts)})
check("signature for a different action rejected", "error" in wrong_action, wrong_action)

print("\n[ images ]")
ts4 = int(time.time())
up = post("/api/profile/image", {"handle": H, "wallet": ACC.address, "ts": ts4, "sig": sign(ACC, "image", H, ts4), "kind": "avatar", "data": img_b64(700, 700)})
check("avatar upload", up.get("ok") and up.get("size") == [512, 512], up)
ts5 = int(time.time())
up2 = post("/api/profile/image", {"handle": H, "wallet": ACC.address, "ts": ts5, "sig": sign(ACC, "image", H, ts5), "kind": "banner", "data": img_b64(2400, 800)})
check("banner upload (resized to ≤1500x500)", up2.get("ok") and up2.get("size", [0, 0])[0] <= 1500 and up2.get("size", [0, 0])[1] <= 500, up2)
code, ctype = status(f"{SITE}/bot/api/profile/image/{H}-avatar")[0], curl(["-o", "/dev/null", "-w", "%{content_type}", f"{SITE}/bot/api/profile/image/{H}-avatar"])
check("avatar served as image", code == "200" and ctype.startswith("image/"), (code, ctype))
notimg = post("/api/profile/image", {"handle": H, "wallet": ACC.address, "ts": ts5, "sig": sign(ACC, "image", H, ts5), "kind": "avatar", "data": base64.b64encode(b"not an image at all").decode()})
check("non-image rejected", "error" in notimg, notimg)
ts6 = int(time.time())
stranger_img = post("/api/profile/image", {"handle": H, "wallet": other.address, "ts": ts6, "sig": sign(other, "image", H, ts6), "kind": "banner", "data": img_b64(300, 100)})
check("stranger cannot replace images", "error" in stranger_img, stranger_img)
after = get(f"/api/profile?handle={H}")
check("profile.avatar updated to uploaded url", "/api/profile/image/" in ((after.get("profile") or {}).get("avatar") or ""), (after.get("profile") or {}).get("avatar"))
card = curl(["-o", "/dev/null", "-w", "%{http_code} %{content_type} %{size_download}", f"{BASE}/api/profile/card?handle={H}"]).split()
check("OG card is a PNG", card[0] == "200" and card[1] == "image/png" and int(card[2]) > 5000, card)

print("\n[ follow / feeds / chart ]")
ts7 = int(time.time())
fo = post("/api/profile/follow", {"handle": H, "wallet": ACC.address, "ts": ts7, "target": "boos", "sig": sign(ACC, "follow", H, ts7)})
check("follow another profile", fo.get("ok"), fo)
fl = get(f"/api/profile/following?wallet={ACC.address.lower()}")
check("following list contains target", any(x.get("handle") == "boos" for x in (fl.get("following") or [])), fl)
ff = get(f"/api/profile/following-feed?wallet={ACC.address.lower()}&limit=5")
check("following feed responds", isinstance(ff.get("trades"), list), ff)
ts8 = int(time.time())
un = post("/api/profile/follow", {"handle": H, "wallet": ACC.address, "ts": ts8, "target": "boos", "off": True, "sig": sign(ACC, "follow", H, ts8)})
check("unfollow", un.get("ok") and un.get("following") is False, un)
ch = get("/api/profiles/chart?token=0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52")
check("chart marks respond", isinstance(ch.get("marks"), list), ch)
if ch.get("marks"):
    check("chart marks have handle/side/usdc/ts", all(all(k in m for k in ("handle", "side", "usdc", "ts")) for m in ch["marks"][:5]), ch["marks"][0])
bw = get(f"/api/profiles/by-wallets?wallets={ACC.address.lower()},0xe34acb641acbe8063a81f60822a6379d795dbc32")
check("bulk wallet lookup returns both", len(bw.get("profiles") or {}) == 2, bw)

print("\n[ wallet-trades live stats ]")
wt = get(f"/api/wallet-trades?wallet={ACC.address.lower()}&limit=5")
check("wallet-trades has stats (live fallback)", len(wt.get("stats") or []) >= 1, wt.get("stats"))

print("\n[ pages ]")
for path in ("/leaderboard", f"/u/{H}", "/u/boos", "/u/dsf", "/profile", "/trade",
             "/token/0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52", "/insider/0xe34acb641acbe8063a81f60822a6379d795dbc32", "/u/zzz_no_such_profile_zzz"):
    code, t = status(f"{SITE}{path}")
    check(f"{path} → 200 in {float(t):.2f}s", code == "200" and float(t) < 4, (code, t))
html = curl(["--compressed", f"{SITE}/u/{H}"]).replace("\x00", "")
check("/u page ships og:image meta", "og:image" in html and f"card?handle={H}" in html, "meta missing")
check("/u page ships twitter:card", "summary_large_image" in html, "twitter meta missing")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
