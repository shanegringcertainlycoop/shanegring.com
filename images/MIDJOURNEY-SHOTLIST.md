# Midjourney shot list — Operating Ladder hero images

Style anchor: the two existing pieces (`hero.png`, `operating-map-hero.png`) — SNES-era
16-bit pixel art, real-world civic-infrastructure scenes, muted blue-gray + cream palette
with warm orange and teal accents, big cumulus clouds, clean composition, no readable text.

**Shared style suffix for every prompt** (once the site is live, the `--sref` URLs lock
Midjourney to the existing art; until then drop the flag and upload the two images as
style references instead):

```
detailed 16-bit pixel art illustration, SNES-era videogame aesthetic, crisp pixel
clusters, muted blue-gray and cream palette with warm orange and teal accents, soft
daytime light, large cumulus clouds, clean composition, no text, no lettering
--ar 16:9 --sref https://shanegring.com/images/hero.png https://shanegring.com/images/operating-map-hero.png
```

Export notes: placeholders are 16:9; export ~2464px wide for retina. The CSS renders
these with `image-rendering: pixelated`, so downscale with nearest-neighbor if needed.
Midjourney garbles written text — keep signs/boards abstract color blocks, like the
transit map in the existing Operating Map hero.

---

## 1. `/work-with-me` — the path ✅ DONE (`work-with-me-hero.png`, 2026-07-08)

**Idea to carry:** one continuous path, five distinct stops, rising toward something built.

> a hillside funicular railway climbing from a small seaside platform to a bright
> hilltop terminus, five distinct stations along the track, each station larger and
> more built-up than the last, one tram car mid-climb, terraced town and harbor below,
> [style suffix]

## 2. `/read` — the Read ✅ DONE (`read-hero.png`, 2026-07-08)

**Idea to carry:** a person closely reading a building the way I read a website.

> a building inspector on a rolling scaffold closely examining an aging storefront
> facade, clipboard in hand, small annotation flags pinned to the brickwork, warm
> light from the shop window, quiet street, [style suffix]

## 3. `/operating-site` — the build ✅ DONE (`operating-site-hero.png`, 2026-07-08)

**Idea to carry:** prefab modules, each complete, craned into one coherent building.

> a modular construction site, a tower crane lowering a fully furnished prefabricated
> room module into a half-assembled modern building, other completed modules already
> lit and occupied, workers guiding the module into place, [style suffix]

## 4. `/operating-partner` — the monthly rhythm ✅ DONE (`operating-partner-hero.png`, 2026-07-08)

**Idea to carry:** someone assigned to keep what the board says matched to what's true.

> a station master on a ladder updating a huge split-flap departure board in a grand
> train station at dusk, board tiles mid-flip rendered as abstract color blocks,
> commuters below, warm lamps against blue evening light, [style suffix]

---

## 5. Site-wide footer band — the whole city ✅ DONE (`footer-city.png`, 2026-07-08; footer background #2b5d64 continues the water)

**Idea to carry:** every motif in one skyline — the city the rest of the art lives in.
One strip used across all page footers.

> a wide panoramic city skyline at dusk seen from across the water, an elevated train
> crossing the full width on a viaduct, a funicular track climbing a hill on the left,
> a grand station facade and a tower crane among the rooftops, telecom towers with
> blinking lights, hundreds of small warm lit windows, harbor boats in the foreground,
> [style suffix but with] --ar 4:1

If 4:1 comes back mushy or repetitive, generate at --ar 21:9 and use Midjourney's
pan left/right to extend the strip, or upscale and crop a horizontal band.

---

## 7. `/scan` — the Scan hero ✅ DONE (`scan-hero.png`, 2026-07-08)

**Idea to carry:** a beam sweeping the city, lighting up what machines can see —
some of it lit, some in shadow.

> a lighthouse on a rocky point at the edge of a harbor city at dusk, its bright
> beam sweeping across the water and lighting up a slice of the buildings on the
> far shore, the lit buildings glowing warm while the rest sit in blue shadow,
> small boats on the water, [style suffix] --ar 16:9

Placement: below the scan intro (the CSS gauge card on the right stays — it's
replaced by live results when a scan runs).

## 8. `/approach` — the centralizing layer

**Idea to carry:** the hub the whole city runs through — every line converges into it.

> a grand central railway station at the heart of a city seen from a high vantage
> point in morning light, many train lines converging into it from every direction,
> trains arriving and departing, the glass-roofed station hall glowing warm, the
> city's streets and buildings radiating outward around it, people flowing toward
> the entrances, [style suffix] --ar 21:9

Placement: likely below the "Looked at vs. run from" section; the existing
approach-hero.svg diagram stays in the hero (it labels what radiates from the
site — real explanatory content). Fall back to --ar 16:9 + crop if 21:9 is mushy.

## 6. Path icons — all five stages ✅ v2 DONE (`icons/*.png`, 2026-07-09)
(v1 had too much variance. v2: flat front-facing enforced, one color per rung —
Scan teal, Read sky blue, Map cobalt, Site warm orange, Partner brick red. The
ramp runs cool diagnostics → warm build/run, matching the ladder.)

Generate all five together so the set matches (the hand-coded `icons/map.svg` gets
replaced too). MJ returns 1024px squares, not true 16px grids — Claude downscales
nearest-neighbor to the 56px slots and cleans backgrounds on delivery.

**Shared suffix:**

```
simple pixel art icon, chunky 16x16-style pixel sprite, thick blocky pixels, flat
cobalt blue and sky blue palette (#4a90e2, #5ba3f5, #6bb6ff) on a plain white
background, single centered object, retro videogame inventory icon, no text,
no border --ar 1:1 --stylize 50
```

Objects (each echoes its page's hero scene):

1. Scan — `a radar dial gauge with a sweeping needle,`
2. Read — `a clipboard with a magnifying glass over it,`
3. Map — `a folded transit map with route lines,`
4. Site — `a crane hook lifting a small building block,`
5. Partner — `a split-flap departure board tile mid-flip,`

Tips: generate all five in one session; reroll drifters with `--seed` from the best
job; `--stylize 50` keeps MJ literal instead of illustrative.
