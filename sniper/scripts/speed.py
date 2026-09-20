"""What a visitor actually waits for on the Terminal — measured, step by step.

No browser here, so this reproduces the waterfall by hand: HTML (SSR) -> critical JS -> data calls the page
fires after hydration. Prints where the time goes, so "make it fast like GMGN" becomes a list of numbers.
"""
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

SITE = "https://arctools.fun"
BOT = "https://bot-production-4200.up.railway.app"
PAGE = sys.argv[1] if len(sys.argv) > 1 else "/trade2"


def timed(url, gzip=True):
    args = ["curl", "-s", "-m", "60", "-o", "/dev/null", "-w", "%{time_connect} %{time_starttransfer} %{time_total} %{size_download}"]
    if gzip:
        args += ["-H", "accept-encoding: br,gzip"]
    out = subprocess.run(args + [url], capture_output=True, text=True).stdout.split()
    c, ttfb, tot, size = map(float, out)
    return c, ttfb, tot, int(size)


print(f"=== 1. HTML {PAGE} (SSR) — 3 pomiary ===")
for _ in range(3):
    c, ttfb, tot, size = timed(SITE + PAGE, gzip=False)
    print(f"  connect {c:.2f}s | TTFB {ttfb:.2f}s | całość {tot:.2f}s | {size/1024:.0f} KB")
html = subprocess.run(["curl", "-s", "-m", "60", SITE + PAGE], capture_output=True, text=True).stdout
js = sorted(set(re.findall(r'(?:src|href)="(/assets/[^"]+\.js)"', html)))
print(f"  skryptów: {len(js)} | wierszy tabeli w SSR: {html.count('arc-row-link')} | placeholderów '…': {html.count('…')}")

print("\n=== 2. JS krytyczny ===")
with ThreadPoolExecutor(8) as ex:
    sizes = list(ex.map(lambda u: (u, timed(SITE + u)), js))
total = sum(s[1][3] for s in sizes)
print(f"  {len(js)} plików, łącznie {total/1024:.0f} KB skompresowane")
for u, (c, ttfb, tot, size) in sorted(sizes, key=lambda x: -x[1][3])[:5]:
    print(f"    {size/1024:>6.0f} KB  {tot:.2f}s  {u.split('/')[-1][:44]}")

print("\n=== 3. dane po hydracji (to, na co czeka tabela) ===")
calls = [
    ("site", "/api/tokens?lite=1"), ("site", "/api/padcounts"), ("site", "/api/padlist"),
    ("bot", "/api/trending?minutes=1440&limit=400"), ("bot", "/api/trending?minutes=0&limit=400"),
    ("bot", "/api/trending?minutes=60&limit=200&sort=trend"), ("bot", "/api/chain-status"), ("bot", "/api/pads"),
    ("bot", "/api/holder-risk?tokens=0xece5ca8bf9220718e5727754026757512212cb3c"),
]
def one(item):
    who, e = item
    base = SITE if who == "site" else BOT
    return who, e, timed(base + e)
with ThreadPoolExecutor(6) as ex:
    for who, e, (c, ttfb, tot, size) in ex.map(one, calls):
        print(f"  {who:<4} {e[:44]:<44} connect {c:.2f}s  TTFB {ttfb:.2f}s  {size/1024:>6.0f} KB")

print("\n=== 4. sieć do backendu ===")
c, ttfb, tot, _ = timed(BOT + "/api/chain-status")
print(f"  bot (Railway):     connect {c:.2f}s, TTFB {ttfb:.2f}s")
c, ttfb, tot, _ = timed(SITE + "/api/padcounts")
print(f"  site (Cloudflare): connect {c:.2f}s, TTFB {ttfb:.2f}s")
