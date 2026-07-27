import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildBody, ellipseAxes, type BodyMesh } from "../src/lib/avatar/body.ts";
import type { BodyMeasurements } from "../src/lib/types.ts";

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
