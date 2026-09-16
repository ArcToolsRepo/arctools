"""41 — New launchpads on the Terminal: robot (pointing) + pad list + Minara / Klik filtered screenshots."""
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
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim); sd.rectangle((0, 0, 620, H), fill=(8, 10, 16, 120)); sd.rectangle((0, 0, W, 230), fill=(8, 10, 16, 80))
bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(40))); d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=INK)
d.text((56, 108), 'FOUND ON-CHAIN, NOW LABELLED', font=f(22), fill=GRN)
d.text((56, 138), 'More launchpads', font=f(72), fill=INK)
d.text((56, 224), 'every Arc token is tracked; today six more pads get their name', font=f(22), fill=INK)
d.text((56, 252), 'and their own filter chip in the Terminal', font=f(22), fill=INK)
pads = [('Klik', 'klik.finance', 'instant V4 pool, factory 0x7e5a…217c'),
        ('Minara', 'minara.fun', 'live on mainnet since today, 100+ launches'),
        ('pools.trade', 'pools.trade', 'Uniswap liquidity launcher, V4 pools'),
        ('Tolly factory', 'tolly.fun', '32 tokens that hid under "Uniswap V3"'),
        ('Arguspad factory', 'arguspad.io', '34 tokens that hid under "Uniswap V4"'),
        ('Lift / Sashimi / Archemist on V4', 'new hooks', 'graduations recognised, 300+ pools')]
y = 300
for name, site, sub in pads:
    d.rounded_rectangle((56, y + 8, 66, y + 18), radius=3, fill=GRN)
    d.text((80, y - 2), name, font=f(22), fill=INK); tw = d.textlength(name, font=f(22)); d.text((80 + tw + 12, y + 3), site, font=f(15, M), fill=COB)
    d.text((80, y + 27), sub, font=f(14, R), fill=MUTED)
    y += 62
d.text((56, y + 14), '26 launchpads recognised. Not every token is classified yet: there are', font=f(15, R), fill=MUTED)
d.text((56, y + 36), 'hundreds of factories on Arc; we add them one by one, every week.', font=f(15, R), fill=MUTED)
robot = Image.open('robot_point.png').convert('RGBA').transpose(Image.FLIP_LEFT_RIGHT)
rb = robot.resize((int(robot.width * 225 / robot.height), 225), Image.LANCZOS)
bg.alpha_composite(rb, (W - 56 - rb.width - 40, 20)); d = ImageDraw.Draw(bg)
cx0 = 640; cw = W - 56 - cx0; sw = cw - 16
chips = Image.open('crop_chips.png').convert('RGBA'); chips = chips.resize((sw, int(chips.height * sw / chips.width)), Image.LANCZOS); sy = 262
d.rounded_rectangle((cx0, sy, cx0 + cw, sy + chips.height + 16), radius=12, fill=CARD + (255,), outline=(255, 255, 255, 40))
bg.alpha_composite(chips, (cx0 + 8, sy + 8)); d = ImageDraw.Draw(bg)
d.text((cx0, sy - 24), 'source chips  -  Klik, Minara, pools.trade join 20 others', font=f(15, R), fill=MUTED)
y0 = sy + chips.height + 16 + 40
avail = H - 70 - y0 - 40 - 16 * 2
for i, (n, lab) in enumerate((('crop_pad_minara.png', 'filter: Minara  -  every row labelled Minara, live MC and volume'), ('crop_pad_klik.png', 'filter: Klik  -  fresh Klik launches, seconds after the factory call'))):
    im = Image.open(n).convert('RGBA'); im = im.resize((sw, int(im.height * sw / im.width)), Image.LANCZOS)
    mh = avail // 2
    if im.height > mh: im = im.crop((0, 0, im.width, mh))
    d.rounded_rectangle((cx0, y0, cx0 + cw, y0 + im.height + 16), radius=16, fill=CARD + (255,), outline=(GRN if i == 0 else COB) + (210,), width=2)
    bg.alpha_composite(im, (cx0 + 8, y0 + 8)); d = ImageDraw.Draw(bg)
    d.text((cx0, y0 - 24), 'live screenshot  -  ' + lab, font=f(15, R), fill=MUTED)
    y0 += im.height + 16 + 40
print('cards bottom', y0 - 40, 'footer', H - 46)
d.text((56, H - 44), 'factories found by walking token-creation transactions on our own Arc node  ·  registry in the open: /bot/api/pad-tokens  ·  16.09.2026', font=f(15, M), fill=MUTED)
tw_ = d.textlength('arctools.fun/trade', font=f(22)); d.text((W - 56 - tw_, H - 48), 'arctools.fun/trade', font=f(22), fill=COB)
bg.convert('RGB').save('../41-launchpads.png', quality=95); print('saved')
