"""70 — ArcOne 2.2 update: robot + real Settings screen in a phone frame + change list."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-250, 250, 650, 1150), fill=GRN + (44,)); gd.ellipse((950, -250, 1850, 550), fill=COB + (48,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(170)))

robot = Image.open(sys.argv[1]).convert('RGBA'); rh = 760; rw = int(robot.width * rh / robot.height)
robot = robot.resize((rw, rh), Image.LANCZOS).crop((0, 0, int(rw * 0.46), rh))
fade = np.full((rh, robot.width), 255, dtype=np.float32); fade[:, -90:] *= np.linspace(1, 0, 90)[None, :]; fade[-60:, :] *= np.linspace(1, 0, 60)[:, None]
robot.putalpha(Image.fromarray(np.minimum(np.array(robot.split()[3], dtype=np.float32), fade).astype('uint8')))
bg.alpha_composite(robot, (0, H - rh - 10))
d = ImageDraw.Draw(bg)

X = 640
d.text((X, 56), 'ArcOne', font=f(30), fill=INK); d.text((X + 130, 66), 'powered by ArcTools', font=f(16, R), fill=MUTED)
d.rounded_rectangle((X, 100, X + 210, 132), radius=8, fill=GRN); d.text((X + 12, 105), 'UPDATE  ·  v2.2', font=f(19), fill=(4, 20, 10))
d.text((X, 150), 'Update from inside the app.', font=f(48), fill=INK)
# Roboto has no arrow glyphs: draw them
def arrow(x, y):
    d.line((x, y, x + 14, y), fill=MUTED, width=2); d.polygon([(x + 14, y - 5), (x + 20, y), (x + 14, y + 5)], fill=MUTED); return x + 28
cx = X
for i, part in enumerate(['Settings', 'App updates', 'Update.  No browser, no re-download from the site.']):
    if i: cx = arrow(cx + 8, 224)
    d.text((cx, 212), part, font=f(20, R), fill=MUTED); cx += int(d.textlength(part, font=f(20, R)))

items = [('One-tap updates', 'The app downloads the signed build, verifies it, opens the installer.'),
         ('Launchpad chips', 'Tap a launchpad to see every token from it — newest first.'),
         ('Real token age', 'Mint time from the explorer, never younger than the first trade.'),
         ('Correct market caps', 'Burned supply excluded — no more $1.5M caps on $50K tokens.'),
         ('Logos everywhere', 'ArcToolsPad and site-hosted logos now show in the app.'),
         ('Honest screens', 'No endless loading — clear messages, and a screen that breaks says why.')]
y = 268
for t, sub in items:
    d.ellipse((X + 2, y + 8, X + 14, y + 20), fill=GRN)
    d.text((X + 26, y), t, font=f(19), fill=INK); d.text((X + 26, y + 24), sub, font=f(15, R), fill=MUTED); y += 58

# real settings screenshot in a phone frame, right side
shot = Image.open('assets/70-app-settings.png').convert('RGB'); ph = 560; pw = int(shot.width * ph / shot.height); shot = shot.resize((pw, ph), Image.LANCZOS)
pad, r = 10, 34; fx, fy = W - 56 - pw - 2 * pad, 300
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((fx - 8, fy + 12, fx + pw + 2 * pad + 8, fy + ph + 2 * pad + 26), radius=r, fill=(0, 0, 0, 150))
bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(18)))
frame = Image.new('RGBA', (pw + 2 * pad, ph + 2 * pad), (0, 0, 0, 0)); fd = ImageDraw.Draw(frame)
fd.rounded_rectangle((0, 0, pw + 2 * pad - 1, ph + 2 * pad - 1), radius=r, fill=(22, 26, 34, 255), outline=(255, 255, 255, 40), width=2)
mask = Image.new('L', (pw, ph), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw - 1, ph - 1), radius=r - 8, fill=255)
frame.paste(shot, (pad, pad), mask); bg.alpha_composite(frame, (fx, fy))
d = ImageDraw.Draw(bg)
# highlight ring around the App updates card (≈ y 61-69 % of the 800px shot)
cy0, cy1 = fy + pad + int(ph * 0.615), fy + pad + int(ph * 0.70)
d.rounded_rectangle((fx + pad + 6, cy0, fx + pad + pw - 6, cy1), radius=10, outline=GRN, width=3)
d.text((fx + pw // 2 + pad, fy + ph + 2 * pad + 12), 'real screen · Settings', font=f(14, R), fill=MUTED, anchor='ma')

d.rounded_rectangle((X, H - 66, X + 290, H - 16), radius=10, fill=GRN); d.text((X + 22, H - 54), 'arctools.fun/app', font=f(26), fill=(4, 20, 10))
d.text((X + 310, H - 50), 'Android 7+ · signed APK · wallet and settings stay through updates', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('70-arcone-update.png', quality=95); print('70-arcone-update.png; list ends y', y, 'phone x', fx)
