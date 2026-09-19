"""Token page rendered in the DexScreener layout, 1:1 on the measured geometry of the reference screenshot.

Column widths, paddings and palette were measured off the user's DexScreener capture (1876x897) and scaled to
1920x1080: rail 250, chart toolbar 72, chart to x=1535, right column 385. Numbers are ARGUS's real figures.
Only the left rail differs by intent: chains become launchpads, each one linking into the Terminal list.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
RAIL_W, TOOL_W, RIGHT_X = 250, 72, 1535

# sampled off the reference screenshot, not guessed
BG_TOP = (23, 23, 28)        # #17171c  right column + top bar
BG_RAIL = (17, 17, 22)       # #111116  left rail
BG_MAIN = (19, 23, 34)       # #131722  chart canvas
BG_PANEL = (21, 25, 36)
LINE = (42, 46, 57)
INK = (233, 237, 245)
MUTED = (137, 146, 163)
DIM = (104, 112, 128)
UP = (8, 153, 129)           # TradingView teal, the reference's candle green
UP_TXT = (72, 187, 120)
DOWN = (242, 54, 69)
BLUE = (41, 98, 255)
GOLD = (245, 197, 66)

B = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
R = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
f = lambda s, p=R: ImageFont.truetype(p, s)

img = Image.new("RGB", (W, H), BG_MAIN)
d = ImageDraw.Draw(img)


def text(xy, s, size=12, color=INK, bold=False, anchor=None):
    d.text(xy, s, font=f(size, B if bold else R), fill=color, anchor=anchor)


def panel(box, fill=BG_PANEL, outline=LINE, radius=6):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline)


# ---------------------------------------------------------------- top bar
d.rectangle((0, 0, W, 36), fill=BG_TOP)
text((14, 10), "ArcTools", 15, INK, True)
d.line((RAIL_W, 0, RAIL_W, H), fill=LINE)
x = RAIL_W + 14
for i, (sym, chg, up) in enumerate([("USDC", "200%", True), ("ARGUS", "41%", True), ("TOLLY", "-16%", False),
                                    ("MURMUR", "260%", True), ("LEAP", "-99%", False), ("MI", "18%", True)]):
    text((x, 11), f"#{i + 1}", 11, DIM)
    x += 22
    d.ellipse((x, 12, x + 12, 24), fill=(60, 70, 96))
    x += 17
    text((x, 10), sym, 12, INK, True)
    x += d.textlength(sym, font=f(12, B)) + 6
    text((x, 10), chg, 12, UP_TXT if up else DOWN, True)
    x += d.textlength(chg, font=f(12, B)) + 22
text((RIGHT_X + 16, 10), "ARGUS", 13, INK, True)

# ---------------------------------------------------------------- left rail
d.rectangle((0, 0, RAIL_W, H), fill=BG_RAIL)
text((14, 11), "ArcTools", 15, INK, True)
panel((12, 44, RAIL_W - 12, 74), fill=(30, 30, 36), radius=8)
d.ellipse((24, 54, 36, 66), outline=MUTED)
d.line((35, 65, 40, 70), fill=MUTED, width=2)
text((46, 53), "Search token or CA", 12, DIM)

y = 92
for icon, label in (("star", "Watchlist"), ("bell", "Alerts"), ("grid", "Multicharts"), ("spark", "New pairs"),
                    ("arrows", "Gainers & losers"), ("eye", "Insiders"), ("swap", "Swap")):
    ix, iy = 26, y + 7
    if icon == "star":
        d.polygon([(ix, iy - 7), (ix + 2, iy - 2), (ix + 7, iy - 2), (ix + 3, iy + 1), (ix + 5, iy + 6),
                   (ix, iy + 3), (ix - 5, iy + 6), (ix - 3, iy + 1), (ix - 7, iy - 2), (ix - 2, iy - 2)], fill=MUTED)
    elif icon == "bell":
        d.pieslice((ix - 6, iy - 7, ix + 6, iy + 5), 180, 360, fill=MUTED); d.rectangle((ix - 6, iy - 1, ix + 6, iy + 3), fill=MUTED)
        d.rectangle((ix - 1, iy + 4, ix + 1, iy + 6), fill=MUTED)
    elif icon == "grid":
        for gx in (-6, 1):
            for gy in (-6, 1):
                d.rectangle((ix + gx, iy + gy, ix + gx + 5, iy + gy + 5), fill=MUTED)
    elif icon == "spark":
        d.line((ix - 7, iy + 5, ix - 2, iy - 2), fill=MUTED); d.line((ix - 2, iy - 2, ix + 2, iy + 2), fill=MUTED)
        d.line((ix + 2, iy + 2, ix + 7, iy - 6), fill=MUTED)
    elif icon == "arrows":
        d.line((ix - 4, iy + 6, ix - 4, iy - 6), fill=MUTED); d.polygon([(ix - 7, iy - 3), (ix - 1, iy - 3), (ix - 4, iy - 7)], fill=MUTED)
        d.line((ix + 4, iy - 6, ix + 4, iy + 6), fill=MUTED); d.polygon([(ix + 1, iy + 3), (ix + 7, iy + 3), (ix + 4, iy + 7)], fill=MUTED)
    elif icon == "eye":
        d.ellipse((ix - 8, iy - 5, ix + 8, iy + 5), outline=MUTED); d.ellipse((ix - 2, iy - 2, ix + 2, iy + 2), fill=MUTED)
    elif icon == "swap":
        d.line((ix - 7, iy - 3, ix + 7, iy - 3), fill=MUTED); d.polygon([(ix + 4, iy - 7), (ix + 8, iy - 3), (ix + 4, iy + 1)], fill=MUTED)
        d.line((ix - 7, iy + 4, ix + 7, iy + 4), fill=MUTED); d.polygon([(ix - 4, iy), (ix - 8, iy + 4), (ix - 4, iy + 8)], fill=MUTED)
    text((46, y), label, 13, (205, 212, 224))
    y += 34

y += 6
d.line((12, y, RAIL_W - 12, y), fill=LINE)
y += 12
text((20, y), "LAUNCHPADS", 10, DIM, True)
y += 20
PADS = [("Arguspad", "2 500", (124, 92, 255), True), ("Lift", "2 500", (34, 197, 94), False),
        ("UBI.fun", "1 557", (245, 197, 66), False), ("Minara", "1 536", (255, 110, 169), False),
        ("Tolly", "1 477", (47, 214, 196), False), ("Uniswap V4", "1 219", (255, 122, 198), False),
        ("long.supply", "867", (124, 196, 255), False), ("faze.fun", "853", (255, 159, 69), False),
        ("peach.ag", "788", (255, 179, 167), False), ("RadarDex", "500", (94, 224, 160), False),
        ("Warp", "355", (154, 166, 255), False), ("pools.trade", "288", (111, 208, 255), False),
        ("DYORSwap", "278", (214, 179, 94), False), ("Hopium", "19", (255, 94, 138), False)]
for name, n, col, active in PADS:
    if active:
        d.rectangle((0, y - 6, RAIL_W, y + 22), fill=(28, 44, 74))
        d.rectangle((0, y - 6, 3, y + 22), fill=BLUE)
    d.rounded_rectangle((18, y - 1, 36, y + 17), radius=5, fill=col)
    text((27, y + 2), name[:2].upper(), 9, (12, 14, 20), True, anchor="ma")
    text((46, y), name, 12.5 if not active else 13, INK if active else (198, 206, 219), active)
    text((RAIL_W - 16, y + 1), n, 10.5, (200, 214, 240) if active else DIM, anchor="ra")
    y += 28

d.line((0, H - 40, RAIL_W, H - 40), fill=LINE)
text((18, H - 28), "anon", 12, MUTED)
text((RAIL_W - 18, H - 28), "Connect", 12, BLUE, anchor="ra")

# ---------------------------------------------------------------- chart toolbar (vertical)
d.rectangle((RAIL_W, 36, RAIL_W + TOOL_W, H), fill=(19, 22, 31))
d.line((RAIL_W + TOOL_W, 36, RAIL_W + TOOL_W, H), fill=LINE)
ty = 62
cx_t = RAIL_W + TOOL_W // 2
for kind in ("cross", "line", "hline", "fib", "brush", "text", "shape", "ruler", "magnet", "lock", "eye"):
    c = DIM
    if kind == "cross":
        d.line((cx_t - 8, ty, cx_t + 8, ty), fill=c); d.line((cx_t, ty - 8, cx_t, ty + 8), fill=c)
    elif kind == "line":
        d.line((cx_t - 8, ty + 7, cx_t + 8, ty - 7), fill=c); d.ellipse((cx_t - 10, ty + 5, cx_t - 6, ty + 9), outline=c)
    elif kind == "hline":
        for k in (-6, 0, 6):
            d.line((cx_t - 9, ty + k, cx_t + 9, ty + k), fill=c)
    elif kind == "fib":
        for k, wdt in ((-7, 9), (-2, 7), (3, 5), (8, 3)):
            d.line((cx_t - wdt, ty + k, cx_t + wdt, ty + k), fill=c)
    elif kind == "brush":
        d.arc((cx_t - 9, ty - 9, cx_t + 9, ty + 9), 200, 20, fill=c)
    elif kind == "text":
        d.line((cx_t - 7, ty - 7, cx_t + 7, ty - 7), fill=c); d.line((cx_t, ty - 7, cx_t, ty + 8), fill=c)
    elif kind == "shape":
        d.polygon([(cx_t, ty - 8), (cx_t + 8, ty + 7), (cx_t - 8, ty + 7)], outline=c)
    elif kind == "ruler":
        d.rectangle((cx_t - 9, ty - 5, cx_t + 9, ty + 5), outline=c)
        for k in (-4, 0, 4):
            d.line((cx_t + k, ty - 5, cx_t + k, ty - 1), fill=c)
    elif kind == "magnet":
        d.arc((cx_t - 8, ty - 8, cx_t + 8, ty + 8), 180, 360, fill=c)
        d.line((cx_t - 8, ty, cx_t - 8, ty + 7), fill=c); d.line((cx_t + 8, ty, cx_t + 8, ty + 7), fill=c)
    elif kind == "lock":
        d.rectangle((cx_t - 6, ty - 1, cx_t + 6, ty + 8), outline=c)
        d.arc((cx_t - 5, ty - 9, cx_t + 5, ty + 3), 180, 360, fill=c)
    elif kind == "eye":
        d.ellipse((cx_t - 9, ty - 5, cx_t + 9, ty + 5), outline=c); d.ellipse((cx_t - 3, ty - 3, cx_t + 3, ty + 3), fill=c)
    ty += 40

# ---------------------------------------------------------------- chart header
CX0 = RAIL_W + TOOL_W
d.rectangle((CX0, 36, RIGHT_X, 74), fill=BG_MAIN)
d.line((CX0, 74, RIGHT_X, 74), fill=LINE)
x = CX0 + 16
for tf in ("1s", "1m", "5m", "15m", "1h", "4h", "D"):
    on = tf == "15m"
    text((x, 48), tf, 12, BLUE if on else MUTED, on)
    x += d.textlength(tf, font=f(12, B)) + 18
x += 10
for g in ("wave", "compare", "fx", "layout"):
    if g == "wave":
        d.line([(x, 56), (x + 5, 49), (x + 10, 57), (x + 15, 50)], fill=MUTED)
    elif g == "compare":
        d.line((x + 4, 47, x + 4, 59), fill=MUTED); d.polygon([(x + 1, 50), (x + 7, 50), (x + 4, 46)], fill=MUTED)
        d.line((x + 11, 59, x + 11, 47), fill=MUTED); d.polygon([(x + 8, 56), (x + 14, 56), (x + 11, 60)], fill=MUTED)
    elif g == "fx":
        text((x, 47), "fx", 12, MUTED)
    else:
        for gx in (0, 8):
            for gy in (48, 55):
                d.rectangle((x + gx, gy, x + gx + 6, gy + 5), outline=MUTED)
    x += 30
x += 8
text((x, 48), "Price", 12, BLUE, True); x += 38
text((x, 48), "/ Mcap", 12, MUTED); x += 58
text((x, 48), "USD", 12, BLUE, True); x += 34
text((x, 48), "/ USDC", 12, MUTED); x += 62
d.rectangle((x, 49, x + 11, 59), outline=MUTED)
text((x + 18, 48), "Full", 12, MUTED)
ux = RIGHT_X - 140
for g in ("undo", "redo", "clock", "gear", "cam"):
    if g in ("undo", "redo"):
        d.arc((ux, 47, ux + 13, 60), 150, 30 if g == "undo" else 360, fill=MUTED)
    elif g == "clock":
        d.ellipse((ux, 47, ux + 12, 59), outline=MUTED); d.line((ux + 6, 53, ux + 6, 49), fill=MUTED)
    elif g == "gear":
        d.ellipse((ux + 1, 48, ux + 11, 58), outline=MUTED); d.ellipse((ux + 4, 51, ux + 8, 55), fill=MUTED)
    else:
        d.rectangle((ux, 49, ux + 13, 59), outline=MUTED); d.ellipse((ux + 4, 51, ux + 9, 56), outline=MUTED)
    ux += 26

# ---------------------------------------------------------------- chart body
CY0, CY1 = 74, 620
d.rectangle((CX0, CY0, RIGHT_X, CY1), fill=BG_MAIN)
text((CX0 + 14, CY0 + 12), "ARGUS/USDC on Uniswap V4 · 15m · arctools.fun", 12, MUTED)
text((CX0 + 420, CY0 + 12), "O", 11, DIM); text((CX0 + 432, CY0 + 12), "0.01921", 11, UP_TXT)
text((CX0 + 492, CY0 + 12), "H", 11, DIM); text((CX0 + 504, CY0 + 12), "0.01960", 11, UP_TXT)
text((CX0 + 564, CY0 + 12), "L", 11, DIM); text((CX0 + 574, CY0 + 12), "0.01918", 11, UP_TXT)
text((CX0 + 634, CY0 + 12), "C", 11, DIM); text((CX0 + 646, CY0 + 12), "0.01954  +1.72%", 11, UP_TXT)
text((CX0 + 14, CY0 + 34), "Volume  2.84M", 11, (140, 180, 230))

PX0, PX1 = CX0 + 14, RIGHT_X - 96
GY0, GY1 = CY0 + 62, CY1 - 150
VY0, VY1 = CY1 - 140, CY1 - 34
import random
random.seed(11)
n = 58
step = (PX1 - PX0) / n
price = 0.4
series = []
for i in range(n):
    drift = 0.011 + (0.02 if i > 34 else 0)
    price = max(0.05, min(0.97, price + random.uniform(-0.035, 0.035) + drift))
    series.append(price)
for i, p in enumerate(series):
    o = series[i - 1] if i else p - 0.01
    hi = max(o, p) + random.uniform(0.004, 0.02)
    lo = min(o, p) - random.uniform(0.004, 0.02)
    up = p >= o
    col = UP if up else DOWN
    cx = PX0 + i * step + step / 2
    yv = lambda v: GY1 - (GY1 - GY0) * v
    d.line((cx, yv(hi), cx, yv(lo)), fill=col, width=1)
    bw = max(3, step * 0.55)
    d.rectangle((cx - bw / 2, yv(max(o, p)), cx + bw / 2, yv(min(o, p))), fill=col)
    vh = (VY1 - VY0) * (0.18 + abs(p - o) * 9 + random.uniform(0, .35))
    d.rectangle((cx - bw / 2, VY1 - min(vh, VY1 - VY0), cx + bw / 2, VY1), fill=col + (0,) if False else col)

for i in range(6):
    gy = GY0 + (GY1 - GY0) * i / 5
    d.line((PX0, gy, PX1, gy), fill=(34, 38, 50))
    text((PX1 + 10, gy - 6), f"0.0{1900 + (5 - i) * 18}", 10, DIM)
d.rectangle((PX1 + 6, GY1 - (GY1 - GY0) * series[-1] - 9, RIGHT_X - 10, GY1 - (GY1 - GY0) * series[-1] + 9), fill=UP)
text((PX1 + 12, GY1 - (GY1 - GY0) * series[-1] - 7), "0.01954", 10, (8, 24, 16), True)
for i, t in enumerate(("10:15", "10:50", "11:25", "12:00", "12:35")):
    text((PX0 + 60 + i * (PX1 - PX0 - 150) / 4, CY1 - 26), t, 10, DIM, anchor="ma")

text((PX1 - 8, CY1 - 44), "12:47:03 (UTC+2)", 10, DIM, anchor="ra")

# ---------------------------------------------------------------- bottom: tabs + transactions
TY = CY1
d.line((CX0, TY, RIGHT_X, TY), fill=LINE)
x = CX0 + 16
for i, (icon, label, count) in enumerate((("", "Transactions", "15 780"), ("", "Top traders", "2 787"),
                                          ("", "Holders", "812"), ("", "Bubbles", ""), ("", "Dev", "4"))):
    on = i == 0
    text((x, TY + 14), label, 12.5, INK if on else MUTED, on)
    wlab = d.textlength(label, font=f(12.5, B if on else R))
    if count:
        text((x + 8 + wlab, TY + 14), count, 10.5, DIM)
        wlab += d.textlength(count, font=f(10.5)) + 8
    if on:
        d.line((x, TY + 36, x + wlab, TY + 36), fill=BLUE, width=2)
    x += wlab + 30

HY = TY + 46
d.line((CX0, HY + 22, RIGHT_X, HY + 22), fill=LINE)
cols = [(CX0 + 16, "DATE"), (CX0 + 190, "TYPE"), (CX0 + 330, "USD"), (CX0 + 500, "ARGUS"),
        (CX0 + 690, "USDC"), (CX0 + 860, "PRICE"), (CX0 + 1010, "TRADER"), (RIGHT_X - 80, "TXN")]
for cx, label in cols:
    text((cx, HY + 4), label, 10.5, DIM, True)
rows = [("12s ago", "Buy", "412.80", "21 120", "412.80", "$0.01954", "0x7a3e…c1b4"),
        ("38s ago", "Sell", "96.10", "4 918", "96.10", "$0.01954", "whale.arc"),
        ("1m ago", "Buy", "1 204.55", "61 640", "1 204.55", "$0.01953", "0x19bd…88fa"),
        ("1m ago", "Buy", "58.00", "2 969", "58.00", "$0.01953", "0xcc21…4d02"),
        ("2m ago", "Sell", "330.42", "16 920", "330.42", "$0.01952", "0x51aa…9e77"),
        ("2m ago", "Buy", "74.20", "3 800", "74.20", "$0.01952", "0x88fe…21aa"),
        ("3m ago", "Buy", "2 010.00", "102 950", "2 010.00", "$0.01952", "kolwallet.arc"),
        ("3m ago", "Sell", "145.70", "7 463", "145.70", "$0.01951", "0x2b40…77c9"),
        ("4m ago", "Buy", "505.00", "25 880", "505.00", "$0.01951", "0x9d1c…3ef0"),
        ("4m ago", "Sell", "63.90", "3 275", "63.90", "$0.01950", "0x4fa7…b620")]
ry = HY + 32
for date, side, usd, tok, usdc, price, trader in rows:
    col = UP_TXT if side == "Buy" else DOWN
    text((CX0 + 16, ry), date, 11.5, MUTED)
    ax, ay_ = CX0 + 190, ry + 7
    if side == "Buy":
        d.polygon([(ax, ay_ - 5), (ax + 5, ay_ + 2), (ax - 5, ay_ + 2)], fill=col)
    else:
        d.polygon([(ax - 5, ay_ - 2), (ax + 5, ay_ - 2), (ax, ay_ + 5)], fill=col)
    text((CX0 + 204, ry), side, 11.5, col)
    for cx, val in ((CX0 + 330, usd), (CX0 + 500, tok), (CX0 + 690, usdc), (CX0 + 860, price)):
        text((cx, ry), val, 11.5, col)
    text((CX0 + 1010, ry), trader, 11.5, (130, 170, 235))
    d.rectangle((RIGHT_X - 78, ry + 2, RIGHT_X - 68, ry + 12), outline=DIM)
    d.line((RIGHT_X - 74, ry + 8, RIGHT_X - 66, ry), fill=DIM)
    ry += 30
    if ry > H - 20:
        break

# ---------------------------------------------------------------- right column
d.rectangle((RIGHT_X, 36, W, H), fill=BG_TOP)
d.line((RIGHT_X, 36, RIGHT_X, H), fill=LINE)
rx0, rx1 = RIGHT_X + 12, W - 12
text((rx0, 52), "ARGUS", 15, INK, True)
d.rectangle((rx0 + 68, 55, rx0 + 77, 64), outline=DIM)
text((rx0 + 92, 52), "/ USDC", 14, MUTED)
text((rx1, 53), "15m", 11, UP_TXT, anchor="ra")
d.ellipse((rx0, 76, rx0 + 12, 88), fill=(58, 66, 86))
text((rx0 + 18, 76), "Arc", 11.5, MUTED)
text((rx0 + 48, 76), ">", 11.5, DIM)
text((rx0 + 62, 76), "Uniswap", 11.5, (180, 190, 210))
text((rx0 + 120, 76), "V4", 11.5, DIM)


def tile(box, label, value, vcolor=INK, vsize=17):
    panel(box)
    text((box[0] + 10, box[1] + 8), label, 9.5, DIM, True)
    text((box[0] + 10, box[1] + 24), value, vsize, vcolor, True)


tile((rx0, 96, rx0 + 178, 150), "PRICE USD", "$0.01954")
tile((rx0 + 186, 96, rx1, 150), "PRICE", "0.01954 USDC", vsize=14)
w3 = (rx1 - rx0 - 12) / 3
for i, (lab, val) in enumerate((("LIQUIDITY", "$579.6K"), ("FDV", "$18.74M"), ("MKT CAP", "$18.74M"))):
    tile((rx0 + i * (w3 + 6), 156, rx0 + i * (w3 + 6) + w3, 208), lab, val, vsize=15)
w4 = (rx1 - rx0 - 18) / 4
for i, (lab, val, c) in enumerate((("5M", "+2.7%", UP_TXT), ("1H", "+7.8%", UP_TXT), ("6H", "+37.8%", UP_TXT), ("24H", "+112%", UP_TXT))):
    bx = rx0 + i * (w4 + 6)
    panel((bx, 214, bx + w4, 266), fill=(34, 38, 52) if i == 3 else BG_PANEL)
    text((bx + w4 / 2, 222), lab, 9.5, DIM, True, anchor="ma")
    text((bx + w4 / 2, 238), val, 13, c, True, anchor="ma")

by = 278


def stat_block(y, left_label, left_value, a_label, a_val, b_label, b_val, ratio):
    text((rx0 + 2, y), left_label, 9.5, DIM, True)
    text((rx0 + 2, y + 16), left_value, 15, INK, True)
    text((rx0 + 118, y), a_label, 9.5, DIM, True)
    text((rx1 - 2, y), b_label, 9.5, DIM, True, anchor="ra")
    text((rx0 + 118, y + 16), a_val, 12.5, INK)
    text((rx1 - 2, y + 16), b_val, 12.5, INK, anchor="ra")
    bar_y = y + 40
    d.rectangle((rx0 + 118, bar_y, rx1, bar_y + 4), fill=DOWN)
    d.rectangle((rx0 + 118, bar_y, rx0 + 118 + (rx1 - rx0 - 118) * ratio, bar_y + 4), fill=UP_TXT)
    d.line((rx0, y + 58, rx1, y + 58), fill=(38, 42, 54))


stat_block(by, "TXNS", "15 780", "BUYS", "8 245", "SELLS", "7 535", 0.522)
stat_block(by + 68, "VOLUME", "$2.84M", "BUY VOL", "$1.52M", "SELL VOL", "$1.32M", 0.535)
stat_block(by + 136, "TRADERS", "2 787", "BUYERS", "1 903", "SELLERS", "1 512", 0.557)

ay = by + 208
panel((rx0, ay, rx0 + (rx1 - rx0) / 2 - 4, ay + 44))
text((rx0 + ((rx1 - rx0) / 2 - 4) / 2, ay + 14), "Watchlist", 12.5, INK, anchor="ma")
panel((rx0 + (rx1 - rx0) / 2 + 4, ay, rx1, ay + 44))
text((rx0 + (rx1 - rx0) / 2 + 4 + ((rx1 - rx0) / 2 - 4) / 2, ay + 14), "Alerts", 12.5, INK, anchor="ma")

ay += 54
d.rounded_rectangle((rx0, ay, rx1, ay + 40), radius=6, fill=BLUE)
text(((rx0 + rx1) / 2, ay + 11), "Buy ARGUS", 13.5, (255, 255, 255), True, anchor="ma")

ay += 54
panel((rx0, ay, rx1, ay + 168))
text((rx0 + 12, ay + 12), "SAFETY", 9.5, DIM, True)
checks = (("Sell simulation", "passed · 100%", UP_TXT), ("Liquidity", "locked · LP burned", UP_TXT),
          ("Dev holdings", "4.1% · 2 wallets", GOLD), ("Bundle at launch", "none detected", UP_TXT),
          ("Top 10 holders", "31.4%", GOLD), ("Score", "78 / 100", UP_TXT))
cy = ay + 34
for label, val, c in checks:
    text((rx0 + 12, cy), label, 11.5, MUTED)
    text((rx1 - 12, cy), val, 11.5, c, anchor="ra")
    cy += 22

img.save("token-ds-mockup.png", quality=96)
print("token-ds-mockup.png", img.size)
print("rail 0-%d | toolbar %d-%d | chart %d-%d | right %d-%d" % (RAIL_W, RAIL_W, CX0, CX0, RIGHT_X, RIGHT_X, W))
