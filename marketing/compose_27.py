from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/27-by-the-numbers.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
GREEN = (34, 197, 94); CYAN = (78, 205, 255); INK = (245, 247, 250); MUTED = (150, 165, 185)

canvas = Image.new("RGBA", (W, H), (6, 9, 16, 255))
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((1000, 150, 1900, 1150), fill=(*GREEN, 50))
gd.ellipse((-300, -300, 700, 500), fill=(40, 90, 200, 55))
glow = glow.filter(ImageFilter.GaussianBlur(160))
canvas.alpha_composite(glow)
for x in range(0, W, 40): d.line((x, 0, x, H), fill=(255, 255, 255, 5))
for y in range(0, H, 40): d.line((0, y, W, y), fill=(255, 255, 255, 5))

# header
f_kick = ImageFont.truetype(MONO, 18); f_h = ImageFont.truetype(RB, 50)
d.text((70, 52), "ARCTOOLS · ARC INDEX · 14 SEP 2026", font=f_kick, fill=MUTED)
d.text((70, 82), "EVERY ARC LAUNCHPAD.", font=f_h, fill=INK)
d.text((70, 140), "ONE INDEX. BY THE NUMBERS.", font=f_h, fill=GREEN)

# stat tiles (2 rows x 3) — real values from the swap index + Terminal list
stats = [
    ("$33.1M", "volume indexed", "all swaps since Aug 11 · V3/V4/V2/curves"),
    ("218k", "swaps indexed", "58k in the last 24 h"),
    ("4,553", "tokens listed", "16 sources · 3,676 with trades"),
    ("6,517", "pools tracked", "5,358 V3 · 706 V4 · 453 stock pairs"),
    ("11,953", "wallets seen", "4,767 active in the last 24 h"),
    ("$12.3M", "24 h volume", "1,141 tokens traded today"),
]
f_num = ImageFont.truetype(RB, 46); f_lab = ImageFont.truetype(MONO, 14); f_sub = ImageFont.truetype(RR, 13)
tx, ty, tw, th, gap = 70, 222, 300, 128, 14
for i, (n, lab, sub) in enumerate(stats):
    x = tx + (i % 3) * (tw + gap); y = ty + (i // 3) * (th + gap)
    d.rounded_rectangle((x, y, x + tw, y + th), radius=12, fill=(14, 18, 27, 235), outline=(60, 75, 100), width=1)
    d.rectangle((x, y + 18, x + 4, y + th - 18), fill=GREEN if i % 2 == 0 else CYAN)
    d.text((x + 18, y + 12), n, font=f_num, fill=INK)
    d.text((x + 18, y + 66), lab.upper(), font=f_lab, fill=GREEN if i % 2 == 0 else CYAN)
    d.text((x + 18, y + 90), sub, font=f_sub, fill=MUTED)

# sources strip
f_src = ImageFont.truetype(MONO, 12)
srcs = "RadarDex · long.supply · Lift · Arguspad · Uniswap V3/V4 · Tolly · eve.fun · DYORSwap · ArcPad · Ellipse · Archemist · Warp · UBI.fun · act.fun · ArcToolsPad · Sashimi"
d.text((70, ty + 2 * (th + gap) + 2), "SOURCES  " + srcs[:srcs.index("· ArcPad")], font=f_src, fill=MUTED)
d.text((70, ty + 2 * (th + gap) + 18), "         " + srcs[srcs.index("ArcPad"):], font=f_src, fill=MUTED)

# Terminal screenshot card (real): rows region
term = Image.open(SRC + "term_lift_full2.png").convert("RGB").crop((230, 400, 1130, 880))
cw = 900; sc = cw / term.width
term = term.resize((cw, int(term.height * sc)), Image.LANCZOS)
cx, cy = 70, ty + 2 * (th + gap) + 50
sh = Image.new("RGBA", (term.width + 90, term.height + 90), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((45, 55, term.width + 45, term.height + 55), radius=20, fill=(0, 0, 0, 180)); sh = sh.filter(ImageFilter.GaussianBlur(26))
canvas.alpha_composite(sh, (cx - 45, cy - 45))
fr = Image.new("RGBA", (term.width + 4, term.height + 4), (0, 0, 0, 0))
ImageDraw.Draw(fr).rounded_rectangle((0, 0, fr.width - 1, fr.height - 1), radius=16, fill=(70, 85, 110, 255)); canvas.alpha_composite(fr, (cx - 2, cy - 2))
mask = Image.new("L", term.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, term.width - 1, term.height - 1), radius=14, fill=255)
canvas.paste(term.convert("RGBA"), (cx, cy), mask)
fade_h = 110
fade = Image.new("RGBA", (term.width, fade_h), (0, 0, 0, 0))
for i in range(fade_h): ImageDraw.Draw(fade).line((0, i, term.width, i), fill=(6, 9, 16, int(255 * (i / fade_h) ** 1.5)))
canvas.alpha_composite(fade, (cx, H - fade_h))

# robot (right), arms crossed with holo charts
robot = Image.open(SRC + "robot_stats.png").convert("RGBA")
rw = 500
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
canvas.alpha_composite(robot, (W - rw + 10, H - robot.height + 40))

# footer (top-right)
f_url = ImageFont.truetype(MONO, 20)
foot = "arctools.fun/trade  ·  @arctoolsfun"
d.text((W - 70 - d.textlength(foot, font=f_url), 56), foot, font=f_url, fill=INK)
logo = Image.open(LOGO).convert("RGBA"); lh = 30
logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
canvas.alpha_composite(logo, (int(W - 70 - d.textlength(foot, font=f_url) - logo.width - 12), 52))

canvas.convert("RGB").save(OUT, quality=95)
print(OUT)
