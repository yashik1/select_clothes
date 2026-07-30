/**
 * Reading a garment off a retailer's product page.
 *
 * Every field here comes from data the shop publishes deliberately — the
 * schema.org `Product` block it feeds to Google Shopping, its Open Graph tags,
 * or, on Shopify, the JSON endpoint that sits beside every product URL. There
 * is no parsing of page layout and nothing here defeats a bot check: if a site
 * doesn't publish structured data, the import comes back honest about what it
 * couldn't find rather than guessing from markup that changes weekly.
 *
 * **What this cannot do, and it is the important part.** Garment measurements
 * are essentially never in structured data — they live in a size-chart modal,
 * usually drawn by JavaScript, in a different shape on every site. So an import
 * fills in the catalogue fields and leaves the fit engine exactly where a typed
 * size label leaves it, at about 45% confidence. The UI has to keep asking for
 * the tape measure, because that is still the only thing that gets to 90%.
 */
import { FIBERS } from "../data/fabrics";
import { SUBCATEGORY_LIST } from "../data/garmentTypes";
import type { GarmentCategory } from "../types";

export interface ImportedProduct {
  name?: string;
  brand?: string;
  category?: GarmentCategory;
  subcategory?: string;
  /** The shop's own colour word. The real colour comes from the photo. */
  colorName?: string;
  size?: string;
  pricePaid?: number;
  currency?: string;
  retailer?: string;
  productUrl: string;
  imageUrls: string[];
  fabric?: Record<string, number>;
  /** Where the fields came from, so the UI can say. */
  source: "shopify" | "json-ld" | "open-graph" | "none";
  /** Fields the page did supply, in the app's own vocabulary. */
  found: string[];
}

/* -------------------------------------------------------------- helpers -- */

const decodeEntities = (s: string) =>
  s
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1]?.toLowerCase() === "x"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      const named: Record<string, string> = {
        amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
        eacute: "é", egrave: "è", rsquo: "’", ndash: "–", mdash: "—",
      };
      return named[code.toLowerCase()] ?? whole;
    })
    .trim();

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));

const clean = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = decodeEntities(v).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 200) : undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/* ------------------------------------------------------------ inference -- */

/**
 * The app's own catalogue, matched against whatever the shop calls the thing.
 * Substring collisions between garment names are the whole difficulty here —
 * "dress shirt" against "dress", "tee" inside "long-sleeve tee" — so which
 * match wins is decided in `classify`, not by the order of this list.
 */
const CLASSIFIERS: { subcategory: string; category: GarmentCategory; terms: string[] }[] =
  SUBCATEGORY_LIST.map((def) => ({
    subcategory: def.key,
    category: def.category,
    terms: [def.key.replace(/-/g, " "), def.label.toLowerCase()],
  }));

/**
 * Words a shop uses for a garment that aren't the catalogue's own.
 *
 * Every entry here has to *be* a garment. Necklines, fabrics and fits are not:
 * "crew neck" was mapped to sweater, and since a crew neck is a neckline that
 * a tee has as readily as a jumper, every "Crew-Neck Tee" in every shop came
 * back as a sweater. A modifier that names no garment belongs nowhere in this
 * table — it can only ever outvote the word that does.
 */
const SYNONYMS: Record<string, string> = {
  jumper: "sweater",
  pullover: "sweater",
  tee: "t-shirt",
  "t shirt": "t-shirt",
  trousers: "dress-trousers",
  pants: "chinos",
  jean: "jeans",
  trainers: "sneakers",
  plimsolls: "sneakers",
  overcoat: "wool-coat",
  parka: "puffer",
  anorak: "rain-shell",
  windbreaker: "rain-shell",
  gilet: "vest",
  waistcoat: "vest",
  shirt: "oxford-shirt",
  hoody: "hoodie",
  boots: "combat-boots",
};

export function classify(text: string): { category: GarmentCategory; subcategory: string } | null {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;

  const hits: { subcategory: string; category: GarmentCategory; length: number; end: number }[] = [];
  const consider = (subcategory: string, category: GarmentCategory, term: string) => {
    const at = haystack.lastIndexOf(` ${term} `);
    if (at >= 0) hits.push({ subcategory, category, length: term.length, end: at + term.length });
  };

  for (const c of CLASSIFIERS) {
    for (const term of c.terms) if (term) consider(c.subcategory, c.category, term);
  }
  for (const [term, key] of Object.entries(SYNONYMS)) {
    const def = SUBCATEGORY_LIST.find((d) => d.key === key);
    if (def) consider(key, def.category, term);
  }
  if (!hits.length) return null;

  /*
   * The last garment word wins. English product names put the head noun at the
   * end and hang the modifiers off the front — "Slub Cotton Crew-Neck Tee" is
   * a tee, "Denim Shirt" is a shirt — so position says which word names the
   * thing far more reliably than length does. Length only breaks ties between
   * matches ending at the same place, where it correctly prefers the more
   * specific phrase: "dress shirt" over "shirt".
   */
  hits.sort((a, b) => b.end - a.end || b.length - a.length);
  return { category: hits[0].category, subcategory: hits[0].subcategory };
}

/**
 * The name decides, and only a name that says nothing hands over to the prose.
 *
 * A description is long and mentions other garments — "layer it under a
 * jumper" — and a breadcrumb reflects how the shop merchandises rather than
 * what the thing is. Both are worth reading, neither is worth letting outvote
 * the title.
 */
export function classifyBest(
  primary: string | undefined,
  ...fallbacks: (string | undefined)[]
): { category: GarmentCategory; subcategory: string } | null {
  if (primary) {
    const fromName = classify(primary);
    if (fromName) return fromName;
  }
  for (const text of fallbacks) {
    if (!text) continue;
    const guess = classify(text);
    if (guess) return guess;
  }
  return null;
}

/**
 * The fibre a shop's wording names.
 *
 * "Merino wool" contains both `merino` and `wool`, and they are not
 * interchangeable — merino is warmer and stretchier in the models downstream.
 * So a name the phrase *starts with* beats one merely contained in it, and the
 * longest match wins either way; taking the first fibre that matched picked
 * whichever happened to be declared first, which is nothing to do with the
 * garment.
 */
function matchFiber(name: string): string | undefined {
  const keys = Object.keys(FIBERS);
  const longest = (candidates: string[]) =>
    candidates.sort((a, b) => b.length - a.length)[0];

  const prefix = keys.filter((f) => name.startsWith(f));
  if (prefix.length) return longest(prefix);

  const contained = keys.filter((f) => name.includes(f));
  return contained.length ? longest(contained) : undefined;
}

/**
 * "98% Cotton, 2% Elastane" and its many spellings, onto the fibres the warmth
 * and stretch models actually know about.
 */
export function parseFabric(text: string): Record<string, number> | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  const out: Record<string, number> = {};

  for (const m of lower.matchAll(/(\d{1,3})\s*%\s*([a-z][a-z\s-]*)/g)) {
    const pct = parseInt(m[1], 10);
    const fiber = matchFiber(m[2].trim());
    if (fiber && pct > 0 && pct <= 100) out[fiber] = (out[fiber] ?? 0) + pct / 100;
  }

  const total = Object.values(out).reduce((s, v) => s + v, 0);
  if (total <= 0) {
    // No percentages given — a bare "Merino wool" still names the fibre.
    const fiber = matchFiber(lower);
    return fiber ? { [fiber]: 1 } : undefined;
  }
  // Shops round, and 33/33/33 should still sum to one.
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v / total]));
}

/* ------------------------------------------------------------- shopify -- */

/**
 * Any Shopify storefront serves this beside the product page, which covers a
 * large share of independent fashion brands with no HTML parsing at all.
 */
export function shopifyJsonUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^(.*\/products\/[^/]+?)(?:\.json)?\/?$/);
    if (!m) return null;
    return `${u.origin}${m[1]}.json`;
  } catch {
    return null;
  }
}

interface ShopifyProduct {
  title?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  body_html?: string;
  images?: { src?: string }[];
  variants?: { title?: string; price?: string; option1?: string }[];
}

export function fromShopify(body: string, productUrl: string): ImportedProduct | null {
  let parsed: { product?: ShopifyProduct };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const p = parsed.product;
  if (!p || !p.title) return null;

  const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags ?? "");
  const guess = classifyBest(p.title, p.product_type, tags);
  const fabric = parseFabric(stripTags(p.body_html ?? ""));

  const found: string[] = [];
  const out: ImportedProduct = {
    productUrl,
    imageUrls: (p.images ?? []).map((i) => i.src).filter((s): s is string => Boolean(s)).slice(0, 4),
    source: "shopify",
    found,
  };

  out.name = clean(p.title);
  if (out.name) found.push("name");
  out.brand = clean(p.vendor);
  if (out.brand) found.push("brand");
  if (guess) {
    out.category = guess.category;
    out.subcategory = guess.subcategory;
    found.push("category");
  }
  if (fabric) {
    out.fabric = fabric;
    found.push("fabric");
  }
  const price = num(p.variants?.[0]?.price);
  if (price !== undefined) {
    out.pricePaid = price;
    found.push("price");
  }
  if (out.imageUrls.length) found.push("photo");
  out.retailer = retailerFrom(productUrl);
  return out;
}

/* ------------------------------------------------------------- json-ld -- */

type Json = Record<string, unknown>;

/** Every JSON-LD block on the page, flattened through `@graph` and arrays. */
export function jsonLdNodes(html: string): Json[] {
  const out: Json[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(push);
    if (!v || typeof v !== "object") return;
    const node = v as Json;
    out.push(node);
    if (node["@graph"]) push(node["@graph"]);
  };

  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      push(JSON.parse(m[1].trim()));
    } catch {
      // A malformed block is one shop's bug, not a reason to fail the import.
    }
  }
  return out;
}

const isProduct = (n: Json) => {
  const t = n["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && /product/i.test(x));
};

export function fromJsonLd(html: string, productUrl: string): ImportedProduct | null {
  const product = jsonLdNodes(html).find(isProduct);
  if (!product) return null;

  const found: string[] = [];
  const out: ImportedProduct = {
    productUrl,
    imageUrls: [],
    source: "json-ld",
    found,
    retailer: retailerFrom(productUrl),
  };

  out.name = clean(product.name);
  if (out.name) found.push("name");

  const brand = product.brand;
  out.brand =
    clean(brand) ?? clean((brand as Json | undefined)?.name) ?? undefined;
  if (out.brand) found.push("brand");

  const image = product.image;
  const images = Array.isArray(image) ? image : [image];
  out.imageUrls = images
    .map((i) => (typeof i === "string" ? i : clean((i as Json | undefined)?.url)))
    .filter((s): s is string => Boolean(s))
    .slice(0, 4);
  if (out.imageUrls.length) found.push("photo");

  out.colorName = clean(product.color);
  if (out.colorName) found.push("colour");
  out.size = clean(product.size);
  if (out.size) found.push("size");

  // `offers` is a single object, a list, or an AggregateOffer wrapping more.
  const offers = product.offers as Json | Json[] | undefined;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const price = num(offer?.price ?? offer?.lowPrice);
  if (price !== undefined) {
    out.pricePaid = price;
    found.push("price");
  }
  const currency = clean(offer?.priceCurrency);
  if (currency) out.currency = currency;

  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const guess = classifyBest(out.name, text(product.category), text(product.description));
  if (guess) {
    out.category = guess.category;
    out.subcategory = guess.subcategory;
    found.push("category");
  }

  const fabric = parseFabric(
    [product.material, product.description].map((v) => (typeof v === "string" ? v : "")).join(" "),
  );
  if (fabric) {
    out.fabric = fabric;
    found.push("fabric");
  }

  return out.name ? out : null;
}

/* -------------------------------------------------------- open graph -- */

function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Either attribute order, either quote style — both are common in the wild.
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return clean(m[1]);
  }
  return undefined;
}

export function fromOpenGraph(html: string, productUrl: string): ImportedProduct | null {
  const title = metaContent(html, "og:title") ?? clean(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
  if (!title) return null;

  const found: string[] = ["name"];
  const image = metaContent(html, "og:image");
  const out: ImportedProduct = {
    productUrl,
    name: title,
    imageUrls: image ? [image] : [],
    source: "open-graph",
    found,
    retailer: metaContent(html, "og:site_name") ?? retailerFrom(productUrl),
  };
  if (image) found.push("photo");

  const brand = metaContent(html, "product:brand") ?? metaContent(html, "og:brand");
  if (brand) {
    out.brand = brand;
    found.push("brand");
  }
  const price = num(metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount"));
  if (price !== undefined) {
    out.pricePaid = price;
    found.push("price");
  }
  const currency = metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency");
  if (currency) out.currency = currency;

  const guess = classifyBest(title, metaContent(html, "og:description"));
  if (guess) {
    out.category = guess.category;
    out.subcategory = guess.subcategory;
    found.push("category");
  }
  return out;
}

/* --------------------------------------------------------------- host -- */

export function retailerFrom(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\d?\./, "");
    const label = host.split(".")[0];
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best available reading of one page. Shopify first because it is exact,
 * then the structured block the shop publishes for search engines, then the
 * social-preview tags every page has.
 */
export function extractProduct(
  productUrl: string,
  page: { html?: string; shopifyJson?: string },
): ImportedProduct {
  if (page.shopifyJson) {
    const shopify = fromShopify(page.shopifyJson, productUrl);
    if (shopify) return shopify;
  }
  if (page.html) {
    const ld = fromJsonLd(page.html, productUrl);
    if (ld) return ld;
    const og = fromOpenGraph(page.html, productUrl);
    if (og) return og;
  }
  return { productUrl, imageUrls: [], source: "none", found: [], retailer: retailerFrom(productUrl) };
}

/**
 * What the import could not answer. Measurements lead the list because they
 * are what separates a catalogue entry from a fit verdict, and no amount of
 * structured data supplies them.
 */
export function stillNeeded(p: ImportedProduct): string[] {
  const needed = ["the garment's own measurements"];
  if (!p.found.includes("size")) needed.push("size");
  if (!p.found.includes("fabric")) needed.push("fabric");
  if (!p.found.includes("category")) needed.push("what kind of thing it is");
  if (!p.found.includes("photo")) needed.push("a photo");
  return needed;
}
