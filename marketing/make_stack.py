"""'The Arc trading stack' — 12 live utilities on one 1600x900 card + a 1080x1350 vertical variant."""
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2
BG, PANEL, LINE = (9, 11, 16), (14, 17, 24), (38, 44, 58)
INK, MUTED, COBALT, UP = (240, 244, 252), (124, 136, 158), (46, 124, 255), (34, 197, 128)
F = {
    "display": "/home/.hermes/skills/animated-explainer/scripts/fonts/Montserrat-ExtraBold.ttf",
    "bold": "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "reg": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "monob": "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "mono": "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
}


def font(k, size):
    p = F[k] if os.path.exists(F[k]) else F["bold"]
    return ImageFont.truetype(p, size * SS)


def px(v):
    return int(v * SS)


TILES = [
    ("01", "EXPLORER", "Every token, every launchpad,\nnew pools in seconds"),
    ("02", "TOKEN PAGES", "TradingView chart 1m-1d,\ntrades, holders, swap"),
    ("03", "FULL-CHAIN INDEX", "Uniswap V2, V3, V4 + every\ncurve. 80,000+ swaps"),
    ("04", "SMART MONEY", "1,700+ wallets ranked\nby realised PnL"),
    ("05", "COPY TRADING", "One tap mirrors an Insider\nwallet from the sniper"),
    ("06", "SNIPER BOT", "Maestro-style panels,\nsnipes every Arc pad"),
    ("07", "BUY ALERTS", "Free bot for any group:\nlogo, socials, rank"),
    ("08", "TRENDING", "Live board + paid boosts,\nmirrored to @ARCTrends"),
    ("09", "LAUNCHPAD", "One-tx launch, taxes,\nfree gas for new launches"),
    ("10", "CCTP BRIDGE", "Native USDC in from\nother chains"),
    ("11", "PORTFOLIO + SCANNER", "Every holding priced;\nowner, mint, liquidity checks"),
    ("12", "$ARCT STAKING", "USDC from every fee +\n5% of every pad launch"),
]


def card_wide():
    W, H = 1600, 900
    img = Image.new("RGB", (W * SS, H * SS), BG)
    d = ImageDraw.Draw(img)
    d.text((px(64), px(46)), "THE ARC TRADING STACK", font=font("display", 44), fill=INK)
    d.text((px(64), px(104)), "12 utilities. All live. One token earns from every one of them.",
           font=font("reg", 21), fill=MUTED)
    d.rectangle([px(W - 64 - 118), px(52), px(W - 64), px(84)], fill=(16, 40, 30), outline=UP, width=SS)
    d.text((px(W - 64 - 59), px(60)), "LIVE NOW", font=font("monob", 14), fill=UP, anchor="ma")

    gx, gy = px(64), px(158)
    cols, rows = 4, 3
    gap = px(16)
    cw = (px(W - 128) - gap * (cols - 1)) // cols
    ch = px(200)
    for i, (n, t, s) in enumerate(TILES):
        x = gx + (cw + gap) * (i % cols)
        y = gy + (ch + gap) * (i // cols)
        d.rectangle([x, y, x + cw, y + ch], fill=PANEL, outline=LINE, width=SS)
        d.rectangle([x, y, x + px(4), y + ch], fill=COBALT)
        d.text((x + cw - px(16), y + px(12)), n, font=font("display", 30), fill=(30, 40, 62), anchor="ra")
        d.text((x + px(20), y + px(22)), t, font=font("monob", 16), fill=COBALT)
        d.multiline_text((x + px(20), y + px(62)), s, font=font("reg", 17), fill=INK, spacing=px(7))
    d.line([(px(64), px(H - 70)), (px(W - 64), px(H - 70))], fill=LINE, width=SS)
    d.text((px(64), px(H - 54)), "ARCTOOLS.FUN", font=font("monob", 17), fill=COBALT)
    d.text((px(W - 64), px(H - 54)), "@ArcSniper_bot  ·  @ArcToolsBuyBot  ·  @ARCTrends",
           font=font("mono", 14), fill=MUTED, anchor="ra")
    img = img.resize((W, H), Image.LANCZOS)
    img.save(os.path.join(OUT, "05-stack-wide.png"), "PNG", optimize=True)
    print("05-stack-wide.png")


def card_tall():
    W, H = 1080, 1350
    img = Image.new("RGB", (W * SS, H * SS), BG)
    d = ImageDraw.Draw(img)
    d.text((px(56), px(56)), "THE ARC\nTRADING STACK", font=font("display", 52), fill=INK, spacing=px(2))
    d.text((px(56), px(196)), "12 utilities, all live today.", font=font("reg", 22), fill=MUTED)
    gx, gy = px(56), px(250)
    cols, rows = 2, 6
    gap = px(14)
    cw = (px(W - 112) - gap) // 2
    ch = px(150)
    for i, (n, t, s) in enumerate(TILES):
        x = gx + (cw + gap) * (i % cols)
        y = gy + (ch + gap) * (i // cols)
        d.rectangle([x, y, x + cw, y + ch], fill=PANEL, outline=LINE, width=SS)
        d.rectangle([x, y, x + px(4), y + ch], fill=COBALT)
        d.text((x + cw - px(14), y + px(10)), n, font=font("display", 26), fill=(30, 40, 62), anchor="ra")
        d.text((x + px(18), y + px(18)), t, font=font("monob", 15), fill=COBALT)
        d.multiline_text((x + px(18), y + px(54)), s, font=font("reg", 16), fill=INK, spacing=px(6))
    d.line([(px(56), px(H - 66)), (px(W - 56), px(H - 66))], fill=LINE, width=SS)
    d.text((px(56), px(H - 50)), "ARCTOOLS.FUN", font=font("monob", 17), fill=COBALT)
    d.text((px(W - 56), px(H - 50)), "one token earns from all of it: $ARCT", font=font("mono", 14), fill=MUTED, anchor="ra")
    img = img.resize((W, H), Image.LANCZOS)
    img.save(os.path.join(OUT, "06-stack-tall.png"), "PNG", optimize=True)
    print("06-stack-tall.png")


card_wide()
card_tall()
