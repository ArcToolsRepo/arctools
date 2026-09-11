"""Insider alerts channel announcement: two real alerts rendered as Telegram-style cards + explainer."""
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2
BG, PANEL, LINE = (9, 11, 16), (14, 17, 24), (38, 44, 58)
INK, MUTED, COBALT, UP, AMBER, RED = (240, 244, 252), (124, 136, 158), (46, 124, 255), (34, 197, 128), (232, 168, 56), (240, 83, 79)
TG_BUBBLE, TG_BTN = (24, 28, 38), (30, 36, 50)
F = {
    "display": "/home/.hermes/skills/animated-explainer/scripts/fonts/Montserrat-ExtraBold.ttf",
    "bold": "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "reg": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "monob": "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "mono": "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
}


def font(k, s):
    p = F[k] if os.path.exists(F[k]) else F["bold"]
    return ImageFont.truetype(p, s * SS)


def px(v):
    return int(v * SS)


W, H = 1600, 900
img = Image.new("RGB", (W * SS, H * SS), BG)
d = ImageDraw.Draw(img)

# header
d.text((px(64), px(44)), "THE TOP-20 WALLETS ON ARC, IN YOUR POCKET", font=font("display", 40), fill=INK)
d.text((px(64), px(98)), "Every buy and sell of the highest-PnL wallets on Arc, posted seconds after the block.  t.me/ArcToolsInsiders",
       font=font("reg", 20), fill=MUTED)
d.rectangle([px(W - 64 - 118), px(50), px(W - 64), px(82)], fill=(16, 40, 30), outline=UP, width=SS)
d.text((px(W - 64 - 59), px(58)), "LIVE NOW", font=font("monob", 14), fill=UP, anchor="ma")


def bubble(x, y, w, lines, buttons, accent):
    """Telegram-style dark bubble. lines: [(text, font_key, size, color)]; buttons: [[label,...],...]"""
    pad = px(18)
    ly = y + pad
    heights = []
    for t, fk, sz, c in lines:
        heights.append(px(sz) + px(9) if t else px(10))
    body_h = sum(heights)
    btn_h = px(34)
    total_h = pad * 2 + body_h + px(10) + (btn_h + px(8)) * len(buttons)
    d.rounded_rectangle([x, y, x + w, y + total_h], radius=px(14), fill=TG_BUBBLE, outline=LINE, width=SS)
    d.rounded_rectangle([x, y, x + px(5), y + total_h], radius=px(2), fill=accent)
    for (t, fk, sz, c), h in zip(lines, heights):
        if t:
            d.text((x + px(24), ly), t, font=font(fk, sz), fill=c)
        ly += h
    by = y + pad + body_h + px(10)
    for row in buttons:
        gap = px(8)
        bw = (w - px(24) * 2 - gap * (len(row) - 1)) // len(row)
        for i, lab in enumerate(row):
            bx = x + px(24) + (bw + gap) * i
            d.rounded_rectangle([bx, by, bx + bw, by + btn_h], radius=px(8), fill=TG_BTN, outline=LINE, width=SS)
            d.text((bx + bw // 2, by + btn_h // 2), lab, font=font("bold", 13), fill=COBALT, anchor="mm")
        by += btn_h + gap
    return total_h


cw = px(640)
x0 = px(64)
y0 = px(150)

buy_lines = [
    ("INSIDER BUY  ·  #7", "monob", 17, UP),
    ("$VORT   +$219.78   (6.06M tokens)", "bold", 20, INK),
    ("Price $0.00003628  ·  MCAP $36.1K  ·  Uniswap v3", "mono", 13, MUTED),
    ("", "reg", 6, INK),
    ("Insider 0x6e3a…f8aa  ·  30d PnL +$20.1K  ·  win-rate 33%", "reg", 15, INK),
    ("New position in $VORT — first entry", "reg", 15, AMBER),
    ("", "reg", 6, INK),
    ("tx · chart · wallet", "mono", 13, COBALT),
]
h1 = bubble(x0, y0, cw, buy_lines, [["Snipe $VORT", "Copy insider"], ["Chart", "Insider profile"]], UP)

sell_lines = [
    ("INSIDER SELL  ·  #16", "monob", 17, RED),
    ("$SHARC   −$198.53   (12.69M tokens)", "bold", 20, INK),
    ("Price $0.00001564  ·  MCAP $15.6K  ·  Uniswap v4", "mono", 13, MUTED),
    ("", "reg", 6, INK),
    ("Insider 0x1837…2b0f  ·  30d PnL +$13.9K  ·  72 closed", "reg", 15, INK),
    ("fully out  ·  +121% vs avg entry", "reg", 15, UP),
    ("", "reg", 6, INK),
    ("tx · chart · wallet", "mono", 13, COBALT),
]
bubble(x0, y0 + h1 + px(18), cw, sell_lines, [["Snipe $SHARC", "Copy insider"], ["Chart", "Insider profile"]], RED)
d.text((x0, px(H - 118)), "real posts from the channel, 11 Sep 2026 — nothing mocked up", font=font("mono", 13), fill=MUTED)

# right column: how it works
rx = px(64 + 640 + 40)
rw = px(W - 64) - rx
tiles = [
    ("WHO", "The 20 most profitable wallets on Arc by\nrealized PnL (30 days), across Uniswap V3,\nV4 and every launchpad. Recomputed every 5 min.", COBALT),
    ("WHAT", "Buys and sells above $150. Position size,\naverage entry, whether they add or exit —\nand a CLUSTER post when 3+ enter together.", UP),
    ("HOW FAST", "Our own chain-wide swap index reads every\nblock. Alert lands seconds after inclusion,\nnot after a screener refresh.", AMBER),
    ("THEN WHAT", "One tap: snipe the token or copy the wallet\nin @ArcSniper_bot. Every future buy of that\ninsider mirrored automatically.", RED),
]
ty = y0
th = px(118)
for t, s, c in tiles:
    d.rectangle([rx, ty, rx + rw, ty + th], fill=PANEL, outline=LINE, width=SS)
    d.rectangle([rx, ty, rx + px(4), ty + th], fill=c)
    d.text((rx + px(18), ty + px(14)), t, font=font("monob", 15), fill=c)
    d.multiline_text((rx + px(120), ty + px(14)), s, font=font("reg", 15), fill=INK, spacing=px(6))
    ty += th + px(14)

# stat strip
sy = ty + px(6)
stats = [("95K+", "swaps indexed"), ("4.3K", "pools tracked"), ("<3 s", "block to alert"), ("free", "for now")]
sw_ = (rw - px(12) * 3) // 4
for i, (v, l) in enumerate(stats):
    sx = rx + (sw_ + px(12)) * i
    d.rectangle([sx, sy, sx + sw_, sy + px(70)], fill=(12, 20, 36), outline=COBALT, width=SS)
    d.text((sx + sw_ // 2, sy + px(16)), v, font=font("display", 22), fill=INK, anchor="ma")
    d.text((sx + sw_ // 2, sy + px(48)), l, font=font("mono", 11), fill=MUTED, anchor="ma")

d.line([(px(64), px(H - 52)), (px(W - 64), px(H - 52))], fill=LINE, width=SS)
d.text((px(64), px(H - 40)), "ARCTOOLS.FUN/INSIDERS", font=font("monob", 16), fill=COBALT)
d.text((px(W - 64), px(H - 40)), "t.me/ArcToolsInsiders  ·  not financial advice  ·  insiders are ranked by on-chain PnL, they can be wrong",
       font=font("mono", 13), fill=MUTED, anchor="ra")

img = img.resize((W, H), Image.LANCZOS)
img.save(os.path.join(OUT, "11-insiders-channel.png"), "PNG", optimize=True)
print("11-insiders-channel.png", img.size)
