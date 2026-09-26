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

describe("plans and share tokens", options, () => {
  let db: typeof import("../src/lib/db.ts");
  let auth: typeof import("../src/lib/auth.ts");
  let userId: string;
  let otherId: string;

  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  /** Unique per call: the column is unique, and a rerun must not collide. */
  const shareToken = () =>
    (Date.now().toString(16) + Math.random().toString(16).slice(2)).replace(/[^0-9a-f]/g, "").padEnd(32, "0").slice(0, 32);

  const plan = (date: string, garmentIds: string[], extra = {}) => ({
    id: db.newId(),
    date,
    garmentIds,
    createdAt: db.nowIso(),
    ...extra,
  });

  before(async () => {
    db = await import("../src/lib/db.ts");
    auth = await import("../src/lib/auth.ts");
    await db.ready();
    const mine = await db.createUser(
      `plan-test-${Date.now()}@example.invalid`,
      await auth.hashPassword("a-real-passphrase"),
    );
    const theirs = await db.createUser(
      `plan-test-other-${Date.now()}@example.invalid`,
      await auth.hashPassword("a-real-passphrase"),
    );
    assert.ok(mine && theirs);
    userId = mine.id;
    otherId = theirs.id;
  });

  after(async () => {
    /*
     * `deleteAccount`, not a DELETE on app_user. Outfits and plans have no
     * cascade from the user row, so deleting the account directly would leave
     * this suite's outfits behind — and the next run's `setOutfitShare` would
     * then collide with last run's token on the unique index.
     */
    await db.deleteAccount(userId);
    await db.deleteAccount(otherId);
  });

  test("a second plan for a day replaces the first", async () => {
    // The unique index is on (user_id, date), which is what makes a calendar
    // cell unambiguous. Without it the grid would have to explain which of two
    // outfits for Thursday it was drawing.
    await db.savePlan(userId, plan(day(1), ["a", "b"]));
    await db.savePlan(userId, plan(day(1), ["c"]));
    const plans = await db.listPlans(userId, day(0), day(2));
    assert.equal(plans.length, 1, "a day ended up with two plans");
    assert.deepEqual(plans[0].garmentIds, ["c"]);
  });

  test("two accounts can plan the same day", async () => {
    // The uniqueness is per account. A shared calendar would be a spectacular
    // way for one person's Thursday to overwrite another's.
    await db.savePlan(otherId, plan(day(1), ["theirs"]));
    const mine = await db.listPlans(userId, day(1), day(1));
    const theirs = await db.listPlans(otherId, day(1), day(1));
    assert.deepEqual(mine[0].garmentIds, ["c"]);
    assert.deepEqual(theirs[0].garmentIds, ["theirs"]);
  });

  test("the range is inclusive at both ends", async () => {
    await db.savePlan(userId, plan(day(10), ["edge"]));
    assert.equal((await db.listPlans(userId, day(10), day(10))).length, 1);
    assert.equal((await db.listPlans(userId, day(11), day(12))).length, 0);
  });

  test("deleting one day leaves the others", async () => {
    await db.deletePlan(userId, day(1));
    const left = (await db.listPlans(userId, day(-30), day(30))).map((p) => p.date);
    assert.ok(!left.includes(day(1)));
    assert.ok(left.includes(day(10)), "deleting one day took another with it");
  });

  test("a share token resolves to its outfit and its owner", async () => {
    const outfit = await db.saveOutfit(userId, {
      id: db.newId(),
      garmentIds: ["x"],
      pinned: false,
      createdAt: db.nowIso(),
      updatedAt: db.nowIso(),
    });
    const token = shareToken();
    await db.setOutfitShare(userId, outfit.id, token);

    const found = await db.getOutfitByShareToken(token);
    assert.equal(found?.outfit.id, outfit.id);
    assert.equal(found?.userId, userId, "the lookup lost track of whose outfit it is");
  });

  test("saving an outfit cannot mint or revoke a share link", async () => {
    /*
     * The token is a capability and the studio saves on every edit, so the two
     * have to be unable to touch each other. `saveOutfit` drops the field on
     * the floor; only `setOutfitShare` writes the column.
     */
    const outfit = await db.saveOutfit(userId, {
      id: db.newId(),
      garmentIds: ["x"],
      pinned: false,
      createdAt: db.nowIso(),
      updatedAt: db.nowIso(),
    });
    const token = shareToken();
    const impostor = shareToken();
    await db.setOutfitShare(userId, outfit.id, token);

    // A save that claims a different token, the way a round-tripped object would.
    await db.saveOutfit(userId, { ...outfit, name: "renamed", shareToken: impostor });

    assert.equal(await db.getOutfitByShareToken(impostor), null, "a save minted a link");
    assert.equal((await db.getOutfitByShareToken(token))?.outfit.id, outfit.id, "a save revoked a link");

    // And a save with no token at all must not clear one either.
    await db.saveOutfit(userId, { ...outfit, name: "renamed again" });
    assert.equal((await db.getOutfitByShareToken(token))?.outfit.id, outfit.id);
  });

  test("another account cannot revoke a link it does not own", async () => {
    const outfit = await db.saveOutfit(userId, {
      id: db.newId(), garmentIds: ["x"], pinned: false,
      createdAt: db.nowIso(), updatedAt: db.nowIso(),
    });
    const token = shareToken();
    await db.setOutfitShare(userId, outfit.id, token);

    assert.equal(await db.setOutfitShare(otherId, outfit.id, null), null);
    assert.equal((await db.getOutfitByShareToken(token))?.outfit.id, outfit.id);
  });

  test("deleting an account kills its share links", async () => {
    /*
     * This is the one that needs a test. `plan` has a real foreign key, so
     * Postgres would cascade it away whatever `deleteAccount` did — but
     * `outfit` has none, and `outfit` is now where share tokens live. A row
     * left behind there is not merely invisible clutter: `getOutfitByShareToken`
     * is the one query in the app that is not scoped to an account, so an
     * orphaned outfit means a link that still resolves after the person who
     * minted it has deleted everything and left.
     */
    const doomed = await db.createUser(
      `plan-test-doomed-${Date.now()}@example.invalid`,
      await auth.hashPassword("a-real-passphrase"),
    );
    assert.ok(doomed);

    const outfit = await db.saveOutfit(doomed.id, {
      id: db.newId(), garmentIds: ["z"], pinned: false,
      createdAt: db.nowIso(), updatedAt: db.nowIso(),
    });
    const token = shareToken();
    await db.setOutfitShare(doomed.id, outfit.id, token);
    await db.savePlan(doomed.id, plan(day(2), ["z"]));
    // The link works right up until the account goes.
    assert.ok(await db.getOutfitByShareToken(token));

    await db.deleteAccount(doomed.id);

    assert.equal(
      await db.getOutfitByShareToken(token),
      null,
      "a deleted account's share link still resolves",
    );
    const { rows } = await db.pool().query("SELECT 1 FROM plan WHERE user_id = $1", [doomed.id]);
    assert.equal(rows.length, 0, "a deleted account's plans survived it");
  });

  test("an export carries the plans", async () => {
    const dump = await db.exportAccount(userId);
    assert.ok(Array.isArray(dump?.plans), "the export has no plans array at all");
    assert.ok(
      dump!.plans.some((p) => p.date === day(10)),
      "a plan was missing from the export, so the copy is not a copy",
    );
  });
});

describe("wishlist and inspiration", options, () => {
  let db: typeof import("../src/lib/db.ts");
  let auth: typeof import("../src/lib/auth.ts");
  let userId: string;
  let otherId: string;

  const item = (over: Partial<import("../src/lib/types.ts").WishlistItem> = {}) => ({
    id: db.newId(),
    key: "https://example.com/thing",
    name: "A thing",
    createdAt: db.nowIso(),
    ...over,
  });

  /** A tiny real image, since `image.bytes` is NOT NULL. */
  const storeImage = async (owner: string, kind = "garment") => {
    const id = db.newId();
    await db.saveImage(owner, { id, mime: "image/png", kind, createdAt: db.nowIso() }, Buffer.from([1, 2, 3]));
    return id;
  };

  before(async () => {
    db = await import("../src/lib/db.ts");
    auth = await import("../src/lib/auth.ts");
    await db.ready();
    const a = await db.createUser(`wl-test-${Date.now()}@example.invalid`, await auth.hashPassword("a-real-passphrase"));
    const b = await db.createUser(`wl-test-other-${Date.now()}@example.invalid`, await auth.hashPassword("a-real-passphrase"));
    assert.ok(a && b);
    userId = a.id;
    otherId = b.id;
  });

  after(async () => {
    await db.deleteAccount(userId);
    await db.deleteAccount(otherId);
  });

  test("saving the same product twice is one entry", async () => {
    // The whole reason there is a key at all. Pressing save again on a product
    // page means "I still want this", not "give me a second copy".
    const first = await db.saveWishlistItem(userId, item({ name: "Merino crew", price: 39.9 }));
    const second = await db.saveWishlistItem(userId, item({ name: "Merino crew (sale)", price: 29.9 }));

    assert.equal(second.id, first.id, "a second save made a second row");
    const all = await db.listWishlist(userId);
    assert.equal(all.length, 1);
    assert.equal(all[0].price, 29.9, "the newer save did not win");
  });

  test("two accounts can want the same product", async () => {
    /*
     * The key is unique per account, not globally. Keyed globally — the obvious
     * mistake, since the key is a URL — the second person to want a jumper
     * would either fail to save it or overwrite a stranger's row.
     */
    await db.saveWishlistItem(otherId, item({ name: "Theirs" }));
    assert.equal((await db.listWishlist(userId)).length, 1);
    assert.equal((await db.listWishlist(otherId)).length, 1);
    assert.equal((await db.listWishlist(userId))[0].name, "Merino crew (sale)");
  });

  test("a wishlist photo shared with a garment is not deleted with the entry", async () => {
    /*
     * An entry saved from Shop Check points at the photo the importer already
     * fetched, and that is the same photo the add-a-garment form pre-fills
     * with — so a garment can end up owning it. Deleting the wishlist entry
     * must not pull the picture out from under the garment.
     */
    const imageId = await storeImage(userId);
    await db.saveGarment(userId, {
      id: db.newId(), name: "Real shirt", category: "top", subcategory: "shirt",
      formality: 3, careState: "clean", colors: [{ hex: "#2b3a55", share: 1 }],
      pattern: "solid", patternScale: "none", fabric: { cotton: 1 }, fitIntent: "regular",
      measurements: {}, seasons: ["autumn"], imageIds: [imageId], wearCount: 0,
      lastWornAt: null, archivedAt: null, createdAt: db.nowIso(), updatedAt: db.nowIso(),
    } as never);

    const saved = await db.saveWishlistItem(userId, item({ key: "https://example.com/shirt", name: "Same shirt", imageId }));
    await db.deleteWishlistItem(userId, saved.id);
    assert.equal(await db.deleteImageIfUnused(userId, imageId), false, "it deleted a garment's photo");
    assert.ok(await db.getImage(userId, imageId), "the garment's photo is gone");
  });

  test("a photo nothing else points at is cleaned up", async () => {
    // The other half: never deleting would leak the photo quota to a picture no
    // screen can reach and no button can remove.
    const imageId = await storeImage(userId);
    const saved = await db.saveWishlistItem(userId, item({ key: "https://example.com/lone", name: "Lone", imageId }));
    await db.deleteWishlistItem(userId, saved.id);

    assert.equal(await db.deleteImageIfUnused(userId, imageId), true);
    assert.equal(await db.getImage(userId, imageId), null);
  });

  test("a body photo counts as a reference too", async () => {
    // `bodyPhotoIds` lives in the profile's JSONB rather than in a column, so
    // it is the reference most easily forgotten by a cleanup query.
    const imageId = await storeImage(userId, "body");
    const profile = await db.getOrCreateProfile(userId);
    await db.saveProfile(userId, { ...profile, bodyPhotoIds: [imageId] });

    assert.equal(await db.deleteImageIfUnused(userId, imageId), false, "it deleted the body photo");
    assert.ok(await db.getImage(userId, imageId));
  });

  test("deleting a reference takes its photo with it", async () => {
    // Unconditional here, unlike the wishlist: an image stored under the
    // `inspiration` kind exists only to be that board entry.
    const imageId = await storeImage(userId, "inspiration");
    const look = await db.saveInspiration(userId, {
      id: db.newId(), name: "Street look", imageId, createdAt: db.nowIso(),
    });

    assert.equal(await db.deleteInspiration(userId, look.id), true);
    assert.equal(await db.getImage(userId, imageId), null, "the photo outlived the entry");
    assert.equal((await db.listInspiration(userId)).length, 0);
  });

  test("another account cannot delete a reference it does not own", async () => {
    const imageId = await storeImage(userId, "inspiration");
    const look = await db.saveInspiration(userId, {
      id: db.newId(), name: "Mine", imageId, createdAt: db.nowIso(),
    });

    assert.equal(await db.deleteInspiration(otherId, look.id), false);
    assert.ok(await db.getImage(userId, imageId), "someone else's delete took the photo");
    assert.equal((await db.listInspiration(userId)).length, 1);
  });

  test("both are in the export, which is the point of moving them", async () => {
    /*
     * The reason this work happened. In `localStorage` neither appeared in the
     * export, so the file claiming to be a complete copy of an account quietly
     * was not one.
     */
    const dump = await db.exportAccount(userId);
    assert.ok(Array.isArray(dump?.wishlist), "no wishlist array in the export");
    assert.ok(Array.isArray(dump?.inspiration), "no inspiration array in the export");
    assert.ok(dump!.wishlist.some((w) => w.name === "Merino crew (sale)"));
    assert.ok(dump!.inspiration.some((i) => i.name === "Mine"));
  });

  test("deleting an account takes both, and their photos, with it", async () => {
    /*
     * Half of this Postgres guarantees and half of it does not, and the half it
     * does not is the point.
     *
     * `wishlist` and `inspiration` were created with a real foreign key, so
     * they cascade away whatever `deleteAccount` does with them. `image` has no
     * such key — it predates accounts and carries a nullable `user_id` — so the
     * only thing removing an account's photos is `deleteAccount` naming the
     * table. Miss it and the pictures survive as rows nobody can see, nobody
     * can reach, and nobody can delete, still counted against nothing.
     *
     * The motivation is the same as the rest of this suite: in `localStorage`
     * both of these outlived the account entirely.
     */
    const doomed = await db.createUser(
      `wl-test-doomed-${Date.now()}@example.invalid`,
      await auth.hashPassword("a-real-passphrase"),
    );
    assert.ok(doomed);
    const imageId = await storeImage(doomed.id, "inspiration");
    await db.saveWishlistItem(doomed.id, item({ name: "Theirs" }));
    await db.saveInspiration(doomed.id, { id: db.newId(), name: "Theirs", imageId, createdAt: db.nowIso() });

    await db.deleteAccount(doomed.id);

    assert.equal((await db.listWishlist(doomed.id)).length, 0);
    assert.equal((await db.listInspiration(doomed.id)).length, 0);
    const { rows } = await db.pool().query("SELECT 1 FROM image WHERE user_id = $1", [doomed.id]);
    assert.equal(rows.length, 0, "a deleted account's photos survived it");
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
