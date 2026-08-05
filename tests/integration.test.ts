import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

/*
 * The parts that only exist against a database.
 *
 * Rate limiting and password resets are both enforced *by the write* — an
 * atomic upsert for one, a conditional UPDATE for the other — precisely so two
 * requests racing cannot both be allowed. That guarantee lives in the SQL, so
 * testing it against a mock would test the mock.
 *
 * Skipped when there is no DATABASE_URL, so `npm test` still runs anywhere. CI
 * provides one, which is where these actually gate anything.
 */
const HAVE_DB = Boolean(process.env.DATABASE_URL);
const options = HAVE_DB ? {} : { skip: "no DATABASE_URL" };

describe("rate limiting", options, () => {
  // The policy layer carries `server-only`, which throws outside a bundler.
  // What is worth testing is the SQL, and that lives in the data layer with
  // every other statement.
  let db: typeof import("../src/lib/db.ts");

  const key = () => `test:${Math.random().toString(36).slice(2)}`;

  const consume = async (k: string, limit: { max: number; windowSeconds: number }) => {
    const { count, resetAt } = await db.bumpRateLimit(k, limit.windowSeconds);
    return { ok: count <= limit.max, retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)) };
  };
  const refund = (k: string) => db.refundRateLimit(k);

  before(async () => {
    db = await import("../src/lib/db.ts");
    await db.ready();
  });

  after(async () => {
    await db.pool().query("DELETE FROM rate_limit WHERE key LIKE 'test:%'");
  });

  test("allows exactly the limit, then refuses", async () => {
    const k = key();
    const limit = { max: 3, windowSeconds: 60 };
    for (let i = 1; i <= 3; i++) {
      assert.equal((await consume(k, limit)).ok, true, `attempt ${i} should have been allowed`);
    }
    const over = await consume(k, limit);
    assert.equal(over.ok, false);
    assert.ok(over.retryAfter > 0 && over.retryAfter <= 60, `retryAfter was ${over.retryAfter}`);
  });

  test("separate keys do not share a budget", async () => {
    const limit = { max: 1, windowSeconds: 60 };
    const a = key(), b = key();
    assert.equal((await consume(a, limit)).ok, true);
    assert.equal((await consume(a, limit)).ok, false);
    assert.equal((await consume(b, limit)).ok, true, "one key's limit spilled onto another");
  });

  test("an expired window starts again from one", async () => {
    const k = key();
    const brief = { max: 1, windowSeconds: 1 };
    assert.equal((await consume(k, brief)).ok, true);
    assert.equal((await consume(k, brief)).ok, false);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal((await consume(k, brief)).ok, true, "the window never reset");
  });

  test("a refund gives the attempt back", async () => {
    const k = key();
    const limit = { max: 2, windowSeconds: 60 };
    await consume(k, limit);
    await consume(k, limit);
    assert.equal((await consume(k, limit)).ok, false);
    await refund(k);
    await refund(k);
    assert.equal((await consume(k, limit)).ok, true, "refunding did not free an attempt");
  });

  test("counters whose window closed long ago are swept up", async () => {
    // The table is written by unauthenticated traffic — one row per distinct
    // email address and per distinct forwarded-for value — so without a sweep
    // it is a slower version of the attack the limiter exists to stop.
    const stale = key();
    await db.pool().query(
      "INSERT INTO rate_limit (key, count, reset_at) VALUES ($1, 1, now() - interval '2 hours')",
      [stale],
    );
    const live = key();
    await consume(live, { max: 5, windowSeconds: 3600 });

    await db.purgeExpiredRateLimits();

    const rows = await db
      .pool()
      .query("SELECT key FROM rate_limit WHERE key IN ($1, $2)", [stale, live]);
    const keys = rows.rows.map((r) => r.key);
    assert.ok(!keys.includes(stale), "an expired counter was left behind");
    assert.ok(keys.includes(live), "a live counter was swept up with the dead ones");
  });

  test("simultaneous attempts cannot both slip through the last slot", async () => {
    // The whole reason it is one statement. Read-then-write would let two
    // requests both see "one left" and both take it.
    const k = key();
    const limit = { max: 5, windowSeconds: 60 };
    const verdicts = await Promise.all(
      Array.from({ length: 20 }, () => consume(k, limit)),
    );
    const allowed = verdicts.filter((v) => v.ok).length;
    assert.equal(allowed, 5, `${allowed} of 20 concurrent attempts were allowed, expected 5`);
  });
});

describe("password reset tokens", options, () => {
  let db: typeof import("../src/lib/db.ts");
  let auth: typeof import("../src/lib/auth.ts");
  let userId: string;

  const future = () => new Date(Date.now() + 3600_000).toISOString();

  before(async () => {
    db = await import("../src/lib/db.ts");
    auth = await import("../src/lib/auth.ts");
    await db.ready();
    const email = `reset-test-${Date.now()}@example.invalid`;
    const user = await db.createUser(email, await auth.hashPassword("initial-passphrase"));
    assert.ok(user, "could not create the test account");
    userId = user.id;
  });

  after(async () => {
    await db.pool().query("DELETE FROM app_user WHERE email LIKE 'reset-test-%@example.invalid' OR email LIKE 'reset-test-other-%@example.invalid'");
    // Closed once, here, at the end of the last suite that needs it — the pool
    // is a singleton, so ending it in an earlier teardown kills the next one.
    await db.pool().end();
  });

  test("a live token resolves to its account exactly once", async () => {
    const { token } = auth.newSessionToken();
    await db.createPasswordReset(auth.hashToken(token), userId, future());

    assert.equal(await db.claimPasswordReset(auth.hashToken(token)), userId);
    // Single use is the entire security property: a link sitting in an inbox,
    // or in a mail provider's logs, must not keep working.
    assert.equal(await db.claimPasswordReset(auth.hashToken(token)), null, "the token worked twice");
  });

  test("an expired token is refused", async () => {
    const { token } = auth.newSessionToken();
    const past = new Date(Date.now() - 1000).toISOString();
    await db.createPasswordReset(auth.hashToken(token), userId, past);
    assert.equal(await db.claimPasswordReset(auth.hashToken(token)), null);
  });

  test("an unknown token is refused rather than throwing", async () => {
    assert.equal(await db.claimPasswordReset(auth.hashToken("never issued")), null);
  });

  test("the raw token is never stored", async () => {
    const { token } = auth.newSessionToken();
    await db.createPasswordReset(auth.hashToken(token), userId, future());
    const { rows } = await db
      .pool()
      .query("SELECT token_hash FROM password_reset WHERE user_id = $1", [userId]);
    for (const row of rows) {
      assert.notEqual(row.token_hash, token, "the reset table holds a usable token");
    }
    assert.ok(rows.some((r) => r.token_hash === auth.hashToken(token)));
  });

  test("two requests racing on one token both cannot win", async () => {
    const { token } = auth.newSessionToken();
    await db.createPasswordReset(auth.hashToken(token), userId, future());
    const results = await Promise.all(
      Array.from({ length: 8 }, () => db.claimPasswordReset(auth.hashToken(token))),
    );
    assert.equal(results.filter(Boolean).length, 1, "a token was claimed more than once");
  });

  test("using one link kills every other live link for that account", async () => {
    /*
     * Asking for a second link because the first seemed lost is the ordinary
     * case. If the first keeps working for the rest of its 45 minutes, then an
     * old message — in an inbox, a forwarded thread, or a mail provider's
     * logs — can still take the account over after its owner believes they
     * have secured it.
     */
    const first = auth.newSessionToken();
    const second = auth.newSessionToken();
    await db.createPasswordReset(auth.hashToken(first.token), userId, future());
    await db.createPasswordReset(auth.hashToken(second.token), userId, future());

    assert.equal(await db.claimPasswordReset(auth.hashToken(second.token)), userId);
    assert.equal(
      await db.claimPasswordReset(auth.hashToken(first.token)),
      null,
      "an older reset link still worked after a newer one was used",
    );
  });

  test("one account's links are not spent by another account's reset", async () => {
    const other = await db.createUser(
      `reset-test-other-${Date.now()}@example.invalid`,
      await auth.hashPassword("another-passphrase"),
    );
    assert.ok(other);

    const mine = auth.newSessionToken();
    const theirs = auth.newSessionToken();
    await db.createPasswordReset(auth.hashToken(mine.token), userId, future());
    await db.createPasswordReset(auth.hashToken(theirs.token), other.id, future());

    await db.claimPasswordReset(auth.hashToken(mine.token));

    assert.equal(
      await db.claimPasswordReset(auth.hashToken(theirs.token)),
      other.id,
      "resetting one account invalidated a different account's link",
    );
  });

  test("changing a password signs every device out", async () => {
    const a = auth.newSessionToken();
    const b = auth.newSessionToken();
    await db.createSession(a.tokenHash, userId, auth.sessionExpiry());
    await db.createSession(b.tokenHash, userId, auth.sessionExpiry());

    await db.deleteSessionsFor(userId);

    const { rows } = await db.pool().query("SELECT 1 FROM session WHERE user_id = $1", [userId]);
    assert.equal(rows.length, 0, "a session survived the password change");
  });
});
