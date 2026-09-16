from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/26-referral-claim.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
GREEN = (34, 197, 94)
CYAN = (78, 205, 255)
INK = (245, 247, 250)
MUTED = (150, 165, 185)

canvas = Image.new("RGBA", (W, H), (6, 9, 16, 255))
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((-250, 100, 750, 1100), fill=(*GREEN, 55))
gd.ellipse((900, -250, 1800, 450), fill=(40, 90, 200, 55))
glow = glow.filter(ImageFilter.GaussianBlur(160))
canvas.alpha_composite(glow)

# header
f_kick = ImageFont.truetype(MONO, 18)
d.text((70, 56), "ARCTOOLS REFERRALS · NEW", font=f_kick, fill=MUTED)
f_h = ImageFont.truetype(RB, 50)
d.text((70, 86), "25% OF THE FEES.", font=f_h, fill=INK)
d.text((70, 144), "CLAIM ANY TIME.", font=f_h, fill=GREEN)
f_b = ImageFont.truetype(RB, 20); f_bs = ImageFont.truetype(RR, 16)
bullets = [
    ("Every trade of everyone you bring", "1.5% swap fee on the Terminal · 1% per trade in the sniper"),
    ("A quarter of it is yours, forever", "no cap, no expiry, credited seconds after the tx"),
    ("Claim button, native USDC", "sign with your wallet, USDC lands on the spot · min 1 USDC"),
    ("Works in the sniper bot too", "/ref → Claim, paid to your active wallet"),
]
y = 218
for t, sub in bullets:
    d.rectangle((70, y + 6, 80, y + 16), fill=GREEN)
    d.text((92, y - 2), t, font=f_b, fill=INK)
    d.text((92, y + 24), sub, font=f_bs, fill=MUTED)
    y += 58

# robot with coin (left-bottom)
robot = Image.open(SRC + "robot_coin.png").convert("RGBA")
rw = 380
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
canvas.alpha_composite(robot, (250, H - robot.height + 60))

# screenshot card (real /referrals page): crop section 610..1515 x, 70..905 y
shot = Image.open(SRC + "ref_claim_full.png").convert("RGB").crop((612, 70, 1514, 905))
cw = 860
sc = cw / shot.width
shot = shot.resize((cw, int(shot.height * sc)), Image.LANCZOS)
cx, cy = 690, 72
sh = Image.new("RGBA", (shot.width + 90, shot.height + 90), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((45, 55, shot.width + 45, shot.height + 55), radius=20, fill=(0, 0, 0, 180))
sh = sh.filter(ImageFilter.GaussianBlur(26))
canvas.alpha_composite(sh, (cx - 45, cy - 45))
fr = Image.new("RGBA", (shot.width + 4, shot.height + 4), (0, 0, 0, 0))
ImageDraw.Draw(fr).rounded_rectangle((0, 0, fr.width - 1, fr.height - 1), radius=16, fill=(70, 85, 110, 255))
canvas.alpha_composite(fr, (cx - 2, cy - 2))
mask = Image.new("L", shot.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), radius=14, fill=255)
canvas.paste(shot.convert("RGBA"), (cx, cy), mask)
fade_h = 120
fade = Image.new("RGBA", (shot.width, fade_h), (0, 0, 0, 0))
for i in range(fade_h):
    ImageDraw.Draw(fade).line((0, i, shot.width, i), fill=(6, 9, 16, int(255 * (i / fade_h) ** 1.5)))
canvas.alpha_composite(fade, (cx, H - fade_h))

# highlight the claim panel (DOM: [637,428,1489,595] page px → crop origin 612,70)
def box(x0, y0, x1, y1):
    return (cx + (x0 - 612) * sc, cy + (y0 - 70) * sc, cx + (x1 - 612) * sc, cy + (y1 - 70) * sc)
b = box(632, 423, 1494, 600)
d.rounded_rectangle(b, radius=12, outline=GREEN, width=3)
f_l = ImageFont.truetype(MONO, 14)
lbl = "NEW · CLAIM USDC"
tw = d.textlength(lbl, font=f_l)
d.rounded_rectangle((b[0], b[1] - 30, b[0] + tw + 16, b[1] - 6), radius=6, fill=GREEN)
d.text((b[0] + 8, b[1] - 26), lbl, font=f_l, fill=(6, 20, 10))

# footer → top-right strip above nothing (card starts at y=56), so put it bottom-left of the robot is bad; use header right side
f_url = ImageFont.truetype(MONO, 20); f_tag = ImageFont.truetype(RR, 14)
foot = "arctools.fun/referrals  ·  @arctoolsfun"
d.text((W - 70 - d.textlength(foot, font=f_url), 22), foot, font=f_url, fill=INK)
note = "demo numbers shown"
d.text((W - 70 - d.textlength(note, font=f_tag), 46), note, font=f_tag, fill=MUTED)
logo = Image.open(LOGO).convert("RGBA"); lh = 30
logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
canvas.alpha_composite(logo, (int(W - 70 - d.textlength(foot, font=f_url) - logo.width - 12), 18))
canvas.convert("RGB").save(OUT, quality=95)
print(OUT, shot.size)
