"""Discover launchpad contracts on Arc from project frontends: fetch HTML + JS bundles, collect 0x addresses and
API endpoints, then verify on-chain (has code? how many logs in the last N blocks? which topics?)."""
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RPC = "https://rpc-production-ba7a.up.railway.app"
SITES = {
    "actfun": "https://actfun.pro",
    "synthra": "https://synthra.org/",
    "arcfun": "https://arc.fun",
    "arcadeswap": "https://www.arcade.trading/swap",
    "pumparchi": "https://pump.archi",
    "archemist": "https://archemist.fun",
    "ubifun": "https://ubi.fun",
    "arguspad": "https://arguspad.io/",
    "onmifun": "https://onmi.fun",
    "minara": "https://minara.fun",
    "flipt": "https://flipt.fun/",
}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 Safari/537.36", "Accept": "*/*"}
KNOWN = {a.lower() for a in [
    "0x3600000000000000000000000000000000000000", "0xf0db7b58379503491d857dB50AC9ece64c653918",
    "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77", "0x7dfd4f31be6814d2906bde155c3e1b146eac1468",
    "0x8366a39cc670b4001a1121b8f6a443a643e40951", "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377",
    "0xcA11bde05977b3631167028862bE2a173976CA11", "0x0000000000000000000000000000000000000000",
    "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d", "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
]}


def get(url, timeout=25):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)
        return r.read().decode("utf-8", "ignore"), r.geturl()
    except Exception as e:  # noqa
        return "", f"ERR {e}"


def rpc(method, params):
    body = json.dumps({"id": 1, "jsonrpc": "2.0", "method": method, "params": params}).encode()
    r = urllib.request.urlopen(urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"}), timeout=40)
    j = json.load(r)
    return j.get("result")


def crawl(name, url):
    html, final = get(url)
    out = {"name": name, "url": url, "final": final, "html_len": len(html), "addrs": set(), "apis": set(), "chain5042": False, "js": []}
    if not html:
        return out
    base = re.match(r"https?://[^/]+", final or url).group(0)
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', html) + re.findall(r'href="([^"]+\.js)"', html)
    # next.js / vite chunk manifests
    scripts += re.findall(r'"(/_next/static/[^"]+\.js)"', html)
    urls = []
    for s in scripts:
        if s.startswith("//"):
            s = "https:" + s
        elif s.startswith("/"):
            s = base + s
        elif not s.startswith("http"):
            s = base + "/" + s
        if s not in urls:
            urls.append(s)
    texts = [html]
    with ThreadPoolExecutor(8) as ex:
        for body, _ in ex.map(lambda u: get(u, 30), urls[:40]):
            texts.append(body)
    # second level: chunks referenced inside JS (vite/next dynamic imports)
    more = []
    for t in texts[1:]:
        for m in re.findall(r'["\']((?:\./|/)?(?:assets|_next/static/chunks|static/js)/[A-Za-z0-9_\-./]+\.js)["\']', t):
            u = m if m.startswith("http") else base + ("/" + m.lstrip("./") if not m.startswith("/") else m)
            if u not in urls and u not in more:
                more.append(u)
    with ThreadPoolExecutor(8) as ex:
        for body, _ in ex.map(lambda u: get(u, 30), more[:60]):
            texts.append(body)
    out["js"] = urls[:40] + more[:60]
    for t in texts:
        if "5042" in t:
            out["chain5042"] = True
        for a in re.findall(r"0x[a-fA-F0-9]{40}", t):
            if a.lower() not in KNOWN:
                out["addrs"].add(a.lower())
        for a in re.findall(r'https?://[a-zA-Z0-9.\-]+(?:/api[^"\'\s)]*)?', t):
            if any(k in a for k in ("api.", "/api", "backend", "indexer", "rpc")) and "google" not in a and "walletconnect" not in a:
                out["apis"].add(a.rstrip("/"))
    return out


def verify(addr, head):
    try:
        code = rpc("eth_getCode", [addr, "latest"]) or "0x"
        if len(code) <= 2:
            return {"code": 0}
        logs = rpc("eth_getLogs", [{"fromBlock": hex(head - 9000), "toBlock": hex(head), "address": addr}]) or []
        topics = {}
        for lg in logs:
            topics[lg["topics"][0]] = topics.get(lg["topics"][0], 0) + 1
        return {"code": len(code) // 2, "logs9k": len(logs), "topics": dict(sorted(topics.items(), key=lambda x: -x[1])[:6])}
    except Exception as e:  # noqa
        return {"err": str(e)[:80]}


if __name__ == "__main__":
    names = sys.argv[1:] or list(SITES)
    head = int(rpc("eth_blockNumber", []), 16)
    for n in names:
        r = crawl(n, SITES[n])
        print(f"\n=== {n}  {r['final']}  html={r['html_len']}  js={len(r['js'])}  chain5042={r['chain5042']}")
        for a in sorted(r["apis"])[:12]:
            print("   api:", a)
        cands = sorted(r["addrs"])
        print(f"   {len(cands)} candidate addresses")
        with ThreadPoolExecutor(6) as ex:
            res = list(ex.map(lambda a: (a, verify(a, head)), cands[:60]))
        for a, v in res:
            if v.get("code"):
                print(f"   {a} code={v['code']}B logs9k={v.get('logs9k')} topics={v.get('topics')}")
