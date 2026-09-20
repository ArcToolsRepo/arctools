"""64 — what the Terminal does, and what it sees: real numbers from the index (20 Sep 2026)."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
AMBER = (255, 183, 74)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

# measured 20 Sep 2026, /api/db-maint?action=wallets and /api/trending 24h — not estimates
STATS = [
    ('704,877', 'swaps indexed in 24 h'),
    ('33,470', 'wallets traded in 24 h'),
    ('181,568', 'wallets seen this week'),
    ('$51.4M', 'volume in 24 h'),
    ('6,186', 'tokens traded in 24 h'),
    ('24', 'launchpads in one table'),
]
FEATURES = [
    ('Every launchpad, one table', 'ArcPad, Uniswap V3/V4, Arguspad, Tolly, peach.ag, hopium.gg and 18 more. Price, cap, liquidity, 5M/1H/6H/24H.'),
    ('One-click buys', 'A wallet that never leaves your browser. Pick an amount, hit buy. The aggregator finds the venue.'),
    ('Dev and bundle risk', 'Net dev activity, launch-block wallets, top-10 share, a sell simulation before you buy.'),
    ('Index on the chain head', 'A swap lands in the table as its block closes. Live feed, no polling.'),
    ('Insiders, not influencers', 'The wallets that were early last time, ranked by what they actually made.'),
    ('Spam filtered', 'Clone farms minting one name eighty times are hidden from the default view.'),
]

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-200, -100, 800, 700), fill=COB + (46,))
gd.ellipse((900, 400, 1800, 1200), fill=GRN + (30,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(170)))
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 396, 78), radius=8, fill=COB)
d.text((222, 50), 'TERMINAL · 24H', font=f(20), fill=INK)
d.text((56, 104), 'What the Terminal sees', font=f(54), fill=INK)
d.text((56, 166), 'in one day on Arc.', font=f(54), fill=GRN)

# stat tiles: 3 x 2
tx, ty, tw, th, gap = 56, 250, 470, 118, 14
for i, (big, lab) in enumerate(STATS):
    x = tx + (i % 3) * (tw + gap); y = ty + (i // 3) * (th + gap)
    d.rounded_rectangle((x, y, x + tw, y + th), radius=14, fill=(18, 24, 36, 235), outline=(255, 255, 255, 40))
    d.text((x + 22, y + 18), big, font=f(44), fill=GRN if i in (0, 3) else INK)
    d.text((x + 22, y + 78), lab, font=f(16, R), fill=MUTED)

# feature list: 2 x 3
fx, fy = 56, 540
colw = 726
for i, (title, body) in enumerate(FEATURES):
    x = fx + (i % 2) * (colw + 36); y = fy + (i // 2) * 118
    d.ellipse((x, y + 10, x + 10, y + 20), fill=GRN)
    d.text((x + 22, y), title, font=f(22), fill=INK)
    # wrap body to the column
    words = body.split(); line = ''; yy = y + 34
    for w_ in words:
        t = (line + ' ' + w_).strip()
        if d.textlength(t, font=f(15, R)) > colw - 22:
            d.text((x + 22, yy), line, font=f(15, R), fill=MUTED); yy += 22; line = w_
        else:
            line = t
    if line: d.text((x + 22, yy), line, font=f(15, R), fill=MUTED)

d.rounded_rectangle((56, H - 66, 300, H - 16), radius=10, fill=GRN)
d.text((78, H - 54), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((330, H - 50), 'numbers from our own index · 20 Sep 2026 · mobile app next week', font=f(15, R), fill=MUTED)
bg.convert('RGB').save('64-terminal-stats.png', quality=95)
print('64-terminal-stats.png')
