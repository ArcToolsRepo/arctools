"""Real desktop screenshots of arctools.fun pages for the feature film (1920x1080 viewport, dark theme, network idle)."""
import json, sys, time
from playwright.sync_api import sync_playwright
S = json.load(open("script.json"))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1, color_scheme="dark", user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36")
    pg = ctx.new_page()
    for seg in S["segments"]:
        if seg["kind"] != "screen": continue
        out = f"shots/{seg['id']}.png"
        try:
            pg.goto(seg["url"], wait_until="networkidle", timeout=60000)
        except Exception as e: print("slow", seg["id"], str(e)[:60])
        time.sleep(6 if seg["id"] in ("terminal", "predict", "market") else 3)
        # dismiss cookie/consent-like overlays if present
        for sel in ("button:has-text('Got it')", "button:has-text('Accept')", "button:has-text('Close')"):
            try:
                el = pg.query_selector(sel)
                if el and el.is_visible(): el.click(); time.sleep(0.5)
            except Exception: pass
        pg.screenshot(path=out, full_page=False); print("shot", seg["id"])
        if seg["id"] in ("terminal", "market", "launchpad"):   # second frame lower on the page for a scroll move
            pg.mouse.wheel(0, 700); time.sleep(1.5); pg.screenshot(path=f"shots/{seg['id']}_b.png", full_page=False)
    b.close()
