# ArcTools — design brief

## Design read
For Arc-chain degens and pro snipers who live in Telegram: the site must feel like a
precision instrument for money, not a meme casino. Register: calibrated, fast, dollar-clean.

## Concept spine
**"The site is a range-finder being calibrated."** Scrolling turns the calibration dial:
a machined cobalt-and-steel targeting instrument assembles, engraves its venue ticks,
reveals its dollar core, and locks its reticle. Every UI element borrows range-finder
grammar: tick marks, engraved mono labels, aperture corners.

## Delivery tier
cinema (Lenis+GSAP, scroll-scrub journey Tier-1).

## Locked palette
- Paper `#EFEDE4` (warm instrument-lab paper; NOT the banned beige+brass family: the accent is cobalt, zero brass/clay/oxblood anywhere)
- Ink `#161A22` (off-black, blue-leaning)
- Cobalt `#1B3FCF` (the ONE accent, engraved details + CTAs)
- Muted `#5D6474` (secondary ink)
- Metal highlight in imagery only: brushed silver `#C9CDD6`
Defense: cobalt+cream is the USDC/dollar world without the near-black+neon-terminal cliché;
light theme sets it apart from every trading-tool site.

## Locked type
- Display: **Outfit** (600/700, tracking-tight)
- Mono: **IBM Plex Mono** (numbers, ticks, addresses, engraved labels)
No serif anywhere.

Animation mode: animated-website

## Journey shape: single-shot
ONE continuous ~12-15s film, cut frame-exact into 4 chapter segments (same take, zero seams).

## Journey
World grammar (byte-identical preamble for all imagery): "macro studio film of a precision
machined targeting instrument, brushed steel and cobalt blue enamel, warm paper-white seamless
studio background, soft diffused light from upper left, shallow depth of field, no text, no
logos, no watermark". Camera: one continuous slow push-in with a quarter orbit; locked
exposure; no cuts.

1. **INSTRUMENT** (0-25%): the instrument emerges from soft paper-white fog, half-assembled
   rings floating. Headline: "Snipe the first block on Arc". Body: one-liner on ArcTools =
   sniper terminal for Arc. Tags: ARC 5042, USDC-NATIVE. CTA: Open the bot.
2. **VENUES** (25-50%): camera quarter-orbits; concentric rings click into place, engraved
   tick marks catching light. Headline: "Every launchpad. One crosshair." Body: RadarDex,
   ArcPad, Warp, Uniswap V3 today, any pad tomorrow (config, not code).
3. **SPEED** (50-75%): push into the macro dollar-coin core of the instrument, cobalt enamel
   ring around a machined coin disc. Headline: "Dollar-native. Sub-second." Body: race
   broadcast across RPCs, pre-approved USDC, 0.6s blocks.
4. **LOCK** (75-100%): the aperture blades close and the reticle locks to center, assembled
   instrument at rest, beauty frame. Headline: "Lock. Fire. Track." Body: positions panel
   with live PnL after every buy. Tags: TP 2-10X, PANIC SELL.

Mobile framing: subject stays center-safe; edges expendable (cover crop). Lighter mobile encodes.
Delivery budget: desktop clips ≤32 MiB total, mobile ≤16 MiB.

## Section plan (after the journey; one family each, no repeats)
1. Journey (scroll-scrub, 4 chapters) — Tier-1
2. Venues rail — horizontal mono-ticker row of supported venues (RadarDex / ArcPad / Warp / Uniswap V3) with engraved tick separators
3. Feature bento — exactly 5 cells (Sniper modes, Positions+PnL, CCTP bridge, Copy-trade, Alerts); 3 cells carry visuals (panel UI image, icon art, pattern tint)
4. How it works — 3-step vertical ladder with generated step icons (fund → arm → track)
5. Positions panel showcase — split: left copy, right generated Telegram-panel UI image
6. CTA band — full-width paper plate, one primary CTA
Footer — mono links (Arc Scan, RadarDex, docs), monogram.
Eyebrow budget: ceil(6/3)=2 (used on bento + steps only).

## Asset plan
- Storyboard 6-panel (Phase 1, generation source of truth)
- Film: ONE seedance take (~12s, 16:9, 1080p, no audio) → 4 frame-exact segments + posters + mobile encodes
- Logo/monogram: arc + reticle mark, cutout, nav + head kit
- Custom icon sheet: 6 glyphs (crosshair, bolt, bridge, copy, bell, shield), 2px stroke, cobalt on paper, sliced + bg-removed
- Positions-panel UI image (generated, not div-fake): Telegram-style PnL card in brand grade
- Section plate: subtle paper-grain texture
- OG 1200×630 (via launch branding) + full head kit from monogram
- Launch branding (cover/OG/favicon) via generate_app_branding, submitted WITH the film

## CTA inventory
- **"Open the bot"** (primary; hero chapter + CTA band): cobalt pill, reticle corner brackets
  that expand on hover, magnetic pull, `:active` scale-98. Links t.me/ArcSniper_bot.
- **"Watch the feed"** (secondary; venues rail): mono underline that sweeps like a ranging
  tick, links t.me/ArcSniper_bot?start=feed.
- **"View source on Arc Scan"** (footer, mono link): dotted underline, external.
One label per intent page-wide.

## Anti-convergence ledger
First build in this chat. Palette family: cream+cobalt (light). Type: Outfit+Plex Mono.
Hero architecture: scroll-scrub film. Tier-1: A4 scrub. CTA garments: reticle brackets,
ranging-tick underline. Corner language: all-sharp with 2px aperture corner accents.
