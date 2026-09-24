"""88 — Sniper bot: robot at the button + a Telegram-style Buy card drawn from the bot's real card format (ui/cards.py)."""
from kit import *
from PIL import ImageDraw, ImageFont
MONO = f"{FD}/RobotoMono-Regular.ttf"
def mono(s, b=False): return ImageFont.truetype(f"{FD}/Roboto-Bold.ttf" if b else MONO, s)
bg = robot_bg('assets/88-robot-button.png', dark_left=0.60, strength=210); d = ImageDraw.Draw(bg)
d.text((70, 52), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 54, 400, 86), radius=8, fill=GRN); d.text((222, 59), '@ArcSniper_bot', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'The second it goes live, you are in.', font=f(50), fill=INK)
for i, s in enumerate(['Telegram sniper for every Arc launchpad: buys at any cost the moment a token is tradeable, then runs the position for you.', 'Auto-snipe rules, copy trading, deployer-dump guard, take profit and stop loss, one card per position.']):
    d.text((70, 168 + i * 26), s, font=f(19, False), fill=MUTED)
# Telegram-style card (content follows cards.header/buy_text exactly)
x, y, w = 70, 250, 640; bg = card(bg, (x, y, x + w, y + 400), radius=14, fill=(24, 30, 42, 245)); d = ImageDraw.Draw(bg)
lines = [('ARCPET · ArcToolsPad  chart · scan · explorer', True), ('0x42be73ca5ed50ebf4c9f49cdb79fb0abe15cf70d', False), ('', False),
         ('|- Price  $0.0000032', False), ('|- MC     $3.2K    Liq $1.1K', False), ('|- Vol24  $612     B/S 14/3    age 6m', False), ('-- 5m +41.2% · 1h +41.2% · 24h +41.2%', False), ('', False),
         ('BUY  5 USDC  ->  1,559,402 ARCPET', True), ('|- Wallet 42.10 USDC  ·  1 wallet', False), ('|- gas fast  ·  slippage 15%  ·  fee 0.05 USDC', False), ('-- Buy now', False)]
yy = y + 16
for t, b in lines:
    if t: d.text((x + 18, yy), t, font=mono(15, b), fill=INK if b else (215, 222, 235)); yy += 24
# button rows
rows = [['1', '• 5', '20', '100', 'X'], ['Gas: Fast', 'Slip 15%', 'Wallets x1'], ['ArcToolsPad', 'Buy now', 'Requote'], ['BUY 5 USDC']]
by = yy + 10
for r in rows:
    bw = (w - 36 - (len(r) - 1) * 6) // len(r); bx = x + 18
    for lbl in r:
        d.rounded_rectangle((bx, by, bx + bw, by + 30), radius=6, fill=(46, 124, 255) if lbl.startswith('BUY') else (40, 48, 64))
        d.text((bx + bw // 2 - d.textlength(lbl, font=f(13)) / 2, by + 8), lbl, font=f(13), fill=INK); bx += bw + 6
    by += 36
d.text((70, y + 412), 'Buy card, same fields as the bot renders (icons omitted here). 1 % fee, minOut 0: speed first, always.', font=f(12, False), fill=DIM)
X = 740; yy = 250; d.text((X, yy), 'WHAT IT DOES', font=f(13), fill=GRN); yy += 26
for t in ['Snipe 25 launchpads + Uniswap V3/V4', 'Auto-snipe rules by Token Score, pad, MC', 'Copy any wallet from the Insiders list', 'Deployer-dump guard sells before the dev', 'TP / SL / limit orders, filled 24/7', 'Referral: 25 % of your invitees\' fees']:
    d.text((X, yy), '· ' + t, font=f(14, False), fill=MUTED); yy += 22
bg = footer(bg, 't.me/ArcSniper_bot', 'Key exportable any time · every fee shown on the card before you confirm · 1 % on trades -> ARCT burn')
bg.convert('RGB').save('88-sniper.png', quality=95); print('88 ok')
