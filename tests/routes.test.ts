import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

/*
 * The auth boundary, tested through HTTP.
 *
 * Every route in this app imports `server-only`, directly or through the
 * session helper, and that module throws the moment it is loaded outside a
 * bundler. So these cannot be unit tests — a route handler cannot be imported
 * into a test process at all. They run against a started server instead, which
 * is also the only way to test the thing that actually matters here: what an
 * unauthenticated stranger gets back.
 *
 * Set FITCHECK_TEST_URL to a running instance. CI already builds and boots one
 * for its health check, so it points these at the same server.
 */
const BASE = process.env.FITCHECK_TEST_URL;
const options = BASE ? {} : { skip: "no FITCHECK_TEST_URL" };

const url = (path: string) => new URL(path, BASE).toString();

/** A fresh address per run, so a rerun isn't poisoned by the last one's rows. */
const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;

const PASSWORD = "a-real-passphrase-1234";

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

/*
 * A different source address for every signup, unless a test names one.
 *
 * Signups are capped per source at five an hour, which is the point — but it
 * means tests sharing an address start failing on whichever one happens to run
 * sixth, for a reason that has nothing to do with what it was checking.
 */
let sourceCounter = 0;
const freshSource = () => `10.${++sourceCounter % 255}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

/** Signs up and returns the session cookie, so a test can act as that person. */
async function account(email: string, from = freshSource()) {
  const res = await post("/api/auth/signup", { email, password: PASSWORD }, { "x-forwarded-for": from });
  assert.equal(res.status, 201, `could not create ${email}: ${await res.text()}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "signup returned no session cookie");
  return cookie;
}

describe("the auth boundary", options, () => {
  /*
   * Not an exhaustive list of routes — a list of every route that reads or
   * writes something belonging to a person. If one of these ever answers a
   * request with no cookie, the app has no privacy at all.
   */
  const GUARDED: [string, string][] = [
    ["GET", "/api/garments"],
    ["POST", "/api/garments"],
    ["GET", "/api/profile"],
    ["PUT", "/api/profile"],
    ["PUT", "/api/profile/photo"],
    ["POST", "/api/images"],
    ["POST", "/api/score"],
    ["POST", "/api/pack"],
    ["POST", "/api/wear"],
    ["GET", "/api/tryon"],
    ["POST", "/api/tryon"],
    ["GET", "/api/account/export"],
    ["DELETE", "/api/account"],
    ["POST", "/api/garments/import"],
    ["GET", "/api/outfits"],
    ["POST", "/api/outfits"],
    ["GET", "/api/plan"],
    ["PUT", "/api/plan"],
    ["DELETE", "/api/plan"],
  ];

  for (const [method, path] of GUARDED) {
    test(`${method} ${path} refuses an anonymous request`, async () => {
      const res = await fetch(url(path), {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : "{}",
        redirect: "manual",
      });
      assert.equal(res.status, 401, `${method} ${path} answered ${res.status} with no session`);
    });
  }

  test("pages redirect rather than rendering someone else's data", async () => {
    for (const path of [
      "/profile", "/wardrobe", "/studio", "/account", "/insights", "/pack", "/calendar",
    ]) {
      const res = await fetch(url(path), { redirect: "manual" });
      assert.ok(
        res.status === 307 || res.status === 302,
        `${path} answered ${res.status} instead of redirecting a signed-out visitor`,
      );
    }
  });

  test("a garbage session cookie is not a session", async () => {
    const res = await fetch(url("/api/garments"), {
      headers: { cookie: "fitcheck_session=not-a-real-token" },
    });
    assert.equal(res.status, 401);
  });
});

describe("one account cannot reach another's data", options, () => {
  let alice: string, bob: string, aliceGarmentId: string;

  before(async () => {
    alice = await account(unique("alice"));
    bob = await account(unique("bob"));

    const res = await fetch(url("/api/garments"), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: alice },
      body: JSON.stringify({
        name: "Alice's navy coat",
        category: "outerwear",
        subcategory: "coat",
        formality: 3,
        careState: "clean",
        colors: [{ hex: "#1b2a45", share: 1 }],
        pattern: "solid",
        patternScale: "none",
        // A composition: fractions of the whole, summing to one.
        fabric: { wool: 0.8, polyamide: 0.2 },
        fitIntent: "regular",
        measurements: { chestCm: 108, lengthCm: 92 },
        seasons: ["autumn", "winter"],
        imageIds: [],
      }),
    });
    // Read once. `await res.text()` inside the assertion message is evaluated
    // whether or not the assertion fails, and a Response body only reads once.
    const body = await res.text();
    assert.equal(res.status, 201, `could not create the garment: ${body}`);
    aliceGarmentId = JSON.parse(body).garment.id;
  });

  test("Bob's wardrobe does not contain Alice's coat", async () => {
    const res = await fetch(url("/api/garments"), { headers: { cookie: bob } });
    assert.equal(res.status, 200);
    const { garments } = await res.json();
    assert.ok(
      !garments.some((g: { id: string }) => g.id === aliceGarmentId),
      "a garment leaked across accounts",
    );
  });

  test("Bob cannot fetch Alice's garment by id", async () => {
    const res = await fetch(url(`/api/garments/${aliceGarmentId}`), { headers: { cookie: bob } });
    assert.equal(res.status, 404, "guessing an id was enough to read someone else's garment");
  });

  test("Bob cannot delete Alice's garment", async () => {
    const res = await fetch(url(`/api/garments/${aliceGarmentId}`), {
      method: "DELETE",
      headers: { cookie: bob },
    });
    assert.ok(res.status === 404 || res.status === 403, `delete answered ${res.status}`);

    // The real assertion: it is still there.
    const check = await fetch(url(`/api/garments/${aliceGarmentId}`), { headers: { cookie: alice } });
    assert.equal(check.status, 200, "Alice's garment was destroyed by someone else's request");
  });

  test("Alice's export contains only Alice's things", async () => {
    const res = await fetch(url("/api/account/export"), { headers: { cookie: alice } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.garments.length, 1);
    assert.equal(data.garments[0].id, aliceGarmentId);
  });
});

describe("the sign-in limiter cannot be turned on its owner", options, () => {
  /*
   * This is a regression test for a real defect, and the shape of it matters.
   *
   * The limiter used to count failures against `login:email:<address>` and
   * refuse the request when that counter was full. Because the counter was
   * keyed on a value any stranger can type, nine junk requests naming an
   * address locked its owner out of every device for five minutes — and
   * because the failing check ran first and returned immediately, the
   * attacker's own counter stopped being touched, so it cost them nothing and
   * could be repeated forever.
   *
   * A rate limiter that can be pointed at a stranger is a denial-of-service
   * tool. These tests say: hammering an address must never stop its owner
   * signing in.
   */
  let victim: string;
  let victimSource: string;

  before(async () => {
    victim = unique("victim");
    victimSource = freshSource();
    await account(victim, victimSource);
  });

  test("a stranger's failures do not lock the owner out", async () => {
    // Comfortably past the old eight-attempt ceiling.
    for (let i = 0; i < 20; i++) {
      await post(
        "/api/auth/login",
        { email: victim, password: `junk-${i}` },
        { "x-forwarded-for": "203.0.113.7" },
      );
    }

    const res = await post(
      "/api/auth/login",
      { email: victim, password: PASSWORD },
      { "x-forwarded-for": victimSource },
    );
    assert.equal(res.status, 200, "the owner was locked out by somebody else's failed attempts");
  });

  test("nor do failures spread across many sources", async () => {
    for (let i = 0; i < 70; i++) {
      await post(
        "/api/auth/login",
        { email: victim, password: "junk" },
        { "x-forwarded-for": `198.18.${Math.floor(i / 256)}.${i % 256}` },
      );
    }

    const res = await post(
      "/api/auth/login",
      { email: victim, password: PASSWORD },
      { "x-forwarded-for": "198.51.100.4" },
    );
    assert.equal(res.status, 200, "a distributed attack locked the owner out");
  });

  test("nor does forging the header, which anyone can do", async () => {
    /*
     * `x-forwarded-for` is a client-supplied header, and Next passes a
     * client's own value through in preference to the socket address — so an
     * attacker talking to the origin gets a fresh identity per request and
     * walks past both caller-keyed limits at will.
     *
     * That is survivable only because the limit that cannot be evaded — the
     * one keyed on the email address — is also the one that is not allowed to
     * refuse a correct password. This test is what says so.
     */
    const target = unique("forged");
    const home = freshSource();
    await account(target, home);

    const codes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await post(
        "/api/auth/login",
        { email: target, password: `junk-${i}` },
        { "x-forwarded-for": `203.0.${Math.floor(i / 256)}.${i % 256}` },
      );
      codes.push(res.status);
    }
    assert.ok(codes.includes(429), "a hundred forged identities were never refused");

    const res = await post(
      "/api/auth/login",
      { email: target, password: PASSWORD },
      { "x-forwarded-for": home },
    );
    assert.equal(res.status, 200, "forging the header locked the owner out");
  });

  test("but one source guessing at one account is still stopped", async () => {
    const target = unique("target");
    await account(target);

    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await post(
        "/api/auth/login",
        { email: target, password: `guess-${i}` },
        { "x-forwarded-for": "192.0.2.99" },
      );
      codes.push(res.status);
    }
    assert.ok(codes.includes(429), `no attempt was ever refused: ${codes.join(",")}`);
    assert.equal(codes[codes.length - 1], 429, "the limiter stopped refusing partway through");
  });

  test("and so is one source spraying many accounts", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 45; i++) {
      const res = await post(
        "/api/auth/login",
        { email: unique(`spray${i}`), password: "whatever" },
        { "x-forwarded-for": "192.0.2.123" },
      );
      codes.push(res.status);
    }
    assert.ok(codes.includes(429), "spraying many accounts from one source was never refused");
  });
});

describe("password reset", options, () => {
  test("answers identically for a registered and an unregistered address", async () => {
    const known = unique("known");
    await account(known);

    const a = await post("/api/auth/forgot", { email: known }, { "x-forwarded-for": freshSource() });
    const b = await post(
      "/api/auth/forgot",
      { email: unique("stranger") },
      { "x-forwarded-for": freshSource() },
    );

    assert.equal(a.status, b.status);
    assert.deepEqual(await a.json(), await b.json(), "the reply gave away who has an account");
  });

  test("an unknown token is refused", async () => {
    const res = await post(
      "/api/auth/reset",
      { token: "x".repeat(43), password: "some-new-passphrase-1234" },
      // Its own source, or the limit left over from a previous test answers
      // 429 and the assertion never reaches the thing it is checking.
      { "x-forwarded-for": freshSource() },
    );
    assert.equal(res.status, 400);
  });

  /*
   * Needs a genuinely live token, which means minting one directly — the token
   * itself only ever leaves the server by email. `db.ts` carries no
   * `server-only` guard, so it can be imported here; the route modules cannot.
   */
  const canMintTokens = BASE && process.env.DATABASE_URL;
  const mintOptions = canMintTokens ? {} : { skip: "needs DATABASE_URL as well" };

  test("a bad password cannot be used to find out whether a token is real", mintOptions, async () => {
    /*
     * The reset route checks the password before the token, so a typo never
     * burns a link somebody has only one of. That ordering is safe only while
     * the two rejections are indistinguishable: the moment "your password is
     * too short" and "that link is dead" can be told apart, a short password
     * becomes a free way to test tokens until one turns out to be real.
     *
     * This has to compare a *live* token against a dead one. An earlier
     * version of this test compared two dead ones and sent a password that
     * passed validation, so it never reached the branch where the answers
     * could diverge — it would have passed with the checks in either order,
     * which is to say it tested nothing.
     */
    const db = await import("../src/lib/db.ts");
    const auth = await import("../src/lib/auth.ts");
    await db.ready();

    const email = unique("oracle");
    await account(email);
    const user = await db.getUserByEmail(email);
    assert.ok(user, "the account was not created");

    const { token } = auth.newSessionToken();
    await db.createPasswordReset(
      auth.hashToken(token),
      user.id,
      new Date(Date.now() + 3600_000).toISOString(),
    );

    const short = "short";
    const live = await post("/api/auth/reset", { token, password: short }, { "x-forwarded-for": freshSource() });
    const dead = await post(
      "/api/auth/reset",
      { token: "x".repeat(token.length), password: short },
      { "x-forwarded-for": freshSource() },
    );

    assert.equal(live.status, dead.status, "the status told a live token from a dead one");
    assert.deepEqual(await live.json(), await dead.json(), "the message told them apart");
    assert.equal(live.status, 400);

    // And the live token survived the bad password, which is the other half of
    // why the checks are in this order.
    const good = await post(
      "/api/auth/reset",
      { token, password: "a-perfectly-good-passphrase" },
      { "x-forwarded-for": freshSource() },
    );
    assert.equal(good.status, 200, "a mistyped password burned the only link");

    await db.pool().query("DELETE FROM app_user WHERE id = $1", [user.id]);
  });
});

/*
 * A shared outfit link is the only way into this app's data without a session,
 * so the things that must hold are: the token is the whole authorisation, it
 * reaches exactly one outfit and the photos of the garments in it, and revoking
 * it takes all of that away again.
 */
describe("a shared outfit reaches exactly as far as its link", options, () => {
  let alice: string, bob: string;
  let outfitId = "";
  let token = "";
  let sharedImageId = "";
  let privateImageId = "";

  /** A 32×32 PNG, small enough to inline and real enough for the uploader. */
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAM0lEQVR42u3OMQEAAAgDoC252H0Mj" +
      "gVwKS0kSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZK+DHjKAAGhVvxFAAAAAElFTkSuQmCC",
    "base64",
  );

  async function upload(cookie: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([PNG], { type: "image/png" }), "g.png");
    form.append("kind", "garment");
    const res = await fetch(url("/api/images"), { method: "POST", headers: { cookie }, body: form });
    assert.ok(res.ok, `image upload answered ${res.status}`);
    return (await res.json()).id as string;
  }

  async function garment(cookie: string, name: string, imageId: string): Promise<string> {
    const res = await fetch(url("/api/garments"), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        name, category: "top", subcategory: "shirt", formality: 3, careState: "clean",
        colors: [{ hex: "#2b3a55", share: 1 }], pattern: "solid", patternScale: "none",
        fabric: { cotton: 1 }, fitIntent: "regular", measurements: { chestFlat: 56 },
        seasons: ["autumn"], imageIds: [imageId],
      }),
    });
    const body = await res.text();
    assert.equal(res.status, 201, `could not create ${name}: ${body}`);
    return JSON.parse(body).garment.id as string;
  }

  before(async () => {
    alice = await account(unique("share-alice"));
    bob = await account(unique("share-bob"));

    sharedImageId = await upload(alice);
    privateImageId = await upload(alice);
    const inOutfit = await garment(alice, "Shared shirt", sharedImageId);
    // Deliberately not put in the outfit: holding the token must not reach it.
    await garment(alice, "Private shirt", privateImageId);

    const created = await fetch(url("/api/outfits"), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: alice },
      body: JSON.stringify({ name: "Alice's Thursday", garmentIds: [inOutfit], occasion: "office" }),
    });
    assert.equal(created.status, 201);
    outfitId = (await created.json()).outfit.id;

    const shared = await fetch(url(`/api/outfits/${outfitId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: alice },
      body: JSON.stringify({ shared: true }),
    });
    token = (await shared.json()).outfit.shareToken;
  });

  test("the token is 128 bits of hex and nothing shorter", () => {
    // Guessing has to be infeasible: this link is the entire authorisation and
    // there is no account check behind it.
    assert.match(token, /^[0-9a-f]{32}$/);
  });

  test("a stranger with the link sees the outfit", async () => {
    const res = await fetch(url(`/o/${token}`), { redirect: "manual" });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Alice&#x27;s Thursday") || html.includes("Alice's Thursday"));
    assert.match(html, /noindex/i, "a shared link must not be indexable");
  });

  test("a stranger with the link sees the photos it contains", async () => {
    const res = await fetch(url(`/api/images/${sharedImageId}?share=${token}`));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^image\//);
    // Revocable, so no shared cache may keep serving it afterwards.
    assert.match(res.headers.get("cache-control") ?? "", /private/);
  });

  test("the link does not reach a photo outside the outfit", async () => {
    const res = await fetch(url(`/api/images/${privateImageId}?share=${token}`));
    assert.equal(res.status, 404, "the token reached a garment the outfit does not contain");
  });

  test("the same photo is refused without the link", async () => {
    const res = await fetch(url(`/api/images/${sharedImageId}`));
    assert.equal(res.status, 404);
  });

  test("a wrong or malformed token gets nothing", async () => {
    for (const bad of ["0".repeat(32), "not-a-token", "../../etc/passwd", ""]) {
      const res = await fetch(url(`/api/images/${sharedImageId}?share=${encodeURIComponent(bad)}`));
      assert.equal(res.status, 404, `"${bad}" was accepted`);
    }
  });

  test("saving the outfit again does not revoke the link", async () => {
    // The studio saves on every edit. If that could clear the column, a link
    // already sent to somebody would die the next time its owner touched it.
    const res = await fetch(url("/api/outfits"), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: alice },
      body: JSON.stringify({
        id: outfitId, name: "Alice's Thursday, revised",
        garmentIds: [(await (await fetch(url("/api/garments"), { headers: { cookie: alice } })).json()).garments[0].id],
        occasion: "office",
      }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).outfit.shareToken, token, "an ordinary save revoked the link");
  });

  test("another account cannot share, rename or delete it", async () => {
    for (const body of [{ shared: true }, { name: "Bob's now" }, { pinned: true }]) {
      const res = await fetch(url(`/api/outfits/${outfitId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: bob },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 404, `Bob patched Alice's outfit with ${JSON.stringify(body)}`);
    }
  });

  test("another account cannot overwrite it by supplying its id", async () => {
    // `saveOutfit`'s upsert is guarded on the owner, so the write would be a
    // silent no-op — the route has to refuse rather than report success.
    const res = await fetch(url("/api/outfits"), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: bob },
      body: JSON.stringify({ id: outfitId, garmentIds: ["anything"], occasion: "office" }),
    });
    assert.equal(res.status, 404);
  });

  test("revoking breaks the page and the photos together", async () => {
    const res = await fetch(url(`/api/outfits/${outfitId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: alice },
      body: JSON.stringify({ shared: false }),
    });
    assert.equal((await res.json()).outfit.shareToken, null);

    assert.equal((await fetch(url(`/o/${token}`), { redirect: "manual" })).status, 404);
    assert.equal(
      (await fetch(url(`/api/images/${sharedImageId}?share=${token}`))).status,
      404,
      "a revoked link still served a photo",
    );
  });
});

describe("planning a day", options, () => {
  let cookie: string;
  let garmentId = "";

  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const put = (body: unknown) =>
    fetch(url("/api/plan"), {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    });

  const list = async () =>
    (await (await fetch(url(`/api/plan?from=${day(-60)}&to=${day(60)}`), { headers: { cookie } })).json()).plans;

  before(async () => {
    cookie = await account(unique("planner"));
    const res = await fetch(url("/api/garments"), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        name: "Planner's shirt", category: "top", subcategory: "shirt", formality: 3,
        careState: "clean", colors: [{ hex: "#2b3a55", share: 1 }], pattern: "solid",
        patternScale: "none", fabric: { cotton: 1 }, fitIntent: "regular",
        measurements: { chestFlat: 56 }, seasons: ["autumn"], imageIds: [],
      }),
    });
    garmentId = (await res.json()).garment.id;
  });

  test("a day holds one plan, so planning again replaces it", async () => {
    await put({ date: day(3), garmentIds: [garmentId], occasion: "office" });
    await put({ date: day(3), garmentIds: [garmentId], occasion: "date-night" });
    const plans = (await list()).filter((p: { date: string }) => p.date === day(3));
    assert.equal(plans.length, 1, "a second plan stacked instead of replacing");
    assert.equal(plans[0].occasion, "date-night");
  });

  test("a plan moves no wear counters", async () => {
    /*
     * The whole reason `plan` is its own table. If an intention incremented
     * `wear_count`, Insights would start reporting cost per wear on clothes
     * nobody had put on yet.
     */
    const { garments } = await (await fetch(url("/api/garments"), { headers: { cookie } })).json();
    const total = garments.reduce((n: number, g: { wearCount?: number }) => n + (g.wearCount ?? 0), 0);
    assert.equal(total, 0, `planning moved ${total} wears`);
  });

  test("a date that is not a date is refused, not crashed on", async () => {
    // `new Date("not-a-dateT00:00:00Z").toISOString()` throws a RangeError, and
    // a failed regex leaves zod's parse dirty rather than aborted — so the
    // refinement runs on input the pattern already rejected.
    for (const date of ["not-a-date", "2026-02-31", "26-09-2026", "2026-13-01", ""]) {
      const res = await put({ date, garmentIds: [garmentId] });
      assert.equal(res.status, 400, `"${date}" answered ${res.status}`);
    }
  });

  test("an outfit id belonging to nobody is dropped rather than stored", async () => {
    const res = await put({ date: day(5), garmentIds: [garmentId], outfitId: "not-mine" });
    assert.equal((await res.json()).plan.outfitId, null);
  });

  test("confirming a plan makes it a wear and retires the plan", async () => {
    await put({ date: day(-1), garmentIds: [garmentId], occasion: "office" });
    const res = await fetch(url("/api/wear"), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        garmentIds: [garmentId], date: day(-1), planDate: day(-1), occasion: "office",
      }),
    });
    assert.equal(res.status, 200);

    const dates = (await list()).map((p: { date: string }) => p.date);
    assert.ok(!dates.includes(day(-1)), "the plan outlived its own confirmation");
    // And the other days it had nothing to do with are still there.
    assert.ok(dates.includes(day(3)), "confirming one day cleared another");

    const { garments } = await (await fetch(url("/api/garments"), { headers: { cookie } })).json();
    assert.equal(garments[0].wearCount, 1, "confirming did not record the wear");
  });
});
