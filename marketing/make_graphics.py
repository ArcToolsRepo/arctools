"""ArcTools comparison graphics — rendered in code so every number is exact.

Data sources (verified 10 Sep 2026):
  market caps  : RadarDex screener api.radardex.pro/tokens
  competitor   : tollylabs.com, circlewarp.fun, radardex.pro (own marketing pages)
  our stack    : shipped features on arctools.fun / @ArcSniper_bot / @ArcToolsBuyBot
"""
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2                                    # supersampling
W, H = 1600, 900

BG = (9, 11, 16)
PANEL = (14, 17, 24)
LINE = (38, 44, 58)
INK = (240, 244, 252)
MUTED = (124, 136, 158)
COBALT = (46, 124, 255)
AMBER = (232, 168, 56)
DIM = (70, 79, 96)

FONTS = [
    "/home/.hermes/skills/animated-explainer/scripts/fonts/Montserrat-ExtraBold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]


def font(kind: str, size: int):
    idx = {"display": 0, "bold": 1, "reg": 2, "monob": 3, "mono": 4}[kind]
    path = FONTS[idx]
    if not os.path.exists(path):
        path = FONTS[1] if kind in ("display", "bold") else FONTS[2]
    return ImageFont.truetype(path, size * SS)


def canvas():
    img = Image.new("RGB", (W * SS, H * SS), BG)
    return img, ImageDraw.Draw(img)


def save(img, name):
    img = img.resize((W, H), Image.LANCZOS)
    img.save(os.path.join(OUT, name), "PNG", optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, "KB")


def px(v):
    return int(v * SS)


def check(d, cx, cy, r, color):
    """vector check mark — no glyph dependency"""
    w = max(2, int(r * 0.34))
    d.line([(cx - r * 0.62, cy + r * 0.02), (cx - r * 0.16, cy + r * 0.48)], fill=color, width=w)
    d.line([(cx - r * 0.16, cy + r * 0.48), (cx + r * 0.66, cy - r * 0.52)], fill=color, width=w)


def dash(d, cx, cy, r, color):
    w = max(2, int(r * 0.30))
    d.line([(cx - r * 0.55, cy), (cx + r * 0.55, cy)], fill=color, width=w)


def half(d, cx, cy, r, color):
    w = max(2, int(r * 0.26))
    d.ellipse([cx - r * 0.62, cy - r * 0.62, cx + r * 0.62, cy + r * 0.62], outline=color, width=w)
    d.pieslice([cx - r * 0.62, cy - r * 0.62, cx + r * 0.62, cy + r * 0.62], start=90, end=270, fill=color)


def brandbar(d, note):
    d.line([(px(64), px(H - 74)), (px(W - 64), px(H - 74))], fill=LINE, width=SS)
    d.text((px(64), px(H - 58)), "ARCTOOLS.FUN", font=font("monob", 17), fill=COBALT)
    d.text((px(W - 64), px(H - 58)), note, font=font("mono", 14), fill=MUTED, anchor="ra")


# ---------------------------------------------------------------- graphic 1
def g1_matrix():
    rows = [
        ("Token launchpad", 1, 1, 1, 0),
        ("Explorer across every Arc launchpad", 1, 1, 0, 1),
        ("Portfolio tracker", 1, 0, 0, 1),
        ("Telegram sniper bot", 1, 0, 0, 0),
        ("Buy-alert bot for any project group", 1, 0, 0, 0),
        ("Trending channel with paid boosts", 1, 0, 0, 0),
        ("Smart-money wallet PnL leaderboard", 1, 0, 0, 2),
        ("One-tap copy trading", 1, 0, 0, 0),
        ("Staking = share of every pad trade", 1, 0, 0, 0),
        ("5% of every launch to stakers", 1, 0, 0, 0),
        ("Public data API + own RPC", 1, 0, 0, 0),
        ("Gas faucet for new launches", 1, 0, 0, 0),
    ]
    cols = ["ARCTOOLS", "TOLLY", "WARP", "RADARDEX"]
    img, d = canvas()
    d.text((px(64), px(50)), "ONE STACK vs POINT SOLUTIONS", font=font("display", 44), fill=INK)
    d.text((px(64), px(108)), "Everything a trader on Arc needs, in one product",
           font=font("reg", 22), fill=MUTED)

    x0, y0 = px(64), px(158)
    tw, cw, rh = px(760), px(178), px(45)
    # header
    for i, c in enumerate(cols):
        cx = x0 + tw + cw * i + cw // 2
        if i == 0:
            d.rectangle([cx - cw // 2 + px(4), y0 - px(6), cx + cw // 2 - px(4), y0 + rh * (len(rows) + 1)],
                        fill=(17, 26, 46))
        d.text((cx, y0 + px(14)), c, font=font("monob", 18 if i == 0 else 16),
               fill=COBALT if i == 0 else MUTED, anchor="ma")
    d.line([(x0, y0 + rh), (x0 + tw + cw * 4, y0 + rh)], fill=LINE, width=SS)

    for r, (label, *vals) in enumerate(rows):
        y = y0 + rh * (r + 1)
        d.text((x0 + px(6), y + px(15)), label, font=font("reg", 19), fill=INK)
        for i, v in enumerate(vals):
            cx = x0 + tw + cw * i + cw // 2
            cy = y + rh // 2
            r_ = px(12)
            if v == 1:
                check(d, cx, cy, r_, COBALT if i == 0 else INK)
            elif v == 2:
                half(d, cx, cy, r_, AMBER)
            else:
                dash(d, cx, cy, r_, DIM)
        d.line([(x0, y + rh), (x0 + tw + cw * 4, y + rh)], fill=(24, 28, 38), width=SS)

    yl = y0 + rh * (len(rows) + 1) + px(14)
    half(d, x0 + px(10), yl + px(10), px(9), AMBER)
    d.text((x0 + px(28), yl), "partial — points leaderboard, not wallet PnL",
           font=font("mono", 14), fill=MUTED)
    brandbar(d, "features per each project's own site, Sep 2026")
    save(img, "01-feature-matrix.png")


# ---------------------------------------------------------------- graphic 2
def g2_gap():
    data = [
        ("TOLLY", "launchpad", 2_924_772),
        ("COOL", "meme", 2_624_361),
        ("ARCHITECTS", "meme", 938_219),
        ("WARP", "launchpad", 774_355),
        ("ARGUS", "launchpad", 488_211),
        ("ARCT", "launchpad + full toolkit", 9_570),
    ]
    img, d = canvas()
    d.text((px(64), px(50)), "SAME CATEGORY. 300x THE GAP.", font=font("display", 46), fill=INK)
    d.text((px(64), px(112)), "Market caps of launchpad & infra tokens on Arc",
           font=font("reg", 22), fill=MUTED)

    x0, y0 = px(64), px(186)
    bw = px(880)
    rh = px(84)
    mx = data[0][2]
    for i, (sym, kind, mc) in enumerate(data):
        y = y0 + rh * i
        is_us = sym == "ARCT"
        d.text((x0, y + px(12)), sym, font=font("monob", 24), fill=COBALT if is_us else INK)
        d.text((x0, y + px(44)), kind, font=font("mono", 15), fill=MUTED)
        bx = x0 + px(300)
        w = max(px(5), int(bw * (mc / mx)))
        d.rectangle([bx, y + px(14), bx + bw, y + px(52)], fill=(18, 21, 30))
        d.rectangle([bx, y + px(14), bx + w, y + px(52)], fill=COBALT if is_us else (58, 68, 90))
        d.text((bx + bw + px(200), y + px(18)), f"${mc:,.0f}",
               font=font("monob", 22), fill=COBALT if is_us else INK, anchor="ra")
    d.text((px(64), px(712)), "We shipped the most. We're priced the least.",
           font=font("bold", 30), fill=INK)
    brandbar(d, "source: RadarDex screener, 10 Sep 2026")
    save(img, "02-valuation-gap.png")


# ---------------------------------------------------------------- graphic 3
def g3_only():
    tiles = [
        ("SNIPER BOT", "Maestro-style buy panels.\nSnipes 5 launchpads on Arc."),
        ("BUY ALERTS", "Any project plugs our bot into\ntheir group. Logo, socials, rank."),
        ("TRENDING", "Live board + paid boosts,\nmirrored to @ARCTrends."),
        ("SMART MONEY", "22,400+ swaps indexed.\n1,763 wallets ranked by real PnL."),
        ("COPY TRADING", "One tap and the sniper mirrors\nan Insider wallet's buys."),
        ("REVENUE SHARE", "USDC from every pad trade\n+ 5% of every launch, to stakers."),
    ]
    img, d = canvas()
    d.text((px(64), px(50)), "WHAT ONLY ARCTOOLS HAS", font=font("display", 46), fill=INK)
    d.text((px(64), px(112)), "No other project on Arc ships any of these",
           font=font("reg", 22), fill=MUTED)

    gx, gy = px(64), px(186)
    cw, ch, gap = px(480), px(206), px(26)
    for i, (t, s) in enumerate(tiles):
        cx = gx + (cw + gap) * (i % 3)
        cy = gy + (ch + gap) * (i // 3)
        d.rectangle([cx, cy, cx + cw, cy + ch], fill=PANEL, outline=LINE, width=SS)
        d.rectangle([cx, cy, cx + px(5), cy + ch], fill=COBALT)
        d.text((cx + px(26), cy + px(26)), t, font=font("monob", 22), fill=COBALT)
        d.multiline_text((cx + px(26), cy + px(74)), s, font=font("reg", 19), fill=INK, spacing=px(10))
    brandbar(d, "live on arctools.fun · @ArcSniper_bot · @ArcToolsBuyBot")
    save(img, "03-only-arctools.png")


# ---------------------------------------------------------------- graphic 4
def g4_flywheel():
    img, d = canvas()
    d.text((px(64), px(50)), "THE ARCT FLYWHEEL", font=font("display", 46), fill=INK)
    d.text((px(64), px(112)), "Every trade on our stack pays the people holding the token",
           font=font("reg", 22), fill=MUTED)
    steps = [
        ("1", "TRADES", "Sniper buys, pad trades,\nbridge transfers"),
        ("2", "FEES", "1% per trade, 2% per bridge,\n1% per pad trade"),
        ("3", "STAKERS", "10% of pad fees + 5% of every\nlaunch, paid in USDC"),
        ("4", "DEMAND", "Boosts, gating and premium\npriced in ARCT"),
    ]
    x, y = px(64), px(210)
    cw, ch, gap = px(340), px(224), px(26)
    for i, (n, t, s) in enumerate(steps):
        cx = x + (cw + gap) * i
        d.rectangle([cx, y, cx + cw, y + ch], fill=PANEL, outline=LINE, width=SS)
        d.text((cx + cw - px(24), y + px(20)), n, font=font("display", 44), fill=(32, 43, 68), anchor="ra")
        d.text((cx + px(24), y + px(30)), t, font=font("monob", 24), fill=COBALT)
        d.multiline_text((cx + px(24), y + px(84)), s, font=font("reg", 18), fill=INK, spacing=px(10))
        if i < 3:
            ax = cx + cw + gap // 2
            d.line([(ax - px(7), y + ch // 2), (ax + px(7), y + ch // 2)], fill=COBALT, width=px(3))
            d.line([(ax + px(2), y + ch // 2 - px(6)), (ax + px(8), y + ch // 2)], fill=COBALT, width=px(3))
            d.line([(ax + px(2), y + ch // 2 + px(6)), (ax + px(8), y + ch // 2)], fill=COBALT, width=px(3))
    d.text((px(64), px(520)), "Not a promise — the contracts are live and paying today.",
           font=font("bold", 28), fill=INK)
    d.text((px(64), px(570)), "Vault 0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd",
           font=font("mono", 17), fill=MUTED)
    brandbar(d, "arctools.fun/rewards")
    save(img, "04-flywheel.png")


if __name__ == "__main__":
    g1_matrix()
    g2_gap()
    g3_only()
    g4_flywheel()
