import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  emailProblem, hashPassword, hashToken, newSessionToken, normaliseEmail,
  passwordProblem, sessionExpiry, verifyPassword,
} from "../src/lib/auth.ts";

describe("password hashing", () => {
  test("a password verifies against its own hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  });

  test("a wrong password does not", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  test("the same password hashes differently every time", async () => {
    // Per-password salt: two accounts sharing a password must not share a hash,
    // or one cracked hash cracks both.
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("same-password", a), true);
    assert.equal(await verifyPassword("same-password", b), true);
  });

  test("the stored form records its own parameters", async () => {
    const hash = await hashPassword("whatever-goes-here");
    const [algorithm, N, r, p] = hash.split("$");
    assert.equal(algorithm, "scrypt");
    // Without these the cost can never be raised without locking everyone out.
    assert.deepEqual([N, r, p], ["16384", "8", "1"]);
  });

  test("a corrupt or foreign hash is rejected, not thrown on", async () => {
    for (const bad of ["", "not-a-hash", "scrypt$$$$", "bcrypt$2a$10$abc", "scrypt$16384$8$1$zz$zz"]) {
      assert.equal(await verifyPassword("anything", bad), false, `threw or accepted: ${bad}`);
    }
  });

  test("unicode passwords normalise, so the same keystrokes always work", async () => {
    // "é" composed vs decomposed: identical to the user, different bytes.
    const hash = await hashPassword("café-password");
    assert.equal(await verifyPassword("café-password", hash), true);
  });
});

describe("session tokens", () => {
  test("tokens are unique and long enough to be unguessable", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { token } = newSessionToken();
      // 32 random bytes, base64url — 43 characters.
      assert.ok(token.length >= 43);
      assert.equal(seen.has(token), false);
      seen.add(token);
    }
  });

  test("only the hash is ever stored, and it matches the token", () => {
    const { token, tokenHash } = newSessionToken();
    assert.notEqual(token, tokenHash);
    assert.equal(tokenHash, hashToken(token));
    assert.equal(tokenHash.length, 64);
  });

  test("expiry is in the future", () => {
    assert.ok(new Date(sessionExpiry()).getTime() > Date.now());
  });
});

describe("credential validation", () => {
  test("emails are compared case- and whitespace-insensitively", () => {
    assert.equal(normaliseEmail("  Sam@Example.COM "), "sam@example.com");
  });

  test("obvious non-addresses are refused", () => {
    for (const bad of ["", "sam", "sam@", "@example.com", "sam @example.com"]) {
      assert.ok(emailProblem(bad), `accepted ${JSON.stringify(bad)}`);
    }
    assert.equal(emailProblem("sam@example.com"), null);
  });

  test("passwords are held to a length floor and nothing else", () => {
    assert.ok(passwordProblem("short"));
    assert.equal(passwordProblem("a-perfectly-fine-passphrase"), null);
    // No composition rules: this is long, so it passes.
    assert.equal(passwordProblem("aaaaaaaaaaaaaaaaaaaa"), null);
  });
});
