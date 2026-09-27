"use client";

import { useEffect } from "react";

/**
 * Sweeps up what the browser-only wishlist and inspiration board left behind.
 *
 * Both of those used to live in `localStorage`. They are tables now, and the
 * code that read these keys is gone — so anything still under them is bytes
 * nothing will ever look at again. That would be a shrug for the wishlist,
 * which was a little JSON. The board is the reason this exists: it stored whole
 * photos as base64 data URLs, so an abandoned key can be several megabytes of
 * an origin's ~5MB budget, held forever, starving the one thing still using
 * that store.
 *
 * Mounted in the root layout rather than on the two pages it cleans up after,
 * which is the whole point: somebody who never opens the inspiration board
 * again is exactly the person whose megabytes are stuck.
 *
 * `removeItem` on a key that is not there is free, so there is no "have I done
 * this yet" flag — a flag would itself be a write, which is the thing being
 * economised.
 *
 * Deletable once the people using this have opened the app once. It leaves no
 * trace, so nothing depends on it having run.
 */
const LEGACY_KEYS = ["fitcheck:wishlist:v1", "fitcheck:inspiration:v1"];

export function ClearLegacyStorage() {
  useEffect(() => {
    for (const key of LEGACY_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        /*
         * Reaching `localStorage` at all throws in some privacy configurations.
         * Nothing here is worth a broken page: the keys stay, inert.
         */
      }
    }
  }, []);

  return null;
}
