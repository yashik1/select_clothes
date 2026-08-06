/**
 * A small software renderer for the body mesh.
 *
 * The mesh is a few thousand flat quads with no textures and no transparency,
 * which is comfortably inside what a 2D canvas can fill at 60fps — so this
 * draws polygons directly rather than pulling in a WebGL engine for a figure
 * that is, geometrically, a stack of tubes.
 */
import type { BodyMesh, Face, Vec3 } from "./body";
import type { GarmentShell } from "./garment";

export interface Camera {
  /** Radians. 0 faces the viewer; increases turning to their left. */
  yaw: number;
  /** Radians. Positive looks down on the figure. */
  pitch: number;
  /** 1 = the whole body fills the frame height. */
  zoom: number;
}

export interface Theme {
  skin: [number, number, number];
  ambient: number;
  outline: string;
  ring: string;
  ringEstimated: string;
  label: string;
}

/**
 * Tuned for paper. On a light page an unlit face has to stay well above the
 * background or the figure dissolves into it, so ambient is high and the
 * "skin" is a warm mid tone rather than a bright one — the shading range runs
 * downward from the page, not upward from black.
 */
export const DEFAULT_THEME: Theme = {
  skin: [176, 166, 154],
  ambient: 0.62,
  outline: "rgba(50,48,47,0.35)",
  ring: "#32302f",
  ringEstimated: "rgba(50,48,47,0.45)",
  label: "rgba(50,48,47,0.9)",
};

function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;

  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;

  return { x: x1, y: y2, z: z2 };
}

export interface RenderOptions {
  camera: Camera;
  theme?: Theme;
  /** Draw and label the measured girths. */
  showRings?: boolean;
  /** Clothes to draw over the body. */
  garments?: GarmentShell[];
  /** 0 = body only, 1 = fully dressed. Anything between cross-fades. */
  dressed?: number;
  /**
   * Radians the cloth trails the body by, from turning it.
   *
   * Fabric doesn't arrive with the shoulders it hangs from. Feeding the
   * figure's angular velocity in here is what turns a turntable into something
   * that looks like it has weight — and because the lag each garment takes is
   * scaled by its own ease, an oversized coat swings and a second-skin tee
   * barely moves. The motion is the measurement.
   */
  swing?: number;
  /** The contact shadow. On unless a caller wants the figure alone. */
  showShadow?: boolean;
  /** Device pixel ratio; the canvas is assumed already scaled by it. */
  width: number;
  height: number;
  unitLabel?: (cm: number) => string;
}

/** One shaded polygon, resolved far enough to sort against every other. */
interface Drawn {
  points: { x: number; y: number }[];
  depth: number;
  shade: number;
  rgb: [number, number, number];
  alpha: number;
}

export function renderBody(
  ctx: CanvasRenderingContext2D,
  mesh: BodyMesh,
  options: RenderOptions,
) {
  const { camera, width, height } = options;
  const theme = options.theme ?? DEFAULT_THEME;

  ctx.clearRect(0, 0, width, height);
  if (!mesh.vertices.length) return;

  // Frame on the figure's mid-height so pitch pivots about the waist rather
  // than the floor, which is what makes "look from below" feel natural.
  const centreY = mesh.height / 2;
  const margin = 0.88;
  const scale = ((height * margin) / mesh.height) * camera.zoom;

  const project = (p: Vec3) => {
    const r = rotate({ x: p.x, y: p.y - centreY, z: p.z }, camera.yaw, camera.pitch);
    // Gentle perspective: enough to read as solid, not enough to distort the
    // proportions the whole thing exists to communicate.
    const depth = 1 + r.z / (mesh.height * 3.2);
    return {
      x: width / 2 + r.x * scale * depth,
      y: height / 2 - r.y * scale * depth,
      z: r.z,
    };
  };

  // Light from over the viewer's left shoulder, in world space, so it stays
  // put as the body turns — turning toward a fixed light is the cue that sells
  // the rotation as three-dimensional.
  const lx = -0.42, ly = 0.5, lz = 0.76;

  const drawn: Drawn[] = [];

  /**
   * Resolves one mesh into shaded, projected polygons.
   *
   * Body and clothes go into a single depth-sorted list rather than being
   * painted in passes, because a sleeve is in front of the torso from one
   * angle and behind it from another — layering by draw order alone would be
   * right half the time.
   */
  const collect = (
    vertices: Vec3[],
    faces: Face[],
    rgb: [number, number, number],
    alpha: number,
    /**
     * Pulls a mesh toward the camera when sorting, without moving it on
     * screen. Cloth and skin are nested surfaces a centimetre apart, and
     * per-face average depth is too coarse to order them reliably — the
     * result is the two fighting for the same pixels in stripes. A bias
     * larger than the standoff settles it, and stays small enough that a
     * sleeve still sorts correctly against the far side of the torso.
     */
    depthBias = 0,
  ) => {
    const projected = vertices.map(project);

    for (const face of faces) {
      const [i0, i1, i2, i3] = face.v;

      // Both visibility and lighting come from the surface normal, so they can
      // never disagree. Deriving the backface test from screen-space winding
      // instead would depend on the projection's handedness, and would happily
      // draw the inside of the far surface of a symmetric body without looking
      // obviously wrong — until a horizontal face like the top of a shoulder
      // turns up unlit.
      const a = vertices[i0], b = vertices[i1], c = vertices[i2];
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const rotated = rotate({ x: nx, y: ny, z: nz }, camera.yaw, camera.pitch);
      if (rotated.z <= 0) continue;

      const lambert = Math.max(0, rotated.x * lx + rotated.y * ly + rotated.z * lz);
      const indices = i2 === i3 ? [i0, i1, i2] : [i0, i1, i2, i3];

      drawn.push({
        points: indices.map((i) => projected[i]),
        depth: (projected[i0].z + projected[i1].z + projected[i2].z) / 3 + depthBias,
        shade: theme.ambient + (1 - theme.ambient) * lambert,
        rgb,
        alpha,
      });
    }
  };

  if (options.showShadow !== false) drawShadow(ctx, mesh, options, project, scale);

  collect(mesh.vertices, mesh.faces, theme.skin, 1);

  const dressed = options.dressed ?? 1;
  const swing = options.swing ?? 0;

  if (options.garments?.length && dressed > 0.01) {
    /*
     * Layers land one after another rather than all at once. It takes no
     * longer overall, and it makes the order legible: trousers, then the
     * shirt, then the coat over both — which is the thing the depth sorting
     * was fixed to get right and had no way of showing.
     */
    const layers = options.garments.map((s) => s.layer);
    const span = { lowest: Math.min(...layers), deepest: Math.max(...layers) };

    for (const shell of options.garments) {
      const alpha = layerAlpha(dressed, shell.layer, span);
      if (alpha <= 0.01) continue;

      collect(
        swung(shell, swing),
        shell.faces,
        hexToRgb(shell.hex),
        alpha,
        /*
         * Layers are separated widely here because two garments genuinely can
         * occupy the same space: both get clamped to the body's minimum
         * standoff wherever each is tighter than the wearer, so a jumper and
         * the coat over it come out at exactly the same radius below the
         * waist. The geometry is right — both really are against the body —
         * and which one you see is a drawing question, so it is settled with
         * the sort key rather than by inflating the shells and spoiling the
         * gap the whole picture exists to show.
         */
        3 + shell.layer * 2.6,
      );
    }
  }

  // Painter's algorithm. The figure is close enough to convex that per-face
  // depth sorting resolves it without a z-buffer.
  drawn.sort((p, q) => p.depth - q.depth);

  for (const { points, shade, rgb, alpha } of drawn) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();

    const fill = `rgb(${Math.round(rgb[0] * shade)},${Math.round(rgb[1] * shade)},${Math.round(rgb[2] * shade)})`;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    // Stroking each face in its own fill colour hides the hairline seams that
    // antialiasing leaves between adjacent polygons.
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (options.showRings) drawRings(ctx, mesh, options, project, theme);
}

/** How much of one layer's fade the next one waits for before starting. */
const LAYER_OVERLAP = 0.45;

/**
 * How far in a given layer is, at a given point in the dressing.
 *
 * Layers land one after another rather than all at once. It takes no longer
 * overall — the last one still finishes when `dressed` reaches 1 — and it makes
 * the order legible: trousers, then the shirt, then the coat over both, which
 * is the thing the depth sorting was fixed to get right and had no way of
 * showing.
 */
export function layerAlpha(
  dressed: number,
  layer: number,
  span: { lowest: number; deepest: number },
): number {
  const range = Math.max(1, span.deepest - span.lowest);
  const start = ((layer - span.lowest) / range) * LAYER_OVERLAP;
  return Math.max(0, Math.min(1, (dressed - start) / (1 - LAYER_OVERLAP)));
}

/**
 * Cloth trailing the body it hangs from.
 *
 * The twist runs from nothing at the top of the shell to its full value at the
 * hem, because a garment is held at the shoulders or the waist and it is the
 * loose end that lags. How much lag it takes at all comes from the shell's own
 * drape — the ease the fit report scores — so a coat standing 12cm off the
 * chest sweeps and a tee at 2cm barely stirs.
 *
 * Each ring twists about its own centre rather than the body's. A coat's hem
 * is one loop that already runs close to the spine, so those two axes are
 * nearly the same thing, which is why this looked right for coats and dresses.
 * A trouser leg or a sleeve is a narrow tube sitting well off to one side, and
 * this used to rotate it about the *body's* axis regardless — which swings a
 * whole limb's worth of cloth sideways in an arc rather than twisting it in
 * place, and the further out the tube sits, the more of an arc it is. Measured
 * on a pair of relaxed-fit trousers at the largest lag the spring reaches: the
 * two ankles drifted 2.7cm apart in opposite directions — a third of the
 * ankle's own width — while the leg underneath, which nothing swings, stayed
 * exactly put. That is the garment visibly leaving the body while the figure
 * is dragged, and it is gone once each ring supplies its own pivot: a torso
 * ring's own centre already sits close to the spine, so a coat keeps sweeping
 * exactly as before, while a limb far off that axis now turns about the line
 * actually running through it.
 *
 * Returns the original vertices untouched when there is nothing to apply,
 * which is the common case: the figure is usually standing still.
 */
export function swung(shell: GarmentShell, swing: number): Vec3[] {
  const lag = swing * Math.min(1, shell.drape / 9);
  if (Math.abs(lag) < 1e-4) return shell.vertices;

  const span = shell.topY - shell.bottomY;
  if (span <= 0) return shell.vertices;

  /*
   * A ring is built symmetric around its own centre (x = cx + a·cos, z = cz +
   * b·sin), so cosine and sine average to zero across it and the plain mean of
   * a ring's own vertices recovers (cx, cz) exactly — no separate bookkeeping
   * of the ring geometry has to travel alongside the shell for this. Grouped
   * by height because that is the one coordinate every vertex on the same ring
   * shares.
   */
  const centres = new Map<number, { x: number; z: number; n: number }>();
  const ringKey = (y: number) => Math.round(y * 100);
  for (const v of shell.vertices) {
    const k = ringKey(v.y);
    const c = centres.get(k);
    if (c) {
      c.x += v.x;
      c.z += v.z;
      c.n += 1;
    } else {
      centres.set(k, { x: v.x, z: v.z, n: 1 });
    }
  }

  return shell.vertices.map((v) => {
    const t = Math.max(0, Math.min(1, (shell.topY - v.y) / span));
    const angle = lag * t * t; // eased, so the shoulder stays put and the hem carries it
    const cos = Math.cos(angle), sin = Math.sin(angle);

    const c = centres.get(ringKey(v.y))!;
    const cx = c.x / c.n, cz = c.z / c.n;
    const x = v.x - cx, z = v.z - cz;
    return { x: cx + x * cos + z * sin, y: v.y, z: cz + (-x * sin + z * cos) };
  });
}

/**
 * A soft ellipse where the figure meets the floor.
 *
 * Without it the body floats: there is no horizon in this scene and nothing
 * else to say where the ground is. It is drawn before everything, never sorted
 * with the polygons, and fades out as the camera drops below the floor — where
 * a shadow cast on the ground would be behind the viewer.
 */
function drawShadow(
  ctx: CanvasRenderingContext2D,
  mesh: BodyMesh,
  options: RenderOptions,
  project: (p: Vec3) => { x: number; y: number; z: number },
  scale: number,
) {
  const fade = Math.max(0, Math.min(1, (options.camera.pitch + 0.15) / 0.35));
  if (fade <= 0.01) return;

  let spread = 0;
  for (const v of mesh.vertices) {
    if (v.y < mesh.height * 0.08) spread = Math.max(spread, Math.hypot(v.x, v.z));
  }
  if (spread <= 0) return;

  const rx = spread * 2.6;
  const rz = spread * 2.0;
  const centre = project({ x: 0, y: 0, z: 0 });

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    points.push(project({ x: rx * Math.cos(t), y: 0, z: rz * Math.sin(t) }));
  }

  // The gradient is in screen space, which is a cheat — but a shadow this soft
  // has no edge to give the cheat away.
  const radius = Math.max(4, rx * scale);
  const gradient = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
  gradient.addColorStop(0, `rgba(50,48,47,${0.20 * fade})`);
  gradient.addColorStop(0.55, `rgba(50,48,47,${0.09 * fade})`);
  gradient.addColorStop(1, "rgba(50,48,47,0)");

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function drawRings(
  ctx: CanvasRenderingContext2D,
  mesh: BodyMesh,
  options: RenderOptions,
  project: (p: Vec3) => { x: number; y: number; z: number },
  theme: Theme,
) {
  const format = options.unitLabel ?? ((cm: number) => `${Math.round(cm)}cm`);
  ctx.save();
  ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";

  for (const r of mesh.rings) {
    const points: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      points.push(project({ x: r.a * Math.cos(t) * 1.035, y: r.y, z: r.b * Math.sin(t) * 1.035 }));
    }

    ctx.strokeStyle = r.estimated ? theme.ringEstimated : theme.ring;
    ctx.lineWidth = r.estimated ? 1 : 1.6;
    ctx.setLineDash(r.estimated ? [3, 4] : []);

    // The near half is drawn solid and the far half faint, so the band reads
    // as passing behind the body rather than floating in front of it.
    for (const half of [0, 1]) {
      ctx.globalAlpha = half === 0 ? 0.35 : 1;
      ctx.beginPath();
      let started = false;
      for (const p of points) {
        const near = p.z >= 0;
        if (near !== (half === 1)) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    const right = points.reduce((best, p) => (p.x > best.x ? p : best), points[0]);
    const left = points.reduce((best, p) => (p.x < best.x ? p : best), points[0]);
    // Interpolated girths are rounded: a figure like 85.3 implies a precision
    // that an estimate does not have, and the dashed band already says so.
    const value = r.estimated ? Math.round(r.circumference) : r.circumference;
    const text = `${r.label} ${format(value)}`;

    ctx.fillStyle = r.estimated ? theme.ringEstimated : theme.label;
    ctx.textBaseline = "middle";

    // Label to the right normally, but flip to the left rather than run off
    // the canvas — at high zoom or in profile the body sits well off-centre.
    const width = ctx.measureText(text).width;
    if (right.x + 8 + width <= options.width - 4) {
      ctx.textAlign = "left";
      ctx.fillText(text, right.x + 8, right.y);
    } else if (left.x - 8 - width >= 4) {
      ctx.textAlign = "right";
      ctx.fillText(text, left.x - 8, left.y);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(text, options.width - 4, right.y);
    }
  }

  ctx.restore();
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? [140, 136, 130] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
