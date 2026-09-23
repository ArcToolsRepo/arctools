"""78 — ArcTools Market: USDC escrow for token-team services. Real /market screenshot + the escrow rules + house gig prices."""
import json, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (140, 150, 170); AMB = (255, 176, 32)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'; R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
try:
    st = json.loads(urllib.request.urlopen(urllib.request.Request('https://bot-production-4200.up.railway.app/api/work/stats', headers={'User-Agent': 'arctools'}), timeout=30).read()); n_gigs, n_sellers = st['active_gigs'], st['sellers']
except Exception: n_gigs, n_sellers = 15, 2
bg = Image.new('RGBA', (W, H), NAVY + (255,)); glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-300, 200, 600, 1100), fill=GRN + (56,)); gd.ellipse((1100, -300, 1900, 500), fill=COB + (46,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180))); d = ImageDraw.Draw(bg)
d.text((70, 56), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 58, 400, 90), radius=8, fill=GRN); d.text((222, 63), 'NEW · MARKET', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'Hire for your token. Pay when it is delivered.', font=f(50), fill=INK)
d.text((70, 168), f'Logos, sites, Telegram setups, KOL posts, audits — USDC held in a contract until you accept. {n_gigs} gigs live, on the site and in ArcOne.', font=f(20, R), fill=MUTED)
shot = Image.open('assets/78-market.png').convert('RGB').crop((250, 550, 1300, 1370)); sw = 700; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
frame = Image.new('RGBA', (sw + 2, shot.height + 2), (255, 255, 255, 40)); frame.paste(shot, (1, 1)); mask = Image.new('L', frame.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw + 1, shot.height + 1), radius=12, fill=255)
sy = 226; bg.paste(frame, (70, sy), mask); d = ImageDraw.Draw(bg); d.text((70, sy + shot.height + 8), 'arctools.fun/market — real screen', font=f(12, R), fill=DIM)
X = 800; y = sy
d.text((X, y), 'HOW THE ESCROW WORKS', font=f(13), fill=GRN); y += 28
steps = [('1  Hire', 'You pay the listed price into the ArcWork contract. Not to the seller, not to us.'),
         ('2  Deliver', 'The seller posts the delivery. You have 72 h to look at it.'),
         ('3  Accept', 'One tap: the seller is paid, 2 % goes to the ARCT buyback. Refunds carry no fee.'),
         ('4  Or dispute', 'Either side can. ArcTools splits the money with a public note — that is the only power ArcTools has over it.'),
         ('5  Not delivered?', 'Deadline + 3 days and nothing came: take 100 % back yourself.'),
         ('6  Review', '1–5 stars, on-chain, forever. The next buyer sees it.')]
for t, s in steps:
    d.text((X, y), t, font=f(17), fill=INK); words = s.split(); line = ''; lines = []
    for w_ in words:
        if len(line) + len(w_) > 68: lines.append(line); line = w_
        else: line = (line + ' ' + w_).strip()
    lines.append(line)
    for i, ln in enumerate(lines): d.text((X, y + 24 + i * 19), ln, font=f(14, R), fill=MUTED)
    y += 24 + len(lines) * 19 + 12
y = 790
d.text((70, y), 'ARCTOOLS HOUSE GIGS (a few)', font=f(13), fill=GRN); y += 26
prices = [('Dev-audit report', '40'), ('Logo + banner pack', '40'), ('Token profile everywhere', '15'), ('Buy bot + trending setup', '30'), ('ArcLocker setup', '60'), ('Landing page', '200'), ('X + @ARCTrends announcement', '150'), ('Launchpad integration', '300')]
cw = (W - 140 - 3 * 12) // 4
for i, (n, p) in enumerate(prices):
    x = 70 + (i % 4) * (cw + 12); yy = y + (i // 4) * 62
    d.rounded_rectangle((x, yy, x + cw, yy + 52), radius=10, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.text((x + 12, yy + 8), n, font=f(14), fill=INK); d.text((x + 12, yy + 29), f'{p} USDC', font=f(13), fill=GRN)
d.rounded_rectangle((70, H - 84, 380, H - 34), radius=10, fill=GRN); d.text((92, H - 72), 'arctools.fun/market', font=f(24), fill=(4, 20, 10))
d.text((402, H - 68), 'Also in ArcOne 2.9 (More: Market, Predict) · contract 0x74Df…5706 · sellers welcome: listing is free', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('78-market.png', quality=95); print('78 ok', n_gigs, n_sellers, 'steps end', y)
