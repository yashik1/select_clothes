/**
 * Virtual try-on rendering.
 *
 * Deliberately optional and deliberately last.
 *
 * The industry has this backwards: try-on renders are sold as the product, but
 * a generated image can only ever show you a *plausible* drape — it does not
 * know your chest measurement and cannot tell you the shirt won't close. In
 * this app the arithmetic answers "will this fit and does it work", and the
 * render is a picture of the answer. That ordering means the app is fully
 * useful with no API key, no GPU, and no per-image cost, and the render is a
 * garnish you can switch on if you want it.
 *
 * Providers are pluggable. With none configured the UI falls back to a
 * composed flat-lay, which — for the "does this combination work" question —
 * is most of the value at none of the cost.
 */

export type ProviderId = "none" | "fal" | "fashn" | "custom";

export interface TryOnRequest {
  /** Full-length photo of the person, as a data URL or absolute URL. */
  personImage: string;
  /** Garment images to apply, in layering order (base first). */
  garments: { image: string; category: "tops" | "bottoms" | "one-pieces" | "auto" }[];
}

export interface TryOnResult {
  ok: boolean;
  /** Rendered image URL or data URL, when ok. */
  image?: string;
  provider: ProviderId;
  error?: string;
  /** Roughly what this render cost, for the UI to show honestly. */
  estimatedCostUsd?: number;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  /** Why it isn't usable, when it isn't. */
  hint?: string;
  /** How the provider was chosen, so the UI can explain a surprise. */
  source: "explicit" | "inferred" | "default";
}

const PROVIDER_IDS: ProviderId[] = ["none", "fal", "fashn", "custom"];

/**
 * Which provider a key implies.
 *
 * Setting `FAL_KEY` is an unambiguous statement of intent, and requiring a
 * second variable to act on it means the obvious thing — paste the key, expect
 * renders — silently does nothing at all. Explicit configuration still wins,
 * including an explicit `none`, so this can only ever turn on a provider whose
 * credentials someone deliberately supplied.
 */
function inferProvider(): ProviderId {
  if (process.env.FAL_KEY) return "fal";
  if (process.env.FASHN_API_KEY) return "fashn";
  if (process.env.FITCHECK_TRYON_URL) return "custom";
  return "none";
}

export function providerStatus(): ProviderStatus {
  const raw = process.env.FITCHECK_TRYON_PROVIDER?.trim();
  const explicit = raw ? (raw as ProviderId) : undefined;

  if (explicit && !PROVIDER_IDS.includes(explicit)) {
    return {
      id: "none",
      label: "Flat-lay preview (no external service)",
      configured: true,
      source: "explicit",
      hint: `FITCHECK_TRYON_PROVIDER is set to "${raw}", which isn't a provider. Use fal, fashn, custom, or none.`,
    };
  }

  const id = explicit ?? inferProvider();
  const source: ProviderStatus["source"] = explicit
    ? "explicit"
    : id === "none"
      ? "default"
      : "inferred";

  switch (id) {
    case "fal":
      return {
        id,
        label: "fal.ai (FASHN v1.6)",
        configured: Boolean(process.env.FAL_KEY),
        source,
        hint: process.env.FAL_KEY ? undefined : "Set FAL_KEY in your environment.",
      };
    case "fashn":
      return {
        id,
        label: "FASHN API",
        configured: Boolean(process.env.FASHN_API_KEY),
        source,
        hint: process.env.FASHN_API_KEY ? undefined : "Set FASHN_API_KEY in your environment.",
      };
    case "custom":
      return {
        id,
        label: "Custom endpoint",
        configured: Boolean(process.env.FITCHECK_TRYON_URL),
        source,
        hint: process.env.FITCHECK_TRYON_URL
          ? undefined
          : "Set FITCHECK_TRYON_URL to a POST endpoint taking { personImage, garmentImage }.",
      };
    default:
      return {
        id: "none",
        label: "Flat-lay preview (no external service)",
        configured: true,
        source,
        // Layout-neutral: this line is shown beside the figure on the garment
        // page and above it in the studio, so it cannot point anywhere.
        hint:
          source === "explicit"
            ? "Photo rendering is switched off — FITCHECK_TRYON_PROVIDER is set to none."
            : "Set FAL_KEY (or FASHN_API_KEY) on the server to render on your own photo.",
      };
  }
}

async function runFal(person: string, garment: string, category: string): Promise<TryOnResult> {
  const res = await fetch("https://fal.run/fal-ai/fashn/tryon/v1.6", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_image: person,
      garment_image: garment,
      category,
      mode: "quality",
    }),
  });
  if (!res.ok) {
    return { ok: false, provider: "fal", error: `fal.ai returned ${res.status}: ${await res.text()}` };
  }
  const json = (await res.json()) as { images?: { url: string }[] };
  const url = json.images?.[0]?.url;
  return url
    ? { ok: true, provider: "fal", image: url, estimatedCostUsd: 0.075 }
    : { ok: false, provider: "fal", error: "No image in response." };
}

async function runFashn(person: string, garment: string, category: string): Promise<TryOnResult> {
  const start = await fetch("https://api.fashn.ai/v1/run", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FASHN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: "tryon-v1.6",
      inputs: { model_image: person, garment_image: garment, category },
    }),
  });
  if (!start.ok) {
    return { ok: false, provider: "fashn", error: `FASHN returned ${start.status}: ${await start.text()}` };
  }
  const { id } = (await start.json()) as { id: string };

  // FASHN is asynchronous; poll with a hard ceiling so a stuck job can never
  // hang a request thread.
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`https://api.fashn.ai/v1/status/${id}`, {
      headers: { Authorization: `Bearer ${process.env.FASHN_API_KEY}` },
    });
    if (!poll.ok) continue;
    const status = (await poll.json()) as { status: string; output?: string[]; error?: string };
    if (status.status === "completed" && status.output?.[0]) {
      return { ok: true, provider: "fashn", image: status.output[0], estimatedCostUsd: 0.075 };
    }
    if (status.status === "failed") {
      return { ok: false, provider: "fashn", error: status.error ?? "Render failed." };
    }
  }
  return { ok: false, provider: "fashn", error: "Timed out waiting for the render." };
}

async function runCustom(person: string, garment: string, category: string): Promise<TryOnResult> {
  const res = await fetch(process.env.FITCHECK_TRYON_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.FITCHECK_TRYON_KEY
        ? { Authorization: `Bearer ${process.env.FITCHECK_TRYON_KEY}` }
        : {}),
    },
    body: JSON.stringify({ personImage: person, garmentImage: garment, category }),
  });
  if (!res.ok) {
    return { ok: false, provider: "custom", error: `Endpoint returned ${res.status}.` };
  }
  const json = (await res.json()) as { image?: string; url?: string };
  const image = json.image ?? json.url;
  return image
    ? { ok: true, provider: "custom", image }
    : { ok: false, provider: "custom", error: "Response had no `image` or `url` field." };
}

/**
 * Applies garments one at a time, feeding each render back in as the person
 * image for the next. Every current model is single-garment, so this is how a
 * full outfit gets rendered — and it's also why the cost estimate multiplies.
 */
export async function renderTryOn(req: TryOnRequest): Promise<TryOnResult> {
  const status = providerStatus();
  if (status.id === "none" || !status.configured) {
    return {
      ok: false,
      provider: status.id,
      error: status.hint ?? "No try-on provider configured.",
    };
  }
  if (!req.garments.length) {
    return { ok: false, provider: status.id, error: "Nothing to render." };
  }

  let current = req.personImage;
  let cost = 0;

  for (const g of req.garments) {
    const category = g.category === "auto" ? "auto" : g.category;
    let result: TryOnResult;
    switch (status.id) {
      case "fal": result = await runFal(current, g.image, category); break;
      case "fashn": result = await runFashn(current, g.image, category); break;
      case "custom": result = await runCustom(current, g.image, category); break;
      default: result = { ok: false, provider: status.id, error: "Unsupported provider." };
    }
    if (!result.ok || !result.image) return result;
    current = result.image;
    cost += result.estimatedCostUsd ?? 0;
  }

  return { ok: true, provider: status.id, image: current, estimatedCostUsd: cost };
}

/** Map our garment categories onto the provider's vocabulary. */
export function tryOnCategory(category: string): "tops" | "bottoms" | "one-pieces" | "auto" {
  switch (category) {
    case "top": return "tops";
    case "outerwear": return "tops";
    case "bottom": return "bottoms";
    case "dress": return "one-pieces";
    default: return "auto";
  }
}
