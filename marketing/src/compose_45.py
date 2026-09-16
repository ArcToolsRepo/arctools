"""45 — real product shot: live Terminal screenshot + the three launchpads added today (faze, sharc, creo)."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); CARD = (18, 24, 36); FIRE = (255, 146, 43)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGB', (W, H), NAVY).convert('RGBA')
d = ImageDraw.Draw(bg)
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((-200, 380, 1100, 1250), fill=COB + (42,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(160)))
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))
d.text((56, 110), 'THREE MORE LAUNCHPADS, ONE SCREEN', font=f(21), fill=GRN)
d.text((56, 142), 'faze · sharc · creo', font=f(56), fill=INK)
d.text((56, 212), 'now indexed, with their own artwork and curve progress', font=f(21, R), fill=MUTED)

# --- real product screenshot, cropped to the token table and framed
shot = Image.open('shot_terminal.png').convert('RGB')
crop = shot.crop((int(shot.width * 0.06), int(shot.height * 0.30), int(shot.width * 0.995), int(shot.height * 0.995)))
sw = 980
crop = crop.resize((sw, int(crop.height * sw / crop.width)), Image.LANCZOS)
sx, sy = 56, 276
d.rounded_rectangle((sx - 10, sy - 10, sx + sw + 10, sy + crop.height + 10), radius=14, fill=CARD + (255,), outline=(255, 255, 255, 46))
bg.paste(crop, (sx, sy))
d = ImageDraw.Draw(bg)
d.text((sx, sy - 30), 'live on arctools.fun — ranked top 10, curve progress, one-tap buy', font=f(15, R), fill=MUTED)

# --- launchpad cards on the right
px, py = 1100, 276
cards = [('pad_faze.png', 'faze.fun', 'own bonding curve, decoded on-chain', '362 coins'),
         ('pad_sharc.png', 'sharc.fun', 'multichain curve, LP burned at graduation', '303 coins'),
         ('pad_creo.png', 'creo.family', 'AI launchpad running on o1 infrastructure', '48 coins')]
for i, (icon, name, sub, n) in enumerate(cards):
    cy = py + i * 128
    d.rounded_rectangle((px, cy, W - 56, cy + 110), radius=14, fill=CARD + (245,), outline=(255, 255, 255, 40))
    ic = Image.open(icon).convert('RGBA')
    side = 64
    ic = ic.resize((side, int(ic.height * side / ic.width)), Image.LANCZOS) if ic.width >= ic.height else ic.resize((int(ic.width * side / ic.height), side), Image.LANCZOS)
    mask = Image.new('L', ic.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, ic.size[0] - 1, ic.size[1] - 1), radius=16, fill=255)
    bg.paste(ic, (px + 18, cy + 23 + (64 - ic.size[1]) // 2), mask)
    d = ImageDraw.Draw(bg)
    d.text((px + 98, cy + 24), name, font=f(24), fill=INK)
    d.text((px + 98, cy + 56), sub, font=f(14, R), fill=MUTED)
    d.text((px + 98, cy + 78), n, font=f(15, M), fill=GRN)

# --- what shipped with them
d.text((1100, 668), 'SAME PASS', font=f(17), fill=GRN)
for i, line in enumerate([
    'curve fill bar on every row',
    'top-10 ranked and tinted',
    'live ARCT burn counter',
    'logos read from contracts',
    'Alpha scoring every play',
]):
    d.rounded_rectangle((1102, 702 + i * 30, 1110, 710 + i * 30), radius=3, fill=COB)
    d.text((1124, 696 + i * 30), line, font=f(16, R), fill=MUTED)

d.text((56, H - 64), 'arctools.fun', font=f(28), fill=INK)
lbl = '29 launchpads labelled'
d.text((W - 56 - d.textlength(lbl, font=f(16)), H - 56), lbl, font=f(16), fill=(226, 232, 244))
d.rounded_rectangle((56 + 200, H - 62, 56 + 392, H - 28), radius=8, fill=(255, 146, 43, 40), outline=FIRE + (200,))
d.text((56 + 214, H - 56), '50.6M ARCT burned', font=f(16), fill=FIRE)

bg.convert('RGB').save('../45-launchpads-live.png', quality=95)
print('saved ../45-launchpads-live.png')
