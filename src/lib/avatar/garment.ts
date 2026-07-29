/**
 * Clothes, drawn from their own measurements, hung on the measured body.
 *
 * This is the fit report rendered instead of tabulated. A garment's shell is
 * built from the circumferences recorded for *that garment* — chest flat times
 * two, waist flat times two — stacked at the landmark heights of *this body*.
 * The gap you see between cloth and skin is the ease: the same number the fit
 * engine scores, only now you can walk around it.
 *
 * Where a garment is narrower than the body it clings rather than passing
 * through, because that is what fabric does. So "too tight" reads as a shell
 * moulded onto the body and "oversized" reads as one standing well off it,
 * without either being annotated.
 *
 * Measurements that were never recorded fall back to the middle of the
 * subcategory's ideal ease band — the engine's own assumption, drawn honestly
 * rather than invented — and the caller is told which garments those were.
 */
import type { Garment, GarmentMeasurements } from "../types";
import { subcategoryDef } from "../data/garmentTypes";
import { ellipseAxes, type BodyFrame, type Face, type Section, type Vec3 } from "./body";

export interface GarmentShell {
  vertices: Vec3[];
  faces: Face[];
  /** Base colour, straight from the garment. */
  hex: string;
  garmentId: string;
  name: string;
  /** Draw order — base layers first, outerwear last. */
  layer: number;
  /** True when this shell rests on ease bands rather than real measurements. */
  estimated: boolean;
}

const SEGMENTS = 28;

/**
 * Cloth has thickness and can't occupy the same space as the body. Generous
 * enough that the two surfaces are unambiguously ordered when sorted by depth.
 */
const MIN_STANDOFF = 0.9;

const LAYER_ORDER: Record<string, number> = {
  base: 0,
  mid: 1,
  legs: 1,
  outer: 2,
  feet: 0,
  accent: 3,
};

/* ---------------------------------------------------------- interpolation -- */

/** The body's cross-section at an arbitrary height, between known sections. */
function sectionAt(sections: Section[], y: number): Section {
  if (!sections.length) return { y, a: 15, b: 11, cx: 0 };

  const sorted = [...sections].sort((p, q) => p.y - q.y);
  if (y <= sorted[0].y) return { ...sorted[0], y };
  if (y >= sorted[sorted.length - 1].y) return { ...sorted[sorted.length - 1], y };

  for (let i = 1; i < sorted.length; i++) {
    if (y <= sorted[i].y) {
      const lo = sorted[i - 1];
      const hi = sorted[i];
      const t = (y - lo.y) / (hi.y - lo.y || 1);
      return {
        y,
        a: lo.a + (hi.a - lo.a) * t,
        b: lo.b + (hi.b - lo.b) * t,
        cx: lo.cx + (hi.cx - lo.cx) * t,
      };
    }
  }
  return { ...sorted[sorted.length - 1], y };
}

/* ---------------------------------------------------------------- meshes -- */

function ring(
  vertices: Vec3[],
  y: number,
  a: number,
  b: number,
  cx: number,
  cz = 0,
): number {
  const start = vertices.length;
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2;
    vertices.push({ x: cx + a * Math.cos(t), y, z: cz + b * Math.sin(t) });
  }
  return start;
}

/** Winding matches the body's: `lower` is the ring at the smaller y. */
function loft(faces: Face[], lower: number, upper: number, group: string) {
  for (let i = 0; i < SEGMENTS; i++) {
    const j = (i + 1) % SEGMENTS;
    faces.push({ v: [lower + j, lower + i, upper + i, upper + j], group });
  }
}

function cap(
  vertices: Vec3[],
  faces: Face[],
  start: number,
  y: number,
  cx: number,
  group: string,
  facing: "up" | "down",
) {
  const centre = vertices.length;
  vertices.push({ x: cx, y, z: 0 });
  for (let i = 0; i < SEGMENTS; i++) {
    const j = (i + 1) % SEGMENTS;
    faces.push({
      v:
        facing === "down"
          ? [start + i, start + j, centre, centre]
          : [start + j, start + i, centre, centre],
      group,
    });
  }
}

/* ------------------------------------------------------------ dimensions -- */

interface Stop {
  y: number;
  /** Garment circumference at this height, in cm. */
  circumference: number;
}

/** Ramanujan's perimeter — the same approximation `ellipseAxes` inverts. */
const girth = (a: number, b: number) =>
  Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

/** The garment's own circumference at an arbitrary height, between its stops. */
function circumferenceAt(stops: Stop[], y: number): number {
  for (let i = 1; i < stops.length; i++) {
    if (y >= stops[i].y) {
      const hi = stops[i - 1];
      const lo = stops[i];
      const t = (hi.y - y) / (hi.y - lo.y || 1);
      return hi.circumference + (lo.circumference - hi.circumference) * t;
    }
  }
  return stops[stops.length - 1].circumference;
}

/** Flat measurements are half the garment; doubling gives the way round. */
const round = (flat: number | undefined | null) =>
  typeof flat === "number" && flat > 0 ? flat * 2 : null;

/**
 * The ease this subcategory considers ideal at a landmark, used only when the
 * garment itself was never measured there.
 */
function idealEase(
  def: ReturnType<typeof subcategoryDef>,
  key: keyof GarmentMeasurements,
): number {
  const band = def.ease[key];
  if (!band) return 8;
  return (band.idealHi + band.snug) / 2;
}

/* ----------------------------------------------------------------- build -- */

function shellFromStops(
  stops: Stop[],
  frame: BodyFrame,
  sections: Section[],
  side: number,
  garment: Garment,
  layer: number,
  estimated: boolean,
): GarmentShell | null {
  const usable = stops.filter((s) => Number.isFinite(s.y) && s.circumference > 0);
  usable.sort((p, q) => q.y - p.y); // top-down

  // Two stops at the same height loft into a band of zero-area faces, which
  // the renderer then tries to shade from a normal it cannot compute. A hem
  // landing exactly on the waist is enough to cause it, so collapse first.
  const landmarks = usable.filter((s, i) => i === 0 || usable[i - 1].y - s.y > 0.05);
  if (landmarks.length < 2) return null;

  /*
   * The shell is clamped outside the body ring by ring, so between two rings
   * it is a straight cone — and a cone from the neck to the shoulder point
   * cuts straight through the trapezius sitting between them. That is the
   * body poking through a sweater's shoulders.
   *
   * Sampling at every body section the garment spans, as well as at its own
   * landmarks, means the clamp is applied everywhere the body actually
   * changes shape, so no interpolated span can dive back inside it.
   */
  const top = landmarks[0].y;
  const bottom = landmarks[landmarks.length - 1].y;
  const distinct = [
    ...landmarks,
    ...sections
      .filter((s) => s.y < top - 0.05 && s.y > bottom + 0.05)
      .map((s) => ({ y: s.y, circumference: circumferenceAt(landmarks, s.y) })),
  ]
    .sort((p, q) => q.y - p.y)
    .filter((s, i, all) => i === 0 || all[i - 1].y - s.y > 0.05);

  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  const group = garment.category;

  let previous: number | null = null;
  let first: number | null = null;
  let firstY = 0;
  let firstCx = 0;
  let lastY = 0;
  let lastCx = 0;

  // Above the topmost section there is no body — the shoulder joint just ends.
  // `sectionAt` holds the last section instead, which is right for
  // interpolating and wrong for clamping: it made a sleeve head dome onto a
  // phantom arm, leaving a nub standing above the shoulder.
  const highest = sections.length ? Math.max(...sections.map((s) => s.y)) : Infinity;

  for (const stop of distinct) {
    const body = sectionAt(sections, stop.y);
    const aspect = body.a / (body.b || 1);
    const cloth = ellipseAxes(stop.circumference, aspect);

    // Cloth cannot pass through the body: where the garment is narrower than
    // the wearer it moulds onto them, which is exactly how "too tight" should
    // look without needing a label.
    const clear = stop.y > highest + 0.05 ? 0 : MIN_STANDOFF;
    const a = clear ? Math.max(cloth.a, body.a + clear) : cloth.a;
    const b = clear ? Math.max(cloth.b, body.b + clear) : cloth.b;
    const cx = side * body.cx;

    const start = ring(vertices, stop.y, a, b, cx);
    if (previous === null) {
      first = start;
      firstY = stop.y;
      firstCx = cx;
    } else {
      loft(faces, start, previous, group);
    }
    previous = start;
    lastY = stop.y;
    lastCx = cx;
  }

  // Both ends are open tubes. A neck hole would be more truthful but reads as
  // a hollow shell from above; closing them keeps the figure solid.
  if (first !== null) cap(vertices, faces, first, firstY, firstCx, group, "up");
  if (previous !== null) cap(vertices, faces, previous, lastY, lastCx, group, "down");

  return {
    vertices,
    faces,
    hex: garment.colors?.[0]?.hex ?? "#8a8681",
    garmentId: garment.id,
    name: garment.name,
    layer,
    estimated,
  };
}

/**
 * Builds every shell for one garment. Bottoms return two — one per leg —
 * below the crotch, plus a seat over the hips.
 */
function shellsFor(garment: Garment, frame: BodyFrame): GarmentShell[] {
  const def = subcategoryDef(garment.subcategory, garment.category);
  const m = garment.measurements ?? {};
  const layer = LAYER_ORDER[def.layer] ?? 1;
  const hemY = frame.hem[def.hem ?? "hip"] ?? frame.hem.hip;

  const torso = frame.torso;
  const bodyAt = (y: number) => sectionAt(torso, y);
  const bodyRound = (y: number) => {
    const s = bodyAt(y);
    return girth(s.a, s.b);
  };

  const chestY = frame.landmark.chest;
  const waistY = frame.landmark.waist;
  const hipY = frame.landmark.hip;

  /* ---------------------------------------------------- tops and dresses -- */
  if (["top", "outerwear", "dress"].includes(garment.category)) {
    const chest = round(m.chestFlat);
    const waist = round(m.waistFlat);
    const measured = Boolean(chest || waist);

    const chestC = chest ?? bodyRound(chestY) + idealEase(def, "chestFlat");
    const waistC = waist ?? bodyRound(waistY) + idealEase(def, "waistFlat");

    // A body length, when given, overrides the subcategory's nominal hem. It
    // is measured from the high point of the shoulder, which is where the neck
    // base sits — not from the shoulder point, which is 7cm lower.
    const bodyLength = typeof m.bodyLength === "number" ? m.bodyLength : null;
    const hpsY = frame.landmark.neck;
    const bottomY = bodyLength ? Math.max(0, hpsY - bodyLength) : hemY;

    // The shell has to close somewhere, and closing it flat across the
    // shoulders reads as a yoke shelf. Tapering up to a neck opening gives the
    // shoulder slope a real garment has, and hides the cap inside the neck.
    const neckY = frame.landmark.neck;
    const neckC = round(m.neckCircumference) ?? bodyRound(neckY) + 4;

    const stops: Stop[] = [
      { y: neckY, circumference: neckC },
      { y: frame.shoulderY, circumference: chestC * 0.97 },
      { y: chestY, circumference: chestC },
      { y: waistY, circumference: waistC },
      { y: bottomY, circumference: Math.max(waistC, bodyRound(bottomY) + 4) },
    ].filter((s) => s.y >= bottomY - 0.01);

    const shells: GarmentShell[] = [];
    const body = shellFromStops(stops, frame, torso, 1, garment, layer, !measured);
    if (body) shells.push(body);

    // Sleeves, when the garment records a length worth drawing.
    const sleeve = typeof m.sleeveLength === "number" ? m.sleeveLength : null;
    if (sleeve && sleeve > 12 && frame.arm.length) {
      // Over the top of the joint, not down from the shoulder seam: starting at
      // the seam left the deltoid bare through the armhole. Length is still
      // measured from the seam, which is where a tape starts.
      const topY = frame.arm[0].y;
      const endY = Math.max(frame.arm[frame.arm.length - 1].y, frame.shoulderY - sleeve);

      /*
       * The sleeve follows the arm's own profile plus ease, all the way up.
       * Holding it at the width of the armhole instead — to butt it against
       * the body of the garment — left it standing three centimetres off a
       * joint that is tapering inward, which is precisely the shape of a
       * shoulder pad. The narrow gap that leaves at the very top of the
       * shoulder reads as the seam, and is much the smaller error.
       */
      const head = girth(frame.arm[0].a, frame.arm[0].b) + 5.5;

      /*
       * Rounded over rather than closed with a disc. It has to stay shallow:
       * the joint already tops out a few centimetres above the shoulder
       * point, and a tall head on top of that stands up beside the neck.
       */
      const DOME: [number, number][] = [[1.4, 0.42], [0.7, 0.78]];

      for (const side of [-1, 1]) {
        const armStops: Stop[] = DOME.map(([rise, scale]) => ({
          y: topY + rise,
          circumference: head * scale,
        }));

        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const y = topY - (topY - endY) * t;
          const s = sectionAt(frame.arm, y);
          // Roomy at the top, close at the cuff — the taper every sleeve has.
          armStops.push({ y, circumference: girth(s.a, s.b) + 5.5 - t * 3.5 });
        }

        const arm = shellFromStops(armStops, frame, frame.arm, side, garment, layer, !measured);
        if (arm) shells.push(arm);
      }
    }
    return shells;
  }

  /* ---------------------------------------------------------- bottoms -- */
  if (garment.category === "bottom") {
    const waist = round(m.waistFlat);
    const hip = round(m.hipFlat);
    const thigh = round(m.thighFlat);
    const opening = round(m.legOpeningFlat);
    const measured = Boolean(waist || hip || thigh);

    const waistC = waist ?? bodyRound(waistY) + idealEase(def, "waistFlat");
    const hipC = hip ?? bodyRound(hipY) + idealEase(def, "hipFlat");

    // Inseam decides where the legs stop; without one, the hem rule does.
    const inseam = typeof m.inseam === "number" ? m.inseam : null;
    const legEndY = inseam !== null ? Math.max(0, frame.crotchY - inseam) : hemY;

    // The seat: waist down to the crotch, still one tube.
    const seat = shellFromStops(
      [
        { y: waistY + 1.5, circumference: waistC * 0.99 },
        { y: waistY, circumference: waistC },
        { y: hipY, circumference: hipC },
        { y: frame.crotchY, circumference: hipC * 0.97 },
      ],
      frame,
      torso,
      1,
      garment,
      layer,
      !measured,
    );

    const shells: GarmentShell[] = seat ? [seat] : [];

    if (legEndY < frame.crotchY - 4) {
      for (const side of [-1, 1]) {
        const stops: Stop[] = [];
        for (let i = 0; i <= 4; i++) {
          const y = frame.crotchY - ((frame.crotchY - legEndY) * i) / 4;
          const s = sectionAt(frame.leg, y);
          const bodyC = girth(s.a, s.b);
          // Thigh and hem are measured; between them the garment tapers.
          const t = i / 4;
          const target =
            thigh && opening ? thigh + (opening - thigh) * t
            : thigh ? thigh * (1 - t * 0.35)
            : bodyC + idealEase(def, "thighFlat") * (1 - t * 0.4);
          stops.push({ y, circumference: Math.max(target, bodyC + 1) });
        }
        const leg = shellFromStops(stops, frame, frame.leg, side, garment, layer, !measured);
        if (leg) shells.push(leg);
      }
    }
    return shells;
  }

  /* ------------------------------------------------------------- shoes -- */
  if (garment.category === "shoes") {
    const shells: GarmentShell[] = [];
    const ankleY = frame.hem.ankle;
    for (const side of [-1, 1]) {
      const s = sectionAt(frame.leg, ankleY);
      const c = girth(s.a, s.b);
      const shoe = shellFromStops(
        [
          { y: ankleY + 3, circumference: c + 3 },
          { y: ankleY * 0.5, circumference: c + 6 },
          { y: 0.5, circumference: c + 8 },
        ],
        frame,
        frame.leg,
        side,
        garment,
        LAYER_ORDER.feet,
        true,
      );
      if (shoe) shells.push(shoe);
    }
    return shells;
  }

  // Accessories and bags have no meaningful shape on a mannequin, so they are
  // listed beside the figure rather than drawn badly on it.
  return [];
}

export interface GarmentRender {
  shells: GarmentShell[];
  /** Garments that couldn't be drawn, with why. */
  skipped: { name: string; reason: string }[];
  /** Garments drawn from ease bands rather than their own measurements. */
  estimated: string[];
}

export function buildGarments(frame: BodyFrame, garments: Garment[]): GarmentRender {
  const shells: GarmentShell[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const estimated: string[] = [];

  for (const garment of garments) {
    const made = shellsFor(garment, frame);
    if (!made.length) {
      skipped.push({
        name: garment.name,
        reason:
          garment.category === "accessory" || garment.category === "bag"
            ? "not worn on the body"
            : "no shape to draw",
      });
      continue;
    }
    if (made[0].estimated) estimated.push(garment.name);
    shells.push(...made);
  }

  // Base layers first so outerwear sits over them.
  shells.sort((p, q) => p.layer - q.layer);
  return { shells, skipped, estimated };
}
