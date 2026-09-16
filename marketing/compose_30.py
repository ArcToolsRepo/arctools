from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/30-terminal-update.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
COBALT = (46, 124, 255); GREEN = (34, 197, 128); INK = (245, 247, 250); MUTED = (170, 184, 204)

canvas = Image.new("RGBA", (W, H), (6, 9, 16, 255))
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((950, 200, 1900, 1100), fill=(*COBALT, 70)); gd.ellipse((-300, -300, 700, 500), fill=(*GREEN, 30))
canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(160)))
for x in range(0, W, 40): d.line((x, 0, x, H), fill=(255, 255, 255, 5))
for y in range(0, H, 40): d.line((0, y, W, y), fill=(255, 255, 255, 5))

# header
d.text((70, 52), "ARCTOOLS · TERMINAL UPDATE", font=ImageFont.truetype(MONO, 18), fill=MUTED)
f_h = ImageFont.truetype(RB, 48)
d.text((70, 82), "PRO CHARTS.", font=f_h, fill=INK)
d.text((70, 138), "SELF-HEALING DATA.", font=f_h, fill=COBALT)
f_b = ImageFont.truetype(RB, 19); f_bs = ImageFont.truetype(RR, 14)
items = [
    ("TradingView-grade chart", "6 chart types · EMA / BB / VWAP / RSI / MACD\nfib · trend · ray · measure · resize · fullscreen · PNG"),
    ("Every row filled, every time", "MC, liquidity, Score, dev/bundle checked every\n3 minutes and repaired automatically"),
    ("Sniper bot: instant panels", "Maestro-style buy & position cards, live MC/liq,\nfills in ~5 s, right venue every time"),
    ("Five languages, light & dark", "English · Chinese · Spanish · Russian · Polish\nadd ?lang=xx to any link"),
]
for i, (t, sub) in enumerate(items):
    y = 208 + i * 70
    d.rectangle((70, y + 6, 80, y + 16), fill=GREEN if i % 2 == 0 else COBALT)
    d.text((92, y - 2), t, font=f_b, fill=INK); d.multiline_text((92, y + 24), sub, font=f_bs, fill=MUTED, spacing=2)

# "desktop app in the works" badge
by = 500
d.rounded_rectangle((70, by, 560, by + 78), radius=12, fill=(14, 20, 34, 230), outline=(*COBALT, 200), width=2)
d.rounded_rectangle((88, by + 22, 112, by + 40), radius=3, outline=COBALT, width=2); d.line((94, by + 46, 106, by + 46), fill=COBALT, width=2); d.line((100, by + 40, 100, by + 46), fill=COBALT, width=2)
d.text((128, by + 12), "DESKTOP APP — IN THE WORKS", font=ImageFont.truetype(RB, 20), fill=INK)
d.text((128, by + 42), "The Terminal as a native Windows / macOS app. More info soon.", font=ImageFont.truetype(RR, 15), fill=MUTED)

def card(img, x, y, w, border):
    im = img.convert("RGBA"); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    mask = Image.new("L", im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=14, fill=255)
    fr = Image.new("RGBA", (im.width + 4, im.height + 4), (0, 0, 0, 0))
    ImageDraw.Draw(fr).rounded_rectangle((0, 0, fr.width - 1, fr.height - 1), radius=16, fill=(*border, 255))
    fr.paste(im, (2, 2), mask)
    sh = Image.new("RGBA", (fr.width + 90, fr.height + 90), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((45, 55, fr.width + 45, fr.height + 55), radius=20, fill=(0, 0, 0, 200))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)), (x - 45, y - 45))
    canvas.alpha_composite(fr, (x - 2, y - 2)); return fr.size

# real terminal screenshot (table area) + chart screenshot stacked
term = Image.open(SRC + "term_final_dark.png").convert("RGB").crop((230, 470, 1500, 1000))
chart = Image.open(SRC + "chart_pro7.png").convert("RGB")
s1 = card(term, 600, 56, 640, (60, 90, 140))
s2 = card(chart, 620, 56 + s1[1] + 20, 560, (60, 90, 140))
fh = 120
fade = Image.new("RGBA", (W, fh), (0, 0, 0, 0))
for i in range(fh): ImageDraw.Draw(fade).line((0, i, W, i), fill=(6, 9, 16, int(255 * (i / fh) ** 1.5)))
canvas.alpha_composite(fade, (0, H - fh))

# robot
robot = Image.open(SRC + "robot_arc.png").convert("RGBA"); rw = 360
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
canvas.alpha_composite(robot, (W - rw - 10, H - robot.height + 60))

# footer
logo = Image.open(LOGO).convert("RGBA"); lh = 32; logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
canvas.alpha_composite(logo, (70, H - 78))
d.text((70 + logo.width + 12, H - 78), "arctools.fun/trade", font=ImageFont.truetype(MONO, 22), fill=INK)
d.text((70 + logo.width + 12, H - 50), "@arctoolsfun · Sniper bot @ArcSniper_bot", font=ImageFont.truetype(RR, 15), fill=MUTED)
canvas.convert("RGB").save(OUT, quality=95); print(OUT, s1, s2)
