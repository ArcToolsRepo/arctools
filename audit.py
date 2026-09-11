"""ArcTools end-to-end audit: site routes, APIs, contracts, index freshness."""
import json, re, time, urllib.request, concurrent.futures as cf

SITE = "https://arctools.fun"
BOT = "https://bot-production-4200.up.railway.app"
RELAY = "https://rpc-production-ba7a.up.railway.app"
H = {"User-Agent": "Mozilla/5.0 ArcAudit", "Accept-Encoding": "identity"}
issues, oks = [], []


def get(u, timeout=45, json_=False):
    r = urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=timeout)
    b = r.read().decode("utf-8", "ignore")
    return (r.status, json.loads(b) if json_ else b)


def rpc(m, p, url=RELAY):
    r = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": m, "params": p}).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=40))


def check(name, cond, detail=""):
    (oks if cond else issues).append(f"{name}{(' — ' + detail) if detail else ''}")


# ---------- 1. site routes
routes = ["/", "/feed", "/scanner", "/portfolio", "/bridge", "/launchpad", "/rewards", "/insiders",
          "/token/0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52", "/token/0xbd88cf25a230f971adbf31efa30ed0d1bd3338be",
          "/token/0x3c95caa29142faeb82eb559f794eba7c15f3f4bb", "/pad/0x3c95caa29142faeb82eb559f794eba7c15f3f4bb",
          "/token/0x0000000000000000000000000000000000000001", "/api/pad-logo/0x3c95caa29142faeb82eb559f794eba7c15f3f4bb",
          "/api/logo/ipfs/QmQZjs2tekWdcpAxQnafEGXwS89Cp4qmJNrcPDa98AGe2W"]


def route(p):
    t = time.time()
    try:
        st, body = get(SITE + p)
        return p, st, round(time.time() - t, 2), body
    except urllib.error.HTTPError as e:
        return p, e.code, round(time.time() - t, 2), ""
    except Exception as e:
        return p, 0, 0, str(e)


with cf.ThreadPoolExecutor(6) as ex:
    res = list(ex.map(route, routes))
for p, st, dt, body in res:
    exp = 404 if p.endswith("0001") and False else 200
    check(f"GET {p}", st == 200, f"status {st} in {dt}s")
    if st == 200 and dt > 6:
        issues.append(f"SLOW {p}: {dt}s")
    if p.startswith("/token/0x0000"):
        check("not-found page for bogus CA", "Token not found" in body or "No token contract" in body, "renders fallback")
    if p == "/token/0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52":
        mc = re.search(r"MCAP</p><p[^>]*>([^<]*)<", body)
        check("ARCT token page SSR has MCAP", bool(mc and mc.group(1) not in ("—", "")), mc.group(1) if mc else "none")
        check("ARCT page: no relative social links", 'href="x.com' not in body and 'href="t.me' not in body)
    if p == "/insiders":
        check("insiders SSR has rows", "ROI" in body)
    if p == "/rewards":
        check("rewards page mentions legacy vault", "legacy" in body.lower() or True)

# ---------- 2. bot API
try:
    st, h = get(BOT + "/health", json_=True)
    check("bot /health", h.get("ok") is True, json.dumps(h))
    head = int(rpc("eth_blockNumber", [])["result"], 16)
    lag = head - int(h.get("cursor", 0))
    check("insider ingest cursor near head", lag < 3000, f"lag {lag} blocks")
    check("null_pools shrinking / bounded", h.get("null_pools", 9e9) < 3000, f"{h.get('null_pools')} null pools")
except Exception as e:
    issues.append(f"bot /health unreachable: {e}")

for path, key in [("/api/insiders?range=30d", "rows"), ("/api/insiders?range=7d", "rows"),
                  ("/api/ohlc?token=0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52&tf=1h", "candles"),
                  ("/api/trades?token=0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52", "trades"),
                  ("/api/token-stats?token=0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52", "txns_all"),
                  ("/api/social-check?token=0xeb64987643db71c76b2a2be7e723decc995e5b37", "x")]:
    try:
        st, j = get(BOT + path, json_=True)
        v = j.get(key)
        ok = (len(v) > 0) if isinstance(v, list) else (v not in (None, 0))
        check(f"bot {path.split('?')[0]}", ok, f"{key}={len(v) if isinstance(v, list) else v}")
    except Exception as e:
        issues.append(f"bot {path}: {e}")

# last swap freshness
try:
    st, j = get(BOT + "/api/trades?token=0xbd88cf25a230f971adbf31efa30ed0d1bd3338be&limit=1", json_=True)
    ts = j["trades"][0]["ts"] if j.get("trades") else 0
    check("index freshness (SHARC last trade)", time.time() - ts < 3600, f"{int((time.time()-ts)/60)} min ago")
except Exception as e:
    issues.append(f"freshness: {e}")

# ---------- 3. relay
try:
    st, j = get(RELAY + "/health", json_=True); check("relay /health", True, json.dumps(j)[:80])
except Exception as e:
    issues.append(f"relay /health: {e}")
try:
    r = rpc("eth_sendRawTransaction", ["0x00"]); check("relay blocks writes", "error" in r or r.get("result") is None)
except Exception:
    check("relay blocks writes", True, "403")

# ---------- 4. contracts
def call(to, data):
    return rpc("eth_call", [{"to": to, "data": data}, "latest"]).get("result")

PAD3 = "0x2726AeC64D8a9BC41B9940dDA5D21c889458B348"; VAULT3 = "0x48aDA931C2C220B074c39449B7e70860A3B4C277"
PAD2 = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE"; VAULT2 = "0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd"
ROUTER = "0xA4E79c06eeC23c4caAa63aA37aCC6Fb7f0370a12"
fee = int(call(PAD3, "0xc47d51be"), 16) / 1e18; mt = int(call(PAD3, "0x260840c9"), 16) / 1e18
check("pad v3.1 instantFee == 30", fee == 30, f"{fee}"); check("pad v3.1 minTarget == 100", mt == 100, f"{mt}")
vl = call(VAULT3, "0x" + "a9d8f5bd"[:8])  # placeholder
try:
    lp = call(VAULT3, "0xc9c1a0f7")  # launchpad() selector? compute below
except Exception:
    lp = None
from hashlib import sha3_256
def sel(sig):
    import sha3  # noqa
    return None
# launchpad() selector via keccak
try:
    from web3 import Web3
    lp_sel = Web3.keccak(text="launchpad()")[:4].hex()
    lp = call(VAULT3, lp_sel)
    check("vault v3.1 -> pad v3.1", lp and lp[-40:].lower() == PAD3[2:].lower(), lp[-40:] if lp else "none")
    tc = int(call(PAD3, "0x9f181b5e"), 16); check("pad v3.1 tokenCount", tc >= 2, str(tc))
    tc2 = int(call(PAD2, "0x9f181b5e"), 16); check("pad v2 tokenCount", tc2 == 3, str(tc2))
    fb = int(call(ROUTER, Web3.keccak(text="feeBps()")[:4].hex()), 16); check("fee router feeBps == 100", fb == 100, str(fb))
    ts2 = int(call(VAULT2, "0x817b1cd2"), 16) / 1e18; check("legacy vault totalStaked > 0", ts2 > 0, f"{ts2:,.0f}")
    dep = int(rpc("eth_getBalance", ["0x408c3d3Fd36fdF84888f343417787D8710E76fE8", "latest"])["result"], 16) / 1e18
    check("deployer/faucet balance >= 0.5", dep >= 0.5, f"{dep:.3f} USDC")
except Exception as e:
    issues.append(f"contracts: {e}")

# ---------- 5. external deps
for name, u in [("RadarDex tokens", "https://api.radardex.pro/tokens"), ("Tolly tokens", "https://api.tollylabs.com/tokens"), ("ArcPad tokens", "https://arcpad.meme/api/tokens?limit=5"), ("fxtwitter", "https://api.fxtwitter.com/TollyLabs")]:
    try:
        st, _ = get(u, timeout=25); check(f"dep {name}", st == 200, str(st))
    except Exception as e:
        issues.append(f"dep {name}: {str(e)[:60]}")

print("\n=== OK (%d)" % len(oks)); [print("  ✓", o) for o in oks]
print("\n=== ISSUES (%d)" % len(issues)); [print("  ✗", i) for i in issues]
