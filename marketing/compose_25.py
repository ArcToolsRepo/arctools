from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/25-today-update.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 1100
GREEN = (34, 197, 94)
CYAN = (78, 205, 255)
BLUE = (56, 130, 255)
INK = (245, 247, 250)
MUTED = (150, 165, 185)

canvas = Image.new("RGBA", (W, H), (6, 9, 16, 255))
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((-200, 150, 800, 1150), fill=(40, 90, 200, 70))     # blue behind robot
gd.ellipse((900, -200, 1800, 500), fill=(*GREEN, 26))
glow = glow.filter(ImageFilter.GaussianBlur(160))
canvas.alpha_composite(glow)

def card(img, x, y, w, radius=12, border=(70, 85, 110)):
    im = img.convert("RGBA")
    im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    sh = Image.new("RGBA", (im.width + 90, im.height + 90), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((45, 55, im.width + 45, im.height + 55), radius=radius + 6, fill=(0, 0, 0, 180))
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    canvas.alpha_composite(sh, (x - 45, y - 45))
    fr = Image.new("RGBA", (im.width + 4, im.height + 4), (0, 0, 0, 0))
    ImageDraw.Draw(fr).rounded_rectangle((0, 0, fr.width - 1, fr.height - 1), radius=radius + 2, fill=(*border, 255))
    canvas.alpha_composite(fr, (x - 2, y - 2))
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=radius, fill=255)
    canvas.paste(im, (x, y), mask)
    return im.size

def badge(x, y, text, fill, fg=(6, 20, 10), size=15, pad=9):
    f = ImageFont.truetype(MONO, size)
    tw = d.textlength(text, font=f)
    d.rounded_rectangle((x, y, x + tw + pad * 2, y + size + 12), radius=(size + 12) // 2, fill=fill)
    d.text((x + pad, y + 6), text, font=f, fill=fg)
    return tw + pad * 2

def outline(box, color, label=None):
    d.rounded_rectangle(box, radius=7, outline=color, width=3)
    if label:
        badge(box[0], box[1] - 30, label, color, size=13, pad=7)

# ---- header (top-left): kicker, headline (two-tone), bullets
f_kick = ImageFont.truetype(MONO, 18)
d.text((70, 56), "ARCTOOLS TERMINAL · TODAY'S UPDATE", font=f_kick, fill=MUTED)
f_h = ImageFont.truetype(RB, 42)
d.text((70, 86), "5 NEW LAUNCHPADS.", font=f_h, fill=INK)
d.text((70, 136), "CHARTS THAT DON'T QUIT.", font=f_h, fill=CYAN)

f_b = ImageFont.truetype(RB, 20)
f_bs = ImageFont.truetype(RR, 16)
bullets = [
    ("Lift · eve.fun · Ellipse · Sashimi · aka.fun", "logos, MC, volume, Score for every launch"),
    ("ALL tab per launchpad", "every token a pad ever launched, one click"),
    ("TA toolbar on every chart", "MA · EMA · Bollinger · VWAP · RSI · levels · log"),
    ("Real market caps", "priced on what actually trades on Arc"),
    ("Token pages in 0.6 s", "render from our index, chain fills in behind"),
]
y = 210
for t, sub in bullets:
    d.rectangle((70, y + 6, 80, y + 16), fill=GREEN)
    d.text((92, y - 2), t, font=f_b, fill=INK)
    d.text((92, y + 24), sub, font=f_bs, fill=MUTED)
    y += 58

# ---- robot (left-bottom), pointing right at the panels
robot = Image.open(SRC + "robot_point.png").convert("RGBA")
rw = 470
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
canvas.alpha_composite(robot, (40, H - robot.height + 20))

# ---- panel 1: Terminal (chips + framed tabs + first rows), top-right
term = Image.open(SRC + "term_lift_full2.png").convert("RGB").crop((230, 225, 1130, 700))   # 900 x 475
p1x, p1y, p1w = 640, 56, 900
p1 = card(term, p1x, p1y, p1w)
s1 = p1w / 900
# highlights (DOM-measured on this capture: chips y237-261 x244-589 → crop coords 14..359 x, 12..36 y; All tab x240-336 y298-346 → 10..106, 73..121)
outline((p1x + 12 * s1, p1y + 8 * s1, p1x + 366 * s1, p1y + 42 * s1), GREEN, "NEW LAUNCHPADS")
outline((p1x + 8 * s1, p1y + 71 * s1, p1x + 110 * s1, p1y + 125 * s1), CYAN, "ALL · per pad")
badge(p1x + p1w - 230, p1y - 16, "410 Lift tokens", GREEN)

# ---- panel 2: chart with TA toolbar + RSI pane, bottom-right (offset left)
chart = Image.open(SRC + "chart_ta2.png").convert("RGB").crop((85, 130, 916, 640))   # toolbar → RSI
p2x, p2y, p2w = 560, 56 + p1[1] + 44, 780
p2 = card(chart, p2x, p2y, p2w, border=(60, 110, 150))
s2 = p2w / 831
# toolbar in this crop: x 566-912 → 481..827, y 137-170 → 7..40
outline((p2x + 479 * s2, p2y + 4 * s2, p2x + 829 * s2, p2y + 42 * s2), GREEN, "TA TOOLBAR")
# header bar above chart card
hb = "NEW  ·  MA / EMA / BOLLINGER / VWAP / RSI PANE / LEVELS  ·  ARCTOOLS WATERMARK"
f_hb = ImageFont.truetype(MONO, 14)
d.rounded_rectangle((p2x, p2y - 34, p2x + d.textlength(hb, font=f_hb) + 20, p2y - 8), radius=6, fill=BLUE)
d.text((p2x + 10, p2y - 29), hb, font=f_hb, fill=INK)

# ---- small feature cards left of chart (3), like ref
cards = [("Real MC", "LONG: $15M → $0.97M\npriced on Arc, not NYSE"), ("0.6 s pages", "first render from\nour own index"), ("Self-healing", "missed pool? indexed\nthe moment you open it")]
f_ct = ImageFont.truetype(RB, 17); f_cb = ImageFont.truetype(RR, 14)
cx0, cy0 = 70 + 0, p2y + 10
# place them to the right of the robot, left of chart? robot occupies x<510 bottom → put cards at x=... under chart? Use column x= p2x-?? not enough room; place them BELOW panel 1 right of chart? chart spans to 1340; right margin 1340..1560 = 220 → cards column there.
colx = p2x + p2w + 24
cw = W - 70 - colx
for i, (t, b) in enumerate(cards):
    yy = p2y + i * 118
    d.rounded_rectangle((colx, yy, colx + cw, yy + 104), radius=10, fill=(16, 21, 31, 255), outline=(60, 75, 100), width=1)
    d.text((colx + 14, yy + 12), t, font=f_ct, fill=GREEN if i != 1 else CYAN)
    d.multiline_text((colx + 14, yy + 40), b, font=f_cb, fill=MUTED, spacing=4)

# ---- footer
logo = Image.open(LOGO).convert("RGBA"); lh = 34
logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
fx, fy = 560, H - 62
canvas.alpha_composite(logo, (fx, fy - 4))
f_url = ImageFont.truetype(MONO, 24); f_tag = ImageFont.truetype(RR, 16)
d.text((fx + logo.width + 12, fy - 4), "arctools.fun/trade", font=f_url, fill=INK)
d.text((fx + logo.width + 12 + d.textlength("arctools.fun/trade", font=f_url) + 18, fy + 2), "every Arc launchpad · one click · best price across venues", font=f_tag, fill=MUTED)

canvas.convert("RGB").save(OUT, quality=95)
print(OUT, p1, p2)
