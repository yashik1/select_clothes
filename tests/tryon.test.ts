import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { providerStatus, tryOnCategory, renderTryOn } from "../src/lib/tryon.ts";

const KEYS = [
  "FITCHECK_TRYON_PROVIDER",
  "FAL_KEY",
  "FASHN_API_KEY",
  "FITCHECK_TRYON_URL",
  "FITCHECK_TRYON_KEY",
];

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

/*
 * The reported failure: "I put the Fal API key but it still does not show."
 *
 * The provider used to come only from FITCHECK_TRYON_PROVIDER, defaulting to
 * none — so setting FAL_KEY on its own configured a provider that was never
 * selected, and the app went on serving the flat-lay without a word about the
 * variable it was still waiting for.
 */
describe("choosing a try-on provider", () => {
  test("a fal key alone is enough", () => {
    process.env.FAL_KEY = "key-123";
    const status = providerStatus();
    assert.equal(status.id, "fal");
    assert.equal(status.configured, true);
    assert.equal(status.source, "inferred");
    assert.equal(status.hint, undefined);
  });

  test("a fashn key alone is enough", () => {
    process.env.FASHN_API_KEY = "key-123";
    assert.equal(providerStatus().id, "fashn");
  });

  test("a custom endpoint alone is enough", () => {
    process.env.FITCHECK_TRYON_URL = "https://example.invalid/tryon";
    assert.equal(providerStatus().id, "custom");
  });

  test("with no keys at all it stays off, and says what to add", () => {
    const status = providerStatus();
    assert.equal(status.id, "none");
    assert.equal(status.source, "default");
    assert.match(status.hint!, /FAL_KEY/);
  });

  test("an explicit provider still wins over the keys present", () => {
    process.env.FAL_KEY = "key-123";
    process.env.FITCHECK_TRYON_PROVIDER = "fashn";
    const status = providerStatus();
    assert.equal(status.id, "fashn");
    assert.equal(status.source, "explicit");
    // ...and correctly reports that fashn's own key is missing.
    assert.equal(status.configured, false);
    assert.match(status.hint!, /FASHN_API_KEY/);
  });

  test("an explicit none switches it off even with a key set", () => {
    // Inference must never override someone deliberately turning it off.
    process.env.FAL_KEY = "key-123";
    process.env.FITCHECK_TRYON_PROVIDER = "none";
    const status = providerStatus();
    assert.equal(status.id, "none");
    assert.match(status.hint!, /switched off/);
  });

  test("a misspelled provider is named rather than silently ignored", () => {
    process.env.FITCHECK_TRYON_PROVIDER = "fal.ai";
    const status = providerStatus();
    assert.equal(status.id, "none");
    assert.match(status.hint!, /"fal\.ai".*isn't a provider/);
  });

  test("an empty provider variable behaves as if unset", () => {
    // Deploy platforms hand back "" for a variable added with no value.
    process.env.FITCHECK_TRYON_PROVIDER = "  ";
    process.env.FAL_KEY = "key-123";
    assert.equal(providerStatus().id, "fal");
  });

  test("fal is preferred when several keys are present", () => {
    process.env.FAL_KEY = "a";
    process.env.FASHN_API_KEY = "b";
    process.env.FITCHECK_TRYON_URL = "https://example.invalid";
    assert.equal(providerStatus().id, "fal");
  });
});

describe("rendering without a provider", () => {
  test("explains itself rather than throwing", async () => {
    const result = await renderTryOn({ personImage: "data:,", garments: [] });
    assert.equal(result.ok, false);
    assert.equal(result.provider, "none");
    assert.ok(result.error);
  });

  test("a configured provider with nothing to render says so", async () => {
    process.env.FAL_KEY = "key-123";
    const result = await renderTryOn({ personImage: "data:,", garments: [] });
    assert.equal(result.ok, false);
    assert.match(result.error!, /Nothing to render/);
  });
});

describe("garment categories map onto the provider's vocabulary", () => {
  test("every category resolves to something the API accepts", () => {
    const allowed = new Set(["tops", "bottoms", "one-pieces", "auto"]);
    for (const c of ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag", "??"]) {
      assert.ok(allowed.has(tryOnCategory(c)), `${c} mapped outside the vocabulary`);
    }
  });

  test("outerwear renders as a top, not as auto", () => {
    assert.equal(tryOnCategory("outerwear"), "tops");
    assert.equal(tryOnCategory("dress"), "one-pieces");
  });
});
