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
    ["POST", "/api/images"],
    ["POST", "/api/score"],
    ["POST", "/api/pack"],
    ["POST", "/api/wear"],
    ["GET", "/api/tryon"],
    ["POST", "/api/tryon"],
    ["GET", "/api/account/export"],
    ["DELETE", "/api/account"],
    ["POST", "/api/garments/import"],
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
    for (const path of ["/profile", "/wardrobe", "/studio", "/account", "/insights", "/pack"]) {
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
});
