"""85 — Every fee burns ARCT: robot with the green flame + the fee → treasury → burn flow, live burn counter."""
from kit import *
from PIL import ImageDraw
bg = robot_bg('assets/85-robot-flame.png', dark_left=0.58, strength=205); d = ImageDraw.Draw(bg)
d.text((70, 52), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 54, 330, 86), radius=8, fill=GRN); d.text((222, 59), 'ARCT', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'Every fee ends in the fire.', font=f(54), fill=INK)
for i, s in enumerate(['Ten products, one treasury. Whatever ArcTools earns buys ARCT on the market and burns it. No emissions, no team unlocks,', 'no promises about price: just a counter that only goes up, public at arctools.fun/rewards.']):
    d.text((70, 172 + i * 26), s, font=f(19, False), fill=MUTED)
y = 250; d.text((70, y), 'WHERE THE FEES COME FROM', font=f(13), fill=GRN); y += 28
fees = [('Sniper bot', '1 %'), ('Quick Buy', '1.5 %'), ('Swap / app', '0.5 %'), ('ArcToolsPad trades', '1 %'), ('Bridge', '2 %'), ('ArcLocker', '50 USDC'), ('Market', '2 %'), ('ArcPredict', '3 %'), ('x402 API', 'per call'), ('Banner slots', '250 USDC')]
for i, (k, v) in enumerate(fees):
    cx = 70 + (i % 2) * 300; cy = y + (i // 2) * 44
    d.rounded_rectangle((cx, cy, cx + 288, cy + 36), radius=8, fill=(14, 18, 26), outline=(255, 255, 255, 30), width=1)
    d.text((cx + 12, cy + 10), k, font=f(14, False), fill=MUTED); d.text((cx + 288 - 12 - d.textlength(v, font=f(15)), cy + 9), v, font=f(15), fill=INK)
y += 5 * 44 + 16
d.text((70, y), 'ARCT BURNED SO FAR', font=f(13), fill=GRN); d.text((70, y + 24), '59.17M', font=f(72), fill=INK); d.text((70 + d.textlength('59.17M', font=f(72)) + 18, y + 62), 'of 1,000,000,000 · 5.9 % of supply', font=f(20, False), fill=MUTED)
d.text((70, y + 112), 'Plus 1/1 tax on ARCT itself: half to holders in USDC, half to the same treasury.', font=f(15, False), fill=DIM)
bg = footer(bg, 'arctools.fun/rewards', 'Treasury 0xb35c…5c0d · buyback keeper runs on-chain · counter reads the burn address live')
bg.convert('RGB').save('85-burn.png', quality=95); print('85 ok')
