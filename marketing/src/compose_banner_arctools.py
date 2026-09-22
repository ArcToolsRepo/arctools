"""House banner 1060×144 for the sponsored slot (example). Robot from the generated wide frame, text in code."""
from PIL import Image, ImageDraw, ImageFont
F='/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'; R='/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f=lambda s,p=F: ImageFont.truetype(p,s)
src=Image.open('assets/banner-robot.png').convert('RGB')           # 1440×816 (ish)
W,H=1060,144
# band through the visor and the pointing hand: y≈250..560 of the source → 1060:144 ratio needs 7.36:1 → crop height = 1440/7.36 ≈ 196
sw=src.width; ch=int(sw*H/W); top=int(src.height*0.30)            # centre of visor/hand region
im=src.crop((0,top,sw,top+ch)).resize((W,H),Image.LANCZOS)
d=ImageDraw.Draw(im)
X=300
d.text((X,26),'ArcTools',font=f(38),fill=(240,244,250))
d.rounded_rectangle((X+178,36,X+318,62),radius=8,fill=(34,197,128)); d.text((X+190,40),'24 LAUNCHPADS',font=f(15),fill=(4,20,10))
d.text((X,78),'One-click buys on every Arc launchpad · best price, every venue',font=f(18,R),fill=(200,208,224))
d.rounded_rectangle((W-236,44,W-24,100),radius=12,fill=(46,124,255)); d.text((W-212,58),'arctools.fun',font=f(24),fill=(255,255,255))
im.save('assets/arctools-banner-1060x144.png',optimize=True); im.resize((530,72),Image.LANCZOS).save('assets/arctools-banner-preview.png')
import os; print('ok', os.path.getsize('assets/arctools-banner-1060x144.png'),'B')
