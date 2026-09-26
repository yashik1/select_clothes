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

**Wardrobe** — add an item by photographing it, shooting it with the camera, or
pasting the shop's product link; then a per-garment fit report: your measurement, the
garment's, the room between them, and a verdict per landmark. A live fit preview
runs *as you type* while adding an item, and **On you** hangs the piece on the
same figure the You page builds — see below.

**Studio** — build a combination, see it on your own figure, and watch six
dimensions score it in real time, with the specific tweak that would fix each
problem. Layers stack the way they would on you: trousers under tops, tops under
outerwear, hems breaking over shoes. Name what you built and keep it.

**Calendar** — what you wore and what you mean to wear, on one month grid. A
saved outfit goes onto a day; confirming it on the day turns it into a wear. A
plan and a wear are deliberately different kinds of thing — see below.

**Gaps** — the counterfactual: which single item you don't own would unlock the
most wearable outfits. Built by adding a hypothetical garment sized to your
measurements and re-running the whole outfit search.

**Pack** — the fewest garments that still cover every day and occasion of a trip.

**Insights** — cost per wear, dead stock, items with nothing to pair with, and
what the app has learned about how each brand sizes on you.

**You** — measurements, colouring, fit preferences, and a figure built from
your girths that you can turn through 360° and tilt to see from any side. Body
shape and seasonal palette derive live as you type, both overridable.

Measurements are bounded to what a body can actually be, and the profile won't
save while one isn't. That sounds fussy until you see what a bad one does:
every landmark position and every girth you *haven't* given is a fraction of
your stature, so a height entered as "5.4" — meaning five foot four, into a
field asking for inches — puts a 13cm stature under a real chest and the whole
figure collapses around it, while the fit engine goes on scoring confidently
against a body that cannot exist. Working in inches now gets separate feet and
inches boxes, because nobody thinks of themselves as sixty-four inches tall.
Bounds reject the impossible rather than the unusual: the smallest and largest
adults pass, and a girth is only refused against a stature when it exceeds it
by half again.

### Seeing the fit instead of reading it

Open any garment and the same figure is wearing it. The shell is built from
*that garment's* measurements — chest flat doubled, waist flat doubled, body
length from the high point of the shoulder — stacked at the landmark heights of
*your* body. So the gap between cloth and skin **is** the ease: the number in
the room column of the table above it, drawn rather than tabulated, and you can
walk around it.

Sleeves come from the catalogue when you haven't measured them: eighteen types
carry a sleeve rule off your arm length, and the nine that don't — t-shirt,
polo, tank, gilet, the dresses — say outright how far down the arm they reach.
"No sleeve length recorded" is not the same claim as "sleeveless", and reading
it that way drew every unmeasured jumper, shirt and coat as a gilet.

Where a garment is narrower than you it moulds on rather than passing through,
because that is what fabric does — so "too tight" reads as a shell pressed onto
the body and "oversized" as one standing well off it, without either needing a
label. Anything you haven't measured falls back to the middle of that
subcategory's ideal ease band, and the caption says which. Accessories and bags
have no honest shape on a mannequin, so they're named beside the figure rather
than drawn badly on it.

Turn it and the cloth trails the shoulders it hangs from, swings past when you
let go, and settles. How far it swings is the garment's own ease, so an
oversized coat sweeps and a second-skin tee barely stirs — the motion is the
measurement, not decoration laid over it. Clothes arrive one layer at a time
too, which is the only way the figure can show what is worn under what.

That swing turns each ring about its own centre, not the body's. A coat's hem
is one loop that already runs close to the spine, so those two axes are nearly
the same thing — a trouser leg or a sleeve is a narrow tube sitting well off to
one side, and turning it about the *body's* axis instead swings a whole limb's
worth of cloth sideways in an arc rather than in place, which read as the
garment visibly leaving the leg it was on while the figure was being dragged.

Layering has a matching fix, for a defect that needed no dragging at all: a
wide, gently-curved shell like a shirt's hem sits close to its own tangent line
at the edge of the silhouette, while a narrow tube underneath it — a trouser
leg wrapped tightly around one limb — can have a face on that same screen
column pointed almost straight at the camera. Comparing whole triangles by
their average depth, that is a fact about *shape*, not which garment sits on
top, and it used to beat the margin meant to keep layers apart: a hem sitting
near a leg or a sleeve let the layer underneath win the sort in bands, the
inner garment's colour showing through the outer one in vertical stripes,
plainly visible on a figure that was not moving at all. Fixed by measuring
rather than guessing — swept across four outer/inner pairs from a fitted shirt
over chinos to an oversized coat over wide-leg trousers, at every camera angle,
the worst mismatch found was 50cm, and the margin between layers is now sized
to clear that with room to spare.

It is the same renderer as the You page, drawing into the same 2D canvas — no
WebGL, no model, nothing fetched.

**A photo of yourself, next to it, answering a different question.** The
figure says whether a garment fits — that's arithmetic, and it needs nothing
from you but measurements. Beside it, on a single garment's own page and in
the studio while a whole outfit is assembled, is a photo: take one with the
camera or choose a file, and it puts the garment's own photo — or every
renderable piece of the outfit — onto yours through whichever render provider
is configured. It's optional everywhere the figure isn't — no photo, no key,
no render, the figure and the fit report work exactly as before.

The photo is taken once and reused for every garment, so the second render
onward is just picking a different item. Every render is cached — the pairing
of your photo and that garment's photo is the cache key — so returning to a
page you've already rendered costs nothing and shows the same picture instantly;
a "render it again" link is there for when you want a fresh one. Replacing your
photo throws out every cached render along with the old one, since they're all
pictures of a person you've just said isn't current. Nothing is sent anywhere
until you press the button that renders it, and the panel says in advance
where it's going and roughly what it costs.

---

## Everything is a row

There is no exception to this any more, and there was one until recently.

The wishlist and the inspiration board both started in `localStorage`, which
made them the only part of FitCheck that was not in Postgres — and the cost was
not theoretical. They were absent from the account export, so a file claiming to
be a complete copy of an account quietly was not one. They survived account
deletion. They did not follow you to a phone. And the board stored full photos
as base64 data URLs in a store that holds about 5MB per origin and costs two
bytes per character, so a single 3MB phone photo wanted around 8MB: not "fills
up after a few", the first one threw, and because the screen had already been
updated the picture appeared, was never written, and was gone on reload.

Both are tables now. Photos go through `/api/images` like every other picture,
with the same downscale, the same EXIF handling and the same byte quota.

Three things in that move are worth knowing:

**The wishlist key is unique per account, never globally.** It is a product URL,
so the obvious mistake is to make it the primary key — and then the second
person to want a jumper either fails to save it or silently takes over a
stranger's row. It is `(user_id, key)`, which still makes saving the same
product twice one entry rather than two.

**Deleting a wishlist entry deletes its photo only if nothing else wants it.** An
entry saved from Shop Check points at the picture the importer already fetched,
and that is the same picture the add-a-garment form pre-fills with — so a
garment may be the thing holding it. Deleting unconditionally would pull it out
from under that garment; never deleting would leak the photo quota to a row no
screen can reach. A reference photo is the opposite case: nothing else ever
points at an image stored under the `inspiration` kind, so the entry and its
picture go together in one transaction.

---

## A plan is not a wear

The calendar draws two things and they are not the same fact.

A **wear** happened. It moves `wear_count`, `last_worn_at`, cost per wear, and
the rotation score that stops the app suggesting the same shirt three days
running. A **plan** is an intention, and it moves none of them — it lives in its
own table for exactly that reason. If Thursday's plan incremented a wear count,
Insights would start reporting cost per wear on clothes nobody had put on yet,
and the rotation score would quietly penalise you for owning a calendar.

Confirming a plan is what crosses the line: it writes the wear and retires the
plan in the same request. Worn days are drawn solid, planned days dashed.

Everything works in *local* days. The wear log stores UTC instants, so each one
is converted before it is binned — a shirt worn at 9pm in Los Angeles belongs on
that Tuesday, not on Wednesday because UTC had already rolled over.

---

## Sharing one outfit

A saved outfit can be given a link. It is the app's only page that renders
without a session, so it is worth being exact about what it does and doesn't
carry.

The link is 16 random bytes of hex and it *is* the authorisation — there is no
account check behind it. It reaches one outfit, and the photos of the garments
in that outfit, and nothing else: not the rest of the wardrobe, not the other
photos in the same account, not the owner's email, not their measurements as
numbers, not their location or wear history, and not the body figure, which is
drawn from real girths and would be a disclosure of body shape. The page is
`noindex`, and revoking takes the page and the photos away together.

What it *does* carry, and what the owner is told before they send it: the full
verdict, including fit and proportion notes. Those say things like *"your torso
is already the longer half"* — a qualitative description of the sharer's
proportions. That is the reason the link is worth sending at all, so it stays,
and the share control says so in as many words rather than reassuring.

One more thing the page has to handle: every reason the engine writes is in the
second person, addressed to the wardrobe's owner. The reader here is somebody
else, so an unframed *"your own colouring"* would tell the viewer something
false about themselves. Rewriting the strings to the third person turns them
into mush, so the page says once, where the eye is already going, who "you" is.

---

## Starting from a product link

Paste the page you bought it from and the form fills itself in. It reads only
what the shop publishes on purpose — the schema.org `Product` block it feeds to
Google Shopping, its Open Graph tags, or, on Shopify, the JSON endpoint beside
every product URL. Nothing parses page layout and nothing works around a bot
check: a site that publishes no structured data comes back saying so.

That gets you name, brand, price, photo, usually the fibre content, and a guess
at what kind of garment it is, matched against this app's own catalogue.

**It cannot get you the measurements, and that is the point.** Garment
dimensions live in a size-chart modal, usually drawn by JavaScript, in a
different shape on every site — they are essentially never in structured data.
So an import leaves the fit engine exactly where a typed size label leaves it,
at about 45% confidence. It therefore pre-fills the form rather than saving:
the item stays visibly unfinished, and the panel beside it goes on asking for
the two numbers that take the verdict past 90%.

The server fetches the URL you give it, which is the request shape that gets an
app owned — `169.254.169.254` is the cloud metadata service and hands out
credentials. So the host is resolved before connecting and refused unless every
address it answers with is public, re-checked at every redirect, with a size
cap, a timeout and no crawling.

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

**Forgotten passwords.** A reset link, valid once and for 45 minutes, with
only its SHA-256 stored. Using one link spends every other live link for that
account, so an older message left in an inbox cannot take the account over
after its owner believes they have secured it. Completing a reset signs out
every device — people reset a password because they think somebody else has
it, and leaving that session alive would make the reset theatre.

The link travels in the URL fragment (`/reset#token=…`), never the query
string, so it is not written into the server's access log or any proxy's, and
the page clears it from the address bar once read. A `?token=` in the query is
still accepted, for links already in flight when this changed and for the mail
security gateways that unwrap a URL and reissue it without its fragment.

The request endpoint answers identically whether or not the address is
registered, and the mail is dispatched without being awaited — an awaited call
to the mail provider makes a registered address answer a few hundred
milliseconds slower, which a stopwatch reads out as the membership list every
identical response exists to protect.

Set `RESEND_API_KEY` and the link is emailed. Without it the link goes to the
server log, which is a real answer when you host this for yourself and a
useless one otherwise — so the page says which happened rather than implying an
email is on its way.

**Rate limits.** Sign-in, signup, resets and link imports are all counted in
Postgres rather than in memory, so they hold across instances. Each sign-in
runs scrypt at N=16384 by design, so unlimited attempts were a
denial-of-service against the server long before they were a threat to any
password.

The distinction that matters is *what a counter is keyed on*. Counters keyed on
the caller — per source, and per source-and-address together — are hard gates:
the only budget a request can exhaust is its own. The counter keyed on the
email address alone is not a gate, and deliberately cannot refuse a correct
password. It has to work that way. An earlier version treated it as a gate, and
nine junk requests naming an address locked its owner out of every device for
five minutes, repeatable indefinitely, at no cost to the attacker — a rate
limiter keyed on something a stranger can type is a denial-of-service weapon
aimed at the person it was added to protect. So it now shapes only the answer
given to a *wrong* password. `tests/routes.test.ts` holds that as a regression.

A correct password refunds its attempts. Expired counters are swept
opportunistically, because the table is written by unauthenticated traffic and
would otherwise grow one permanent row per distinct address forever.

**What the caller-keyed limits are worth.** `X-Forwarded-For` is a header the
client sends, and Next passes a client's own value through in preference to the
socket address, so anyone talking to the origin can mint a fresh identity per
request and walk past both of them. That is survivable rather than fatal
precisely because of the split above: the limit that cannot be evaded is the
one keyed on the email address, and it is also the one that can never refuse a
correct password. A hundred attempts from a hundred forged addresses are
refused after sixty and the account's owner still signs in — there is a test
for exactly that. Signups are the softer spot: forging the header gets past the
per-caller cap, leaving only the per-address one, so an instance that shouldn't
take strangers should set `FITCHECK_SIGNUP=closed` rather than rely on the
limiter.

**Your data, and leaving.** `/account` shows what is stored, downloads the lot
as JSON — profile, every garment with its own measurements, outfits, the whole
wear history, brand calibrations — and deletes the account. Deletion asks for
the password and a typed word, then removes every row in every table in one
transaction. It is immediate and there is no backup to ask for.

**Quotas.** 2,000 garments, 2,000 outfits and 256MB of photos per account, and
a hard ceiling on the rows any single query returns. Archived garments don't
count toward the cap, since archiving is how you're told to make room. The wear
log has no row cap — a wear is a fact about a day and refusing a real one would
be wrong — so it is bounded by a per-account rate limit instead. All of these
sit far above what a person with a wardrobe will reach; they exist for a script
with a valid session, looping, on an instance whose disk everybody shares.

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
| `FITCHECK_PUBLIC_URL` | Where this instance is reachable. **Required for password resets** — the link needs an absolute address, and taking it from the request's `Host` header is how reset links get sent to somebody else's server. Inferred on Railway and Vercel. |
| `RESEND_API_KEY` | Sends the reset email. Without it the link is written to the server log instead, and the UI says so. |
| `FITCHECK_EMAIL_FROM` | The From address for that email. |
| `FITCHECK_TRYON_PROVIDER` | `fal`, `fashn`, `custom`, or `none`. Usually unnecessary — see below. |
| `FAL_KEY` | Runs FASHN v1.6 through fal.ai, ~$0.075 per garment layer. Setting it switches photo rendering on. |
| `FASHN_API_KEY` | Same, against FASHN directly. |
| `FITCHECK_TRYON_URL` / `FITCHECK_TRYON_KEY` | For `custom` — any endpoint taking `{ personImage, garmentImage, category }` and returning `{ image }`. |

**Setting a key is enough.** The provider is inferred from whichever credential
is present, because needing a second variable to act on the first means pasting
your `FAL_KEY` and getting nothing — with the app still quietly serving the
fallback. `FITCHECK_TRYON_PROVIDER` overrides the inference when you want a
specific one, including `none` to switch rendering off with a key still in the
environment.

Photo rendering also needs a full-length photo of you on the You page and a
photo on each garment; the Studio says which of those is missing rather than
making you find out by pressing the button.

None of that is required to see an outfit on yourself. The figure is built from
your measurements and needs no key, no photos and no network call — the score
beside it is what answers whether it fits.

Weather uses [Open-Meteo](https://open-meteo.com/), which needs no key. If it's
unreachable the weather dimension drops to zero confidence rather than inventing
a number.

---

## On a phone

This is an app you use standing in front of a wardrobe, so the phone layout is
the one that has to be right — and for a long time it was not. Every page
scrolled sideways, and the header was the reason: the nav links sat in a
wrapping row with nowhere to go at 390px, so they wrapped into a column. The
header alone came to 630px of an 844px screen, three quarters of the viewport
gone before the first heading. The garment page laid itself out 660px wide
inside a 390px window. An outfit card gave its headline 76px, because the
thumbnails and the score ring either side of it were both fixed widths.

What it does now:

- **The nav gets its own row and scrolls sideways.** All thirteen destinations
  stay visible and labelled rather than folding into a hamburger — this is a bar
  you move along constantly, and a menu that has to be opened hides where you
  are as well as where you could go. It used to sit inline in the header row
  from `lg` up; that stopped being possible at thirteen, because the header is
  capped at `max-w-6xl` and the pills want 963px of an available 700. No window
  was ever wide enough, so they overflowed and painted over the account
  controls. On their own row they fit inside 1152px with room to spare, and
  below about 1100px the row scrolls.
- **Cards stack.** An outfit card puts its thumbnails above the text instead of
  beside it, so the headline gets the full width.
- **Tap targets are thumb-sized.** Occasion pills, filters and the figure's view
  controls were 26–38px; the ones you press most are 44px on touch and unchanged
  on a mouse, so desktop keeps its density.

- **It installs.** A web app manifest, icons, a service worker and a one-time,
  dismissible install prompt — so the work above lands on a home screen rather
  than in a browser tab. The part of this app that costs the most effort is
  photographing a wardrobe one garment at a time, and that is exactly the part a
  tab is worst at.

The service worker is deliberately the most conservative one it could be. A
Cache Storage bucket belongs to an origin and a browser profile, not to an
account, so anything cached in it outlives signing out — and a second person
signing in on the same browser would be served the first one's bytes. So it
caches the content-hashed build output, the icons and an offline notice, and
never a page or an API response. `npm run icons` regenerates the icons from
`scripts/icons.mjs`, which draws them rather than committing an unreviewable
binary.

`tests/layout.test.ts` measures the rendered document against the width of the
screen it is on, at 360px, 390px and 1280px, and fails if anything sticks out or
the header grows back. It is a real browser at a real width because none of the
above is visible from a desktop window or a component test.

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
  calendar.ts              local days, the month grid, and what you wore on one
  measurements.ts          what a body can measure — bounds and unit handling
  import/product.ts        reading a garment off a shop's structured data
  import/address.ts        which addresses the server may not connect to
  avatar/body.ts           the figure: measurements lofted into a mesh
  avatar/garment.ts        clothes built from their own measurements, hung on it
  avatar/render.ts         software renderer — projection, shading, girth bands
  auth.ts                  scrypt passwords, session tokens
  db.ts                    Postgres: schema, queries, image bytes
  tryon.ts                 pluggable render providers
  server/share.ts          the one read path with no session behind it
  features/wishlist.ts     the wishlist, over the API
src/app/                   Next.js App Router pages and API routes
  manifest.ts              what makes it installable
  o/[token]/               a shared outfit, rendered for a stranger
src/components/            UI, including client-side colour extraction
public/sw.js               service worker — build output only, never a page
scripts/icons.mjs          draws the app icons, so no binary is committed blind
tests/                     342 tests; some need a database, some a browser
```

## Development

```bash
npm run dev        # dev server
npm test           # 278 with a database, 246 without (the rest skip cleanly)
                   # 64 more run in CI against a booted server: the auth
                   # boundary over HTTP, and the layout in a real browser
npm run icons      # redraw the app icons after changing scripts/icons.mjs
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
