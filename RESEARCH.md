# Research: the market, the gap, and what to build next

Written before the code, and the reason the code looks the way it does.

---

## 1. What already exists

The space splits cleanly into two camps that barely talk to each other.

### Camp A — digital wardrobe apps

| App | Strength | Documented weakness |
|---|---|---|
| **Whering** | Best free tier; strong visual closet, remixing, packing, community | The "Dress Me" shuffle is close to random, and the AI outfit generator produces suggestions reviewers describe as *disjointed from personal style* |
| **Acloset** | AI auto-tagging on upload, weather-aware suggestions, chat assistant, resale marketplace | Development slowed through 2026; calendar bugs reported |
| **Indyx** | Best-in-class cataloguing: auto-tagging accuracy, receipt scanning, cost-per-wear, shopping suggestions | Styling advice is thin next to the analytics |
| **Stylebook** | Deepest analytics of any of them; one-time $5.99 | Setup is brutal — **8–15 hours** to photograph 100–200 items |

**What every one of them is missing: your body.** Not one takes chest, waist, hip and inseam and uses them to judge whether a garment fits. They catalogue clothes; they don't measure them against you.

### Camp B — virtual try-on

Diffusion try-on is genuinely good now. IDM-VTON and CatVTON are the leading open models (CatVTON was accepted to ICLR 2025 and does it with a single compact UNet). Commercial APIs are cheap and easy: FASHN v1.6 runs about **$0.075 per generation** on fal, dropping under $0.04 at volume.

But the reviews say the same thing over and over:

- *"Today's virtual try-on is good at helping shoppers visualise style, but falls short on sizing."*
- A user told the app they were a 6/M; it predicted 12/L. *"I was hoping to AVOID ordering the wrong size, and this was a total fail."*
- A rendered dress appeared as *"a draped rectangle ending somewhat crudely in ruffles right at crotch height."*

### Why this matters commercially

- Apparel return rates run **20–40%**, against ~19% for e-commerce overall.
- **Fit and sizing causes roughly half of all apparel returns** — some studies put it at 70%.
- "Bracketing" (ordering three sizes, returning two) is now mainstream behaviour, up from ~40% of shoppers in 2018.

A pretty picture does not fix any of that.

---

## 2. The gap, stated plainly

> **Wardrobe apps know your clothes but not your body. Try-on apps render your body but don't understand your clothes. Nobody does the arithmetic.**

A generative model cannot tell you a shirt won't close across your chest, because it was never given your chest measurement. It will happily paint a garment onto you that you physically cannot button.

That's the wedge, and it produced the central architectural decision in this build:

**Separate the fit maths from the pretty picture.**

| | Fit engine | AI render |
|---|---|---|
| Cost | Free | ~$0.075 per image, ×N garments |
| Latency | Instant | 5–60s |
| Determinism | Same input, same answer | Varies run to run |
| Explains itself | "4cm tight at the chest — try an L" | No |
| Works offline | Yes | No |
| Needs a photo of you | No | Yes |

So the arithmetic answers *will this fit and does it work*, and the render is an optional picture of an answer you already have. The app is fully useful with no API key, no GPU, and no per-image cost. Try-on is a garnish you can switch on.

---

## 3. What was built

Six scored dimensions, each returning a score **and a confidence**, each producing plain-English reasons with concrete fixes.

1. **Fit** (weight 1.5 — outranks everything) — per-landmark ease analysis in centimetres
2. **Colour** — palette match, harmony, and personal-contrast, kept as three separate questions because they can disagree
3. **Proportion** — volume balance, waist definition, break points, body-shape strategy
4. **Formality** — internal coherence *and* occasion match (spread, not average, catches the suit-jacket-with-trainers problem)
5. **Weather** — clo-based thermal comfort against a live forecast
6. **Rotation** — repeat avoidance and dead-stock rescue

### The fit pipeline

```
garment circumference − body circumference          = raw ease
+ stretch beyond what the ease band already assumes = comfort credit
+ learned brand bias                                = calibration
→ compared against a preference-shifted ease band   → verdict + advice
```

Three details that matter:

- **Stretch is credited as a delta, not an absolute.** The ease band for a jersey tee already assumes a knit. Crediting the full stretch again would double-count and call every tee roomy. Only stretch *beyond* the baseline counts — which is why 2% elastane in a woven shirt buys real room and a plain cotton tee buys none. There's a test for exactly this.
- **Worst-landmark-dominant scoring.** A jacket is only as wearable as its tightest point. Aggregation is 45% mean / 55% worst, so one unwearable landmark can't be averaged away.
- **Confidence is a first-class output.** A size label gives ~45% confidence; measured garment dimensions give >90%. The UI always shows which one you're looking at, and tells you exactly what would raise it.

### Three design decisions worth flagging

**Confidence-weighting the composite.** Every dimension contributes at `weight × (0.35 + 0.65 × confidence)`. A dimension we had to guess at never shouts as loudly as one we measured. This is what makes the app trustworthy on day one *and* better on day thirty — it degrades honestly instead of bluffing.

**No gender field anywhere.** Sizing block is a property of the *garment* (`alpha-mens`, `us-womens`, …), because that's what it actually is. Gap analysis infers which blocks you wear from what you own, so it never suggests a skirt to someone with no evidence they'd want one, and never asks anyone to declare anything.

**Colour maths in CIELAB, not HSL.** HSL lies about lightness — `#0000FF` and `#FFFF00` have identical HSL lightness and wildly different perceived brightness. Differences use CIEDE2000; CIE76 overstates differences in the blue region badly enough to flag every navy-and-charcoal outfit as a clash. There's a test asserting navy/charcoal reads as close and navy/orange doesn't.

---

## 4. Features recommended and built

Beyond the original ask, these were the highest-value additions:

| Feature | Why |
|---|---|
| **Gap analysis** | Answers the counterfactual: *which single thing you don't own would unlock the most outfits?* Add a hypothetical, re-run the search, measure the delta. Turns "I have nothing to wear" into a list of three items with a cost-per-outfit-unlocked figure. |
| **Brand fit calibration** | One tap after wearing ("how did that fit?") teaches the app that a brand runs 6cm small on you — then applies it to everything from that brand, *including things you haven't bought*. This is the asset that compounds and that a competitor can't copy by shipping a better image model. |
| **Live fit preview while adding an item** | The engine runs client-side as you type. Watching "too tight at the chest" appear the moment you enter a size is the moment the app justifies itself. |
| **Client-side colour extraction** | k-means in LAB with border-based background exclusion. Auto-fills colours from a photo with zero API cost — and unlike averaging, a navy shirt on a white hanger doesn't come out periwinkle. |
| **Packing optimiser** | Set-cover: fewest garments that still cover every day and occasion. |
| **Availability state** | Never suggests a shirt that's in the wash. Sounds trivial; it's the difference between advice and a database dump. |
| **Orphan detection** | Items with nothing to pair with. Reframes "this was a bad buy" as "this is a gap *elsewhere*" — and links to the fix. |
| **Pluggable try-on** | fal / FASHN / custom endpoint, degrading to a flat-lay with no key. |

---

## 5. Recommended next — not built

Ranked by value.

### Tier 1

**1. Pre-purchase check (paste a product URL).** The single biggest commercial opportunity. Scrape the size chart and photos, predict fit on *your* measurements, score against your *existing* wardrobe, and return: "This fits — but you own nothing it goes with," or "Size up; their M runs 4cm small on you." Attacks the 50%-of-returns problem at the moment of decision. Everything needed is already in the engine.

**2. Body-change tracking.** Measurements over time, with automatic flagging of items that no longer fit. Nobody does this, and it's the reason wardrobes silently rot.

**3. Photo → measurement estimation.** Two photos (front + side) with a reference object, or MediaPipe pose landmarks, to estimate body measurements. Removes the tape measure, which is the single biggest onboarding drop-off. Should *seed* the measurements as low-confidence and ask for confirmation — never silently replace a real one.

**4. Calendar integration.** Read tomorrow's events, infer dress code, have the outfit ready before you wake up. Turns the app from a destination into a habit.

### Tier 2

**5. Bulk onboarding.** Stylebook's 8–15 hours is the category's biggest failure. Multi-item photo upload with automatic segmentation, plus receipt/order-history import.

**6. Second opinion.** Share an outfit as a link, collect votes. The most-requested social feature that isn't a feed nobody reads.

**7. Resale triage.** Dead stock already surfaces in Insights — connect it to a listing flow with a suggested price.

**8. Repair and alteration tracking.** The fit engine already knows a garment needs 3cm off the sleeve. Make that a task with a tailor's note.

### Tier 3

**9. Care and longevity.** Wash counts, fabric-appropriate care, "this has been washed 40 times" replacement warnings.
**10. Shared household wardrobes.** Couples and families share more clothes than any app admits.
**11. Adaptive dressing.** Seated fit, one-handed fastening, sensory-friendly fabrics — an underserved group and a genuine differentiator.
**12. Capsule builder.** "Build me a 30-item wardrobe from what I own" — the packing optimiser generalised.

---

## 6. Honest limitations

- **Fit prediction is not measurement.** It reasons about ease at landmarks; it can't see how a garment drapes, where it pulls diagonally, or how a curved seam sits. It will tell you a shirt is 4cm tight at the chest. It won't tell you the armhole is cut wrong.
- **Size-chart inference is genuinely weak** — hence 45% confidence and the constant nudge toward measuring. Brand drift is real, which is exactly why the calibration loop exists.
- **Body shape archetypes are a simplification.** They're scored continuously and overridable for that reason.
- **Colour analysis is contested.** The 12-season system is an industry convention, not physics. It's implemented as three continuous axes with a confidence and an override, rather than presented as fact.
- **The proportion rules encode conventional styling.** They describe where the eye lands, not what anyone *should* wear. Every one of them is visible, explained, and ignorable.
- **The weather model assumes sedentary outdoor activity.** No activity-level input yet.

---

## Sources

- [The Best Wardrobe Apps 2026: Compared & Ranked — Indyx](https://www.myindyx.com/blog/the-best-wardrobe-apps)
- [Vesta vs Indyx vs Whering vs Acloset](https://vestatheapp.com/blog/vesta-vs-indyx-whering-acloset)
- [Best Wardrobe Apps 2026: 10 Outfit Planners Compared](https://getwardrobe.com/compare/)
- [Best Wardrobe Apps in 2026: 10 Closet Apps Tested & Ranked — Nouva](https://www.nouva.app/blog/best-wardrobe-apps-2026-comparison)
- [Comparing the Top 4 Open Source Virtual Try On Models — FASHN](https://fashn.ai/blog/comparing-the-top-4-open-source-virtual-try-on-viton-models)
- [Google Research and UW's FIT: What It Means for Virtual Try-On — FASHN](https://fashn.ai/blog/google-research-and-uws-fit-what-it-means-for-virtual-try-on)
- [Awesome-Try-On-Models (paper/code index)](https://github.com/Zheng-Chong/Awesome-Try-On-Models)
- [IDM-VTON](https://idm-vton.github.io/)
- [10 Best Virtual Try-On APIs in 2026 — fal](https://fal.ai/learn/tools/best-virtual-try-on-apis-2026)
- [Ecommerce Return Rates in 2026 — Richpanel](https://www.richpanel.com/learn/ecommerce-return-rates)
- [Average Ecommerce Return Rate 2026 — Eightx](https://eightx.co/blog/average-ecommerce-return-rate)
- [E-commerce Return Rates: The Hidden Cost of Poor Sizing Data](https://esencasizing.com/ecommerce-return-rates-poor-sizing-data/)
- [Clothing & Shoes Are the Most Returned Online Purchases — Statista](https://www.statista.com/chart/34373/most-returned-product-categories-purchased-online/)
- [Virtual Try-On Apps Guide — Fytted](https://fytted.com/blog/virtual-try-on-apps-guide)
- [Colour analysis and body shape analysis — Inspired Styling](https://www.inspired-styling.co.uk/colour-analysis-and-body-shape-analysis)
