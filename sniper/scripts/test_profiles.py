"""End-to-end check of the profile API against production, signing with the E2E wallet.

Covers the paths that decide whether this feature is safe: a real signature is accepted, a forged one is not,
a wallet cannot be claimed twice, a reserved handle is refused, and the public reads come back shaped right.
"""
import json
import subprocess
import sys
import time

from eth_account import Account
from eth_account.messages import encode_defunct

BASE = "https://arctools.fun/bot"
KEY = open("/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools/.e2e_wallet").read().strip().split("\n")[0].strip()
ACC = Account.from_key(KEY)
OTHER = Account.create()


def msg(action, handle, wallet, ts):
    return f"ArcTools profile\naction: {action}\nhandle: {handle}\nwallet: {wallet.lower()}\nts: {ts}"


def sign(acc, action, handle, ts):
    return acc.sign_message(encode_defunct(text=msg(action, handle, acc.address, ts))).signature.hex()


def post(path, body):
    """curl, because urllib gets a Cloudflare 1010 from this host."""
    out = subprocess.run(
        ["curl", "-s", "-m", "30", "-X", "POST", f"{BASE}{path}",
         "-H", "Content-Type: application/json", "-d", json.dumps(body)],
        capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {"raw": out[:200]}


def get(path):
    out = subprocess.run(["curl", "-s", "-m", "30", f"{BASE}{path}"], capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {"raw": out[:200]}


def main():
    handle = sys.argv[1] if len(sys.argv) > 1 else "e2etrader"
    ts = int(time.time())
    ok = fail = 0

    def check(name, cond, detail=""):
        nonlocal ok, fail
        if cond:
            ok += 1; print(f"  PASS  {name}")
        else:
            fail += 1; print(f"  FAIL  {name} :: {detail}")

    print("wallet:", ACC.address)

    sig = "0x" + sign(ACC, "save", handle, ts).lstrip("0x")
    r = post("/api/profile/save", {"handle": handle, "wallet": ACC.address, "ts": ts, "sig": sig,
                                   "display": "E2E Trader", "bio": "automated test profile",
                                   "x_handle": "arctoolsfun", "public_positions": 1})
    check("create with a valid signature", r.get("ok"), r)

    bad = post("/api/profile/save", {"handle": handle + "x", "wallet": ACC.address, "ts": ts,
                                     "sig": "0x" + "11" * 65, "display": "forged"})
    check("forged signature rejected", bad.get("error"), bad)

    old = post("/api/profile/save", {"handle": handle, "wallet": ACC.address, "ts": ts - 5000,
                                     "sig": "0x" + sign(ACC, "save", handle, ts - 5000).lstrip("0x")})
    check("stale signature rejected", old.get("error"), old)

    ts2 = int(time.time())
    res = post("/api/profile/save", {"handle": "arc", "wallet": OTHER.address, "ts": ts2,
                                     "sig": "0x" + OTHER.sign_message(
                                         encode_defunct(text=msg("save", "arc", OTHER.address, ts2))).signature.hex().lstrip("0x")})
    check("reserved handle refused", res.get("error"), res)

    ts3 = int(time.time())
    dup = post("/api/profile/save", {"handle": handle + "2", "wallet": ACC.address, "ts": ts3,
                                     "sig": "0x" + sign(ACC, "save", handle + "2", ts3).lstrip("0x")})
    check("one wallet cannot start a second profile", dup.get("error"), dup)

    g = get(f"/api/profile?handle={handle}")
    p = g.get("profile") or {}
    check("profile reads back", p.get("handle") == handle, g)
    check("stats attached", isinstance(g.get("stats"), dict), list(g)[:4])
    check("badges attached", isinstance(g.get("badges"), list), g.get("badges"))

    byw = get(f"/api/profile?wallet={ACC.address.lower()}")
    check("lookup by wallet", (byw.get("profile") or {}).get("handle") == handle, byw)

    lb = get("/api/profiles/leaderboard?season=7d&sort=pnl&limit=5")
    check("leaderboard responds", isinstance(lb.get("rows"), list), lb)

    tr = get(f"/api/profile/trades?handle={handle}&limit=5")
    check("trade feed responds", isinstance(tr.get("trades"), list), tr)

    ch = get("/api/profiles/chart?token=0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52")
    check("chart marks respond", isinstance(ch.get("marks"), list), ch)

    bw = get(f"/api/profiles/by-wallets?wallets={ACC.address.lower()}")
    check("bulk wallet lookup", ACC.address.lower() in (bw.get("profiles") or {}), bw)

    ts4 = int(time.time())
    fo = post("/api/profile/follow", {"handle": handle, "wallet": ACC.address, "ts": ts4, "target": handle,
                                      "sig": "0x" + sign(ACC, "follow", handle, ts4).lstrip("0x")})
    check("follow works", fo.get("ok"), fo)
    fl = get(f"/api/profile/following?wallet={ACC.address.lower()}")
    check("following list", any(x.get("handle") == handle for x in (fl.get("following") or [])), fl)

    ts5 = int(time.time())
    xs = post("/api/profile/x/start", {"handle": handle, "wallet": ACC.address, "ts": ts5,
                                       "sig": "0x" + sign(ACC, "xstart", handle, ts5).lstrip("0x")})
    check("X verification code issued", str(xs.get("code", "")).startswith("arc-"), xs)

    print(f"\n{ok} passed, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
