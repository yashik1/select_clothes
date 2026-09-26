import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

/*
 * Does it fit on a phone?
 *
 * Every page is one long column of cards, so it is easy to assume it must —
 * and it did not. Seven nav links in a `flex-wrap` row had nowhere to go at
 * 390px, so they wrapped into a seven-line column: a header 630px tall on an
 * 844px screen, three quarters of the viewport gone before the first heading.
 * The garment page laid itself out 660px wide inside a 390px window, and an
 * outfit card gave its headline 76px because the thumbnails and score ring
 * either side of it were fixed widths.
 *
 * None of that is visible from a desktop browser, and none of it shows up in a
 * unit test of a component. What catches it is measuring the rendered document
 * against the width of the screen it is on, which is what this does.
 *
 * Needs a real browser and a running server, so it is skipped unless both a
 * base URL and Playwright are available — the same shape as routes.test.ts.
 */
const BASE = process.env.FITCHECK_TEST_URL;

/** Playwright lives outside the project, so its absence must not fail the run. */
async function loadChromium(): Promise<{ launch: (o: object) => Promise<Browser> } | null> {
  for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.js"]) {
    try {
      const mod = await import(spec);
      return (mod.chromium ?? mod.default?.chromium) ?? null;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

interface Page {
  goto(url: string, o?: object): Promise<unknown>;
  fill(sel: string, value: string): Promise<void>;
  click(sel: string): Promise<void>;
  waitForURL(url: string, o?: object): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: (arg: never) => T, arg?: unknown): Promise<T>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
}
interface Browser {
  newContext(o?: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
}

// Resolved inside `before`, not at module scope: tsx compiles these to CJS,
// where a top-level await is a syntax error.
const options = BASE ? {} : { skip: "needs FITCHECK_TEST_URL" };

describe("the app fits the screen it is on", options, () => {
  let browser: Browser;
  let ctx: { newPage(): Promise<Page>; close(): Promise<void> };
  let page: Page;
  let garmentId = "";

  // Real phones, not arbitrary numbers: 360 is the commonest Android width and
  // 390 is the iPhone's. 1280 is here so a mobile fix that broke the desktop
  // layout would be caught by the same sweep.
  const WIDTHS = [360, 390, 1280];

  before(async (t) => {
    const chromium = await loadChromium();
    if (!chromium) {
      // Playwright isn't installed here; that is not a layout failure.
      (t as { skip: (why: string) => void }).skip("playwright is not available");
      return;
    }
    /*
     * Playwright finds its own browser normally. `PLAYWRIGHT_CHROMIUM_PATH`
     * is for an environment that ships one already and would otherwise make
     * the test download a second copy.
     */
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();

    const email = `layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
    await page.goto(`${BASE}/signup`);
    await page.fill("#email", email);
    await page.fill("#password", "a-real-passphrase-1234");
    await page.click("button[type=submit]");
    await page.waitForURL(`${BASE}/`, { timeout: 30000 });

    // A wardrobe with something in it: the empty state has no cards, no
    // thumbnails and no score rings, which is to say none of the things that
    // overflowed.
    /*
     * Written without a named inner function on purpose. tsx compiles this
     * file with esbuild's `keepNames`, which rewrites named functions to call
     * a `__name` helper — and that helper exists in the test process, not in
     * the browser page this body is serialised into, where it throws
     * `__name is not defined`. A plain loop has no name to keep.
     */
    garmentId = await page.evaluate(async (b64: string) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      // A deliberately long name first — a short one fits anywhere and proves
      // nothing. Its id is the one returned, so the garment page under test is
      // the awkward one.
      const wanted = [
        ["Heritage cotton slub crew-neck t-shirt", "top", "t-shirt", "#3a4a63"],
        ["Olive cargo pant", "bottom", "cargo-pants", "#6b6a4a"],
        ["White leather sneakers", "shoes", "sneakers", "#e8e8e8"],
      ];

      let first = "";
      for (const [name, category, subcategory, hex] of wanted) {
        const form = new FormData();
        form.append("file", new File([bytes], "g.png", { type: "image/png" }));
        form.append("kind", "garment");
        const up = await (await fetch("/api/images", { method: "POST", body: form })).json();
        const res = await fetch("/api/garments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, category, subcategory, formality: 3, careState: "clean",
            colors: [{ hex, share: 1 }], pattern: "solid", patternScale: "none",
            fabric: { cotton: 1 }, fitIntent: "regular", measurements: {},
            seasons: ["autumn"], imageIds: [up.id],
          }),
        });
        const id = (await res.json()).garment.id as string;
        if (!first) first = id;
      }
      return first;
    }, "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAM0lEQVR42u3OMQEAAAgDoC252H0MjgVwKS0kSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZK+DHjKAAGhVvxFAAAAAElFTkSuQmCC");
  });

  after(async () => {
    await browser?.close();
  });

  for (const width of WIDTHS) {
    test(`nothing scrolls sideways at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 844 });

      const paths = [
        "/", "/wardrobe", "/studio", "/calendar", "/profile", "/insights", "/pack", "/gaps",
      ];
      const failures: string[] = [];

      for (const path of [...paths, `/wardrobe/${garmentId}`]) {
        await page.goto(`${BASE}${path}`);
        await page.waitForTimeout(900);

        const result = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const doc = document.documentElement.scrollWidth;
          if (doc <= vw) return { doc, vw, blame: "" };

          /*
           * Name the narrowest thing that sticks out, so a failure says which
           * element to look at rather than only that the number is wrong.
           * Anything inside a deliberately scrollable box is skipped — the nav
           * strip is *meant* to run past the edge.
           */
          let blame = "";
          for (const el of Array.from(document.querySelectorAll("*"))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= vw + 1) continue;
            let scrollable = false;
            for (let a = el.parentElement; a; a = a.parentElement) {
              const ox = getComputedStyle(a).overflowX;
              if (ox === "auto" || ox === "scroll") { scrollable = true; break; }
            }
            if (scrollable) continue;
            let childOut = false;
            for (const c of Array.from(el.children)) {
              const cr = c.getBoundingClientRect();
              if (cr.width > 0 && cr.right > vw + 1) { childOut = true; break; }
            }
            if (childOut) continue;
            blame = `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}">`;
            break;
          }
          return { doc, vw, blame };
        });

        if (result.doc > result.vw) {
          failures.push(`${path}: document is ${result.doc}px wide in a ${result.vw}px window ${result.blame}`);
        }
      }

      assert.deepEqual(failures, [], `\n  ${failures.join("\n  ")}\n`);
    });
  }

  test("the header leaves the page most of a phone screen", async () => {
    // The bug this exists for: seven nav links wrapped into a column and the
    // header alone ran to 630px of an 844px screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(900);

    const height = await page.evaluate(() => {
      const header = document.querySelector("header");
      return header ? Math.round(header.getBoundingClientRect().height) : 0;
    });

    assert.ok(height > 0, "no header found");
    assert.ok(
      height < 180,
      `the header is ${height}px tall on an 844px screen — it is eating the page`,
    );
  });

  test("every nav destination is reachable without a menu", async () => {
    // The strip scrolls sideways rather than collapsing into a hamburger, so
    // all eight have to actually be in the document at phone width.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(900);

    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll("nav a")).map((a) => (a.textContent || "").trim()),
    );

    for (const expected of [
      "Today", "Wardrobe", "Studio", "Calendar", "Gaps", "Pack", "Insights", "You",
    ]) {
      assert.ok(labels.includes(expected), `"${expected}" is not reachable at 390px`);
    }
  });
});
