"""40 — Live token page: running robot + chart crop (● LIVE) + live trades table + 4 speed facts."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (236, 240, 247); MUTED = (176, 186, 204); CARD = (20, 26, 38)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
art = Image.open('bg_arc.png').convert('RGB').transpose(Image.FLIP_LEFT_RIGHT)
sc = max(W / art.width, H / art.height); art = art.resize((int(art.width * sc) + 1, int(art.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H))
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.7).convert('RGBA')
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim); sd.rectangle((0, 0, 560, H), fill=(8, 10, 16, 120)); sd.rectangle((0, 0, W, 230), fill=(8, 10, 16, 80))
bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(40))); d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=INK)
d.text((56, 108), 'TOKEN PAGE, NOW STREAMING', font=f(22), fill=GRN)
d.text((56, 138), 'Live. Not polled.', font=f(72), fill=INK)
d.text((56, 224), 'every swap on Arc lands on the chart', font=f(22), fill=INK); d.text((56, 252), 'within a second of the block', font=f(22), fill=INK)
facts = [('~1 s', 'from block to your screen', 'server-sent stream from our own Arc node, no refresh'),
         ('0.3 s', 'chart + trades load', 'own reth node, indexed OHLC for 1m to 1d'),
         ('26', 'launchpads recognised', 'Klik, Minara, pools.trade, Tolly, Lift, Arguspad... found on-chain'),
         ('100%', 'symbols on new launches', 'name, logo, socials pulled the moment the token is created')]
y = 300
for big, lab, sub in facts:
    d.rounded_rectangle((56, y, 500, y + 128), radius=14, fill=CARD + (235,), outline=(255, 255, 255, 30))
    d.text((76, y + 14), big, font=f(52), fill=GRN); d.text((76, y + 74), lab, font=f(20), fill=INK); d.text((76, y + 100), sub, font=f(14, R), fill=MUTED)
    y += 140
robot = Image.open('robot_run.png').convert('RGBA')
rb = robot.resize((int(robot.width * 230 / robot.height), 230), Image.LANCZOS)
bg.alpha_composite(rb, (W - 56 - rb.width - 60, 14)); d = ImageDraw.Draw(bg)
cx0 = 560; cw = W - 56 - cx0
shot = Image.open('crop_token_chart.png').convert('RGBA'); sw = cw - 16; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS); sy = 262
d.rounded_rectangle((cx0, sy, cx0 + cw, sy + shot.height + 16), radius=16, fill=CARD + (255,), outline=COB + (210,), width=2)
bg.alpha_composite(shot, (cx0 + 8, sy + 8)); d = ImageDraw.Draw(bg)
d.text((cx0, sy - 24), 'live screenshot  -  arctools.fun/token/ARGUS  >  chart, LIVE badge, swap panel', font=f(15, R), fill=MUTED)
tr = Image.open('crop_trades.png').convert('RGBA'); tr = tr.resize((sw, int(tr.height * sw / tr.width)), Image.LANCZOS)
ty = sy + shot.height + 16 + 40; maxh = H - 70 - ty - 16
if tr.height > maxh: tr = tr.crop((0, 0, tr.width, maxh))
d.rounded_rectangle((cx0, ty, cx0 + cw, ty + tr.height + 16), radius=16, fill=CARD + (255,), outline=GRN + (200,), width=2)
bg.alpha_composite(tr, (cx0 + 8, ty + 8)); d = ImageDraw.Draw(bg)
d.text((cx0, ty - 24), 'live screenshot  -  trades tab: 12 s, 15 s, 16 s old, fresh wallet / whale tags', font=f(15, R), fill=MUTED)
print('trades bottom', ty + tr.height + 16, 'footer', H - 46)
d.text((56, H - 44), 'stream: GET /api/stream?token=<ca>  ·  fallback polling 5 s  ·  own Arc node primary, public RPCs backup  ·  16.09.2026', font=f(15, M), fill=MUTED)
tw_ = d.textlength('arctools.fun', font=f(22)); d.text((W - 56 - tw_, H - 48), 'arctools.fun', font=f(22), fill=COB)
bg.convert('RGB').save('../40-live.png', quality=95); print('saved')
