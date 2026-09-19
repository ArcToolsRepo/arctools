"""Token page in the DexScreener layout — refined pass.

Craft notes (what separates this from the first attempt):
  * numeric columns are RIGHT-aligned on a shared baseline grid; that alone reads as "professional"
  * one 4 px spacing rhythm everywhere; panels share exact heights inside a row
  * labels are 9 px uppercase with letter-spacing drawn by hand (PIL has no tracking)
  * the chart is a real OHLC series with a session trend, a separate volume lane with its own baseline,
    a dashed last-price line and a proper right-hand price scale
  * launchpad marks are rounded tiles with a two-tone fill instead of flat squares
Palette and column widths were measured off the reference screenshot.
"""
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
RAIL_W, TOOL_W, RIGHT_X = 248, 70, 1528

BG_TOP = (23, 23, 28)
BG_RAIL = (17, 17, 22)
BG_CHART = (19, 23, 34)
BG_PANEL = (26, 30, 42)
BG_PANEL2 = (30, 34, 47)
LINE = (40, 44, 55)
LINE_SOFT = (31, 35, 46)
INK = (233, 237, 245)
MUTED = (139, 148, 165)
DIM = (101, 109, 125)
UP = (8, 153, 129)
UP_TXT = (72, 187, 120)
DOWN = (242, 54, 69)
DOWN_SOFT = (191, 66, 76)
BLUE = (41, 98, 255)
GOLD = (222, 173, 63)

BOLD = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
REG = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
fonts: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}


def F(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key not in fonts:
        fonts[key] = ImageFont.truetype(BOLD if bold else REG, size)
    return fonts[key]


img = Image.new("RGB", (W, H), BG_CHART)
d = ImageDraw.Draw(img)


def t(xy, s, size=12, color=INK, bold=False, anchor="la"):
    d.text(xy, s, font=F(size, bold), fill=color, anchor=anchor)


def label(xy, s, color=DIM, size=9, track=0.9):
    """Uppercase micro-label with manual letter-spacing — PIL has no tracking and without it these read cheap."""
    x, y = xy
    for ch in s.upper():
        d.text((x, y), ch, font=F(size, True), fill=color)
        x += d.textlength(ch, font=F(size, True)) + track


def panel(box, fill=BG_PANEL, outline=None, radius=6):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline)


def num(xy, s, size=12, color=INK, bold=False):
    """Right-aligned number."""
    t(xy, s, size, color, bold, anchor="ra")


# ═══════════════════════════════════════════════════════════ top bar
d.rectangle((0, 0, W, 38), fill=BG_TOP)
d.line((0, 38, W, 38), fill=LINE)
x = RAIL_W + 16
for i, (sym, chg, up, col) in enumerate([("USDC", "200%", True, (38, 161, 123)), ("ARGUS", "41%", True, (124, 92, 255)),
                                         ("TOLLY", "-16%", False, (47, 214, 196)), ("MURMUR", "260%", True, (255, 159, 69)),
                                         ("LEAP", "-99%", False, (94, 224, 160)), ("MI", "18%", True, (255, 110, 169))]):
    t((x, 12), f"#{i + 1}", 11, DIM)
    x += 21
    d.ellipse((x, 12, x + 14, 26), fill=col)
    t((x + 7, 15), sym[0], 8, (14, 16, 22), True, anchor="ma")
    x += 20
    t((x, 12), sym, 12, INK, True)
    x += d.textlength(sym, font=F(12, True)) + 7
    t((x, 12), chg, 12, UP_TXT if up else DOWN, True)
    x += d.textlength(chg, font=F(12, True)) + 24
    if x > RIGHT_X - 120:
        break
d.rectangle((RIGHT_X, 0, W, 38), fill=BG_TOP)
t((RIGHT_X + 16, 12), "ARGUS", 12.5, MUTED, True)

# ═══════════════════════════════════════════════════════════ left rail
d.rectangle((0, 0, RAIL_W, H), fill=BG_RAIL)
d.line((RAIL_W, 0, RAIL_W, H), fill=LINE)
d.rounded_rectangle((14, 9, 32, 27), radius=5, fill=BLUE)
t((23, 12), "A", 11, (255, 255, 255), True, anchor="ma")
t((40, 11), "ArcTools", 14.5, INK, True)

panel((12, 48, RAIL_W - 12, 78), fill=(28, 28, 34), radius=8)
d.ellipse((24, 57, 36, 69), outline=(120, 128, 144))
d.line((35, 66, 39, 70), fill=(120, 128, 144), width=2)
t((46, 56), "Search token or CA", 12, DIM)
panel((RAIL_W - 34, 55, RAIL_W - 20, 71), fill=(38, 38, 46), radius=4)
t((RAIL_W - 27, 57), "/", 10, DIM, anchor="ma")


def rail_icon(kind, ix, iy, c=MUTED):
    if kind == "star":
        d.polygon([(ix, iy - 7), (ix + 2, iy - 2), (ix + 7, iy - 2), (ix + 3, iy + 1), (ix + 5, iy + 6),
                   (ix, iy + 3), (ix - 5, iy + 6), (ix - 3, iy + 1), (ix - 7, iy - 2), (ix - 2, iy - 2)], fill=c)
    elif kind == "bell":
        d.pieslice((ix - 6, iy - 8, ix + 6, iy + 4), 180, 360, fill=c)
        d.rectangle((ix - 6, iy - 2, ix + 6, iy + 2), fill=c)
        d.rectangle((ix - 7, iy + 2, ix + 7, iy + 3), fill=c)
        d.rectangle((ix - 1, iy + 4, ix + 1, iy + 6), fill=c)
    elif kind == "grid":
        for gx in (-7, 1):
            for gy in (-7, 1):
                d.rounded_rectangle((ix + gx, iy + gy, ix + gx + 6, iy + gy + 6), radius=1, fill=c)
    elif kind == "spark":
        d.line([(ix - 7, iy + 5), (ix - 2, iy - 3), (ix + 2, iy + 2), (ix + 7, iy - 6)], fill=c, width=2)
    elif kind == "arrows":
        d.line((ix - 4, iy + 7, ix - 4, iy - 5), fill=c, width=2)
        d.polygon([(ix - 8, iy - 3), (ix, iy - 3), (ix - 4, iy - 8)], fill=c)
        d.line((ix + 4, iy - 7, ix + 4, iy + 5), fill=c, width=2)
        d.polygon([(ix, iy + 3), (ix + 8, iy + 3), (ix + 4, iy + 8)], fill=c)
    elif kind == "eye":
        d.ellipse((ix - 8, iy - 5, ix + 8, iy + 5), outline=c)
        d.ellipse((ix - 2.5, iy - 2.5, ix + 2.5, iy + 2.5), fill=c)
    elif kind == "swap":
        d.line((ix - 7, iy - 3, ix + 5, iy - 3), fill=c, width=2)
        d.polygon([(ix + 3, iy - 7), (ix + 8, iy - 3), (ix + 3, iy + 1)], fill=c)
        d.line((ix - 5, iy + 4, ix + 7, iy + 4), fill=c, width=2)
        d.polygon([(ix - 3, iy), (ix - 8, iy + 4), (ix - 3, iy + 8)], fill=c)


y = 96
for icon, name in (("star", "Watchlist"), ("bell", "Alerts"), ("grid", "Multicharts"), ("spark", "New pairs"),
                   ("arrows", "Gainers & losers"), ("eye", "Insiders"), ("swap", "Swap")):
    rail_icon(icon, 27, y + 8)
    t((48, y), name, 13, (203, 210, 222))
    y += 33

y += 8
d.line((14, y, RAIL_W - 14, y), fill=LINE)
y += 14
label((18, y), "Launchpads")
num((RAIL_W - 16, y - 1), "15 189", 9.5, DIM, True)
y += 20

PADS = [("Arguspad", "2 500", (124, 92, 255), True), ("Lift", "2 500", (34, 197, 94), False),
        ("UBI.fun", "1 557", (245, 197, 66), False), ("Minara", "1 536", (255, 110, 169), False),
        ("Tolly", "1 477", (47, 214, 196), False), ("Uniswap V4", "1 219", (255, 122, 198), False),
        ("long.supply", "867", (124, 196, 255), False), ("faze.fun", "853", (255, 159, 69), False),
        ("peach.ag", "788", (255, 179, 167), False), ("RadarDex", "500", (94, 224, 160), False),
        ("Warp", "355", (154, 166, 255), False), ("pools.trade", "288", (111, 208, 255), False),
        ("DYORSwap", "278", (214, 179, 94), False), ("Hopium", "19", (255, 94, 138), False)]
for name, n, col, active in PADS:
    row_h = 30
    if active:
        d.rectangle((0, y - 5, RAIL_W, y + row_h - 8), fill=(26, 38, 62))
        d.rectangle((0, y - 5, 2, y + row_h - 8), fill=BLUE)
    dark = tuple(int(c * 0.62) for c in col)
    d.rounded_rectangle((18, y - 1, 37, y + 18), radius=6, fill=dark)
    d.rounded_rectangle((18, y - 1, 37, y + 9), radius=6, fill=col)
    d.rectangle((18, y + 5, 37, y + 9), fill=col)
    t((27.5, y + 3), name[:2].upper(), 9, (16, 18, 24), True, anchor="ma")
    t((48, y + 1), name, 12.5, INK if active else (196, 204, 218), active)
    num((RAIL_W - 16, y + 2), n, 10.5, (188, 206, 240) if active else DIM)
    y += row_h - 4

SY = H - 208
d.line((14, SY - 14, RAIL_W - 14, SY - 14), fill=LINE)
label((18, SY), "Arc network")
for i, (k, v, c) in enumerate((("Block", "21 663 902", INK), ("Index lag", "0 blocks", UP_TXT),
                               ("Swaps 24h", "128 441", INK), ("ARCT burned", "56.02M", GOLD))):
    yy = SY + 22 + i * 22
    t((18, yy), k, 11.5, MUTED)
    num((RAIL_W - 16, yy), v, 11.5, c)
d.line((0, H - 44, RAIL_W, H - 44), fill=LINE)
d.ellipse((16, H - 33, 32, H - 17), fill=(44, 48, 60))
t((42, H - 32), "anon", 12, MUTED)
t((RAIL_W - 16, H - 32), "Connect", 12, BLUE, True, anchor="ra")

# ═══════════════════════════════════════════════════════════ drawing toolbar
CX0 = RAIL_W + TOOL_W
d.rectangle((RAIL_W, 38, CX0, H), fill=(21, 24, 33))
d.line((CX0, 38, CX0, H), fill=LINE)
cx_t = RAIL_W + TOOL_W // 2
ty = 66
for kind in ("cross", "trend", "hline", "fib", "brush", "text", "shape", "ruler", "magnet", "lock", "eye"):
    c = (116, 124, 140)
    if kind == "cross":
        d.line((cx_t - 8, ty, cx_t + 8, ty), fill=c); d.line((cx_t, ty - 8, cx_t, ty + 8), fill=c)
    elif kind == "trend":
        d.line((cx_t - 8, ty + 7, cx_t + 8, ty - 7), fill=c)
        d.ellipse((cx_t - 10, ty + 5, cx_t - 6, ty + 9), outline=c); d.ellipse((cx_t + 6, ty - 9, cx_t + 10, ty - 5), outline=c)
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
        d.ellipse((cx_t - 9, ty - 5, cx_t + 9, ty + 5), outline=c)
        d.ellipse((cx_t - 3, ty - 3, cx_t + 3, ty + 3), fill=c)
    ty += 39

# ═══════════════════════════════════════════════════════════ chart header
d.rectangle((CX0, 38, RIGHT_X, 76), fill=BG_CHART)
d.line((CX0, 76, RIGHT_X, 76), fill=LINE)
x = CX0 + 16
for tf in ("1s", "1m", "5m", "15m", "1h", "4h", "D"):
    on = tf == "15m"
    if on:
        w_ = d.textlength(tf, font=F(12, True))
        d.rounded_rectangle((x - 7, 48, x + w_ + 7, 68), radius=4, fill=(32, 38, 54))
    t((x, 51), tf, 12, BLUE if on else MUTED, on)
    x += d.textlength(tf, font=F(12, on)) + 20
d.line((x - 4, 48, x - 4, 68), fill=LINE)
x += 10
for g in ("wave", "compare", "fx", "layout"):
    c = (128, 136, 152)
    if g == "wave":
        d.line([(x, 62), (x + 5, 54), (x + 10, 62), (x + 15, 53)], fill=c)
    elif g == "compare":
        d.line((x + 4, 52, x + 4, 64), fill=c); d.polygon([(x + 1, 55), (x + 7, 55), (x + 4, 50)], fill=c)
        d.line((x + 11, 64, x + 11, 52), fill=c); d.polygon([(x + 8, 61), (x + 14, 61), (x + 11, 66)], fill=c)
    elif g == "fx":
        t((x, 51), "fx", 12, c)
    else:
        for gx in (0, 8):
            for gy in (52, 59):
                d.rectangle((x + gx, gy, x + gx + 6, gy + 5), outline=c)
    x += 32
d.line((x - 6, 48, x - 6, 68), fill=LINE)
x += 8
t((x, 51), "Price", 12, BLUE, True); x += d.textlength("Price", font=F(12, True)) + 8
t((x, 51), "/", 12, DIM); x += 12
t((x, 51), "Mcap", 12, MUTED); x += d.textlength("Mcap", font=F(12)) + 22
t((x, 51), "USD", 12, BLUE, True); x += d.textlength("USD", font=F(12, True)) + 8
t((x, 51), "/", 12, DIM); x += 12
t((x, 51), "USDC", 12, MUTED); x += d.textlength("USDC", font=F(12)) + 22
d.rectangle((x, 52, x + 11, 63), outline=MUTED)
t((x + 18, 51), "Full", 12, MUTED)

ux = RIGHT_X - 150
for g in ("undo", "redo", "clock", "gear", "cam"):
    c = (128, 136, 152)
    if g in ("undo", "redo"):
        d.arc((ux, 50, ux + 13, 63), 150, 20, fill=c)
        d.polygon([(ux, 53), (ux + 5, 53), (ux + 2, 58)] if g == "undo" else [(ux + 8, 53), (ux + 13, 53), (ux + 11, 58)], fill=c)
    elif g == "clock":
        d.ellipse((ux, 50, ux + 13, 63), outline=c); d.line((ux + 6, 56, ux + 6, 52), fill=c)
    elif g == "gear":
        d.ellipse((ux + 1, 51, ux + 12, 62), outline=c); d.ellipse((ux + 5, 55, ux + 9, 59), fill=c)
    else:
        d.rectangle((ux, 52, ux + 14, 62), outline=c); d.ellipse((ux + 5, 54, ux + 10, 60), outline=c)
    ux += 28

# ═══════════════════════════════════════════════════════════ chart body
CY0, CY1 = 76, 628
d.rectangle((CX0, CY0, RIGHT_X, CY1), fill=BG_CHART)
t((CX0 + 16, CY0 + 13), "ARGUS/USDC on Uniswap V4", 12, (170, 178, 194))
t((CX0 + 196, CY0 + 13), "15m", 12, MUTED)
t((CX0 + 232, CY0 + 13), "arctools.fun", 12, DIM)
ohlc_x = CX0 + 350
for lab, val in (("O", "0.01921"), ("H", "0.01960"), ("L", "0.01918"), ("C", "0.01954")):
    t((ohlc_x, CY0 + 13), lab, 11.5, (126, 134, 150))
    t((ohlc_x + 14, CY0 + 13), val, 11.5, UP_TXT)
    ohlc_x += 86
t((ohlc_x, CY0 + 13), "+1.72%", 11, UP_TXT)
t((CX0 + 16, CY0 + 34), "Volume", 11, DIM)
t((CX0 + 66, CY0 + 34), "2.84M", 11, (140, 180, 230))

PX0, PX1 = CX0 + 16, RIGHT_X - 104
GY0, GY1 = CY0 + 60, CY1 - 168
VY0, VY1 = CY1 - 148, CY1 - 56

random.seed(7)
n = 64
step = (PX1 - PX0) / n
lvl, series = 0.30, []
for i in range(n):
    trend = 0.004 if i < 22 else (0.019 if i < 50 else 0.006)
    lvl = max(0.06, min(0.94, lvl + random.uniform(-0.028, 0.030) + trend))
    o = series[-1][3] if series else lvl - 0.01
    c = lvl
    hi = max(o, c) + random.uniform(0.005, 0.022)
    lo = min(o, c) - random.uniform(0.005, 0.022)
    series.append((o, hi, lo, c))

yv = lambda v: GY1 - (GY1 - GY0) * v
for i in range(7):
    gy = GY0 + (GY1 - GY0) * i / 6
    d.line((PX0, gy, PX1, gy), fill=LINE_SOFT)
    num((RIGHT_X - 16, gy - 6), f"0.0{1906 + (6 - i) * 10}", 10.5, (122, 130, 146))
for i in range(6):
    gx = PX0 + (PX1 - PX0) * i / 5
    d.line((gx, GY0, gx, VY1), fill=LINE_SOFT)

bw = max(3.0, step * 0.62)
for i, (o, hi, lo, c) in enumerate(series):
    up = c >= o
    col = UP if up else DOWN
    cx = PX0 + i * step + step / 2
    d.line((cx, yv(hi), cx, yv(lo)), fill=col)
    top_, bot = yv(max(o, c)), yv(min(o, c))
    if bot - top_ < 1.5:
        bot = top_ + 1.5
    d.rectangle((cx - bw / 2, top_, cx + bw / 2, bot), fill=col)
    vh = (VY1 - VY0) * min(0.95, 0.12 + abs(c - o) * 11 + random.uniform(0, 0.28))
    d.rectangle((cx - bw / 2, VY1 - vh, cx + bw / 2, VY1), fill=col if up else DOWN_SOFT)

last_y = yv(series[-1][3])
for seg in range(PX0, int(PX1), 12):
    d.line((seg, last_y, seg + 6, last_y), fill=(60, 120, 100))
d.rectangle((PX1 + 4, last_y - 10, RIGHT_X - 8, last_y + 10), fill=UP)
num((RIGHT_X - 14, last_y - 6), "0.01954", 10.5, (6, 26, 20), True)
d.line((PX0, VY0 - 8, PX1, VY0 - 8), fill=LINE_SOFT)
d.line((PX0, VY1 + 8, PX1, VY1 + 8), fill=LINE)
for i, lab_ in enumerate(("10:15", "10:50", "11:25", "12:00", "12:35")):
    t((PX0 + 60 + i * (PX1 - PX0 - 140) / 4, CY1 - 26), lab_, 10.5, (122, 130, 146), anchor="ma")
t((RIGHT_X - 14, CY1 - 26), "12:47:03 (UTC+2)", 10.5, (122, 130, 146), anchor="ra")
d.line((PX1, GY0 - 14, PX1, VY1), fill=LINE_SOFT)

# ═══════════════════════════════════════════════════════════ transactions
TY = CY1
d.rectangle((CX0, TY, RIGHT_X, H), fill=BG_CHART)
d.line((CX0, TY, RIGHT_X, TY), fill=LINE)
x = CX0 + 16
for i, (name, count) in enumerate((("Transactions", "15 780"), ("Top traders", "2 787"), ("Holders", "812"),
                                   ("Bubbles", ""), ("Dev", "4"), ("My position", ""))):
    on = i == 0
    wname = d.textlength(name, font=F(12.5, on))
    t((x, TY + 16), name, 12.5, INK if on else MUTED, on)
    wtot = wname
    if count:
        t((x + wname + 8, TY + 16), count, 10.5, (126, 134, 150))
        wtot += 8 + d.textlength(count, font=F(10))
    if on:
        d.line((x - 2, TY + 39, x + wtot + 2, TY + 39), fill=BLUE, width=2)
    x += wtot + 30
d.line((CX0, TY + 40, RIGHT_X, TY + 40), fill=LINE)

HY = TY + 52
COLS = [("DATE", CX0 + 16, "l"), ("TYPE", CX0 + 190, "l"), ("USD", CX0 + 400, "r"), ("ARGUS", CX0 + 580, "r"),
        ("USDC", CX0 + 760, "r"), ("PRICE", CX0 + 920, "r"), ("TRADER", CX0 + 1040, "l"), ("TXN", RIGHT_X - 24, "r")]
for name, cx, align in COLS:
    if align == "r":
        x_end = cx
        wl = d.textlength(name, font=F(9, True))
        label((x_end - wl - 2, HY), name)
    else:
        label((cx, HY), name)
d.line((CX0, HY + 18, RIGHT_X, HY + 18), fill=LINE)

rows = [("12s ago", "Buy", "412.80", "21 120", "412.80", "0.01954", "0x7a3e…c1b4"),
        ("38s ago", "Sell", "96.10", "4 918", "96.10", "0.01954", "whale.arc"),
        ("1m ago", "Buy", "1 204.55", "61 640", "1 204.55", "0.01953", "0x19bd…88fa"),
        ("1m ago", "Buy", "58.00", "2 969", "58.00", "0.01953", "0xcc21…4d02"),
        ("2m ago", "Sell", "330.42", "16 920", "330.42", "0.01952", "0x51aa…9e77"),
        ("2m ago", "Buy", "74.20", "3 800", "74.20", "0.01952", "0x88fe…21aa"),
        ("3m ago", "Buy", "2 010.00", "102 950", "2 010.00", "0.01952", "kolwallet.arc"),
        ("3m ago", "Sell", "145.70", "7 463", "145.70", "0.01951", "0x2b40…77c9"),
        ("4m ago", "Buy", "505.00", "25 880", "505.00", "0.01951", "0x9d1c…3ef0"),
        ("4m ago", "Sell", "63.90", "3 275", "63.90", "0.01950", "0x4fa7…b620"),
        ("5m ago", "Buy", "890.12", "45 650", "890.12", "0.01950", "0x0ac3…5518")]
ry = HY + 28
for i, (date, side, usd, tok, usdc, price, trader) in enumerate(rows):
    if ry + 30 > H:
        break
    col = UP_TXT if side == "Buy" else (232, 96, 100)
    if i % 2:
        d.rectangle((CX0, ry - 6, RIGHT_X, ry + 20), fill=(21, 25, 36))
    t((CX0 + 16, ry), date, 11.5, MUTED)
    ax, ay_ = CX0 + 192, ry + 7
    if side == "Buy":
        d.polygon([(ax, ay_ - 5), (ax + 5, ay_ + 2), (ax - 5, ay_ + 2)], fill=col)
    else:
        d.polygon([(ax - 5, ay_ - 2), (ax + 5, ay_ - 2), (ax, ay_ + 5)], fill=col)
    t((CX0 + 206, ry), side, 11.5, col)
    for cx, val in ((CX0 + 400, usd), (CX0 + 580, tok), (CX0 + 760, usdc), (CX0 + 920, price)):
        num((cx, ry), val, 11.5, col)
    t((CX0 + 1040, ry), trader, 11.5, (128, 166, 232))
    d.rectangle((RIGHT_X - 34, ry + 3, RIGHT_X - 24, ry + 13), outline=DIM)
    d.line((RIGHT_X - 30, ry + 9, RIGHT_X - 22, ry + 1), fill=DIM)
    ry += 29

# ═══════════════════════════════════════════════════════════ right column
d.rectangle((RIGHT_X, 38, W, H), fill=BG_TOP)
d.line((RIGHT_X, 38, RIGHT_X, H), fill=LINE)
rx0, rx1 = RIGHT_X + 14, W - 14

d.ellipse((rx0, 54, rx0 + 26, 80), fill=(86, 64, 190))
t((rx0 + 13, 60), "AR", 10, (255, 255, 255), True, anchor="ma")
t((rx0 + 34, 55), "ARGUS", 15, INK, True)
d.rectangle((rx0 + 100, 60, rx0 + 109, 69), outline=DIM)
t((rx0 + 118, 57), "/ USDC", 13, MUTED)
t((rx1, 58), "15m", 11, UP_TXT, True, anchor="ra")
d.ellipse((rx0, 90, rx0 + 13, 103), fill=(52, 60, 82))
t((rx0 + 6.5, 92), "A", 8, (200, 210, 230), True, anchor="ma")
t((rx0 + 20, 90), "Arc", 11.5, MUTED)
t((rx0 + 48, 90), ">", 11.5, DIM)
d.ellipse((rx0 + 62, 90, rx0 + 75, 103), fill=(226, 96, 168))
t((rx0 + 82, 90), "Uniswap", 11.5, (186, 194, 212))
t((rx0 + 140, 90), "V4", 11.5, DIM)

TOP = 116
panel((rx0, TOP, rx0 + 182, TOP + 64))
label((rx0 + 14, TOP + 12), "Price USD")
t((rx0 + 14, TOP + 30), "$0.01954", 17, INK, True)
panel((rx0 + 190, TOP, rx1, TOP + 64))
label((rx0 + 204, TOP + 12), "Price")
t((rx0 + 204, TOP + 30), "0.01954", 17, INK, True)
t((rx0 + 204 + d.textlength("0.01954", font=F(17, True)) + 6, TOP + 35), "USDC", 10.5, DIM)

R2 = TOP + 70
w3 = (rx1 - rx0 - 12) / 3
for i, (lab_, val) in enumerate((("Liquidity", "$579.6K"), ("FDV", "$18.74M"), ("Mkt Cap", "$18.74M"))):
    bx = rx0 + i * (w3 + 6)
    panel((bx, R2, bx + w3, R2 + 58))
    label((bx + 13, R2 + 12), lab_)
    t((bx + 13, R2 + 30), val, 14.5, INK, True)

R3 = R2 + 64
w4 = (rx1 - rx0 - 18) / 4
for i, (lab_, val) in enumerate((("5M", "+2.70%"), ("1H", "+7.80%"), ("6H", "+37.8%"), ("24H", "+112%"))):
    bx = rx0 + i * (w4 + 6)
    panel((bx, R3, bx + w4, R3 + 52), fill=BG_PANEL2 if i == 3 else BG_PANEL)
    label((bx + w4 / 2 - d.textlength(lab_, font=F(9, True)) / 2 - 1, R3 + 10), lab_, DIM if i != 3 else MUTED)
    t((bx + w4 / 2, R3 + 26), val, 12.5, UP_TXT, True, anchor="ma")

R4 = R3 + 62
panel((rx0, R4, rx1, R4 + 194))


def stat(y, left_lab, left_val, a_lab, a_val, b_lab, b_val, ratio):
    label((rx0 + 12, y), left_lab)
    t((rx0 + 12, y + 15), left_val, 14.5, INK, True)
    label((rx0 + 116, y), a_lab)
    wl = d.textlength(b_lab.upper(), font=F(9, True)) + len(b_lab) * 0.9
    label((rx1 - 12 - wl, y), b_lab)
    t((rx0 + 116, y + 15), a_val, 12.5, INK)
    num((rx1 - 12, y + 15), b_val, 12.5, INK)
    by = y + 38
    d.rectangle((rx0 + 116, by, rx1 - 12, by + 4), fill=DOWN)
    d.rectangle((rx0 + 116, by, rx0 + 116 + (rx1 - 12 - rx0 - 116) * ratio, by + 4), fill=UP_TXT)


stat(R4 + 14, "Txns", "15 780", "Buys", "8 245", "Sells", "7 535", 0.522)
d.line((rx0 + 12, R4 + 76, rx1 - 12, R4 + 76), fill=LINE_SOFT)
stat(R4 + 78, "Volume", "$2.84M", "Buy vol", "$1.52M", "Sell vol", "$1.32M", 0.535)
d.line((rx0 + 12, R4 + 140, rx1 - 12, R4 + 140), fill=LINE_SOFT)
stat(R4 + 142, "Traders", "2 787", "Buyers", "1 903", "Sellers", "1 512", 0.557)

R5 = R4 + 206
half = (rx1 - rx0 - 8) / 2
panel((rx0, R5, rx0 + half, R5 + 42), outline=LINE)
rail_icon("star", rx0 + half / 2 - 34, R5 + 21, (198, 206, 220))
t((rx0 + half / 2 + 8, R5 + 13), "Watchlist", 12.5, INK, anchor="ma")
panel((rx0 + half + 8, R5, rx1, R5 + 42), outline=LINE)
rail_icon("bell", rx0 + half + 8 + half / 2 - 28, R5 + 21, (198, 206, 220))
t((rx0 + half + 8 + half / 2 + 10, R5 + 13), "Alerts", 12.5, INK, anchor="ma")

R6 = R5 + 50
d.rounded_rectangle((rx0, R6, rx1, R6 + 44), radius=6, fill=BLUE)
t(((rx0 + rx1) / 2, R6 + 14), "Buy ARGUS", 13.5, (255, 255, 255), True, anchor="ma")

R7 = R6 + 56
panel((rx0, R7, rx1, R7 + 170))
label((rx0 + 12, R7 + 12), "Safety")
t((rx1 - 12, R7 + 10), "78 / 100", 11.5, UP_TXT, True, anchor="ra")
d.line((rx0 + 12, R7 + 32, rx1 - 12, R7 + 32), fill=LINE_SOFT)
cy = R7 + 42
for lab_, val, c in (("Sell simulation", "passed · 100%", UP_TXT), ("Liquidity", "locked · LP burned", UP_TXT),
                     ("Dev holdings", "4.1% · 2 wallets", GOLD), ("Bundle at launch", "none", UP_TXT),
                     ("Top 10 holders", "31.4%", GOLD)):
    t((rx0 + 12, cy), lab_, 11.5, MUTED)
    num((rx1 - 12, cy), val, 11.5, c)
    cy += 25

R8 = R7 + 182
panel((rx0, R8, rx1, R8 + 168))
label((rx0 + 12, R8 + 12), "Top holders")
t((rx1 - 12, R8 + 10), "812 total", 11, DIM, anchor="ra")
d.line((rx0 + 12, R8 + 32, rx1 - 12, R8 + 32), fill=LINE_SOFT)
hy = R8 + 42
for who, pct, w in (("Liquidity pool", "18.2%", 0.182), ("0x4d21…9ac0", "6.4%", 0.064),
                    ("kolwallet.arc", "3.1%", 0.031), ("0x77be…1f42", "2.4%", 0.024), ("0x91cc…77de", "1.3%", 0.013)):
    t((rx0 + 12, hy), who, 11.5, (186, 194, 210))
    num((rx1 - 12, hy), pct, 11.5, MUTED)
    d.rectangle((rx0 + 12, hy + 17, rx1 - 12, hy + 20), fill=(38, 42, 54))
    d.rectangle((rx0 + 12, hy + 17, rx0 + 12 + (rx1 - 24 - rx0) * min(1, w * 3.4), hy + 20), fill=(64, 96, 152))
    hy += 25

img.save("token-ds-mockup2.png", quality=97)
print("saved token-ds-mockup2.png")
print(f"rail 0-{RAIL_W} | tools {RAIL_W}-{CX0} | chart {CX0}-{RIGHT_X} | side {RIGHT_X}-{W}")
print(f"right column blocks end at y={R7 + 170} (canvas {H})")
