"""73 — Sponsored banner slots: real Terminal v2 screenshot (cropped to the band), price + rules."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-300, 500, 700, 1300), fill=COB + (50,)); gd.ellipse((1000, -300, 1900, 500), fill=GRN + (36,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(170))); d = ImageDraw.Draw(bg)

d.text((70, 60), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((210, 62, 278, 94), radius=8, fill=COB); d.text((222, 67), 'NEW', font=f(19), fill=INK)
d.text((70, 110), 'Your banner. Top of the Terminal.', font=f(56), fill=INK)
d.text((70, 182), '3 slots under the Terminal heading, on both Terminal versions. 7 days each.', font=f(22, R), fill=MUTED)

# screenshot: crop the Terminal heading + band + first rows (x 240..1905, y 250..640), scale to 1460 wide
shot = Image.open('assets/73-shot.png').convert('RGB').crop((240, 340, 1905, 700))
sw = 1460; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
frame = Image.new('RGBA', (sw + 4, shot.height + 4), (255, 255, 255, 40)); frame.paste(shot, (2, 2))
# fade bottom of the screenshot into the poster
alpha = np.full((frame.height, frame.width), 255, dtype=np.float32); alpha[-90:, :] *= np.linspace(1, 0.15, 90)[:, None]
frame.putalpha(Image.fromarray(alpha.astype('uint8')))
sy = 240; bg.alpha_composite(frame, (70, sy)); d = ImageDraw.Draw(bg)
# arrow-free pointer: bracket under the band
k = sw / 1665
b0 = sy + 2 + int((394 - 340) * k); b1 = sy + 2 + int((468 - 340) * k)   # banner band in the shot: y 394..468 (blue button 417..444)
d.rounded_rectangle((56, b0, 64, b1), radius=3, fill=GRN)
lab = Image.new('RGBA', (b1 - b0 + 60, 22), (0, 0, 0, 0)); ld = ImageDraw.Draw(lab); ld.text((0, 0), '3 SLOTS · 7 DAYS', font=f(14), fill=GRN)
bg.alpha_composite(lab.rotate(90, expand=True), (30, b0 - 20)); d = ImageDraw.Draw(bg)

y = sy + frame.height + 24
cols = [('250 USDC', 'or ARCT worth 200 USD, paid on-chain to the fee treasury — the same wallet every fee goes to. Buyback and burn.'),
        ('1060 × 144 px', 'PNG, WebP or JPEG. The form resizes and center-crops anything else. Whole banner is one link.'),
        ('Reviewed by a human', 'Paying is not a right to publish. No shorteners, no drainer domains, no impersonation. Rejected = refunded.')]
cw = (W - 140 - 2 * 24) // 3
for i, (t, sub) in enumerate(cols):
    x = 70 + i * (cw + 24)
    d.rounded_rectangle((x, y, x + cw, y + 150), radius=14, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.text((x + 22, y + 20), t, font=f(30), fill=GRN if i == 0 else INK)
    words = sub.split(); line = ''; lines = []
    for w_ in words:
        if len(line) + len(w_) > 50: lines.append(line); line = w_
        else: line = (line + ' ' + w_).strip()
    lines.append(line)
    for j, ln in enumerate(lines): d.text((x + 22, y + 66 + j * 22), ln, font=f(15, R), fill=(225, 232, 245))

d.rounded_rectangle((70, H - 88, 420, H - 34), radius=10, fill=COB); d.text((92, H - 76), 'arctools.fun/advertise', font=f(26), fill=INK)
d.text((440, H - 70), 'Not shown in the ArcOne app. Slots taken? The form shows when the next one frees up.', font=f(15, R), fill=(225, 232, 245))
bg.convert('RGB').save('73-banner-slots.png', quality=95); print('73 ok; cards y', y, 'end', y + 150)
