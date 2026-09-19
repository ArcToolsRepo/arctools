"""60 — Swap tab: the live card as the hero, the fee promise stated plainly."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-150, 200, 780, 1080), fill=COB + (52,))
gd.ellipse((900, 120, 1750, 1000), fill=GRN + (26,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

# robot, right edge
rob = Image.open('assets/58-robot.png').convert('RGBA')
arr = np.array(rob).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 760; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 150
bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128
ROB_L = rx + int(np.where(a.any(axis=0))[0].min())
print('robot', rob.size, 'solid from x', ROB_L)

d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 330, 78), radius=8, fill=COB); d.text((222, 50), 'NEW TAB', font=f(20), fill=(255, 255, 255))

d.text((56, 108), 'One router.', font=f(66), fill=INK)
d.text((56, 180), 'Every token on Arc.', font=f(66), fill=GRN)

# the live card, cropped from the deployed page
card = Image.open('assets/60-swap.png').crop((520, 235, 1106, 601)).convert('RGB')
cw = 600; card = card.resize((cw, int(card.height * cw / card.width)), Image.LANCZOS)
cx, cy = 56, 292
g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(g).rounded_rectangle((cx - 16, cy - 16, cx + card.width + 16, cy + card.height + 16), radius=28, fill=(0, 0, 0, 140))
bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(20)))
mask = Image.new('L', card.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, card.width, card.height), radius=16, fill=255)
bg.paste(card, (cx, cy), mask)
d = ImageDraw.Draw(bg)
d.rounded_rectangle((cx - 1, cy - 1, cx + card.width + 1, cy + card.height + 1), radius=16, outline=(255, 255, 255, 55), width=2)
print('card', (cx, cy), card.size, 'right', cx + card.width, 'bottom', cy + card.height)

# feature column, between the card and the robot
tx = cx + card.width + 46
avail = ROB_L - tx - 20
print('text column x', tx, 'available width', avail)
items = [
    ('Search by contract', 'paste any address — the picker\nshows which launchpad it came from'),
    ('Your slippage', '0.5 / 1 / 5% or your own number,\nmin received shown before you sign'),
    ('Best route, split', 'Uniswap V3, V4, launchpad curves\nand stock pairs quoted together'),
]
yy = 300
for title, body in items:
    d.rounded_rectangle((tx, yy, tx + 6, yy + 58), radius=3, fill=GRN)
    d.text((tx + 20, yy - 2), title, font=f(26), fill=INK)
    d.text((tx + 20, yy + 30), body, font=f(16, R), fill=MUTED, spacing=6)
    yy += 108
    print('  item', title, 'bottom', yy)

# fee statement
fy = yy + 16
d.rounded_rectangle((tx, fy, tx + min(avail - 40, 400), fy + 116), radius=14, fill=(18, 24, 36, 240), outline=(46, 124, 255, 120), width=2)
d.text((tx + 18, fy + 14), '0.5%', font=f(44), fill=COB)
d.text((tx + 120, fy + 26), 'per swap, in USDC', font=f(19), fill=INK)
d.text((tx + 18, fy + 70), 'spent buying ARCT back and burning it', font=f(15, R), fill=MUTED)
print('fee box', (tx, fy), 'right', tx + min(avail - 40, 400), 'gap to robot', ROB_L - (tx + min(avail - 40, 400)))

d.rounded_rectangle((56, 916, 340, 966), radius=10, fill=GRN)
d.text((78, 928), 'arctools.fun/swap', font=f(26), fill=(4, 20, 10))
bg.convert('RGB').save('60-swap.png', quality=95); print('60-swap.png')
