# FitCheck

**Your wardrobe and your measurements, scored together.**

Photograph your clothes, enter your measurements once, and get an explainable
verdict on any combination before you put it on: *will this fit, does it work,
and is it right for where you're going?*

The answer is arithmetic over centimetres, not a guess from a model — so it's
instant, free, deterministic, and it can always show its working.

```bash
npm install                                                # Node 22
createdb fitcheck                                          # any Postgres ≥ 14
export DATABASE_URL=postgres://localhost:5432/fitcheck
npm run seed     # optional: a realistic 21-item demo wardrobe
npm run dev      # http://localhost:3000
```

No API keys required. `DATABASE_URL` is the only thing the app needs; the
schema creates itself on first connection, and the first account you register
owns everything already in the database.

Everything lives in Postgres — including the photos, which are stored as rows
rather than files. That costs a little space and buys the app statelessness: it
can run on any container platform with no volume attached, scale past one
instance, and survive a redeploy with the wardrobe intact. A `pg_dump` is a
complete backup.

---

## Why this is different

Wardrobe apps (Whering, Acloset, Indyx, Stylebook) catalogue your clothes but
never ask for your body. Virtual try-on tools render your body but don't
understand your clothes — which is why reviewers keep reporting that try-on
"falls short on sizing," and why fit and sizing still causes roughly **half of
all apparel returns**.

FitCheck does the arithmetic in between. The full competitive analysis, the
reasoning behind each engine, and a ranked list of what to build next are in
[RESEARCH.md](./RESEARCH.md).

**The core architectural decision: the fit maths and the pretty picture are
separate things.** A diffusion render can't tell you a shirt won't close across
your chest, because nobody gave it your chest measurement. So the engine answers
whether it fits, and the AI render — optional, pluggable, off by default — is
just a picture of an answer you already have.

---

## What it does

**Today** — ranked outfits from what's actually clean, scored for the occasion
and today's forecast, each with the reason it's ranked where it is.

**Wardrobe** — items with a per-garment fit report: your measurement, the
garment's, the room between them, and a verdict per landmark. A live fit preview
runs *as you type* while adding an item, and **On you** hangs the piece on the
same figure the You page builds — see below.

**Studio** — build a combination and watch six dimensions score it in real time,
with the specific tweak that would fix each problem.

**Gaps** — the counterfactual: which single item you don't own would unlock the
most wearable outfits. Built by adding a hypothetical garment sized to your
measurements and re-running the whole outfit search.

**Pack** — the fewest garments that still cover every day and occasion of a trip.

**Insights** — cost per wear, dead stock, items with nothing to pair with, and
what the app has learned about how each brand sizes on you.

**You** — measurements, colouring, fit preferences, and a figure built from
your girths that you can turn through 360° and tilt to see from any side. Body
shape and seasonal palette derive live as you type, both overridable.

### Seeing the fit instead of reading it

Open any garment and the same figure is wearing it. The shell is built from
*that garment's* measurements — chest flat doubled, waist flat doubled, body
length from the high point of the shoulder — stacked at the landmark heights of
*your* body. So the gap between cloth and skin **is** the ease: the number in
the room column of the table above it, drawn rather than tabulated, and you can
walk around it.

Where a garment is narrower than you it moulds on rather than passing through,
because that is what fabric does — so "too tight" reads as a shell pressed onto
the body and "oversized" as one standing well off it, without either needing a
label. Anything you haven't measured falls back to the middle of that
subcategory's ideal ease band, and the caption says which. Accessories and bags
have no honest shape on a mannequin, so they're named beside the figure rather
than drawn badly on it.

It is the same renderer as the You page, drawing into the same 2D canvas — no
WebGL, no model, nothing fetched.

---

## The six dimensions

Every one returns a score **and a confidence**, and the composite weights by
both — a dimension we had to guess at never shouts as loudly as one we measured.

| Dimension | Weight | What it checks |
|---|---|---|
| **Fit** | 1.5 | Per-landmark ease against your measurements |
| **Colour** | 1.0 | Palette match, harmony, personal contrast |
| **Proportion** | 1.0 | Volume balance, waist definition, break points |
| **Formality** | 1.15 | Internal coherence *and* occasion match |
| **Weather** | 1.05 | clo-based thermal comfort vs. the forecast |
| **Rotation** | 0.6 | Repeat avoidance, dead-stock rescue |

### How fit works

```
garment circumference − body circumference          = raw ease
+ stretch beyond what the ease band already assumes = comfort credit
+ learned brand bias                                = calibration
→ compared against a preference-shifted ease band   → verdict + advice
```

Verdicts run *too tight → snug → ideal → relaxed → oversized → too loose*, per
landmark, each with the fix: *"4cm tighter than comfortable at the chest. Try an
L."* — or, for a shoulder seam falling inside your shoulder point, *"This is the
one thing a tailor cannot fix — treat it as the wrong size."*

Confidence is honest about its source: a size label alone gives ~45%; measured
garment dimensions give >90%. Every screen tells you which you're looking at and
what would raise it.

### Brand calibration is the part that compounds

One tap after wearing something — *how did that fit?* — and the app learns that
a brand runs 6cm small **on you**, then applies that to everything from that
brand, including things you haven't bought yet. Five answers and it knows your
sizing better than any chart does.

---

## Accounts

Email and password, with a session cookie. Passwords are hashed with scrypt at
N=16384 and a per-password salt; the session cookie is 32 random bytes of which
only the SHA-256 is stored, so a leaked database yields neither passwords nor
usable sessions. There is no auth dependency — both are `node:crypto`.

Every row in every table belongs to an account, and every query filters on it,
so isolation is a property of the data layer rather than something each route
has to remember. Asking for another account's garment, editing it, deleting it,
or fetching its photos all answer exactly as they would for an id that never
existed.

Signup is open by default, because the usual case is someone deploying this for
themselves. Set `FITCHECK_SIGNUP=closed` once the accounts that should exist do
— the first account is always allowed, or a closed instance could never be set
up at all.

**Upgrading an instance that predates accounts:** nothing is lost. Rows without
an owner are invisible to every query until the first account is created, which
adopts them. Register first, with the address you want to keep.

---

## Configuration

`DATABASE_URL` is required. Everything else is optional.

| Variable | Effect |
|---|---|
| `DATABASE_URL` | **Required.** Postgres connection string. |
| `DATABASE_SSL` | `disable`, `require`, or `verify`. Inferred from the host if unset — see below. |
| `DATABASE_POOL_MAX` | Connections per instance. Default 10. |
| `FITCHECK_SIGNUP` | `open` (default) or `closed`. The first account is always allowed. |
| `FITCHECK_TRYON_PROVIDER` | `none` (default), `fal`, `fashn`, or `custom`. |
| `FAL_KEY` | For `fal` — runs FASHN v1.6, ~$0.075 per garment layer. |
| `FASHN_API_KEY` | For `fashn`. |
| `FITCHECK_TRYON_URL` / `FITCHECK_TRYON_KEY` | For `custom` — any endpoint taking `{ personImage, garmentImage, category }` and returning `{ image }`. |

With no provider set, the Studio shows a flat-lay composite. For the question
*"does this combination work?"* that's most of the value at none of the cost —
the score to the side is what answers whether it fits.

Weather uses [Open-Meteo](https://open-meteo.com/), which needs no key. If it's
unreachable the weather dimension drops to zero confidence rather than inventing
a number.

---

## Deploying to Railway

1. **New Project → Deploy from GitHub repo**, and pick this repository.
2. **New → Database → Add PostgreSQL** in the same project.
3. On the app service, add one variable — as a *reference*, not a pasted URL:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

   That resolves to the private-network host, which is faster, free of egress
   charges, and needs no TLS. Pasting the public proxy URL instead works, but
   sends every query out over the internet.
4. Deploy. `railway.json` handles the rest: build, start on `$PORT`, and gate
   the deploy on `/api/health`, which fails if Postgres can't be reached.

**Node 22 is required**, and pinned in `engines` and `.nvmrc` so Nixpacks picks
it up. Image conversion uses libvips through `sharp`, which needs Node ≥ 20.9;
Nixpacks otherwise defaults to Node 18, and the build fails while collecting
page data with *"Could not load the sharp module"*. If your builder ignores
both files, set `NIXPACKS_NODE_VERSION=22` as a service variable. (Node 18 has
been end-of-life since April 2025 regardless.)

The schema creates itself on first connection, guarded by a Postgres advisory
lock so that two instances booting together can't race. If the app starts before
the database is ready it returns 503 and retries — no restart needed.

To load the demo wardrobe into the deployed database, point the seed at it:

```bash
DATABASE_URL='<the public proxy URL from Railway>' npm run seed
```

It creates a `demo@fitcheck.local` account, prints a generated password once,
and refuses to run against an account that already holds garments unless you
pass `--force`, because it clears that account's wardrobe before writing.

### A note on TLS

`DATABASE_SSL` is inferred from the host: private and localhost addresses
connect in the clear, anything else negotiates TLS *without verifying the
certificate* — managed Postgres proxies rarely present a publicly-chained one,
and verification would simply fail. That encrypts the connection but does not
authenticate the server, which is the honest reason to prefer the private URL
in production. Set `DATABASE_SSL=verify` if your provider does issue a
verifiable certificate.

---

## Layout

```
src/lib/
  types.ts                 domain model — centimetres everywhere
  color/space.ts           sRGB ↔ CIELAB ↔ LCh, CIEDE2000
  color/palette.ts         12-season analysis as three continuous axes
  data/fabrics.ts          fibre stretch, warmth, breathability, drape
  data/garmentTypes.ts     ~60 garment types: ease bands, clo, volume, hems
  data/sizeCharts.ts       size label → the body it was cut for
  engine/fit.ts            the core: per-landmark ease analysis
  engine/color.ts          palette · harmony · contrast, kept separate
  engine/proportion.ts     silhouette and body-shape strategy
  engine/formality.ts      spread and occasion match
  engine/weather.ts        clo model and thermal comfort
  engine/novelty.ts        rotation and dead-stock rescue
  engine/index.ts          confidence-weighted composite
  engine/combos.ts         beam-searched outfit generation
  engine/gaps.ts           counterfactual purchase analysis
  engine/packing.ts        set-cover packing optimiser
  engine/calibration.ts    per-brand fit learning
  engine/insights.ts       wardrobe analytics
  avatar/body.ts           the figure: measurements lofted into a mesh
  avatar/garment.ts        clothes built from their own measurements, hung on it
  avatar/render.ts         software renderer — projection, shading, girth bands
  auth.ts                  scrypt passwords, session tokens
  db.ts                    Postgres: schema, queries, image bytes
  tryon.ts                 pluggable render providers
src/app/                   Next.js App Router pages and API routes
src/components/            UI, including client-side colour extraction
tests/                     122 tests over the engines, auth and geometry
```

## Development

```bash
npm run dev        # dev server
npm test           # 122 tests
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run seed       # reset to the demo wardrobe (--force if not empty)
```

The engines are pure functions over plain data with no I/O, which is why they
run identically on the server and live in the browser as you type.

---

## Honest limitations

Fit prediction reasons about ease at landmarks — it can't see drape, diagonal
pull, or how a curved seam sits. Size-chart inference is genuinely weak, which
is why it's marked at 45% confidence and why the calibration loop exists. Body
shape archetypes are a simplification, scored continuously and overridable. The
12-season colour system is an industry convention, not physics; it's implemented
with a confidence and an override rather than presented as fact. The figure on
the You page is a tailor's dummy rather than a scan: a girth says how far around
a landmark is, not what shape it is, so it gets your proportions right and your
posture, muscle and bone structure wrong. The proportion
rules encode conventional styling — they describe where the eye lands, not what
anyone *should* wear, and every one of them is visible and ignorable.
