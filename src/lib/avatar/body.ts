/**
 * A body built out of measurements.
 *
 * Every ring of this mesh is a real circumference the user typed in, turned
 * into an ellipse and stacked at the height that landmark actually sits at.
 * Nothing here is learned or generated: it is the same arithmetic the fit
 * engine does, drawn instead of tabulated, so what you rotate is a picture of
 * your numbers rather than an artist's impression of them.
 *
 * That also sets the honest limit. A circumference says how far around a
 * landmark is, not what shape it is, so the cross-sections use conventional
 * width-to-depth ratios. It will get your proportions right and your posture,
 * muscle and bone structure wrong. It is a tailor's dummy, not a scan.
 */
import type { BodyMeasurements } from "../types";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Face {
  /** Indices into `vertices`, wound counter-clockwise seen from outside. */
  v: [number, number, number, number];
  group: string;
}

/** A measured landmark, kept so the renderer can draw and label the girth. */
export interface LandmarkRing {
  key: string;
  label: string;
  y: number;
  a: number;
  b: number;
  circumference: number;
  estimated: boolean;
}

/** One cross-section of the body, so clothes can be lofted over it. */
export interface Section {
  y: number;
  a: number;
  b: number;
  /** Centre offset along x — limbs don't sit on the midline. */
  cx: number;
}

/**
 * The body reduced to the cross-sections a garment needs to follow. Clothes
 * are built from their own measurements, but they have to hang on this: a
 * shirt is a tube around the torso, and where its circumference is smaller
 * than the body's it clings rather than passing through.
 */
export interface BodyFrame {
  torso: Section[];
  leg: Section[];
  arm: Section[];
  legOffset: number;
  shoulderY: number;
  crotchY: number;
  /** Where the garment's own landmarks sit, in cm from the floor. */
  landmark: { neck: number; shoulder: number; chest: number; waist: number; hip: number };
  /** Where each hem position sits, in cm from the floor. */
  hem: Record<string, number>;
}

export interface BodyMesh {
  vertices: Vec3[];
  faces: Face[];
  rings: LandmarkRing[];
  /** Cross-sections for hanging garments on. */
  frame: BodyFrame;
  /** Stature in cm, so the camera can frame any body the same way. */
  height: number;
  /** Measurements that were filled in from height rather than given. */
  estimated: string[];
  /** 0-1: the share of the landmarks that came from real input. */
  confidence: number;
}

/* --------------------------------------------------------- proportions -- */

/**
 * Landmark heights as a fraction of stature, and girths as a fraction of
 * height, from published anthropometric means. They are only ever a fallback:
 * anything the user has actually measured replaces the estimate, and anything
 * still estimated is reported so the UI can say so.
 */
const HEIGHT_FRACTION = {
  crown: 1.0,
  chin: 0.87,
  neck: 0.828,
  /** The trapezius slope. Without it the neck meets the shoulder as a step. */
  trapezius: 0.810,
  shoulder: 0.788,
  chest: 0.72,
  underbust: 0.665,
  waist: 0.615,
  highHip: 0.578,
  hip: 0.52,
  crotch: 0.465,
  thigh: 0.40,
  knee: 0.285,
  calf: 0.22,
  ankle: 0.045,
} as const;

const GIRTH_FRACTION = {
  neck: 0.222,
  chest: 0.548,
  underbust: 0.48,
  waist: 0.47,
  highHip: 0.51,
  hip: 0.565,
  thigh: 0.32,
  knee: 0.216,
  calf: 0.212,
  ankle: 0.13,
  bicep: 0.175,
  wrist: 0.096,
} as const;

/**
 * How much wider than deep each landmark is. Shoulders and hips are broad and
 * shallow; limbs are round. This is the part a circumference genuinely cannot
 * tell us, so it comes from convention.
 */
const ASPECT = {
  neck: 1.05,
  shoulder: 1.5,
  chest: 1.35,
  underbust: 1.3,
  waist: 1.22,
  highHip: 1.3,
  hip: 1.35,
  thigh: 1.05,
  knee: 1.0,
  calf: 1.0,
  ankle: 1.05,
  bicep: 1.0,
  wrist: 1.1,
} as const;

/**
 * Ellipse semi-axes from a circumference and a width-to-depth ratio, by
 * inverting Ramanujan's perimeter approximation — accurate to a few parts in a
 * million over the range a human body occupies.
 */
export function ellipseAxes(circumference: number, aspect: number): { a: number; b: number } {
  const k = aspect;
  const factor = Math.PI * (3 * (k + 1) - Math.sqrt((3 * k + 1) * (k + 3)));
  const b = circumference / factor;
  return { a: k * b, b };
}

const DEFAULT_HEIGHT = 170;

/**
 * The head's half-width as a fraction of its widest point, from chin (0) to
 * crown (1). A head is widest just above the ears and tapers gently to a domed
 * crown — a sphere or a plain sine gives it a pointed top.
 */
const HEAD_PROFILE: [number, number][] = [
  [0.0, 0.52], [0.12, 0.75], [0.26, 0.9], [0.42, 1.0],
  [0.6, 0.99], [0.76, 0.9], [0.9, 0.71], [1.0, 0.4],
];

/** The torso's share of shoulder width; the rest is the arms themselves. */
const SHOULDER_TORSO_SHARE = 0.78;

function profileAt(profile: [number, number][], t: number): number {
  for (let i = 1; i < profile.length; i++) {
    if (t <= profile[i][0]) {
      const [t0, r0] = profile[i - 1];
      const [t1, r1] = profile[i];
      const k = (t - t0) / (t1 - t0 || 1);
      return r0 + (r1 - r0) * k;
    }
  }
  return profile[profile.length - 1][1];
}

/* ---------------------------------------------------------------- mesh -- */

const SEGMENTS = 28;

function ring(
  vertices: Vec3[],
  y: number,
  a: number,
  b: number,
  cx = 0,
  cz = 0,
): number {
  const start = vertices.length;
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2;
    vertices.push({ x: cx + a * Math.cos(t), y, z: cz + b * Math.sin(t) });
  }
  return start;
}

/**
 * Bridges two rings into a band of quads. `lower` must be the ring at the
 * smaller y: the winding below is the one that yields an outward normal, and
 * the renderer decides visibility and lighting from that normal, so a band
 * passed the wrong way round is lit from inside the body.
 */
function loft(faces: Face[], lower: number, upper: number, group: string) {
  for (let i = 0; i < SEGMENTS; i++) {
    const j = (i + 1) % SEGMENTS;
    faces.push({ v: [lower + j, lower + i, upper + i, upper + j], group });
  }
}

/**
 * Closes the end of a tube, so a limb isn't a hollow pipe.
 *
 * `facing` has to match which end this is: the fan's winding decides which way
 * its normal points, and a cap wound the wrong way is lit from the inside and
 * culled from the outside — it reads as a hole straight through the body.
 */
function cap(
  vertices: Vec3[],
  faces: Face[],
  start: number,
  y: number,
  cx: number,
  cz: number,
  group: string,
  facing: "up" | "down" = "down",
) {
  const centre = vertices.length;
  vertices.push({ x: cx, y, z: cz });
  for (let i = 0; i < SEGMENTS; i++) {
    const j = (i + 1) % SEGMENTS;
    const v: [number, number, number, number] =
      facing === "down"
        ? [start + i, start + j, centre, centre]
        : [start + j, start + i, centre, centre];
    faces.push({ v, group });
  }
}

interface Level {
  key: string;
  label: string;
  y: number;
  circumference: number;
  aspect: number;
  estimated: boolean;
  /** Width is given directly rather than derived, as for shoulders. */
  halfWidth?: number;
  /** Depth, when the chest's would be wrong — the neck-to-shoulder slope. */
  halfDepth?: number;
}

export interface BodyOptions {
  /** Overrides the derived stature, for previewing a specific height. */
  height?: number;
}

export function buildBody(m: BodyMeasurements, opts: BodyOptions = {}): BodyMesh {
  const estimated: string[] = [];
  const H = opts.height ?? m.height ?? DEFAULT_HEIGHT;

  /** A measurement if given, otherwise a proportional estimate, recorded. */
  const take = (value: number | undefined, fallback: number, key: string): number => {
    if (typeof value === "number" && value > 0) return value;
    estimated.push(key);
    return fallback;
  };

  const g = (k: keyof typeof GIRTH_FRACTION) => GIRTH_FRACTION[k] * H;

  // Crotch height is the one landmark a common measurement pins exactly, and
  // it drives leg length, so it is worth preferring over the ratio.
  const crotchY = take(m.inseam, HEIGHT_FRACTION.crotch * H, "inseam");
  const y = (k: keyof typeof HEIGHT_FRACTION) => HEIGHT_FRACTION[k] * H;

  const chest = take(m.chest, g("chest"), "chest");
  const waist = take(m.waistNatural, g("waist"), "waistNatural");
  const hip = take(m.hip, g("hip"), "hip");
  const neck = take(m.neck, g("neck"), "neck");
  const thigh = take(m.thigh, g("thigh"), "thigh");
  const calf = take(m.calf, g("calf"), "calf");
  const bicep = take(m.bicep, g("bicep"), "bicep");
  const wrist = take(m.wrist, g("wrist"), "wrist");
  const shoulderWidth = take(m.shoulderWidth, 0.259 * H, "shoulderWidth");

  // Not asked for anywhere, so always interpolated rather than reported as a
  // gap the user could close.
  const underbust = m.underbust ?? chest * 0.87;
  const highHip = m.highHip ?? (waist + hip) / 2;
  const knee = g("knee") * (thigh / g("thigh"));
  const ankle = g("ankle") * (calf / g("calf"));

  const neckAxesTop = ellipseAxes(neck, ASPECT.neck);
  const chestAxes = ellipseAxes(chest, ASPECT.chest);

  /*
   * Shoulders narrower than the chest is a real shape — a full bust on a
   * narrow frame — so it is allowed, up to a point. Past that the torso stops
   * reading as a body and starts reading as a cone: lofting a tiny shoulder
   * ring onto a huge chest ring is what turned a profile whose height had been
   * typed in feet into a flying saucer, and the numbers behind it were
   * individually unremarkable. A floor here means no arithmetic on the input
   * can produce that silhouette, whatever the validation upstream misses.
   */
  const shoulderHalf = Math.max(
    (shoulderWidth / 2) * SHOULDER_TORSO_SHARE,
    chestAxes.a * 0.72,
  );
  /** How far the neck-to-shoulder slope has run by the trapezius. */
  const TRAPEZIUS_RUN = 0.44;
  const trapeziusHalf = neckAxesTop.a + (shoulderHalf - neckAxesTop.a) * TRAPEZIUS_RUN;

  const torso: Level[] = [
    { key: "neck", label: "Neck", y: y("neck"), circumference: neck, aspect: ASPECT.neck, estimated: estimated.includes("neck") },
    // The slope off the neck. Lofting a narrow neck straight onto a wide
    // shoulder reads as a coat hanger. Depth has to climb with it: taking the
    // chest's depth here, where the width is still nearly the neck's, made the
    // trapezius deeper than it is wide — and anything lofted over it inherited
    // that, which is what left the body poking through a sweater's shoulders.
    { key: "trapezius", label: "", y: y("trapezius"), circumference: 0, aspect: ASPECT.shoulder, estimated: false, halfWidth: trapeziusHalf, halfDepth: neckAxesTop.b + (chestAxes.b * 1.02 - neckAxesTop.b) * TRAPEZIUS_RUN },
    { key: "shoulder", label: "Shoulders", y: y("shoulder"), circumference: 0, aspect: ASPECT.shoulder, estimated: estimated.includes("shoulderWidth"), halfWidth: shoulderHalf },
    { key: "chest", label: "Chest", y: y("chest"), circumference: chest, aspect: ASPECT.chest, estimated: estimated.includes("chest") },
    { key: "underbust", label: "Underbust", y: y("underbust"), circumference: underbust, aspect: ASPECT.underbust, estimated: true },
    { key: "waistNatural", label: "Waist", y: y("waist"), circumference: waist, aspect: ASPECT.waist, estimated: estimated.includes("waistNatural") },
    { key: "highHip", label: "High hip", y: y("highHip"), circumference: highHip, aspect: ASPECT.highHip, estimated: true },
    { key: "hip", label: "Hip", y: y("hip"), circumference: hip, aspect: ASPECT.hip, estimated: estimated.includes("hip") },
  ];

  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  const rings: LandmarkRing[] = [];
  const torsoSections: Section[] = [];
  const legSections: Section[] = [];
  const armSections: Section[] = [];

  // ---- torso ------------------------------------------------------------
  const torsoRings = torso.map((level) => {
    const axes =
      level.halfWidth !== undefined
        ? // Shoulder width is a width; depth follows the chest, since a wide
          // frame is not necessarily a deep one.
          { a: level.halfWidth, b: level.halfDepth ?? chestAxes.b * 1.02 }
        : ellipseAxes(level.circumference, level.aspect);

    const start = ring(vertices, level.y, axes.a, axes.b);
    torsoSections.push({ y: level.y, a: axes.a, b: axes.b, cx: 0 });
    if (level.circumference > 0) {
      rings.push({
        key: level.key,
        label: level.label,
        y: level.y,
        a: axes.a,
        b: axes.b,
        circumference: level.circumference,
        estimated: level.estimated,
      });
    }
    return { start, axes, level };
  });

  for (let i = 0; i < torsoRings.length - 1; i++) {
    loft(faces, torsoRings[i + 1].start, torsoRings[i].start, "torso");
  }

  // ---- seat: hip down to where the legs separate ------------------------
  const hipAxes = torsoRings[torsoRings.length - 1].axes;
  const seatStart = ring(vertices, crotchY, hipAxes.a * 0.98, hipAxes.b * 0.95);
  torsoSections.push({ y: crotchY, a: hipAxes.a * 0.98, b: hipAxes.b * 0.95, cx: 0 });
  loft(faces, seatStart, torsoRings[torsoRings.length - 1].start, "torso");
  // The legs start here but don't fill the opening, so without this the torso
  // is an open tube — visible as a hole straight up into the body the moment
  // the camera tilts below the hips.
  cap(vertices, faces, seatStart, crotchY, 0, 0, "torso", "down");

  // ---- legs -------------------------------------------------------------
  const legOffset = hipAxes.a * 0.47;
  const legLevels: [number, number, number][] = [
    // [height, circumference, aspect]
    [crotchY, thigh * 1.02, ASPECT.thigh],
    [y("thigh") * (crotchY / y("crotch")), thigh * 0.88, ASPECT.thigh],
    [y("knee") * (crotchY / y("crotch")), knee, ASPECT.knee],
    [y("calf") * (crotchY / y("crotch")), calf, ASPECT.calf],
    [y("ankle") * (crotchY / y("crotch")), ankle, ASPECT.ankle],
  ];

  for (const side of [-1, 1]) {
    let previous: number | null = null;
    let previousAxes = { a: 0, b: 0 };
    let first: number | null = null;
    for (const [ly, circumference, aspect] of legLevels) {
      const axes = ellipseAxes(circumference, aspect);
      const start = ring(vertices, ly, axes.a, axes.b, side * legOffset, 0);
      if (side === 1) legSections.push({ y: ly, a: axes.a, b: axes.b, cx: legOffset });
      if (previous !== null) loft(faces, start, previous, "leg");
      else first = start;
      previous = start;
      previousAxes = axes;
    }
    // Hidden inside the seat, but it keeps the mesh watertight — which is what
    // makes the orientation of every face checkable rather than eyeballed.
    if (first !== null) cap(vertices, faces, first, legLevels[0][0], side * legOffset, 0, "leg", "up");
    if (previous !== null) {
      cap(vertices, faces, previous, legLevels[legLevels.length - 1][0], side * legOffset, 0, "leg");
      // A foot, so the figure stands on something.
      const footLength = m.footLength ?? 0.152 * H;
      const toe = ring(vertices, 0, previousAxes.a * 1.05, footLength / 2, side * legOffset, footLength / 2 - previousAxes.b);
      loft(faces, toe, previous, "leg");
      cap(vertices, faces, toe, 0, side * legOffset, footLength / 2 - previousAxes.b, "leg");
    }
  }

  // ---- arms -------------------------------------------------------------
  const armLength = take(m.armLength, 0.335 * H, "armLength");
  const shoulderY = y("shoulder");
  // The arm's centre sits at the torso's edge, so bicep radius carries the
  // silhouette out to the shoulder width the user actually measured.
  const armX = shoulderHalf;
  // Hangs slightly away from the body, or it fuses with the torso.
  const armDrop = 0.1;

  /*
   * The joint rises above the shoulder point, and where it does, the torso is
   * still narrowing toward the neck — so the deltoid has to be full enough to
   * still touch it, or the arm floats beside the body with daylight between
   * the two. Broad shoulders on a narrow neck is the case that pulls them
   * apart, and it is exactly the case a fixed fraction of the bicep misses.
   */
  const capY = shoulderY + 0.012 * H;
  const torsoAtCap =
    trapeziusHalf +
    (shoulderHalf - trapeziusHalf) *
      ((y("trapezius") - capY) / (y("trapezius") - shoulderY || 1));
  const capGirth = Math.max(bicep * 0.72, (armX - torsoAtCap + 0.6) * 2 * Math.PI);

  for (const side of [-1, 1]) {
    const x0 = side * armX;
    const x1 = side * (armX + armLength * armDrop);
    const at = (f: number) => x0 + (x1 - x0) * f;

    const levels: [number, number, number, number][] = [
      // [y, circumference, aspect, x] — the first two round the deltoid over
      // the top of the joint rather than leaving a flat-topped cylinder.
      [capY, capGirth, ASPECT.bicep, x0],
      [shoulderY, bicep * 1.14, ASPECT.bicep, x0],
      [shoulderY - armLength * 0.28, bicep, ASPECT.bicep, at(0.28)],
      [shoulderY - armLength * 0.52, bicep * 0.84, ASPECT.bicep, at(0.52)],
      [shoulderY - armLength * 0.84, wrist * 1.12, ASPECT.wrist, at(0.84)],
      [shoulderY - armLength, wrist * 1.3, ASPECT.wrist, x1],
    ];

    let previous: number | null = null;
    let first: number | null = null;
    for (const [ly, circumference, aspect, lx] of levels) {
      const axes = ellipseAxes(circumference, aspect);
      const start = ring(vertices, ly, axes.a, axes.b, lx, 0);
      if (side === 1) armSections.push({ y: ly, a: axes.a, b: axes.b, cx: lx });
      if (previous !== null) loft(faces, start, previous, "arm");
      else first = start;
      previous = start;
    }
    // Both ends are open tubes; close the shoulder and the hand.
    if (first !== null) cap(vertices, faces, first, levels[0][0], levels[0][3], 0, "arm", "up");
    if (previous !== null) {
      const last = levels[levels.length - 1];
      cap(vertices, faces, previous, last[0], last[3], 0, "arm");
    }
  }

  // ---- head and neck ----------------------------------------------------
  const neckAxes = ellipseAxes(neck, ASPECT.neck);
  const chinY = y("chin");
  const crownY = y("crown");
  const headHeight = crownY - chinY;
  const headA = headHeight * 0.36;
  const headB = headHeight * 0.42;

  const neckTop = ring(vertices, chinY, neckAxes.a * 0.92, neckAxes.b * 0.92);
  loft(faces, torsoRings[0].start, neckTop, "neck");

  // Sliced into rings so it lofts like everything else, following a measured
  // head profile rather than a sphere.
  const HEAD_RINGS = 11;
  let previousHead: number | null = neckTop;
  for (let i = 0; i <= HEAD_RINGS; i++) {
    const t = i / HEAD_RINGS;                     // 0 at chin, 1 at crown
    const scale = profileAt(HEAD_PROFILE, t);
    const start = ring(vertices, chinY + headHeight * t, headA * scale, headB * scale, 0, headB * 0.06);
    if (previousHead !== null) loft(faces, previousHead, start, "head");
    previousHead = start;
  }
  if (previousHead !== null) cap(vertices, faces, previousHead, crownY, 0, headB * 0.06, "head", "up");

  // Only landmarks the user can actually supply count toward confidence —
  // underbust and high hip are always interpolated and would flatter it.
  const asked = ["chest", "waistNatural", "hip", "neck", "thigh", "calf", "shoulderWidth", "inseam", "armLength"];
  const given = asked.filter((k) => !estimated.includes(k)).length;

  return {
    vertices,
    faces,
    rings,
    frame: {
      torso: torsoSections,
      leg: legSections,
      arm: armSections,
      legOffset,
      shoulderY: y("shoulder"),
      crotchY,
      landmark: {
        neck: y("neck"),
        shoulder: y("shoulder"),
        chest: y("chest"),
        waist: y("waist"),
        hip: y("hip"),
      },
      // Every position `HemPosition` allows, so a hem never has to fall back
      // to a default and land a crop top at the hip.
      hem: {
        crop: (y("waist") + y("underbust")) / 2,
        waist: y("waist"),
        hip: y("hip"),
        "mid-thigh": legLevels[1][0],
        knee: legLevels[2][0],
        midi: (legLevels[2][0] + legLevels[3][0]) / 2,
        ankle: legLevels[4][0],
        floor: 0,
      },
    },
    height: H,
    estimated,
    confidence: given / asked.length,
  };
}
