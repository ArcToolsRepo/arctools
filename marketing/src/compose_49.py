"""49 — Trader profiles: the public record, on a real screenshot, with the robot presenting it."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); CARD = (18, 24, 36); GOLD = (217, 164, 65)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

# robot: the source is a full standing figure; the poster only has a 260px column for it on the right,
# so it is cropped to head + torso + the card it holds, scaled to that column and drawn first (behind everything)
robot = Image.open('assets/49-robot.png').convert('RGBA')
bx = robot.getbbox() or (0, 0, robot.width, robot.height)
robot = robot.crop(bx)
# keep the upper 62% of the figure (head, visor, arms, the glowing card)
robot = robot.crop((0, 0, robot.width, int(robot.height * 0.62)))
col_w = 380
rs = col_w / robot.width
robot = robot.resize((col_w, int(robot.height * rs)), Image.LANCZOS)
bg = Image.new('RGBA', (W, H), NAVY + (255,))
rx, ry = W - col_w + 40, H - robot.height + 20      # rises from the bottom-right corner
faded = robot.copy(); faded.putalpha(faded.getchannel('A').point(lambda a: int(a * 0.85)))
bg.alpha_composite(faded, (rx, ry))
print('robot', robot.size, 'x', rx, '->', rx + robot.width, 'y', ry)
# left-to-right scrim so type on the left reads over anything
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim)
for x in range(W):
    a = int(235 * max(0, 1 - x / 720))
    sd.line((x, 0, x, H), fill=(8, 10, 16, a))
bg = Image.alpha_composite(bg, scrim)
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))

d.text((56, 112), 'Trader', font=f(96), fill=INK)
d.text((56, 208), 'profiles', font=f(96), fill=GRN)
d.text((56, 324), 'your record, computed from the chain —', font=f(22), fill=(228, 235, 246))
d.text((56, 354), 'a name and a picture on top of it', font=f(22), fill=(228, 235, 246))

rows = [('Wallets join by signature', 'no signature, no claim'),
        ('Every number from Arc swaps', 'the owner sets the picture, never the PnL'),
        ('Leaderboard by PnL, ROI, win rate', 'seasons: week · month · all time'),
        ('Buys marked on the chart', 'avatar on the bar, toggle in the toolbar')]
y = 416
for head, tail in rows:
    d.rounded_rectangle((56, y, 59, y + 44), radius=2, fill=COB)
    d.text((76, y), head, font=f(20), fill=INK)
    d.text((76, y + 24), tail, font=f(16, R), fill=MUTED)
    y += 60

d.rounded_rectangle((76, 690, 320, 740), radius=10, fill=GRN)
d.text((98, 702), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((338, 700), '/leaderboard', font=f(26, R), fill=MUTED)

# the real page, cropped to the three-column band
shot = Image.open('assets/49-panel.png').convert('RGB')
tw = 760
shot = shot.resize((tw, int(shot.height * tw / shot.width)), Image.LANCZOS)
sx, sy = 480, 430
print('card', shot.size, 'x', sx, '->', sx + shot.width, 'y', sy, '->', sy + shot.height)
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).rounded_rectangle((sx - 16, sy - 16, sx + shot.width + 16, sy + shot.height + 16), radius=24, fill=COB + (110,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(20)))
# rounded corners on the screenshot
mask = Image.new('L', shot.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=14, fill=255)
bg.paste(shot, (sx, sy), mask)
d = ImageDraw.Draw(bg)
d.rounded_rectangle((sx - 1, sy - 1, sx + shot.width + 1, sy + shot.height + 1), radius=14, outline=(255, 255, 255, 70), width=2)
# a tag on the card
d.rounded_rectangle((sx + 14, sy - 30, sx + 232, sy - 4), radius=8, fill=GOLD)
d.text((sx + 24, sy - 27), 'LIVE · arctools.fun/u/insider1', font=f(15), fill=(26, 18, 4))

bg.convert('RGB').save('49-profiles.png', quality=95)
print('49-profiles.png', bg.size)
