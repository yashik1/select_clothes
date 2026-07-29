import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BOUNDS,
  boundsProblem,
  fromFeetInches,
  measurementProblems,
  toFeetInches,
  weightFromDisplay,
  weightToDisplay,
} from "../src/lib/measurements.ts";
import { measurementsSchema } from "../src/lib/validate.ts";
import { buildBody } from "../src/lib/avatar/body.ts";
import type { BodyMeasurements } from "../src/lib/types.ts";

const REAL: BodyMeasurements = {
  height: 174, chest: 98, waistNatural: 84, hip: 100, neck: 39,
  shoulderWidth: 45, inseam: 79, thigh: 57, calf: 37, bicep: 31,
  wrist: 17, armLength: 62, weight: 74,
};

/*
 * The profile that produced the flying saucer: an inches profile whose height
 * was typed as "5.4", meaning five foot four. 5.4in is 13.7cm, and because
 * every landmark height and every unmeasured girth is a fraction of stature,
 * the figure collapsed around it while the fit engine went on scoring against
 * a body 13cm tall.
 */
const FEET_TYPO: BodyMeasurements = {
  height: 5.4 * 2.54,
  chest: 20 * 2.54,
  waistNatural: 17 * 2.54,
  hip: 19 * 2.54,
};

describe("measurements that could not belong to a body", () => {
  test("a real profile raises nothing", () => {
    assert.deepEqual(measurementProblems(REAL, "cm"), []);
    assert.deepEqual(measurementProblems(REAL, "in"), []);
  });

  test("an empty profile raises nothing", () => {
    assert.deepEqual(measurementProblems({}, "cm"), []);
  });

  test("the height typed in feet is caught, and named", () => {
    const problems = measurementProblems(FEET_TYPO, "in");
    const height = problems.find((p) => p.key === "height");
    assert.ok(height, "a 13.7cm stature was accepted");
    // The message has to say what the person actually did, or they retype the
    // same thing — this is the whole reason the value looked reasonable.
    assert.match(height.message, /5ft 4in, not 5\.4/);
  });

  test("a girth far larger than the whole body is caught, though each is in range", () => {
    // 140cm chest: large but real. 95cm tall: short but real. Together: not
    // a person — which is what a height entered in the wrong unit looks like
    // once it lands inside its own bounds.
    const problems = measurementProblems({ height: 95, chest: 140 }, "cm");
    assert.equal(problems.length, 1);
    assert.equal(problems[0].key, "chest");
    assert.match(problems[0].message, /far more than your whole height/);
  });

  test("a full-sized torso on a short frame is left alone", () => {
    // Achondroplasia: normal torso, short limbs. A real body, and the bounds
    // exist to reject the impossible, not the uncommon.
    assert.deepEqual(measurementProblems({ height: 95, chest: 98, waistNatural: 88 }, "cm"), []);
  });

  test("a length longer than the body is caught", () => {
    // Both inside their own bounds; only the pairing is wrong.
    const problems = measurementProblems({ height: 100, inseam: 110 }, "cm");
    assert.ok(problems.some((p) => p.key === "inseam" && /longer than your height/.test(p.message)));
  });

  test("a field already out of bounds isn't also reported against height", () => {
    // Otherwise every field on a profile with a bad height lights up red and
    // the one that actually needs fixing is lost in the noise.
    const problems = measurementProblems({ height: 170, chest: 4 }, "cm");
    assert.equal(problems.filter((p) => p.key === "chest").length, 1);
  });

  test("the bounds admit the smallest and largest adults", () => {
    for (const m of [
      { height: 100, chest: 60, waistNatural: 55, hip: 62 },
      { height: 240, chest: 150, waistNatural: 130, hip: 150 },
      { height: 165, chest: 175, waistNatural: 160, hip: 180 },
    ] as BodyMeasurements[]) {
      assert.deepEqual(measurementProblems(m, "cm"), [], JSON.stringify(m));
    }
  });

  test("every field has bounds, and they are the right way round", () => {
    for (const [key, b] of Object.entries(BOUNDS)) {
      assert.ok(b.min < b.max, `${key} bounds inverted`);
      assert.ok(b.min > 0, `${key} allows zero or less`);
    }
  });

  test("bounds are reported in the unit the user is working in", () => {
    const cm = boundsProblem("chest", 10, "cm");
    const inches = boundsProblem("chest", 10, "in");
    assert.match(cm!, /10cm/);
    assert.match(inches!, /3\.9in/);
  });
});

describe("the API refuses what the form refuses", () => {
  test("a real profile parses", () => {
    assert.equal(measurementsSchema.safeParse(REAL).success, true);
  });

  test("a stature of 13cm is rejected", () => {
    const result = measurementsSchema.safeParse(FEET_TYPO);
    assert.equal(result.success, false);
    assert.ok(result.error!.issues.some((i) => i.path[0] === "height"));
  });

  test("fields that are fine apart but impossible together are rejected", () => {
    const result = measurementsSchema.safeParse({ height: 95, chest: 140 });
    assert.equal(result.success, false);
    assert.ok(result.error!.issues.some((i) => i.path[0] === "chest"));
  });

  test("null and missing still mean 'not recorded'", () => {
    const result = measurementsSchema.safeParse({ height: 174, chest: null });
    assert.equal(result.success, true);
  });
});

describe("height in feet and inches", () => {
  test("round-trips", () => {
    for (const [ft, inches] of [[5, 4], [6, 0], [4, 11.5], [5, 10]] as const) {
      const cm = fromFeetInches(ft, inches)!;
      const back = toFeetInches(cm);
      assert.equal(back.ft, ft, `${ft}ft ${inches}in`);
      assert.ok(Math.abs((back.inches as number) - inches) < 0.05, `${ft}ft ${inches}in`);
    }
  });

  test("five foot four is 162.6cm, not 13.7", () => {
    assert.ok(Math.abs(fromFeetInches(5, 4)! - 162.56) < 0.01);
  });

  test("never shows twelve inches", () => {
    // 5ft 11.98in rounds to 12, which would read as "5ft 12in".
    const { ft, inches } = toFeetInches(182.85);
    assert.ok((inches as number) < 12, `showed ${ft}ft ${inches}in`);
  });

  test("one part alone is enough", () => {
    assert.ok(Math.abs(fromFeetInches(5, "")! - 152.4) < 0.01);
    assert.ok(Math.abs(fromFeetInches("", 64)! - 162.56) < 0.01);
    assert.equal(fromFeetInches("", ""), undefined);
  });
});

describe("weight is a mass, not a length", () => {
  test("pounds convert by mass", () => {
    // The bug this replaces multiplied by 2.54, which round-tripped through
    // the form and stored a number that was neither kilograms nor pounds.
    const kg = weightFromDisplay(160, "in")!;
    assert.ok(Math.abs(kg - 72.6) < 0.1, `160lb stored as ${kg}`);
    assert.equal(weightToDisplay(kg, "in"), 160);
  });

  test("kilograms pass through untouched", () => {
    assert.equal(weightFromDisplay(74, "cm"), 74);
    assert.equal(weightToDisplay(74, "cm"), 74);
  });
});

/*
 * Validation is the fix; this is the floor under it. The profile that caused
 * this is already in a database somewhere, and it has to render as something
 * rather than as a flying saucer the moment its owner opens the page.
 */
describe("the figure survives an impossible profile", () => {
  const spread = (m: BodyMeasurements) => {
    const mesh = buildBody(m);
    const widest = Math.max(...mesh.vertices.map((v) => Math.abs(v.x)));
    return widest / mesh.height;
  };

  test("a real body is about a tenth as wide as it is tall", () => {
    assert.ok(spread(REAL) < 0.2, `real body spread ${spread(REAL).toFixed(2)}`);
  });

  test("the profile behind it is reported as impossible, not quietly drawn", () => {
    // The mesh cannot reconcile a 50cm chest with a 13cm stature without
    // inventing a number, and inventing one would be the worse bug. What it
    // owes the user is to say so — loudly, next to the picture.
    const problems = measurementProblems(FEET_TYPO, "in");
    assert.ok(problems.length > 0);
    assert.ok(problems.some((p) => p.key === "height"));
  });

  test("the torso never flares into a cone below the shoulders", () => {
    for (const m of [REAL, FEET_TYPO, {}, { chest: 180, shoulderWidth: 30 }] as BodyMeasurements[]) {
      const { frame } = buildBody(m);
      const shoulder = frame.torso.find((s) => Math.abs(s.y - frame.shoulderY) < 0.01)!;
      const chest = frame.torso.find((s) => Math.abs(s.y - frame.landmark.chest) < 0.01)!;
      assert.ok(
        chest.a / shoulder.a < 1.45,
        `chest is ${(chest.a / shoulder.a).toFixed(1)}x the shoulders on ${JSON.stringify(m)}`,
      );
    }
  });

  test("a full bust on a narrow frame is still drawn wider than the shoulders", () => {
    // The clamp is a floor, not a rule that shoulders win — this is a real
    // shape and flattening it would be its own bug.
    const { frame } = buildBody({ ...REAL, chest: 122, shoulderWidth: 38 });
    const shoulder = frame.torso.find((s) => Math.abs(s.y - frame.shoulderY) < 0.01)!;
    const chest = frame.torso.find((s) => Math.abs(s.y - frame.landmark.chest) < 0.01)!;
    assert.ok(chest.a > shoulder.a, "a 122cm bust was flattened to the shoulder width");
  });
});
