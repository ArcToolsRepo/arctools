"""82 — ARCT reflections: 1/1 tax, half of it paid to holders in USDC through RadarDex, claimable any time. Robot render + real RadarDex panel."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1600, 1000
GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (150, 160, 180)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'; R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
bg = Image.open('assets/82-robot.png').convert('RGB'); bg = bg.resize((W, int(bg.height * W / bg.width)), Image.LANCZOS); bg = bg.crop((0, (bg.height - H) // 2, W, (bg.height - H) // 2 + H)).convert('RGBA')
# darken left 62 % for legibility
grad = Image.new('L', (W, 1), 0); gp = grad.load()
for x in range(W): gp[x, 0] = int(215 * max(0.0, min(1.0, (0.70 - x / W) / 0.30)))
dark = Image.new('RGBA', (W, H), (6, 9, 14, 255)); dark.putalpha(grad.resize((W, H))); bg = Image.alpha_composite(bg, dark)
d = ImageDraw.Draw(bg)
d.text((70, 52), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 54, 470, 86), radius=8, fill=GRN); d.text((222, 59), 'ARCT · USDC REFLECTIONS', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'Hold ARCT. Get paid in USDC.', font=f(54), fill=INK)
d.text((70, 172), 'ARCT has a 1 % buy / 1 % sell tax. Half of it goes to every holder as USDC through RadarDex reflections,', font=f(19, R), fill=MUTED)
d.text((70, 198), 'split by share. Claim any time, or receive it automatically on any transfer or sell.', font=f(19, R), fill=MUTED)
# real RadarDex panel
pan = Image.open('assets/82-radardex-panel.png').convert('RGB'); ph = 640; pan = pan.resize((int(pan.width * ph / pan.height), ph), Image.LANCZOS)
mask = Image.new('L', pan.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, pan.width - 1, pan.height - 1), radius=14, fill=255)
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((60, 262, 60 + pan.width + 20, 262 + ph + 30), radius=20, fill=(0, 0, 0, 200)); bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(40)))
bg.paste(pan, (70, 244), mask); d = ImageDraw.Draw(bg); d.text((70, 244 + ph + 8), 'radardex.io — Reflection dividends panel for ARCT, real screen (one holder\'s view)', font=f(12, R), fill=DIM)
X = 70 + pan.width + 40; y = 250
d.text((X, y), 'PAID OUT SO FAR (USDC)', font=f(13), fill=GRN); y += 30
for k, v in (('To all holders', '3,839.2'), ('To the ArcTools treasury', '3,839.2'), ('Total from the 1/1 tax', '7,678.4'), ('ARCT burned by the tax', '37.05M')):
    d.rounded_rectangle((X, y, X + 470, y + 50), radius=8, fill=(12, 16, 24, 235), outline=(255, 255, 255, 30), width=1)
    d.text((X + 14, y + 15), k, font=f(14, R), fill=DIM); d.text((X + 470 - 14 - d.textlength(v, font=f(18)), y + 13), v, font=f(18), fill=INK); y += 58
y += 8
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(scrim).rounded_rectangle((X - 16, y - 12, X + 500, y + 250), radius=14, fill=(6, 9, 14, 205)); bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(6))); d = ImageDraw.Draw(bg)
d.text((X, y), 'HOW IT WORKS', font=f(13), fill=GRN); y += 28
for t, s in (('1  Buy or sell ARCT', '1 % tax on each side, collected in USDC from the LP.'), ('2  Half to holders', 'Split by your share of supply. No staking, no lock.'), ('3  Claim', 'On the RadarDex token page: "Claim X USDC". Or it arrives on your next transfer.'), ('4  Other half', 'ArcTools treasury: pays for operators and buys back and burns ARCT.')):
    d.text((X, y), t, font=f(17), fill=INK); d.text((X, y + 24), s, font=f(14, R), fill=MUTED); y += 52
d.rounded_rectangle((70, H - 84, 470, H - 34), radius=10, fill=GRN); d.text((92, H - 72), 'arctools.fun/token/ARCT', font=f(24), fill=(4, 20, 10))
d.text((492, H - 68), 'CA 0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52 · reflections are a RadarDex token-contract feature; numbers from the panel on 23 Sep 2026', font=f(12, R), fill=MUTED)
bg.convert('RGB').save('82-reflections.png', quality=95); print('82 ok', y)
