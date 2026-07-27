/**
 * A small software renderer for the body mesh.
 *
 * The mesh is a few thousand flat quads with no textures and no transparency,
 * which is comfortably inside what a 2D canvas can fill at 60fps — so this
 * draws polygons directly rather than pulling in a WebGL engine for a figure
 * that is, geometrically, a stack of tubes.
 */
import type { BodyMesh, Vec3 } from "./body";

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

export const DEFAULT_THEME: Theme = {
  skin: [126, 148, 178],
  ambient: 0.34,
  outline: "rgba(8,12,20,0.55)",
  ring: "rgba(126,214,255,0.95)",
  ringEstimated: "rgba(255,255,255,0.28)",
  label: "rgba(226,236,248,0.92)",
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
  /** Device pixel ratio; the canvas is assumed already scaled by it. */
  width: number;
  height: number;
  unitLabel?: (cm: number) => string;
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

  const projected = mesh.vertices.map(project);

  // Light from over the viewer's left shoulder, in world space, so it stays
  // put as the body turns — turning toward a fixed light is the cue that sells
  // the rotation as three-dimensional.
  const lx = -0.42, ly = 0.5, lz = 0.76;

  const drawn: { face: number[]; depth: number; shade: number }[] = [];

  for (const face of mesh.faces) {
    const [i0, i1, i2, i3] = face.v;

    // Both visibility and lighting come from the surface normal, so they can
    // never disagree. Deriving the backface test from screen-space winding
    // instead would depend on the projection's handedness, and would happily
    // draw the inside of the far surface of a symmetric body without looking
    // obviously wrong — until a horizontal face like the top of a shoulder
    // turns up unlit.
    const a = mesh.vertices[i0], b = mesh.vertices[i1], c = mesh.vertices[i2];
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
    const shade = theme.ambient + (1 - theme.ambient) * lambert;

    const quad = i2 === i3 ? [i0, i1, i2] : [i0, i1, i2, i3];
    drawn.push({
      face: quad,
      depth: (projected[i0].z + projected[i1].z + projected[i2].z) / 3,
      shade,
    });
  }

  // Painter's algorithm. The body is close enough to convex that per-face
  // depth sorting resolves it without a z-buffer.
  drawn.sort((p, q) => p.depth - q.depth);

  const [sr, sg, sb] = theme.skin;
  for (const { face, shade } of drawn) {
    ctx.beginPath();
    ctx.moveTo(projected[face[0]].x, projected[face[0]].y);
    for (let i = 1; i < face.length; i++) {
      ctx.lineTo(projected[face[i]].x, projected[face[i]].y);
    }
    ctx.closePath();

    const fill = `rgb(${Math.round(sr * shade)},${Math.round(sg * shade)},${Math.round(sb * shade)})`;
    ctx.fillStyle = fill;
    // Stroking each face in its own fill colour hides the hairline seams that
    // antialiasing leaves between adjacent polygons.
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  if (options.showRings) drawRings(ctx, mesh, options, project, theme);
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
