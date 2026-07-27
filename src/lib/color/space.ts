/**
 * Colour space maths. Everything the styling engine reasons about happens in
 * CIELAB / LCh rather than RGB or HSL, because those are the only spaces where
 * "how different do these look" and "how light is this" behave the way a human
 * eye does. HSL in particular lies about lightness — #0000FF and #FFFF00 have
 * identical HSL lightness and wildly different perceived brightness.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface Lab {
  L: number;
  a: number;
  b: number;
}
export interface LCh {
  L: number;
  C: number;
  /** Hue angle in degrees, 0-360. */
  h: number;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const linearToSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return c * 255;
};

// D65 reference white.
const Xn = 95.047;
const Yn = 100.0;
const Zn = 108.883;

export function rgbToLab({ r, g, b }: RGB): Lab {
  const R = srgbToLinear(r) * 100;
  const G = srgbToLinear(g) * 100;
  const B = srgbToLinear(b) * 100;

  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb({ L, a, b }: Lab): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);

  const X = inv(fx) * Xn;
  const Y = inv(fy) * Yn;
  const Z = inv(fz) * Zn;

  const R = (X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314) / 100;
  const G = (X * -0.969266 + Y * 1.8760108 + Z * 0.041556) / 100;
  const B = (X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252) / 100;

  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) };
}

export function labToLch({ L, a, b }: Lab): LCh {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function lchToLab({ L, C, h }: LCh): Lab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export function hexToLch(hex: string): LCh {
  return labToLch(rgbToLab(hexToRgb(hex)));
}

/**
 * LCh back to a hex string, reducing chroma until the colour lands inside the
 * sRGB gamut. Naive clipping shifts hue badly for saturated colours; walking
 * chroma down preserves the hue the palette intended.
 */
export function lchToHex(lch: LCh): string {
  for (let C = lch.C; C >= 0; C -= 1) {
    const rgb = labToRgb(lchToLab({ ...lch, C }));
    if (
      rgb.r >= -0.5 && rgb.r <= 255.5 &&
      rgb.g >= -0.5 && rgb.g <= 255.5 &&
      rgb.b >= -0.5 && rgb.b <= 255.5
    ) {
      return rgbToHex(rgb);
    }
  }
  return rgbToHex(labToRgb(lchToLab({ ...lch, C: 0 })));
}

/** Smallest angular distance between two hues, 0-180. */
export function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * CIEDE2000 colour difference. Worth the arithmetic: CIE76 badly overstates
 * differences in the blue region, which would make every navy-and-charcoal
 * outfit look like a clash.
 */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const kL = 1, kC = 1, kH = 1;
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const hp = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    let h = (Math.atan2(b, ap) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  };
  const h1p = hp(b1, a1p);
  const h2p = hp(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbarp += h1p + h2p < 360 ? 360 : -360;
    hbarp /= 2;
  }

  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;

  return Math.sqrt(
    (dLp / (kL * Sl)) ** 2 +
      (dCp / (kC * Sc)) ** 2 +
      (dHp / (kH * Sh)) ** 2 +
      Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  );
}

export function deltaEHex(hex1: string, hex2: string): number {
  return deltaE2000(rgbToLab(hexToRgb(hex1)), rgbToLab(hexToRgb(hex2)));
}

/** Below this chroma a colour behaves as a neutral: it goes with anything. */
export const NEUTRAL_CHROMA = 12;

export function isNeutral(hex: string): boolean {
  return hexToLch(hex).C < NEUTRAL_CHROMA;
}

/** Readable text colour for a swatch background. */
export function contrastText(hex: string): string {
  return hexToLch(hex).L > 60 ? "#141414" : "#ffffff";
}

export function describeColor(hex: string): string {
  const { L, C, h } = hexToLch(hex);
  if (C < NEUTRAL_CHROMA) {
    if (L > 88) return "white";
    if (L > 72) return "light grey";
    if (L > 45) return "grey";
    if (L > 22) return "charcoal";
    return "black";
  }
  // Boundaries are midpoints between measured CIELAB hue angles of reference
  // colours — they are nothing like the HSL wheel, where blue sits at 240°
  // rather than the ~297° it actually occupies here.
  const names: [number, string][] = [
    [25, "pink"], [48, "red"], [73, "orange"], [95, "gold"], [107, "yellow"],
    [128, "olive"], [165, "green"], [200, "teal"], [302, "blue"],
    [322, "violet"], [348, "magenta"], [361, "pink"],
  ];
  let base = names.find(([max]) => h < max)?.[1] ?? "red";

  // Warm, desaturated and dark is brown, not "muted orange".
  if (h >= 40 && h < 100 && C < 42 && L < 58) base = "brown";

  const depth = L > 72 ? "light " : L < 35 ? "deep " : "";
  const sat = C > 55 ? "vivid " : C < 25 ? "muted " : "";
  return `${depth}${sat}${base}`.trim();
}
