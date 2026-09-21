"""65 — gARC, Monday: a new week, first things ship today. Robot at work (generated from the house robot ref)."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (6, 10, 20); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

# the render is 3:2 on a near-#0C0F16 background: resize to canvas width and let it BE the background
rob = Image.open('assets/65-robot.png').convert('RGB'); rob = rob.resize((int(rob.width * H / rob.height), H), Image.LANCZOS)
bg = Image.new('RGB', (W, H), NAVY)
bg.paste(rob, (W - rob.width, 0))          # right-anchored, full height: feet on the floor line, whole robot
# blend the render's top edge into the canvas so the seam is invisible
band = Image.new('L', (W, 140), 0); bd = ImageDraw.Draw(band)
for i in range(140):
    bd.line((0, i, W, i), fill=int(255 * (1 - i / 140) ** 1.5))

bg = bg.convert('RGBA')

glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-260, 120, 640, 900), fill=COB + (42,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(160)))
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 330, 78), radius=8, fill=GRN)
d.text((222, 50), 'MONDAY', font=f(20), fill=(4, 20, 10))

# the greeting, huge — the render left the left 45% dark for exactly this
d.text((56, 130), 'gARC.', font=f(190), fill=INK)
d.text((62, 350), 'New week ahead.', font=f(46), fill=GRN)
d.text((62, 408), 'We start shipping.', font=f(46), fill=INK)

lines = ['First things land today:', 'mobile layout for the Terminal,', 'a real Android build you can', 'download from arctools.fun.']
yy = 500
for i, t in enumerate(lines):
    d.text((64, yy), t, font=f(22, R if i else F), fill=INK if not i else MUTED)
    yy += 32

d.rounded_rectangle((56, H - 66, 300, H - 16), radius=10, fill=GRN)
d.text((78, H - 54), 'arctools.fun', font=f(26), fill=(4, 20, 10))
bg.convert('RGB').save('65-garc-monday.png', quality=95)
print('65-garc-monday.png; text block right edge ~', 64 + max(d.textlength(t, font=f(22, R)) for t in lines), '| robot render starts being solid around x=600')
