"""63 — real screenshot of the live Terminal + mobile app next week."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-200, 300, 700, 1100), fill=COB + (50,))
gd.ellipse((1000, -100, 1800, 600), fill=GRN + (28,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(160)))
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 330, 78), radius=8, fill=GRN)
d.text((222, 50), 'LIVE NOW', font=f(20), fill=(4, 20, 10))

d.text((56, 108), 'The Terminal is live.', font=f(56), fill=INK)
d.text((56, 172), 'The app is next.', font=f(56), fill=GRN)

lines = [
    'Every Arc launchpad in one table: price, cap, liquidity, 5M / 1H / 6H / 24H, dev & bundle risk.',
    'One-click buys with a wallet that never leaves your browser.',
    'The index sits on the chain head: swaps land as the blocks close.',
    'Mobile app: next week.',
]
yy = 258
for i, t in enumerate(lines):
    d.ellipse((58, yy + 9, 66, yy + 17), fill=GRN if i < 3 else COB)
    d.text((80, yy), t, font=f(20, R if i < 3 else F), fill=(226, 233, 245) if i < 3 else INK)
    yy += 38

# the real screenshot — the terminal as it renders today, not a mockup
shot = Image.open('assets/63-shot.png').convert('RGB')
# crop the top of the page: rail + chain strip + table header + first rows
shot = shot.crop((0, 0, 1920, 640))
cw = 1488
shot = shot.resize((cw, int(shot.height * cw / shot.width)), Image.LANCZOS)
cx, cy = 56, 425
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((cx - 16, cy - 16, cx + shot.width + 16, cy + shot.height + 16), radius=26, fill=(0, 0, 0, 150))
bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(20)))
mask = Image.new('L', shot.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=16, fill=255)
bg.paste(shot, (cx, cy), mask)
d = ImageDraw.Draw(bg)
d.rounded_rectangle((cx - 1, cy - 1, cx + shot.width + 1, cy + shot.height + 1), radius=16, outline=(255, 255, 255, 70), width=2)
# fade the bottom of the screenshot into the background so the crop does not read as a hard cut
fade = Image.new('RGBA', (shot.width, 120), (0, 0, 0, 0)); fd = ImageDraw.Draw(fade)
for i in range(120):
    fd.line((0, i, shot.width, i), fill=NAVY + (int(255 * (i / 120) ** 1.6),))
bg.alpha_composite(fade, (cx, cy + shot.height - 120))
d = ImageDraw.Draw(bg)

d.rounded_rectangle((56, H - 66, 300, H - 16), radius=10, fill=GRN)
d.text((78, H - 54), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((330, H - 50), 'real screenshot · 20 Sep 2026', font=f(15, R), fill=MUTED)
bg.convert('RGB').save('63-terminal-live.png', quality=95)
print('63-terminal-live.png', shot.size, 'bottom', cy + shot.height)
