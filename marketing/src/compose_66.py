"""66 — ArcOne launch: three REAL app screens in phone frames (Trending · Token · More)."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-200, 200, 700, 1100), fill=GRN + (40,)); gd.ellipse((900, -200, 1800, 600), fill=COB + (46,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(170)))
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcOne', font=f(34), fill=INK)
d.text((190, 54), 'powered by ArcTools', font=f(16, R), fill=MUTED)
d.rounded_rectangle((56, 96, 232, 128), radius=8, fill=GRN)
d.text((70, 101), 'ANDROID · LIVE', font=f(19), fill=(4, 20, 10))
d.text((56, 148), 'The terminal and the wallet,', font=f(50), fill=INK)
d.text((56, 206), 'in your pocket.', font=f(50), fill=GRN)
lines = ['Every Arc launchpad in one list. One-tap buys. Live candles.',
         'Sell simulation before you buy. A key that never leaves your phone.',
         'Launch, pay links, referrals, staking, Archy — all inside the app.']
yy = 282
for t in lines:
    d.ellipse((58, yy + 9, 66, yy + 17), fill=GRN); d.text((80, yy), t, font=f(18, R), fill=(226, 233, 245)); yy += 30

# three phones
def phone(shot_path, x, y, h):
    shot = Image.open(shot_path).convert('RGB'); w = int(shot.width * h / shot.height); shot = shot.resize((w, h), Image.LANCZOS)
    pad = 10; r = 34
    frame = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0)); fd = ImageDraw.Draw(frame)
    fd.rounded_rectangle((0, 0, w + 2 * pad - 1, h + 2 * pad - 1), radius=r, fill=(22, 26, 34, 255), outline=(255, 255, 255, 40), width=2)
    mask = Image.new('L', (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=r - 8, fill=255)
    frame.paste(shot, (pad, pad), mask)
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((x - 8, y + 10, x + frame.width + 8, y + frame.height + 24), radius=r, fill=(0, 0, 0, 150))
    return frame, sh, (x, y)

ph = 520
shots = ['assets/66-app-trending.png', 'assets/66-app-token.png', 'assets/66-app-more.png']
pw = int(360 * ph / 800) + 20
gap = 26; total = 3 * pw + 2 * gap; x0 = W - 56 - total
for i, sp in enumerate(shots):
    fr, sh, (x, y) = phone(sp, x0 + i * (pw + gap), 380 - (24 if i == 1 else 0), ph)
    bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(18)))
    bg.alpha_composite(fr, (x, y))
d = ImageDraw.Draw(bg)
for i, lab in enumerate(['Trending', 'Token page', 'Everything else']):
    d.text((x0 + i * (pw + gap) + pw // 2, 380 - (24 if i == 1 else 0) + ph + 34), lab, font=f(14, R), fill=MUTED, anchor='ma')

d.rounded_rectangle((56, H - 66, 340, H - 16), radius=10, fill=GRN)
d.text((78, H - 54), 'arctools.fun/app', font=f(26), fill=(4, 20, 10))
d.text((360, H - 50), 'real app screens · signed APK, direct download · Android 7+', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('66-arcone-launch.png', quality=95)
print('66-arcone-launch.png; phones from x', x0, 'width', pw, 'total', total)
