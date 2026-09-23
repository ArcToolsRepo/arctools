"""Seed the ArcTools house gigs on ArcWork (create missing ones on-chain, publish signed metadata + generated 800×450 cover for all).
Usage: DEPLOYER_KEY=0x.. python seed_work_gigs.py"""
import base64, io, json, os, time, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct

RPC = os.environ.get("ARC_RPC", "http://178.156.197.90:8545"); BOT = "https://bot-production-4200.up.railway.app"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120})); A = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"]); U = 10 ** 18
W = w3.eth.contract(address="0x74Dfc2012B71a377cCDaAE7b7Acd8Df3Cf1A5706", abi=json.load(open(os.path.join(os.path.dirname(__file__), "ArcWork.build.json")))["abi"])
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'; R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
CAT = {"logo": 0, "web": 1, "tg": 2, "kol": 3, "review": 4, "other": 5}
CONTACT = "Telegram @ArcToolsPortal"; TG = "ArcToolsPortal"

# slug → (category, price USDC, days, title, description, samples, tags, cover accent)
GIGS = {
 "banner-slot":      ("other", 250, 7, "Sponsored banner slot on the Terminal (7 days)", "One of the three banner slots under the Terminal heading on arctools.fun (classic + v2), 7 days, ~40k page loads. You send a 1060×144 px banner (we resize if needed); it goes live within 24 h after a human review (no shorteners, no impersonation, no drainers). Escrow releases when the banner is live and you have the link.", ["https://arctools.fun/advertise"], ["ads", "banner"], (46, 124, 255)),
 "dev-audit-report": ("review", 40, 3, "Dev-audit report for your token (PDF + public link)", "A written report from the ArcTools indexer for one token: deployer wallet history, funder cluster, bundle detection, holder concentration, LP status, sell simulation, clone-farm check. Delivered as a PDF plus a public arctools.fun link your community can verify. Turnaround 3 days.", ["https://arctools.fun/scan"], ["audit", "trust"], (34, 197, 128)),
 "locker-setup":     ("other", 60, 2, "ArcLocker setup: lock LP or team tokens, with proof link", "We set up your lock in ArcLocker together (LP tokens, team vesting with cliff, Uniswap V3/v4 positions), verify it on-chain and hand you the proof page plus a shareable graphic. The 50 USDC locker fee is included in the price.", ["https://arctools.fun/locker"], ["locker", "lp"], (34, 197, 128)),
 "buybot-setup":     ("tg", 30, 1, "Buy bot + trending setup for your Telegram group", "@ArcToolsBuyBot added to your group with custom emoji, minimum buy, media and socials configured, and your token wired to @ARCTrends. Includes a 30-minute call if you want one. Done within 24 h.", ["https://t.me/ArcToolsBuyBot"], ["telegram", "bot"], (46, 124, 255)),
 "logo-banner-pack": ("logo", 40, 2, "Logo + banner pack for your token (3 concepts, 2 revisions)", "Three logo concepts in the style you describe, you pick one, two rounds of revisions. Deliverables: logo 512 px PNG (transparent), 200 px CMC/DexScreener version, X header 1500×500, Telegram banner, ArcTools 1060×144 banner. Files via link, sources included.", ["https://arctools.fun/assets/brand/arct-512.png"], ["logo", "design"], (255, 122, 60)),
 "landing-page":     ("web", 200, 4, "Token landing page (one page, live on your domain)", "A one-page site for your token: hero with live price from ArcTools, how to buy (Terminal + ArcOne links), tokenomics, roadmap, socials, dev-audit and locker badges. Deployed to your domain or ours (yourtoken.arctools.fun). Source handed over. 4 days.", ["https://arctools.fun"], ["website", "landing"], (46, 124, 255)),
 "kol-post":         ("kol", 150, 2, "Announcement on @ArcToolsBackup (X) + @ARCTrends (Telegram)", "One post about your token on the ArcTools X account and a pinned announcement in the @ARCTrends Telegram channel for 24 h, with a graphic made by us in the ArcTools style and links to your token page. Facts only: we describe what your token is and link the dev audit; we do not write price predictions.", ["https://x.com/ArcToolsBackup", "https://t.me/ARCTrends"], ["kol", "announcement"], (255, 122, 60)),
 "graphics-pack":    ("logo", 60, 2, "Marketing graphics pack (5 posters in your brand)", "Five ready-to-post graphics (1600×1000) for X/Telegram: launch, milestone, locker proof, dev-audit badge, how-to-buy. Your colors and logo, ArcTools quality. 2 days, one revision round.", ["https://arctools.fun"], ["design", "marketing"], (255, 122, 60)),
 "instant-launch":   ("other", 100, 1, "Full launch on ArcToolsPad: token, metadata, locker, bot", "We launch your token on ArcToolsPad with you: name/symbol/supply, logo and socials on the token page, buy bot in your group, ArcLocker for the team allocation, and a launch graphic. The 30 USDC launch fee is included. Same day.", ["https://arctools.fun/launchpad"], ["launch", "pad"], (34, 197, 128)),
 "api-integration":  ("review", 80, 2, "x402 API integration for your bot or dashboard (dev session)", "A 60-minute dev session plus code review: wiring token-stats / dev-audit / sell-sim from the ArcTools pay-per-call API into your bot, agent or site, with the Arc network entry and a working client in your language. Includes 5 USDC of API credit paid to your wallet.", ["https://arctools.fun/api-docs"], ["api", "x402", "developers"], (34, 197, 128)),
 "token-profile":    ("other", 15, 1, "Token profile on ArcTools: logo, socials, description, everywhere", "Your token's logo, X, Telegram, website and description set on ArcTools — Terminal (v1 and v2), token pages, ArcOne app, buy bot cards and @ARCTrends. Verified against your contract or deployer signature. Same day.", ["https://arctools.fun/trade"], ["profile", "listing"], (46, 124, 255)),
 "launchpad-integration": ("review", 300, 3, "Launchpad integration into ArcTools (index, logos, sniper, rail)", "For launchpad teams: your factory and hook mapped in the ArcTools indexer, tokens tagged with your name, logos and socials pulled from your contracts or API, your pad in the Terminal rail and filters, sniper auto-snipe support, and an announcement post. 3 days from contract addresses to live.", ["https://arctools.fun/trade2"], ["launchpad", "integration"], (255, 122, 60)),
 "usdc-checkout":    ("web", 150, 3, "USDC checkout for your shop or service (pay links + webhook)", "Accept USDC on Arc on your site: pay links or a checkout button, a webhook when the payment lands (we see it in 1–2 s), a dashboard of incoming payments, refunds. Built on ArcClaim / Pay links. 3 days.", ["https://arctools.fun/pay"], ["payments", "checkout"], (34, 197, 128)),
}

def cover(title: str, accent, tag: str) -> str:
    im = Image.new("RGBA", (800, 450), (10, 12, 16, 255)); g = Image.new("RGBA", (800, 450), (0, 0, 0, 0)); gd = ImageDraw.Draw(g)
    gd.ellipse((-200, 150, 400, 750), fill=accent + (90,)); gd.ellipse((550, -200, 1000, 250), fill=(46, 124, 255, 50))
    im = Image.alpha_composite(im, g.filter(ImageFilter.GaussianBlur(90))); d = ImageDraw.Draw(im)
    d.text((40, 36), "ArcTools", font=ImageFont.truetype(F, 26), fill=(240, 244, 250)); d.rounded_rectangle((162, 40, 162 + 18 + 9 * len(tag), 66), radius=6, fill=accent); d.text((171, 43), tag.upper(), font=ImageFont.truetype(F, 15), fill=(10, 12, 16))
    words = title.split(); lines = []; line = ""
    for w_ in words:
        if len(line) + len(w_) > 26: lines.append(line); line = w_
        else: line = (line + " " + w_).strip()
    lines.append(line)
    for i, ln in enumerate(lines[:4]): d.text((40, 150 + i * 54), ln, font=ImageFont.truetype(F, 44), fill=(240, 244, 250))
    d.text((40, 400), "arctools.fun/market · USDC escrow", font=ImageFont.truetype(R, 16), fill=(160, 170, 190))
    out = io.BytesIO(); im.convert("RGB").save(out, "WEBP", quality=82); return "data:image/webp;base64," + base64.b64encode(out.getvalue()).decode()

def send(fn):
    tx = fn.build_transaction({"from": A.address}); [tx.pop(k, None) for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type")]
    tx.update({"nonce": w3.eth.get_transaction_count(A.address), "gasPrice": w3.eth.gas_price, "chainId": 5042, "gas": int(tx["gas"] * 1.5) + 50_000})
    rc = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(A.sign_transaction(tx).raw_transaction), timeout=120); assert rc.status == 1; return rc

def post_meta(gid, body):
    payload = json.dumps(body, separators=(",", ":"), sort_keys=True); msg = f"arcwork-meta:{gid}:{Web3.keccak(text=payload).hex()}"
    body = {**body, "sig": "0x" + A.sign_message(encode_defunct(text=msg)).signature.hex().removeprefix("0x")}
    req = urllib.request.Request(BOT + "/api/work/meta", data=json.dumps(body).encode(), headers={"content-type": "application/json", "User-Agent": "arctools"})
    return json.loads(urllib.request.urlopen(req, timeout=90).read())

# existing gigs by uri
n = W.functions.gigsCount().call(); existing = {}
for i in range(n):
    g = W.functions.gigs(i).call(); existing[g[5]] = i
for slug, (cat, price, days, title, desc, samples, tags, accent) in GIGS.items():
    uri = f"arctools://gig/{slug}"
    if uri in existing: gid = existing[uri]
    else:
        send(W.functions.createGig(CAT[cat], price * U, days, uri)); gid = W.functions.gigsCount().call() - 1; print("created", gid, slug)
    r = post_meta(gid, {"gigId": gid, "title": title, "description": desc, "samples": samples, "contact": CONTACT, "tags": tags, "tg": TG, "image": cover(title, accent, tags[0])})
    print(f"  {gid:2} {slug:22} {price:4} USDC {days} d meta:{r.get('ok')} {r.get('reason','')}")
# pause the 1 USDC test gig if present
if "arctools://gig/test-1usdc" in existing:
    gid = existing["arctools://gig/test-1usdc"]; g = W.functions.gigs(gid).call()
    if g[4]: send(W.functions.updateGig(gid, False, g[2], g[3], g[5])); print("paused test gig", gid)
print("done; gigs:", W.functions.gigsCount().call())
