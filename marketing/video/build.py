"""ArcTools feature film: real screenshots in a browser card with slow motion, robot intro/outro, EN narration, bottom captions, music.
Steps: composites (PIL) -> per-segment clips (ffmpeg zoompan) -> xfade chain -> ASS captions -> audio mix (VO + ducked music)."""
import json, os, subprocess, shutil
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
XF = 0.5                     # crossfade
PAD = 1.0                    # tail after narration
VO_IN = 0.45                 # narration starts this late into a segment
FDIR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets"
FB, FR = f"{FDIR}/Roboto-Bold.ttf", f"{FDIR}/Roboto-Regular.ttf"
S = json.load(open("script.json")); segs = S["segments"]
os.makedirs("comp", exist_ok=True); os.makedirs("clips", exist_ok=True)
dur = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).decode().strip())
NAVY = (9, 11, 15); GRN = (34, 197, 128); COB = (46, 124, 255); INK = (240, 244, 250); MUTED = (170, 180, 198)
f = lambda s, p=FB: ImageFont.truetype(p, s)

def backdrop(seed: int) -> Image.Image:
    bg = Image.new("RGBA", (W, H), NAVY + (255,)); glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(glow)
    if seed % 2 == 0: d.ellipse((-400, 300, 500, 1300), fill=GRN + (60,)); d.ellipse((1300, -400, 2200, 400), fill=COB + (50,))
    else: d.ellipse((1200, 500, 2200, 1400), fill=GRN + (50,)); d.ellipse((-300, -400, 700, 500), fill=COB + (60,))
    bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(200)))
    d = ImageDraw.Draw(bg)   # faint grid
    for x in range(0, W, 96): d.line((x, 0, x, H), fill=(255, 255, 255, 6))
    for y in range(0, H, 96): d.line((0, y, W, y), fill=(255, 255, 255, 6))
    return bg

def composite(seg, i):
    """Browser card with the real screenshot; title chip top-left. Rendered at 1.25x so zoompan can move without softness."""
    sc = 1.25; CW, CH = int(W * sc), int(H * sc)
    bg = backdrop(i).resize((CW, CH), Image.LANCZOS)
    shot = Image.open(f"shots/{seg['id']}.png").convert("RGB")
    cw = int(1400 * sc); ch = int(cw * 1080 / 1920); shot = shot.resize((cw, ch), Image.LANCZOS)
    bar = int(44 * sc); card = Image.new("RGBA", (cw, ch + bar), (22, 26, 34, 255)); cd = ImageDraw.Draw(card)
    for k, c in enumerate(((255, 95, 87), (255, 189, 46), (40, 201, 64))): cd.ellipse((int((18 + k * 22) * sc), int(14 * sc), int((18 + k * 22 + 13) * sc), int(27 * sc)), fill=c)
    cd.rounded_rectangle((int(110 * sc), int(9 * sc), cw - int(110 * sc), bar - int(9 * sc)), radius=int(12 * sc), fill=(34, 39, 49))
    cd.text((int(128 * sc), int(14 * sc)), seg["url"].replace("https://", "").replace("2", "").replace("/locker/1", "/locker"), font=f(int(15 * sc), FR), fill=MUTED)
    card.paste(shot, (0, bar))
    mask = Image.new("L", card.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw - 1, ch + bar - 1), radius=int(16 * sc), fill=255)
    shadow = Image.new("RGBA", (CW, CH), (0, 0, 0, 0)); sd = ImageDraw.Draw(shadow)
    x0 = (CW - cw) // 2; y0 = int(128 * sc)
    sd.rounded_rectangle((x0 - 10, y0 + 30, x0 + cw + 10, y0 + ch + bar + 40), radius=int(20 * sc), fill=(0, 0, 0, 170)); shadow = shadow.filter(ImageFilter.GaussianBlur(40))
    bg = Image.alpha_composite(bg, shadow); bg.paste(card, (x0, y0), mask)
    d = ImageDraw.Draw(bg)
    # title chip
    t = seg["title"]; tw = d.textlength(t, font=f(int(40 * sc)))
    d.rounded_rectangle((x0, int(46 * sc), x0 + int(14 * sc) + tw + int(28 * sc), int(46 * sc) + int(58 * sc)), radius=int(14 * sc), fill=(18, 22, 30, 235), outline=GRN + (255,), width=2)
    d.rectangle((x0, int(46 * sc), x0 + int(6 * sc), int(104 * sc)), fill=GRN)
    d.text((x0 + int(22 * sc), int(52 * sc)), t, font=f(int(40 * sc)), fill=INK)
    d.text((x0 + int(14 * sc) + tw + int(50 * sc), int(63 * sc)), seg["sub"], font=f(int(22 * sc), FR), fill=MUTED)
    d.text((CW - x0 - d.textlength("ArcTools", font=f(int(26 * sc))), int(61 * sc)), "ArcTools", font=f(int(26 * sc)), fill=(120, 130, 150))
    out = f"comp/{seg['id']}.png"; bg.convert("RGB").save(out); return out

def title_card(seg, kind):
    """Transparent overlay for robot segments: big title + tagline (intro) / URL + tagline (outro), left-aligned in the free area."""
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    if kind == "intro":
        d.text((110, 120), seg["title"], font=f(120), fill=INK); d.rectangle((110, 256, 420, 264), fill=GRN); d.text((110, 284), seg["sub"], font=f(38, FR), fill=MUTED)
    else:
        d.text((110, 380), seg["title"], font=f(104), fill=INK); d.rectangle((110, 500, 380, 508), fill=GRN); d.text((110, 528), seg["sub"], font=f(40, FR), fill=MUTED)
        d.text((110, 600), "Terminal · Sniper · Buy bot · ArcToolsPad · ArcLocker · ArcPredict · Market · Bridge · x402 API · ArcOne", font=f(22, FR), fill=(120, 130, 150))
    out = f"comp/{seg['id']}_title.png"; ov.save(out); return out

# ── durations ──
plan = []
for i, seg in enumerate(segs):
    vo = dur(f"vo/{seg['id']}.mp3")
    if seg["kind"] == "robot":
        vid = f"robot_{seg['robot']}.mp4"; D = max(dur(vid), vo + VO_IN + PAD)
    else: D = vo + VO_IN + PAD
    plan.append({**seg, "vo_dur": vo, "dur": round(D, 3)})

# ── per-segment clips ──
for i, seg in enumerate(plan):
    out = f"clips/{i:02d}_{seg['id']}.mp4"
    if os.path.exists(out) and os.path.getsize(out) > 0: continue
    n = int(round(seg["dur"] * FPS))
    if seg["kind"] == "screen":
        src = composite(seg, i)
        zoom = "1.0+0.06*on/%d" % n if i % 2 else "1.06-0.06*on/%d" % n
        # gentle drift: alternate directions so consecutive shots feel different
        px = "iw/2-(iw/zoom/2)+%d*on/%d" % ((40 if i % 3 else -40), n); py = "ih/2-(ih/zoom/2)+%d*on/%d" % ((-25 if i % 2 else 25), n)
        vf = f"zoompan=z='{zoom}':x='{px}':y='{py}':d={n}:s={W}x{H}:fps={FPS},format=yuv420p"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", src, "-vf", vf, "-frames:v", str(n), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", out], check=True)
    else:
        vid = f"robot_{seg['robot']}.mp4"; ttl = title_card(seg, seg["robot"])
        # hold the last frame if the narration is longer than the clip; darken behind the title; fade title in
        fade_in = 0.6 if seg["robot"] == "intro" else 0.4
        vf = (f"[0:v]fps={FPS},scale={W}:{H},tpad=stop_mode=clone:stop_duration=6,trim=duration={seg['dur']},setpts=PTS-STARTPTS,"
              f"eq=brightness=-0.03[v];[1:v]format=rgba,fade=t=in:st={fade_in}:d=0.8:alpha=1[t];[v][t]overlay=0:0:format=auto,format=yuv420p")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", vid, "-loop", "1", "-i", ttl, "-filter_complex", vf, "-t", str(seg["dur"]), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", out], check=True)
    print("clip", out, seg["dur"])

# ── timeline offsets (xfade overlaps) ──
starts = []; t = 0.0
for i, seg in enumerate(plan):
    starts.append(t); t += seg["dur"] - (XF if i < len(plan) - 1 else 0)
TOTAL = t; print("total", round(TOTAL, 2))

# ── xfade chain ──
inputs = []; fc = []
for i, seg in enumerate(plan): inputs += ["-i", f"clips/{i:02d}_{seg['id']}.mp4"]
prev = "[0:v]"; off = 0.0
for i in range(1, len(plan)):
    off += plan[i - 1]["dur"] - XF; lab = f"[x{i}]" if i < len(plan) - 1 else "[vout]"
    tr = "fade" if plan[i]["kind"] == "robot" or plan[i - 1]["kind"] == "robot" else ("smoothleft" if i % 2 else "fadeblack")
    fc.append(f"{prev}[{i}:v]xfade=transition={tr}:duration={XF}:offset={off:.3f}{lab}"); prev = lab
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[vout]", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "video_nosub.mp4"], check=True); print("xfade ok")

# ── captions (ASS) ──
def ts(x): h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60; return f"{h}:{m:02d}:{s:05.2f}"
def chunks(text, maxc=60):
    words = text.split(); out = []; cur = ""
    for w in words:
        if len(cur) + len(w) + 1 > maxc and cur: out.append(cur); cur = w
        else: cur = (cur + " " + w).strip()
    if cur: out.append(cur)
    # merge into 2-line cues
    cues = []
    for k in range(0, len(out), 2): cues.append("\\N".join(out[k:k + 2]))
    return cues
ass = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 2", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Cap,Roboto,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,14,0,2,200,200,52,1", "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
for i, seg in enumerate(plan):
    cues = chunks(seg["vo"]); total_chars = sum(len(c) for c in cues); t0 = starts[i] + VO_IN; span = seg["vo_dur"]
    acc = 0.0
    for c in cues:
        d_ = span * len(c) / total_chars; ass.append(f"Dialogue: 0,{ts(t0 + acc)},{ts(t0 + acc + d_ - 0.05)},Cap,,0,0,0,,{c}"); acc += d_
open("captions.ass", "w").write("\n".join(ass))

# ── audio: VO at offsets + music ducked under speech ──
ain = []; amix = []
for i, seg in enumerate(plan):
    ain += ["-i", f"vo/{seg['id']}.mp3"]; amix.append(f"[{i}:a]adelay={int((starts[i] + VO_IN) * 1000)}|{int((starts[i] + VO_IN) * 1000)},volume=1.0[a{i}]")
n = len(plan); music = "music.mp3" if os.path.exists("music.mp3") else None
if music:
    ain += ["-stream_loop", "-1", "-i", music]
    fc_a = ";".join(amix) + ";" + "".join(f"[a{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,dynaudnorm=f=250:g=15:p=0.9[vo];" \
        + f"[{n}:a]atrim=0:{TOTAL:.3f},afade=t=in:d=1.5,afade=t=out:st={TOTAL - 4:.3f}:d=4,volume=0.55[m];[vo]asplit[vo1][vo2];[m][vo2]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=600:makeup=1[md];[vo1][md]amix=inputs=2:normalize=0,alimiter=limit=0.95[aout]"
else:
    fc_a = ";".join(amix) + ";" + "".join(f"[a{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,dynaudnorm=f=250:g=15:p=0.9,alimiter=limit=0.95[aout]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *ain, "-filter_complex", fc_a, "-map", "[aout]", "-t", f"{TOTAL:.3f}", "-c:a", "aac", "-b:a", "192k", "audio.m4a"], check=True); print("audio ok", "music" if music else "no music")

# ── final: burn captions + mux ──
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "video_nosub.mp4", "-i", "audio.m4a", "-vf", f"subtitles=captions.ass:fontsdir={FDIR}", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", "-movflags", "+faststart", "arctools-features.mp4"], check=True)
json.dump({"plan": plan, "starts": starts, "total": TOTAL}, open("plan.json", "w"), indent=1); print("done", round(TOTAL, 1))
