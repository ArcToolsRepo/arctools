"""44 — faze.fun added to the Terminal: robot (welcoming) + faze logo tile + what we index for it."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); CARD = (18, 24, 36); FAZE = (0, 102, 255)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

PANEL = 880

robot = Image.open('robot_welcome.png').convert('RGBA')
sc = max(W / robot.width, H / robot.height)
art = robot.resize((int(robot.width * sc) + 1, int(robot.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H)).convert('RGB')
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.95).convert('RGBA')

panel = Image.new('RGBA', (W, H), (0, 0, 0, 0)); pd = ImageDraw.Draw(panel)
pd.rectangle((0, 0, PANEL, H), fill=(8, 10, 16, 242))
for i in range(110):
    pd.line((PANEL + i, 0, PANEL + i, H), fill=(8, 10, 16, int(242 * (1 - i / 110))))
bg = Image.alpha_composite(bg, panel)
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))

# faze logo tile + name lockup
logo = Image.open('faze_logo.png').convert('RGBA').resize((104, 104), Image.LANCZOS)
mask = Image.new('L', (104, 104), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, 103, 103), radius=26, fill=255)
bg.paste(logo, (56, 122), mask); d = ImageDraw.Draw(bg)
d.text((182, 130), 'faze.fun', font=f(60), fill=INK)
d.text((186, 200), 'now live in the Terminal', font=f(24), fill=GRN)

d.text((56, 268), 'Its own bonding curve, indexed natively - not scraped.', font=f(21, R), fill=MUTED)

cards = [('350', 'coins indexed', COB), ('100%', 'with artwork', GRN), ('curve', 'trades decoded', INK)]
cw, ch, gap = 250, 112, 18
for i, (big, lab, col) in enumerate(cards):
    cx = 56 + i * (cw + gap)
    d.rounded_rectangle((cx, 320, cx + cw, 320 + ch), radius=14, fill=CARD + (245,), outline=(255, 255, 255, 42))
    d.text((cx + 18, 340), big, font=f(40), fill=col)
    d.text((cx + 18, 388), lab, font=f(16, R), fill=MUTED)

rows = [('Curve trades', 'buys and sells decoded straight from the chain'),
        ('Price and FDV', 'read off the curve, live while it fills'),
        ('Artwork and socials', 'pulled from every coin\'s metadata'),
        ('After graduation', 'the locked V4 pool keeps the faze label'),
        ('One-tap buy', 'the aggregator routes curve and pool alike')]
ry = 470
for big, lab in rows:
    d.rounded_rectangle((58, ry + 12, 68, ry + 22), radius=3, fill=FAZE)
    d.text((86, ry), big, font=f(22), fill=INK)
    tw = d.textlength(big, font=f(22))
    d.text((86 + tw + 16, ry + 5), lab, font=f(17, R), fill=MUTED)
    ry += 50

d.text((56, 748), 'WHY IT MATTERS', font=f(18), fill=GRN)
d.text((56, 776), 'A coin on a bonding curve has no Uniswap pool, so most screeners show it as a', font=f(18, R), fill=INK)
d.text((56, 802), 'blank row. We decode the curve itself - the chart is there from the first buy.', font=f(18, R), fill=INK)

px = 56
for name, active in (('faze.fun', True), ('Klik', False), ('Minara', False), ('Tolly', False), ('Arguspad', False), ('+22 more', False)):
    tw = d.textlength(name, font=f(17)) + 30
    d.rounded_rectangle((px, 846, px + tw, 884), radius=19, fill=(FAZE + (110,)) if active else (26, 33, 48, 235),
                        outline=(FAZE + (230,)) if active else (255, 255, 255, 55))
    d.text((px + 15, 856), name, font=f(17), fill=INK); px += tw + 12

d.text((56, H - 62), 'arctools.fun', font=f(28), fill=INK)
lbl = '27 launchpads labelled'
d.text((PANEL - 40 - d.textlength(lbl, font=f(16)), H - 54), lbl, font=f(16), fill=(226, 232, 244))

bg.convert('RGB').save('../44-faze.png', quality=95)
print('saved ../44-faze.png')
