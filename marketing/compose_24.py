from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/24-charts-upgrade.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
GREEN = (34, 197, 94)
ARC_BLUE = (56, 130, 255)      # Arc chain accent
CYAN = (78, 205, 255)

canvas = Image.new("RGBA", (W, H), (7, 10, 16, 255))
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((-250, -350, 800, 600), fill=(*ARC_BLUE, 58))       # Arc blue top-left
gd.ellipse((1000, 250, 1900, 1150), fill=(*GREEN, 40))          # ArcTools green bottom-right
glow = glow.filter(ImageFilter.GaussianBlur(170))
canvas.alpha_composite(glow)
for x in range(0, W, 40):
    d.line((x, 0, x, H), fill=(255, 255, 255, 6))
for y in range(0, H, 40):
    d.line((0, y, W, y), fill=(255, 255, 255, 6))

# ---- brand lockup: ArcTools mark + wordmark, "on Arc" pill
logo = Image.open(LOGO).convert("RGBA")
lh = 44
logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
canvas.alpha_composite(logo, (70, 50))
f_brand = ImageFont.truetype(RB, 30)
d.text((70 + logo.width + 12, 54), "ArcTools", font=f_brand, fill=(245, 247, 250))
f_pill = ImageFont.truetype(MONO, 15)
pill = "on Arc · chain 5042"
pw = d.textlength(pill, font=f_pill)
px = 70 + logo.width + 12 + d.textlength("ArcTools", font=f_brand) + 18
d.rounded_rectangle((px, 60, px + pw + 20, 86), radius=13, outline=ARC_BLUE, width=2)
d.text((px + 10, 65), pill, font=f_pill, fill=CYAN)

# ---- headline
f_kick = ImageFont.truetype(MONO, 22)
f_h1 = ImageFont.truetype(RB, 58)
d.text((72, 120), "CHARTS UPGRADE", font=f_kick, fill=GREEN)
d.text((70, 152), "Every Arc chart, upgraded", font=f_h1, fill=(245, 247, 250))

# ---- 4 feature bullets (left column, under the chart? no — left of chart is too narrow; bullets go right of chart, under robot? put them in a row above the card)
f_b = ImageFont.truetype(RB, 21)
f_bs = ImageFont.truetype(RR, 17)
bullets = [
    ("TA tools", "MA · EMA · Bollinger · VWAP · RSI · levels · log"),
    ("Real market caps", "priced on what actually trades on Arc"),
    ("Instant token pages", "0.6 s to first render, no skeletons"),
    ("Every launchpad indexed", "Lift, eve.fun, Ellipse pools self-heal"),
]
bx, by = 70, 232
colw = 345
for i, (t, sub) in enumerate(bullets):
    x = bx + i * colw
    d.rounded_rectangle((x, by, x + 10, by + 44), radius=5, fill=GREEN if i % 2 == 0 else ARC_BLUE)
    d.text((x + 22, by - 2), t, font=f_b, fill=(245, 247, 250))
    d.text((x + 22, by + 24), sub, font=f_bs, fill=(178, 190, 206))

# ---- real chart screenshot card (LONG page with MA20 + BB + RSI on, ArcTools watermark visible)
shot = Image.open(SRC + "chart_ta2.png").convert("RGB")
crop = shot.crop((85, 72, 916, 668))           # chart card: timeframes → RSI pane
card_w = 1000
crop = crop.resize((card_w, int(crop.height * card_w / crop.width)), Image.LANCZOS)
cx, cy = 70, 312
frame = Image.new("RGBA", (crop.width + 24, crop.height + 24), (0, 0, 0, 0))
ImageDraw.Draw(frame).rounded_rectangle((0, 0, frame.width - 1, frame.height - 1), radius=18, fill=(14, 18, 26, 255), outline=(60, 80, 110, 255), width=2)
shadow = Image.new("RGBA", (frame.width + 80, frame.height + 80), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((40, 50, frame.width + 40, frame.height + 50), radius=22, fill=(0, 0, 0, 170))
shadow = shadow.filter(ImageFilter.GaussianBlur(28))
canvas.alpha_composite(shadow, (cx - 40, cy - 40))
canvas.alpha_composite(frame, (cx - 12, cy - 12))
mask = Image.new("L", crop.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, crop.width - 1, crop.height - 1), radius=12, fill=255)
canvas.paste(crop.convert("RGBA"), (cx, cy), mask)
# bottom fade (card runs off the canvas)
fade_h = 140
fade = Image.new("RGBA", (crop.width, fade_h), (0, 0, 0, 0))
for i in range(fade_h):
    ImageDraw.Draw(fade).line((0, i, crop.width, i), fill=(7, 10, 16, int(255 * (i / fade_h) ** 1.5)))
canvas.alpha_composite(fade, (cx, H - fade_h))

# highlight the indicator toolbar (measured on the crop: [515,175,815,205] in the 1100 crop → minus crop origin)
s = card_w / 831
def hl(x0, y0, x1, y1, label):
    box = (cx + (x0 - 85) * s, cy + (y0 - 72) * s, cx + (x1 - 85) * s, cy + (y1 - 72) * s)
    d.rounded_rectangle(box, radius=8, outline=GREEN, width=3)
    f = ImageFont.truetype(MONO, 15)
    tw = d.textlength(label, font=f)
    lx, ly = box[0], box[1] - 30
    d.rounded_rectangle((lx, ly, lx + tw + 16, ly + 24), radius=6, fill=GREEN)
    d.text((lx + 8, ly + 4), label, font=f, fill=(6, 20, 10))
hl(566, 137, 912, 170, "NEW · TA toolbar")

# ---- robot analyst (right), overlapping the card edge slightly is fine — lens + stylus point at the chart
robot = Image.open(SRC + "robot_analyst.png").convert("RGBA")
rw = 540
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
rx, ry = W - rw + 10, H - robot.height + 40
canvas.alpha_composite(robot, (rx, ry))

# ---- footer
f_foot = ImageFont.truetype(MONO, 20)
foot = "arctools.fun/trade  ·  @arctoolsfun"
d.text((W - 70 - d.textlength(foot, font=f_foot), 62), foot, font=f_foot, fill=(140, 150, 165))

canvas.convert("RGB").save(OUT, quality=95)
print(OUT)
