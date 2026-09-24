"""90 — Never sleeps: robot in the server room + the list of keepers that run while you are away."""
from kit import *
from PIL import ImageDraw
bg = robot_bg('assets/90-robot-night.png', dark_left=0.60, strength=205); d = ImageDraw.Draw(bg)
d.text((70, 52), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 54, 330, 86), radius=8, fill=GRN); d.text((222, 59), '24 / 7', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'It runs while you sleep.', font=f(54), fill=INK)
for i, s in enumerate(['Most of ArcTools is not a website. It is a set of keepers that watch the chain every few seconds and act', 'on your behalf, with your rules, without your key ever leaving your device.']):
    d.text((70, 172 + i * 26), s, font=f(19, False), fill=MUTED)
y = 250
for t, s in [('Orders keeper', 'limit buys, take profit, stop loss: checked every block, filled on-chain'), ('Dump guard', 'sells your position the moment the deployer or bundle starts selling'), ('Auto-snipe', 'buys new launches that match your rules the block they go live'), ('Bridge keeper', 'finishes CCTP transfers when Circle attests, even if you closed the tab'), ('Predict operator', 'posts the median of four exchanges on-chain every two minutes'), ('Buyback keeper', 'turns the treasury\'s USDC into ARCT and burns it, every run public'), ('Index + alerts', 'every swap on Arc indexed in under a second; whale, dev-sell and cluster alerts to Telegram')]:
    bg = card(bg, (70, y, 860, y + 54)); d = ImageDraw.Draw(bg)
    d.text((86, y + 9), t, font=f(16), fill=INK); d.text((86, y + 31), s, font=f(13, False), fill=MUTED); y += 62
bg = footer(bg, 'arctools.fun', 'Status of every keeper: the System pill in the site header · watchdog alerts the team on any stall')
bg.convert('RGB').save('90-keepers.png', quality=95); print('90 ok')
