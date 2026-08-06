import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildBody, ellipseAxes, type BodyMesh, type Face, type Vec3 } from "../src/lib/avatar/body.ts";
import { buildGarments, type GarmentShell } from "../src/lib/avatar/garment.ts";
import { layerAlpha, swung } from "../src/lib/avatar/render.ts";
import { SUBCATEGORY_LIST, assumedSleeveLength, sleeveKind } from "../src/lib/data/garmentTypes.ts";
import type { BodyMeasurements, Garment, GarmentMeasurements } from "../src/lib/types.ts";

const FULL: BodyMeasurements = {
  height: 174, chest: 98, waistNatural: 84, hip: 100, neck: 39,
  shoulderWidth: 45, inseam: 79, thigh: 57, calf: 37, bicep: 31,
  wrist: 17, armLength: 62,
};

/** Ramanujan's perimeter, the same approximation ellipseAxes inverts. */
function perimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

describe("ellipse from a circumference", () => {
  test("round-trips back to the circumference it was given", () => {
    for (const c of [17, 39, 57, 84, 98, 130]) {
      for (const aspect of [1, 1.05, 1.22, 1.35, 1.5]) {
        const { a, b } = ellipseAxes(c, aspect);
        assert.ok(Math.abs(perimeter(a, b) - c) < 1e-6, `${c}cm at ${aspect}`);
      }
    }
  });

  test("honours the width-to-depth ratio", () => {
    const { a, b } = ellipseAxes(100, 1.35);
    assert.ok(Math.abs(a / b - 1.35) < 1e-9);
  });

  test("a ratio of 1 is a circle", () => {
    const { a, b } = ellipseAxes(100, 1);
    assert.ok(Math.abs(a - b) < 1e-9);
    assert.ok(Math.abs(2 * Math.PI * a - 100) < 1e-6);
  });
});

describe("body from measurements", () => {
  test("the drawn bands are the measurements, not an approximation of them", () => {
    const mesh = buildBody(FULL);
    const byKey = new Map(mesh.rings.map((r) => [r.key, r]));
    assert.equal(byKey.get("chest")!.circumference, 98);
    assert.equal(byKey.get("waistNatural")!.circumference, 84);
    assert.equal(byKey.get("hip")!.circumference, 100);
    assert.equal(byKey.get("neck")!.circumference, 39);
  });

  test("a band's ellipse really has the circumference it claims", () => {
    for (const r of buildBody(FULL).rings) {
      assert.ok(
        Math.abs(perimeter(r.a, r.b) - r.circumference) < 1e-6,
        `${r.key} draws ${perimeter(r.a, r.b).toFixed(2)} but says ${r.circumference}`,
      );
    }
  });

  test("missing measurements are reported rather than silently invented", () => {
    const mesh = buildBody({ height: 174, chest: 98 });
    assert.ok(mesh.estimated.includes("waistNatural"));
    assert.ok(mesh.estimated.includes("hip"));
    assert.ok(!mesh.estimated.includes("chest"));
    assert.ok(mesh.confidence < 0.5);

    // And the bands built from them are flagged, so the UI can dash them.
    const waist = mesh.rings.find((r) => r.key === "waistNatural")!;
    assert.equal(waist.estimated, true);
    assert.equal(mesh.rings.find((r) => r.key === "chest")!.estimated, false);
  });

  test("a complete profile is fully confident and estimates nothing", () => {
    const mesh = buildBody(FULL);
    assert.deepEqual(mesh.estimated, []);
    assert.equal(mesh.confidence, 1);
  });

  test("stature scales the whole figure", () => {
    const short = buildBody({ ...FULL, height: 150, inseam: 68 });
    const tall = buildBody({ ...FULL, height: 195, inseam: 92 });
    const top = (m: BodyMesh) => Math.max(...m.vertices.map((v) => v.y));
    assert.ok(Math.abs(top(short) - 150) < 1);
    assert.ok(Math.abs(top(tall) - 195) < 1);
    // ...but a girth is a girth: it must not scale with height.
    const chestOf = (m: BodyMesh) => m.rings.find((r) => r.key === "chest")!.circumference;
    assert.equal(chestOf(short), chestOf(tall));
  });

  test("an empty profile still produces a usable figure", () => {
    const mesh = buildBody({});
    assert.ok(mesh.vertices.length > 0);
    assert.ok(mesh.faces.length > 0);
    for (const v of mesh.vertices) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
    }
  });

  test("the figure stands on the ground and nothing sits below it", () => {
    const mesh = buildBody(FULL);
    const lowest = Math.min(...mesh.vertices.map((v) => v.y));
    assert.ok(lowest >= -0.001, `lowest vertex at ${lowest}`);
  });
});

/*
 * The renderer decides both visibility and lighting from each face's normal,
 * so a face wound the wrong way is invisible from outside and lit from within
 * — which is exactly how the neck came out as a black band and the shoulders
 * as dark patches. These assert the winding directly, because the failure is
 * only obvious once it is on screen.
 */
describe("mesh orientation", () => {
  const mesh = buildBody(FULL);
  /** Faces per band, matching the mesh builder. */
  const SEGMENTS = 28;

  const normalOf = (v: readonly number[]) => {
    const [a, b, c] = [mesh.vertices[v[0]], mesh.vertices[v[1]], mesh.vertices[v[2]]];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const n = { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    return { x: n.x / len, y: n.y / len, z: n.z / len, len };
  };

  test("no face is degenerate", () => {
    for (const f of mesh.faces) {
      // Cap fans are stored as quads with a repeated centre vertex; a wall
      // collapsing to zero area is the failure being looked for here.
      assert.ok(normalOf(f.v).len > 1e-9, `zero-area face in ${f.group}`);
    }
  });

  test("every wall faces outward, away from the band it belongs to", () => {
    // Faces are emitted one band at a time, so a run of consecutive faces
    // sharing a vertex range is one ring pair — and the mean of its vertices
    // is that band's own axis, wherever the limb happens to sit.
    let checked = 0;
    for (let start = 0; start < mesh.faces.length; start += SEGMENTS) {
      const band = mesh.faces.slice(start, start + SEGMENTS);
      if (band[0].v[2] === band[0].v[3]) continue; // a cap fan, not a wall

      const ids = new Set(band.flatMap((f) => f.v));
      let ax = 0, az = 0;
      for (const i of ids) { ax += mesh.vertices[i].x; az += mesh.vertices[i].z; }
      ax /= ids.size; az /= ids.size;

      for (const f of band) {
        const n = normalOf(f.v);
        const cx = f.v.reduce((s, i) => s + mesh.vertices[i].x, 0) / f.v.length - ax;
        const cz = f.v.reduce((s, i) => s + mesh.vertices[i].z, 0) / f.v.length - az;
        const radial = Math.hypot(cx, cz);
        if (radial < 1e-6) continue;

        const dot = (n.x * cx + n.z * cz) / radial;
        assert.ok(dot > -0.25, `${f.group} wall faces inward (${dot.toFixed(2)})`);
        checked++;
      }
    }
    assert.ok(checked > 500, `only checked ${checked} walls`);
  });

  test("every cap is flat and closes its end squarely", () => {
    const fans = new Map<number, { y: number; sum: number; n: number; group: string }>();
    for (const f of mesh.faces) {
      if (f.v[2] !== f.v[3]) continue;
      const centre = f.v[2];
      const e = fans.get(centre) ?? { y: mesh.vertices[centre].y, sum: 0, n: 0, group: f.group };
      e.sum += normalOf(f.v).y;
      e.n++;
      fans.set(centre, e);
    }
    // Both shoulders, both hands, both leg tops, both soles, both toes, the
    // crown and the seat.
    assert.ok(fans.size >= 10, `expected a cap on every open end; found ${fans.size}`);
    for (const [, e] of fans) {
      const facing = e.sum / e.n;
      assert.ok(Math.abs(facing) > 0.9, `cap at y=${e.y.toFixed(1)} isn't flat (${facing.toFixed(2)})`);
    }
  });

  /**
   * The decisive one. With every face wound outward the divergence theorem
   * gives a positive volume; invert any group and the total collapses or goes
   * negative. It needs no assumption about where anything sits, which is what
   * the per-face tests above kept getting wrong.
   */
  test("the mesh encloses a positive, human-sized volume", () => {
    let volume = 0;
    for (const f of mesh.faces) {
      const tris = f.v[2] === f.v[3] ? [[f.v[0], f.v[1], f.v[2]]] : [[f.v[0], f.v[1], f.v[2]], [f.v[0], f.v[2], f.v[3]]];
      for (const [i, j, k] of tris) {
        const a = mesh.vertices[i], b = mesh.vertices[j], c = mesh.vertices[k];
        volume +=
          (a.x * (b.y * c.z - b.z * c.y) -
            a.y * (b.x * c.z - b.z * c.x) +
            a.z * (b.x * c.y - b.y * c.x)) / 6;
      }
    }
    // A 174cm adult displaces roughly 60-80 litres; the shells overlap where
    // the limbs meet the torso, so the bound is deliberately loose.
    assert.ok(volume > 0, `mesh is inside out (volume ${volume.toFixed(0)}cm³)`);
    assert.ok(
      volume > 30_000 && volume < 160_000,
      `implausible volume ${(volume / 1000).toFixed(1)} litres`,
    );
  });
});

/*
 * Clothes on the body.
 *
 * The demo wardrobe is menswear, so eyeballing it exercises maybe a third of
 * the catalogue and never touches a dress. These sweep every subcategory that
 * exists, because the failures are geometric — a hem below the floor, a shell
 * wound inside out, a band of zero-area faces where two stops collided — and
 * all of them look fine until the one garment that triggers them is opened.
 */
describe("garments on the body", () => {
  const mesh = buildBody(FULL);
  const { frame } = mesh;

  const garment = (
    subcategory: string,
    category: Garment["category"],
    measurements: GarmentMeasurements = {},
  ): Garment => ({
    id: `g-${subcategory}`,
    name: subcategory,
    category,
    subcategory,
    colors: [{ hex: "#3b4a6b", share: 1 }],
    pattern: "solid",
    patternScale: "medium",
    fabric: { cotton: 1 },
    formality: 3,
    fitIntent: "regular",
    measurements,
    seasons: ["spring"],
    careState: "clean",
    imageIds: [],
    wearCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const shellsOf = (g: Garment) => buildGarments(frame, [g]).shells;

  /** Signed volume by the divergence theorem; negative means inside out. */
  const volumeOf = (s: { vertices: Vec3[]; faces: Face[] }) => {
    let volume = 0;
    for (const f of s.faces) {
      const tris =
        f.v[2] === f.v[3]
          ? [[f.v[0], f.v[1], f.v[2]]]
          : [[f.v[0], f.v[1], f.v[2]], [f.v[0], f.v[2], f.v[3]]];
      for (const [i, j, k] of tris) {
        const a = s.vertices[i], b = s.vertices[j], c = s.vertices[k];
        volume +=
          (a.x * (b.y * c.z - b.z * c.y) -
            a.y * (b.x * c.z - b.z * c.x) +
            a.z * (b.x * c.y - b.y * c.x)) / 6;
      }
    }
    return volume;
  };

  const WORN = ["top", "bottom", "dress", "outerwear", "shoes"] as const;

  test("every wearable subcategory in the catalogue produces a shell", () => {
    const missing: string[] = [];
    for (const def of SUBCATEGORY_LIST) {
      if (!WORN.includes(def.category as (typeof WORN)[number])) continue;
      if (!shellsOf(garment(def.key, def.category)).length) missing.push(def.key);
    }
    assert.deepEqual(missing, [], `no shape drawn for: ${missing.join(", ")}`);
  });

  test("accessories and bags are reported, not silently dropped", () => {
    for (const def of SUBCATEGORY_LIST) {
      if (def.category !== "accessory" && def.category !== "bag") continue;
      const { shells, skipped } = buildGarments(frame, [garment(def.key, def.category)]);
      assert.equal(shells.length, 0, `${def.key} drew something`);
      assert.equal(skipped.length, 1, `${def.key} vanished without a reason`);
      assert.match(skipped[0].reason, /not worn on the body/);
    }
  });

  test("no shell has a broken vertex or a zero-area face", () => {
    for (const def of SUBCATEGORY_LIST) {
      for (const shell of shellsOf(garment(def.key, def.category))) {
        for (const v of shell.vertices) {
          assert.ok(
            Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
            `${def.key} has a non-finite vertex`,
          );
        }
        for (const f of shell.faces) {
          const [a, b, c] = [shell.vertices[f.v[0]], shell.vertices[f.v[1]], shell.vertices[f.v[2]]];
          const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
          const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
          const len = Math.hypot(
            uy * vz - uz * vy,
            uz * vx - ux * vz,
            ux * vy - uy * vx,
          );
          assert.ok(len > 1e-9, `${def.key} has a zero-area face`);
        }
      }
    }
  });

  /*
   * The renderer culls and lights from the face normal, so a shell wound the
   * wrong way is drawn from the inside — the same class of bug that made the
   * body's neck a black band.
   */
  test("every shell is wound outward and encloses a sane volume", () => {
    for (const def of SUBCATEGORY_LIST) {
      for (const shell of shellsOf(garment(def.key, def.category))) {
        const v = volumeOf(shell);
        assert.ok(v > 0, `${def.key} is inside out (${v.toFixed(0)}cm³)`);
        // A sleeve is a couple of litres; a floor-length coat is tens.
        assert.ok(v < 400_000, `${def.key} encloses ${(v / 1000).toFixed(0)} litres`);
      }
    }
  });

  test("nothing is drawn below the floor or above the head", () => {
    for (const def of SUBCATEGORY_LIST) {
      for (const shell of shellsOf(garment(def.key, def.category))) {
        for (const v of shell.vertices) {
          assert.ok(v.y >= -0.01, `${def.key} falls through the floor (y=${v.y.toFixed(1)})`);
          assert.ok(v.y <= mesh.height, `${def.key} rises past the crown (y=${v.y.toFixed(1)})`);
        }
      }
    }
  });

  test("a hem sits where the subcategory says it does", () => {
    for (const def of SUBCATEGORY_LIST) {
      if (!def.hem || !WORN.includes(def.category as (typeof WORN)[number])) continue;
      const expected = frame.hem[def.hem];
      assert.equal(typeof expected, "number", `no height defined for hem "${def.hem}"`);

      // The hem rule is about the piece covering the body. A sleeve ends at
      // the wrist, well below a hip hem, so counting it measures the cuff.
      const shells = shellsOf(garment(def.key, def.category)).filter((s) => s.part !== "sleeve");
      const lowest = Math.min(...shells.flatMap((s) => s.vertices.map((v) => v.y)));
      assert.ok(
        Math.abs(lowest - expected) < 6,
        `${def.key} hems at ${lowest.toFixed(1)} but "${def.hem}" is ${expected.toFixed(1)}`,
      );
    }
  });

  test("cloth moulds onto the body rather than passing through it", () => {
    // A chest measurement far smaller than the wearer: the shell must still
    // come out wider than the body, which is how "too tight" reads.
    const tiny = garment("t-shirt", "top", { chestFlat: 20, waistFlat: 20 });
    const chest = frame.torso.find((s) => Math.abs(s.y - frame.landmark.chest) < 0.5)!;
    const shell = shellsOf(tiny)[0];
    const widest = Math.max(...shell.vertices.map((v) => Math.abs(v.x)));
    assert.ok(
      widest > chest.a,
      `a 40cm chest drew ${widest.toFixed(1)}cm across a ${chest.a.toFixed(1)}cm body`,
    );
  });

  test("a roomier garment really is drawn roomier", () => {
    const spread = (g: Garment) => {
      const s = shellsOf(g)[0];
      return Math.max(...s.vertices.map((v) => Math.abs(v.x)));
    };
    const slim = spread(garment("t-shirt", "top", { chestFlat: 50 }));
    const loose = spread(garment("t-shirt", "top", { chestFlat: 65 }));
    assert.ok(loose > slim + 3, `30cm more chest moved the shell by ${(loose - slim).toFixed(1)}cm`);
  });

  test("measured garments are not flagged as estimated, and unmeasured ones are", () => {
    const bare = buildGarments(frame, [garment("sweater", "top")]);
    assert.deepEqual(bare.estimated, ["sweater"]);

    const measured = buildGarments(frame, [
      garment("sweater", "top", { chestFlat: 56, waistFlat: 52 }),
    ]);
    assert.deepEqual(measured.estimated, []);
  });

  test("sleeves are drawn on both sides, and only where the type has them", () => {
    // A missing sleeve measurement used to mean "no sleeves", which drew every
    // unmeasured jumper as a gilet. It now means "the length this type
    // usually is" — and only a genuinely sleeveless type gets none.
    const sleeved = shellsOf(garment("sweater", "top", { chestFlat: 56, sleeveLength: 62 }));
    assert.equal(sleeved.length, 3, "expected a body and two sleeves");
    assert.equal(shellsOf(garment("tank", "top", { chestFlat: 50 })).length, 1, "a tank grew sleeves");

    const [left, right] = sleeved
      .filter((s: GarmentShell) => s.part === "sleeve")
      .map((s: GarmentShell) => s.vertices.reduce((sum, v) => sum + v.x, 0) / s.vertices.length);
    assert.ok(left * right < 0, "both sleeves are on the same side");
    assert.ok(Math.abs(Math.abs(left) - Math.abs(right)) < 0.01, "sleeves are asymmetric");
  });

  test("trousers get a seat and two legs; shorts stop above the knee", () => {
    const jeans = shellsOf(garment("jeans", "bottom", { waistFlat: 42, inseam: 79 }));
    assert.equal(jeans.length, 3, "expected a seat and two legs");
    const hem = Math.min(...jeans.flatMap((s) => s.vertices.map((v) => v.y)));
    assert.ok(Math.abs(hem - (frame.crotchY - 79)) < 1, `a 79cm inseam hemmed at ${hem.toFixed(1)}`);

    const shorts = shellsOf(garment("shorts", "bottom", { waistFlat: 42, inseam: 18 }));
    const shortHem = Math.min(...shorts.flatMap((s) => s.vertices.map((v) => v.y)));
    assert.ok(shortHem > frame.hem.knee, `shorts hemmed at ${shortHem.toFixed(1)}, below the knee`);
  });

  test("layers sort so outerwear ends up over the shirt", () => {
    const { shells } = buildGarments(frame, [
      garment("wool-coat", "outerwear", { chestFlat: 60 }),
      garment("t-shirt", "top", { chestFlat: 52 }),
    ]);
    const layers = shells.map((s) => s.layer);
    assert.deepEqual(layers, [...layers].sort((a, b) => a - b), "shells are out of layer order");
    assert.ok(layers[0] < layers[layers.length - 1], "a coat and a tee landed on the same layer");
  });

  test("a body with nothing measured still dresses without breaking", () => {
    const bare = buildBody({});
    for (const def of SUBCATEGORY_LIST) {
      for (const shell of buildGarments(bare.frame, [garment(def.key, def.category)]).shells) {
        for (const v of shell.vertices) {
          assert.ok(
            Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
            `${def.key} broke on an empty profile`,
          );
        }
      }
    }
  });
});

/*
 * The shoulder is where the figure and the clothes both have to be right: it
 * is the one joint where two separate tubes have to read as one body, and a
 * gap there shows as daylight between the neck and the arm — then again as a
 * hole in every sleeve hung over it.
 */
describe("the shoulder joins up", () => {
  const frames = [
    buildBody(FULL).frame,
    buildBody({}).frame,
    // Broad shoulders on a narrow neck is the case that pulls them apart.
    buildBody({ ...FULL, shoulderWidth: 52, neck: 34 }).frame,
    buildBody({ ...FULL, shoulderWidth: 38, neck: 42 }).frame,
  ];

  /** The torso's half-width at an arbitrary height. */
  const torsoAt = (frame: (typeof frames)[number], y: number) => {
    const sorted = [...frame.torso].sort((p, q) => p.y - q.y);
    for (let i = 1; i < sorted.length; i++) {
      if (y <= sorted[i].y) {
        const lo = sorted[i - 1], hi = sorted[i];
        const t = (y - lo.y) / (hi.y - lo.y || 1);
        return lo.a + (hi.a - lo.a) * t;
      }
    }
    return sorted[sorted.length - 1].a;
  };

  test("the arm meets the torso rather than floating beside it", () => {
    for (const frame of frames) {
      const top = frame.arm[0];
      const inner = top.cx - top.a;
      const torso = torsoAt(frame, top.y);
      assert.ok(
        torso >= inner,
        `daylight between torso (${torso.toFixed(1)}) and arm (${inner.toFixed(1)}) at y=${top.y.toFixed(1)}`,
      );
    }
  });

  test("a sleeve reaches high enough to cover the joint", () => {
    for (const frame of frames) {
      // The arm's own topmost section is where a sleeve has to start; if the
      // body's arm rose above it there would be bare skin above every cuff.
      const highest = Math.max(...frame.arm.map((s) => s.y));
      assert.equal(frame.arm[0].y, highest, "the arm's first section isn't its top");
      assert.ok(frame.arm[0].y > frame.shoulderY, "the joint doesn't rise above the shoulder point");
    }
  });
});

/*
 * Layering, which only shows up once more than one thing is on the figure —
 * the studio's case rather than the wardrobe item's.
 */
describe("a whole outfit layers correctly", () => {
  const mesh = buildBody(FULL);

  const piece = (
    subcategory: string,
    category: Garment["category"],
    measurements: GarmentMeasurements = {},
  ): Garment => ({
    id: `o-${subcategory}`,
    name: subcategory,
    category,
    subcategory,
    colors: [{ hex: "#404040", share: 1 }],
    pattern: "solid",
    patternScale: "medium",
    fabric: { cotton: 1 },
    formality: 3,
    fitIntent: "regular",
    measurements,
    seasons: ["autumn"],
    careState: "clean",
    imageIds: [],
    wearCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const outfit = [
    piece("minimal-sneakers", "shoes"),
    piece("jeans", "bottom", { waistFlat: 42, inseam: 79 }),
    piece("t-shirt", "top", { chestFlat: 52 }),
    piece("sweater", "top", { chestFlat: 56, sleeveLength: 62 }),
    piece("wool-coat", "outerwear", { chestFlat: 62, sleeveLength: 64 }),
  ];

  test("nothing is skipped and every piece is drawn", () => {
    const { shells, skipped } = buildGarments(mesh.frame, outfit);
    assert.deepEqual(skipped, []);
    const drawn = new Set(shells.map((s) => s.garmentId));
    assert.equal(drawn.size, outfit.length, "a garment vanished from the outfit");
  });

  test("trousers sit under tops, and shoes under everything", () => {
    const { shells } = buildGarments(mesh.frame, outfit);
    const layerOf = (id: string) => shells.find((s) => s.garmentId === id)!.layer;

    // A waistband sharing a rank with a jumper let the painter's algorithm
    // paint a band of denim across the front of it.
    assert.ok(layerOf("o-jeans") < layerOf("o-t-shirt"), "jeans are not under the tee");
    assert.ok(layerOf("o-t-shirt") < layerOf("o-sweater"), "the tee is not under the jumper");
    assert.ok(layerOf("o-sweater") < layerOf("o-wool-coat"), "the jumper is not under the coat");
    assert.ok(
      layerOf("o-minimal-sneakers") < layerOf("o-jeans"),
      "the trouser hem does not break over the shoe",
    );
  });

  test("shells come back in draw order", () => {
    const { shells } = buildGarments(mesh.frame, outfit);
    const layers = shells.map((s) => s.layer);
    assert.deepEqual(layers, [...layers].sort((a, b) => a - b));
  });

  test("an outer layer really is drawn outside the one beneath it", () => {
    // Not just sorted — actually further from the body, or the sort is a lie.
    const { shells } = buildGarments(mesh.frame, outfit);
    const widthAtChest = (id: string) => {
      const shell = shells.find((s) => s.garmentId === id)!;
      const near = shell.vertices.filter((v) => Math.abs(v.y - mesh.frame.landmark.chest) < 3);
      return Math.max(...near.map((v) => Math.abs(v.x)));
    };
    assert.ok(
      widthAtChest("o-wool-coat") > widthAtChest("o-sweater"),
      "the coat is narrower at the chest than the jumper under it",
    );
  });
});

/*
 * Sleeves.
 *
 * A jumper added without a sleeve-length measurement was drawn as a gilet:
 * the renderer only looked at what the user had typed, so "not recorded" and
 * "sleeveless" came out the same. The catalogue already knew — eighteen types
 * carry a sleeve-length rule off arm length — it was simply never asked.
 */
describe("sleeves are drawn without being measured", () => {
  const mesh = buildBody(FULL);
  const ARM = 62;

  const bare = (subcategory: string, category: Garment["category"]): Garment => ({
    id: `s-${subcategory}`,
    name: subcategory,
    category,
    subcategory,
    colors: [{ hex: "#222222", share: 1 }],
    pattern: "solid",
    patternScale: "medium",
    fabric: { cotton: 1 },
    formality: 3,
    fitIntent: "regular",
    measurements: {},
    seasons: ["autumn"],
    careState: "clean",
    imageIds: [],
    wearCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const sleevesOf = (g: Garment) =>
    buildGarments(mesh.frame, [g]).shells.filter((s) => s.part === "sleeve");

  const sleeveCount = (g: Garment) => sleevesOf(g).length;

  /** How far below the shoulder seam the cuff reaches. */
  const sleeveDrop = (g: Garment) => {
    const sleeves = sleevesOf(g);
    if (!sleeves.length) return 0;
    const lowest = Math.min(...sleeves.flatMap((s) => s.vertices.map((v) => v.y)));
    return mesh.frame.shoulderY - lowest;
  };

  test("an unmeasured jumper has two sleeves, not none", () => {
    assert.equal(sleeveCount(bare("sweater", "top")), 2);
  });

  test("every long-sleeved type gets sleeves with nothing typed in", () => {
    const longSleeved = SUBCATEGORY_LIST.filter((d) => d.lengths.sleeveLength);
    assert.ok(longSleeved.length >= 15, "the catalogue lost its sleeve rules");
    for (const def of longSleeved) {
      assert.equal(sleeveCount(bare(def.key, def.category)), 2, `${def.key} came out sleeveless`);
    }
  });

  test("a long sleeve reaches the wrist", () => {
    const drop = sleeveDrop(bare("sweater", "top"));
    assert.ok(Math.abs(drop - ARM) < 4, `long sleeve stopped ${drop.toFixed(0)}cm down a ${ARM}cm arm`);
  });

  test("a t-shirt gets short sleeves, not long ones and not none", () => {
    assert.equal(sleeveCount(bare("t-shirt", "top")), 2);
    const drop = sleeveDrop(bare("t-shirt", "top"));
    assert.ok(drop > 8 && drop < ARM * 0.5, `t-shirt sleeve dropped ${drop.toFixed(0)}cm`);
  });

  test("genuinely sleeveless types stay sleeveless", () => {
    for (const key of ["tank", "vest"]) {
      const def = SUBCATEGORY_LIST.find((d) => d.key === key)!;
      assert.equal(sleeveCount(bare(key, def.category)), 0, `${key} grew sleeves`);
    }
  });

  test("a recorded sleeve length still wins over the type's assumption", () => {
    const cropped = { ...bare("sweater", "top"), measurements: { sleeveLength: 30 } };
    const drop = sleeveDrop(cropped);
    assert.ok(Math.abs(drop - 30) < 3, `a 30cm sleeve was drawn ${drop.toFixed(0)}cm long`);
  });

  test("every subcategory resolves to a sleeve length that is a real number", () => {
    for (const def of SUBCATEGORY_LIST) {
      const n = assumedSleeveLength(def, ARM);
      assert.ok(Number.isFinite(n) && n >= 0, `${def.key} assumed ${n}`);
      assert.ok(n <= ARM + 4, `${def.key} assumed a ${n}cm sleeve on a ${ARM}cm arm`);
    }
  });

  test("a sleeve never reaches past the hand", () => {
    for (const def of SUBCATEGORY_LIST) {
      const drop = sleeveDrop(bare(def.key, def.category));
      assert.ok(drop <= ARM + 2, `${def.key} sleeve runs ${drop.toFixed(0)}cm down a ${ARM}cm arm`);
    }
  });
});

/*
 * Cloth trailing the body it hangs from.
 *
 * The temptation with motion like this is to shear the vertices, which is one
 * line and looks almost right — until the garment stops being the size it was
 * measured at, and the picture quietly stops meaning the ease it was built to
 * show. These pin it to a rotation: shape preserved, held at the top, and
 * scaled by the garment's own drape rather than applied evenly.
 */
describe("cloth swings without changing size", () => {
  const mesh = buildBody(FULL);

  const piece = (
    subcategory: string,
    category: Garment["category"],
    measurements: GarmentMeasurements = {},
  ): Garment => ({
    id: `w-${subcategory}`,
    name: subcategory,
    category,
    subcategory,
    colors: [{ hex: "#333", share: 1 }],
    pattern: "solid",
    patternScale: "medium",
    fabric: { wool: 1 },
    formality: 3,
    fitIntent: "regular",
    measurements,
    seasons: ["autumn"],
    careState: "clean",
    imageIds: [],
    wearCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const shellOf = (g: Garment) =>
    buildGarments(mesh.frame, [g]).shells.find((s) => s.part === "body")!;

  const tight = shellOf(piece("t-shirt", "top", { chestFlat: 50 }));
  const loose = shellOf(piece("wool-coat", "outerwear", { chestFlat: 72 }));

  test("a garment records how far it stands off the body", () => {
    assert.ok(tight.drape >= 0, "drape went negative");
    assert.ok(
      loose.drape > tight.drape + 3,
      `a coat at ${loose.drape.toFixed(1)}cm should stand further off than a tee at ${tight.drape.toFixed(1)}cm`,
    );
  });

  test("standing still, the vertices are handed back untouched", () => {
    // Identity, and the same array — the figure is usually not moving, and
    // rebuilding thousands of vertices per frame for nothing is the easy way
    // to make a spin stutter.
    assert.equal(swung(loose, 0), loose.vertices);
  });

  test("swinging rotates the cloth rather than stretching it", () => {
    const moved = swung(loose, 0.25);
    assert.notEqual(moved, loose.vertices);
    for (let i = 0; i < loose.vertices.length; i++) {
      const before = loose.vertices[i];
      const after = moved[i];
      // A rotation about the body's axis preserves height and the distance
      // from that axis. A shear preserves neither.
      assert.ok(Math.abs(after.y - before.y) < 1e-9, "a vertex changed height");
      const r0 = Math.hypot(before.x, before.z);
      const r1 = Math.hypot(after.x, after.z);
      assert.ok(Math.abs(r1 - r0) < 1e-9, `radius changed by ${(r1 - r0).toFixed(6)}cm`);
    }
  });

  test("the hem carries the swing and the shoulders hold still", () => {
    const swing = 0.25;
    const moved = swung(loose, swing);
    const angleAt = (i: number) =>
      Math.atan2(moved[i].z, moved[i].x) - Math.atan2(loose.vertices[i].z, loose.vertices[i].x);

    let topTurn = Infinity;
    let hemTurn = 0;
    for (let i = 0; i < loose.vertices.length; i++) {
      const v = loose.vertices[i];
      if (Math.abs(v.y - loose.topY) < 0.5) topTurn = Math.min(topTurn, Math.abs(angleAt(i)));
      if (Math.abs(v.y - loose.bottomY) < 0.5) hemTurn = Math.max(hemTurn, Math.abs(angleAt(i)));
    }
    assert.ok(topTurn < 1e-6, `the shoulder turned by ${topTurn.toFixed(4)} rad`);
    assert.ok(hemTurn > 0.01, `the hem barely moved (${hemTurn.toFixed(4)} rad)`);
  });

  test("a sleeve swings as much as the coat it belongs to", () => {
    // Measured alone a sleeve is always within a centimetre of the arm, which
    // had an oversized coat's sleeves as rigid as a vest's. They are the part
    // furthest from the axis, so they are what a twist visibly moves.
    const coat = buildGarments(mesh.frame, [
      piece("wool-coat", "outerwear", { chestFlat: 72, sleeveLength: 64 }),
    ]).shells;
    const body = coat.find((s) => s.part === "body")!;
    const sleeves = coat.filter((s) => s.part === "sleeve");
    assert.ok(sleeves.length === 2, "expected two sleeves");
    for (const sleeve of sleeves) {
      assert.equal(sleeve.drape, body.drape, "a sleeve did not inherit the coat's slack");
    }
  });

  test("a loose garment swings further than a tight one", () => {
    const sweep = (shell: (typeof loose)) => {
      const moved = swung(shell, 0.25);
      let most = 0;
      for (let i = 0; i < shell.vertices.length; i++) {
        const before = shell.vertices[i];
        most = Math.max(most, Math.hypot(moved[i].x - before.x, moved[i].z - before.z));
      }
      return most;
    };
    assert.ok(
      sweep(loose) > sweep(tight) * 1.5,
      `coat swept ${sweep(loose).toFixed(2)}cm, tee ${sweep(tight).toFixed(2)}cm`,
    );
  });

  /*
   * Every test above builds its shell with `shellOf`, which always picks
   * `part === "body"` — a torso shell, whose own centre already sits close to
   * the spine. Rotating "about the body's axis" and "about the shell's own
   * axis" come out nearly identical there, so none of them could have caught
   * an axis mistake; they'd pass unchanged either way. A leg or a sleeve is
   * the opposite case: a narrow tube sitting well off to one side, which is
   * exactly where the two axes stop agreeing.
   */
  test("a trouser leg swings about its own ankle, not the far side of the body", () => {
    const trousers = buildGarments(mesh.frame, [
      piece("wide-leg-trousers", "bottom", { waistFlat: 44, hipFlat: 56, thighFlat: 34, legOpeningFlat: 24 }),
    ]).shells;
    const legs = trousers.filter((s) => s.part === "leg");
    assert.equal(legs.length, 2, "expected two trouser legs");

    // A ring is built symmetric around its own centre, so the plain mean of
    // its own vertices recovers that centre — no separate geometry needed.
    const ringCentre = (vertices: { x: number; y: number; z: number }[], y: number) => {
      let x = 0, z = 0, n = 0;
      for (const v of vertices) {
        if (Math.abs(v.y - y) > 0.5) continue;
        x += v.x; z += v.z; n++;
      }
      return { x: x / n, z: z / n };
    };

    for (const leg of legs) {
      const before = ringCentre(leg.vertices, leg.bottomY);
      // The largest lag the spring in BodyAvatar ever reaches, so this is the
      // worst case an actual drag produces rather than a contrived extreme.
      const after = ringCentre(swung(leg, 0.34), leg.bottomY);
      const drift = Math.hypot(after.x - before.x, after.z - before.z);
      assert.ok(
        drift < 0.01,
        `the ankle's own axis moved ${drift.toFixed(2)}cm — the trouser leg swung away from the leg it's on`,
      );
    }
  });

  test("but the coat it sits under still visibly sweeps", () => {
    // The whole reason a per-shell axis exists rather than just holding limb
    // shells still: it must not quietly zero out the effect on a torso piece.
    const moved = swung(loose, 0.34);
    let sweep = 0;
    for (let i = 0; i < loose.vertices.length; i++) {
      if (Math.abs(loose.vertices[i].y - loose.bottomY) > 0.5) continue;
      sweep = Math.max(sweep, Math.hypot(moved[i].x - loose.vertices[i].x, moved[i].z - loose.vertices[i].z));
    }
    assert.ok(sweep > 4, `the coat hem only swept ${sweep.toFixed(1)}cm — the flare effect got lost`);
  });

  test("swing is bounded, so a fast spin can't wring the cloth round the body", () => {
    const violent = swung(loose, 5);
    for (let i = 0; i < loose.vertices.length; i++) {
      const before = loose.vertices[i];
      const after = violent[i];
      assert.ok(Number.isFinite(after.x) && Number.isFinite(after.z));
      assert.ok(Math.abs(Math.hypot(after.x, after.z) - Math.hypot(before.x, before.z)) < 1e-9);
    }
  });
});

/*
 * Dressing, layer by layer.
 *
 * The order clothes go on is real information the figure had no way of showing
 * — the depth sorting gets it right in the finished picture, but a picture that
 * simply appears says nothing about what is under what.
 */
describe("clothes arrive in the order they are worn", () => {
  const span = { lowest: 0, deepest: 4 }; // shoes .. outerwear

  test("nothing is on at the start and everything is on at the end", () => {
    for (const layer of [0, 1, 2, 3, 4]) {
      assert.equal(layerAlpha(0, layer, span), 0, `layer ${layer} was already on`);
      assert.equal(layerAlpha(1, layer, span), 1, `layer ${layer} never finished`);
    }
  });

  test("an inner layer is always at least as far along as the one over it", () => {
    for (let dressed = 0; dressed <= 1; dressed += 0.05) {
      let previous = Infinity;
      for (const layer of [0, 1, 2, 3, 4]) {
        const alpha = layerAlpha(dressed, layer, span);
        assert.ok(
          alpha <= previous + 1e-9,
          `at ${dressed.toFixed(2)}, layer ${layer} outran the one beneath it`,
        );
        previous = alpha;
      }
    }
  });

  test("the outer layer really does start later, not just finish later", () => {
    // Otherwise it is a plain crossfade wearing a stagger's clothes.
    const early = 0.2;
    assert.ok(layerAlpha(early, 0, span) > 0, "the innermost layer hadn't started");
    assert.equal(layerAlpha(early, 4, span), 0, "the coat started with everything else");
  });

  test("a single garment fades straight in rather than waiting its turn", () => {
    const alone = { lowest: 3, deepest: 3 };
    assert.ok(layerAlpha(0.5, 3, alone) > 0.5, "one garment was made to wait for nobody");
    assert.equal(layerAlpha(1, 3, alone), 1);
  });

  test("taking them off runs the same ramp backwards", () => {
    // `dressed` sweeps down on the way out, so the outer layer leaves first —
    // which is also the order you would take them off.
    assert.ok(layerAlpha(0.3, 4, span) < layerAlpha(0.3, 0, span));
  });
});
