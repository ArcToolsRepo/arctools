from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/23-new-launchpads.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
GREEN = (34, 197, 94)

canvas = Image.new("RGBA", (W, H), (9, 12, 18, 255))
d = ImageDraw.Draw(canvas)
# subtle radial glow top-left + grid
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((-300, -300, 900, 700), fill=(34, 197, 94, 40))
gd.ellipse((1000, 300, 1900, 1200), fill=(20, 120, 200, 35))
glow = glow.filter(ImageFilter.GaussianBlur(160))
canvas.alpha_composite(glow)
for x in range(0, W, 40):
    d.line((x, 0, x, H), fill=(255, 255, 255, 6))
for y in range(0, H, 40):
    d.line((0, y, W, y), fill=(255, 255, 255, 6))

# ---- headline
f_kick = ImageFont.truetype(MONO, 22)
f_h1 = ImageFont.truetype(RB, 60)
f_sub = ImageFont.truetype(RR, 26)
d.text((72, 58), "TERMINAL UPDATE", font=f_kick, fill=GREEN)
d.text((70, 92), "5 more Arc launchpads", font=f_h1, fill=(245, 247, 250))
d.text((70, 160), "in one Terminal", font=f_h1, fill=(245, 247, 250))
d.text((70, 240), "Lift · eve.fun · Ellipse · Sashimi · aka.fun — logos, market cap, volume,", font=f_sub, fill=(200, 210, 222))
d.text((70, 274), "liquidity and Score for every launch, plus a new ALL tab per launchpad.", font=f_sub, fill=(200, 210, 222))

# ---- screenshot card (real Terminal: chips row + framed tabs + top rows)
shot = Image.open(SRC + "term_lift_full2.png").convert("RGBA")
# crop: source chips row through first ~6 table rows (coordinates from the 1497-wide capture, offset 180,180 on the QA crop)
crop = shot.crop((230, 225, 1130, 770))          # 900 x 660 (DOM-measured: chips y237-261, tabs y298-346, rows from y517)
card_w = 930
crop = crop.resize((card_w, int(crop.height * card_w / crop.width)), Image.LANCZOS)
cx, cy = 70, 335
# frame
frame = Image.new("RGBA", (crop.width + 24, crop.height + 24), (0, 0, 0, 0))
fd = ImageDraw.Draw(frame)
fd.rounded_rectangle((0, 0, frame.width - 1, frame.height - 1), radius=18, fill=(16, 20, 28, 255), outline=(60, 70, 85, 255), width=2)
shadow = Image.new("RGBA", (frame.width + 80, frame.height + 80), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle((40, 50, frame.width + 40, frame.height + 50), radius=22, fill=(0, 0, 0, 170))
shadow = shadow.filter(ImageFilter.GaussianBlur(28))
canvas.alpha_composite(shadow, (cx - 40, cy - 40))
canvas.alpha_composite(frame, (cx - 12, cy - 12))
mask = Image.new("L", crop.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, crop.width - 1, crop.height - 1), radius=12, fill=255)
canvas.paste(crop, (cx, cy), mask)
# bottom fade of the card into the background
fade = Image.new("RGBA", (crop.width, 120), (0, 0, 0, 0))
for i in range(120):
    ImageDraw.Draw(fade).line((0, i, crop.width, i), fill=(9, 12, 18, int(255 * (i / 120) ** 1.6)))
canvas.alpha_composite(fade, (cx, min(H - 120, cy + crop.height - 120)))

# highlight boxes over the new chips and the "All · Lift" tab (positions measured on the crop, scaled)
s = card_w / 900
def hl(x0, y0, x1, y1, label=None):
    box = (cx + x0 * s, cy + y0 * s, cx + x1 * s, cy + y1 * s)
    d.rounded_rectangle(box, radius=8, outline=GREEN, width=3)
    if label:
        f = ImageFont.truetype(MONO, 15)
        tw = d.textlength(label, font=f)
        lx, ly = box[2] + 10, box[1] - 2
        d.rounded_rectangle((lx, ly, lx + tw + 16, ly + 24), radius=6, fill=GREEN)
        d.text((lx + 8, ly + 4), label, font=f, fill=(6, 20, 10))
# chips row: 'Lift' .. 'aka.fun' — measured on QA crop at y≈70–105 (crop offset +65 vs this crop) → 5..40 here; x from 'Lift' (~400) to 'aka.fun' (~735)
hl(13, 9, 371, 44, "NEW")
# framed tab bar with 'All · Lift' (QA crop y 150–245 → 85–180 here; button x ~ 20..135)
hl(11, 73, 115, 128, "ALL per launchpad")

# ---- robot with labelled tiles
robot = Image.open(SRC + "robot_pads.png").convert("RGBA")
rw = 560
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
rs = rw / 880
rx, ry = W - rw - 10, H - robot.height + 60
canvas.alpha_composite(robot, (rx, ry))
tiles = [(248, 341, "Lift"), (369, 466, "eve.fun"), (484, 584, "Ellipse"), (598, 698, "Sashimi"), (707, 811, "aka.fun")]
f_tile = ImageFont.truetype(RB, 26)
for y0, y1, name in tiles:
    tcx = rx + 101 * rs
    tcy = ry + (y0 + y1) / 2 * rs
    tw = d.textlength(name, font=f_tile)
    d.text((tcx - tw / 2, tcy - 15), name, font=f_tile, fill=(190, 255, 210))

# ---- footer
f_foot = ImageFont.truetype(MONO, 20)
foot = "arctools.fun/trade  ·  @arctoolsfun"
d.text((W - 70 - d.textlength(foot, font=f_foot), 62), foot, font=f_foot, fill=(140, 150, 165))

canvas.convert("RGB").save(OUT, quality=95)
print(OUT, canvas.size)
