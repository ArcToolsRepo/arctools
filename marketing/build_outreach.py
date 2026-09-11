"""Arc outreach list: every project with a public community, ranked by reachable audience."""
import concurrent.futures as cf
import json
import re
import urllib.request


def api(u):
    r = urllib.request.Request(u, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r, timeout=45))


toks = api("https://api.radardex.pro/tokens").get("tokens") or []
rows = []
for x in toks:
    tg = (x.get("telegram") or "").strip()
    xx = (x.get("twitter") or "").strip()
    if not tg and not xx:
        continue
    h = re.search(r"t\.me/([A-Za-z0-9_]+)", tg)
    rows.append({
        "holders": int(x.get("holderCount") or 0),
        "kind": "",
        "mcap": float(x.get("mcap") or 0),
        "members": 0,
        "name": (x.get("name") or "")[:26],
        "pad": x.get("launchpad") or "?",
        "sym": (x.get("symbol") or "?")[:14],
        "tg": h.group(1) if h else "",
        "traders24": int(x.get("traders24") or 0),
        "vol24": float(x.get("volume24") or 0),
        "x": xx,
    })


def members(handle):
    if not handle:
        return 0, ""
    try:
        r = urllib.request.Request(f"https://t.me/{handle}",
                                   headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        h = urllib.request.urlopen(r, timeout=20).read().decode("utf-8", "ignore")
        d = re.search(r'<div class="tgme_page_extra">([^<]*)</div>', h)
        d = d.group(1).strip() if d else ""
        m = re.search(r"([\d\s\u00a0]+) (members|subscribers)", d)
        n = int(re.sub(r"\D", "", m.group(1))) if m else 0
        return n, ("group" if "members" in d else "channel" if "subscriber" in d else "")
    except Exception:
        return 0, ""


with cf.ThreadPoolExecutor(8) as ex:
    res = list(ex.map(members, [r["tg"] for r in rows]))
for r, (n, k) in zip(rows, res):
    r["members"], r["kind"] = n, k

rows.sort(key=lambda r: -(r["members"] * 3 + r["traders24"]))

head = (
    "# Arc outreach list — every project on Arc with a public community\n\n"
    "Sorted by reachable audience (TG members x3 + 24h traders).\n\n"
    "**The pitch is never \"buy our token\".** It is: free buy-alert bot in your group,\n"
    "your logo and socials on every alert, a slot on the trending board, your holders\n"
    "tracked in the smart-money leaderboard. Every install puts ArcTools branding in\n"
    "front of their members on every single buy, permanently.\n\n"
    "Data: RadarDex screener + public t.me pages, 10 Sep 2026.\n\n"
    "| # | token | telegram | members | type | holders | mcap | vol 24h | traders 24h | X | pad |\n"
    "|---|-------|----------|---------|------|---------|------|---------|-------------|---|-----|\n"
)
lines = []
for i, r in enumerate(rows):
    tg = ("@" + r["tg"]) if r["tg"] else "—"
    lines.append(
        f"| {i+1} | {r['sym']} | {tg} | {r['members'] or '—'} | {r['kind'] or '—'} | "
        f"{r['holders']} | ${r['mcap']:,.0f} | ${r['vol24']:,.0f} | {r['traders24']} | "
        f"{r['x'] or '—'} | {r['pad']} |"
    )
with open("arc-outreach.md", "w") as f:
    f.write(head + "\n".join(lines) + "\n")

print("projektow z community:", len(rows))
print("z grupa/kanalem TG:", sum(1 for r in rows if r["tg"]))
print("suma czlonkow TG:", sum(r["members"] for r in rows))
print("grupy >100 osob:", sum(1 for r in rows if r["members"] > 100))
print("suma traderow 24h:", sum(r["traders24"] for r in rows))
print("\nTOP 12 po zasiegu:")
for r in rows[:12]:
    print(f"  {r['sym']:<12} @{r['tg']:<20} {r['members']:>5} os.  traderow24h {r['traders24']:>4}  mcap ${r['mcap']:,.0f}")
