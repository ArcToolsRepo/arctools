"""39 — Terminal feature sheet: robot (pointing, holo tablet) + feature list + two real Terminal screenshots."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (236, 240, 247); MUTED = (176, 186, 204); CARD = (20, 26, 38)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
art = Image.open('bg_arc.png').convert('RGB')
sc = max(W / art.width, H / art.height); art = art.resize((int(art.width * sc) + 1, int(art.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H))
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.7).convert('RGBA')
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim)
sd.rectangle((0, 0, 700, H), fill=(8, 10, 16, 120)); sd.rectangle((0, 0, W, 230), fill=(8, 10, 16, 80))
bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(40))); d = ImageDraw.Draw(bg)
# header
d.text((56, 44), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=INK)
d.text((56, 108), 'ONE SCREEN FOR THE WHOLE ARC CHAIN', font=f(22), fill=GRN)
d.text((56, 138), 'The Terminal', font=f(72), fill=INK)
d.text((56, 228), 'every launchpad, every pool, one-click buys at the best price', font=f(24), fill=INK)
# feature list (left column)
feats = [
    ('18 sources, one list', 'RadarDex, ArcPad, Warp, Arguspad, Uniswap V3/V4, eve.fun, Lift, Ellipse, Sashimi, UBI.fun, stock pairs...'),
    ('Quick Buy 1 / 5 / 20 / 100 USDC', 'ArcAggregator routes across venues for the best fill, slippage presets 1-30%'),
    ('Market, Limit, Take profit, Stop loss', 'non-custodial orders, keeper fills on-chain, lines drawn on the chart'),
    ('Score, Dev %, bundle %, Smart money', 'risk grade A-F, deployer holdings and sells, bundled buys, insider clusters'),
    ('Alpha tab', 'Fresh / Accumulation / Revival picks with a public first-call record'),
    ('Filters that matter', 'min/max MC, min volume, age, sort by vol / MC / trades / % / smart money, 1m-All windows'),
    ('Insider picks, Watchlist, Holdings', 'live toasts on new pairs and big buys, chain-wide search by name, symbol or CA'),
    ('Pro chart + Bubble map', 'TradingView-grade candles, KOL mentions, holder clusters on every token page'),
]
y = 282
for title, sub in feats:
    d.rounded_rectangle((56, y + 6, 66, y + 16), radius=3, fill=GRN)
    d.text((80, y - 4), title, font=f(21), fill=INK)
    d.text((80, y + 24), sub, font=f(14, R), fill=MUTED)
    y += 64
# robot bottom-left, pointing right towards the screenshots
robot = Image.open('robot_point.png').convert('RGBA').transpose(Image.FLIP_LEFT_RIGHT)   # points LEFT, at the title
rb = robot.resize((int(robot.width * 225 / robot.height), 225), Image.LANCZOS)
bg.alpha_composite(rb, (W - 56 - rb.width - 20, 22)); d = ImageDraw.Draw(bg)
# screenshot cards (right column)
cx0 = 740; cw = W - 56 - cx0
shot = Image.open('crop_terminal.png').convert('RGBA'); sw = cw - 16
shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS); sy = 262
maxh = 470
if shot.height > maxh:
    shot = shot.crop((0, 0, shot.width, maxh))
d.rounded_rectangle((cx0, sy, cx0 + cw, sy + shot.height + 16), radius=16, fill=CARD + (255,), outline=COB + (210,), width=2)
bg.alpha_composite(shot, (cx0 + 8, sy + 8)); d = ImageDraw.Draw(bg)
d.text((cx0, sy - 24), 'live screenshot  -  arctools.fun/trade  >  Trending, all-time window', font=f(15, R), fill=MUTED)
al = Image.open('crop_alpha.png').convert('RGBA'); al = al.resize((sw, int(al.height * sw / al.width)), Image.LANCZOS)
ay = sy + shot.height + 16 + 44
maxh2 = H - 70 - ay - 16
if al.height > maxh2:
    al = al.crop((0, 0, al.width, maxh2))
d.rounded_rectangle((cx0, ay, cx0 + cw, ay + al.height + 16), radius=16, fill=CARD + (255,), outline=GRN + (200,), width=2)
bg.alpha_composite(al, (cx0 + 8, ay + 8)); d = ImageDraw.Draw(bg)
d.text((cx0, ay - 24), 'live screenshot  -  Alpha tab  >  Fresh alpha / Accumulation / Revival', font=f(15, R), fill=MUTED)
print('alpha card bottom', ay + al.height + 16, 'footer', H - 46)
d.text((56, H - 44), 'fees: 1.5% per Terminal swap, 1% on order fill  ·  non-custodial, your keys stay in the browser  ·  16.09.2026', font=f(15, M), fill=MUTED)
tw_ = d.textlength('arctools.fun/trade', font=f(22)); d.text((W - 56 - tw_, H - 48), 'arctools.fun/trade', font=f(22), fill=COB)
bg.convert('RGB').save('../39-terminal.png', quality=95); print('saved')
