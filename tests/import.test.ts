import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  classify,
  classifyBest,
  extractProduct,
  fromJsonLd,
  fromOpenGraph,
  fromShopify,
  parseFabric,
  retailerFrom,
  shopifyJsonUrl,
  stillNeeded,
} from "../src/lib/import/product.ts";
import { isPrivateAddress } from "../src/lib/import/address.ts";



/*
 * A server that fetches whatever URL a user types will happily fetch the cloud
 * metadata endpoint and hand back credentials, or reach a database that is
 * only listening on the private network. Every one of these is a real address
 * somebody would try.
 */
describe("only public addresses are reachable", () => {
  test("the ranges that must never be fetched", () => {
    for (const ip of [
      "169.254.169.254",     // AWS/GCP/Azure metadata — the classic
      "127.0.0.1", "127.1.1.1",
      "0.0.0.0",
      "10.0.0.5", "10.255.255.255",
      "172.16.0.1", "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",          // carrier-grade NAT
      "198.18.0.1",
      "224.0.0.1", "255.255.255.255",
      "::1", "::",
      "fd00::1", "fe80::1",  // unique-local and link-local
      "::ffff:10.0.0.1",     // v4 wearing a v6 hat
      "::ffff:169.254.169.254",
      "not-an-ip", "",
    ]) {
      assert.equal(isPrivateAddress(ip), true, `${ip} was treated as public`);
    }
  });

  test("ordinary public addresses are allowed", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "104.18.32.7", "172.15.0.1", "172.32.0.1", "2606:4700::1111"]) {
      assert.equal(isPrivateAddress(ip), false, `${ip} was treated as private`);
    }
  });

  test("the boundaries of 172.16/12 are exact", () => {
    // Off-by-one here either blocks a real host or opens the private range.
    assert.equal(isPrivateAddress("172.15.255.255"), false);
    assert.equal(isPrivateAddress("172.16.0.0"), true);
    assert.equal(isPrivateAddress("172.31.255.255"), true);
    assert.equal(isPrivateAddress("172.32.0.0"), false);
  });
});

describe("finding the Shopify endpoint", () => {
  test("any product URL maps to its json twin", () => {
    assert.equal(
      shopifyJsonUrl("https://shop.example/products/wool-runner"),
      "https://shop.example/products/wool-runner.json",
    );
    assert.equal(
      shopifyJsonUrl("https://shop.example/collections/shoes/products/wool-runner?variant=42"),
      "https://shop.example/collections/shoes/products/wool-runner.json",
    );
    // Already pointed at the json, and a trailing slash.
    assert.equal(
      shopifyJsonUrl("https://shop.example/products/wool-runner.json"),
      "https://shop.example/products/wool-runner.json",
    );
    assert.equal(
      shopifyJsonUrl("https://shop.example/products/wool-runner/"),
      "https://shop.example/products/wool-runner.json",
    );
  });

  test("a page that isn't a product isn't guessed at", () => {
    assert.equal(shopifyJsonUrl("https://shop.example/collections/shoes"), null);
    assert.equal(shopifyJsonUrl("not a url"), null);
  });
});

describe("reading a Shopify product", () => {
  const body = JSON.stringify({
    product: {
      title: "Merino Crew Neck Jumper",
      vendor: "Example Knitwear",
      product_type: "Knitwear",
      tags: ["autumn", "wool"],
      body_html: "<p>Made from <b>100% merino wool</b>. Regular fit.</p>",
      images: [{ src: "https://cdn.example/1.jpg" }, { src: "https://cdn.example/2.jpg" }],
      variants: [{ title: "M", price: "129.00", option1: "M" }],
    },
  });

  test("pulls the fields the shop publishes", () => {
    const p = fromShopify(body, "https://shop.example/products/merino-crew")!;
    assert.equal(p.source, "shopify");
    assert.equal(p.name, "Merino Crew Neck Jumper");
    assert.equal(p.brand, "Example Knitwear");
    assert.equal(p.pricePaid, 129);
    assert.equal(p.imageUrls.length, 2);
    assert.equal(p.retailer, "Shop");
  });

  test("works out what kind of garment it is", () => {
    const p = fromShopify(body, "https://shop.example/products/merino-crew")!;
    assert.equal(p.category, "top");
    assert.equal(p.subcategory, "sweater");
  });

  test("reads the fibre out of the description", () => {
    const p = fromShopify(body, "https://shop.example/products/merino-crew")!;
    // Merino, not wool: the specific fibre is the one with the right warmth.
    assert.deepEqual(p.fabric, { merino: 1 });
  });

  test("rubbish in doesn't throw", () => {
    assert.equal(fromShopify("<html>not json</html>", "https://x.example/products/y"), null);
    assert.equal(fromShopify("{}", "https://x.example/products/y"), null);
  });
});

describe("reading schema.org product data", () => {
  const page = (extra: string) => `
    <html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product",
     "name":"Slim Fit Oxford Shirt","brand":{"@type":"Brand","name":"Example Co"},
     "color":"Sky Blue","material":"97% cotton, 3% elastane",
     "image":["https://cdn.example/shirt.jpg"],
     "offers":{"@type":"Offer","price":"79.00","priceCurrency":"GBP"}${extra}}
    </script></head><body></body></html>`;

  test("pulls name, brand, colour, price and photo", () => {
    const p = fromJsonLd(page(""), "https://example.com/p/1")!;
    assert.equal(p.source, "json-ld");
    assert.equal(p.name, "Slim Fit Oxford Shirt");
    assert.equal(p.brand, "Example Co");
    assert.equal(p.colorName, "Sky Blue");
    assert.equal(p.pricePaid, 79);
    assert.equal(p.currency, "GBP");
    assert.deepEqual(p.imageUrls, ["https://cdn.example/shirt.jpg"]);
    assert.equal(p.subcategory, "oxford-shirt");
    assert.deepEqual(p.fabric, { cotton: 0.97, elastane: 0.03 });
  });

  test("finds the product inside an @graph", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"Example"},
        {"@type":"Product","name":"Wool Overcoat","offers":{"price":"340"}}]}
    </script>`;
    const p = fromJsonLd(html, "https://example.com/p/2")!;
    assert.equal(p.name, "Wool Overcoat");
    assert.equal(p.pricePaid, 340);
  });

  test("survives a malformed block sitting next to a good one", () => {
    const html =
      `<script type="application/ld+json">{ this is not json }</script>` +
      `<script type="application/ld+json">{"@type":"Product","name":"Linen Shirt"}</script>`;
    assert.equal(fromJsonLd(html, "https://example.com/p/3")!.name, "Linen Shirt");
  });

  test("an AggregateOffer's low price is still a price", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"Tee","offers":{"@type":"AggregateOffer","lowPrice":"18.50","priceCurrency":"USD"}}
    </script>`;
    const p = fromJsonLd(html, "https://example.com/p/4")!;
    assert.equal(p.pricePaid, 18.5);
  });

  test("a page with no product block gives nothing rather than guessing", () => {
    assert.equal(fromJsonLd("<html><body>hello</body></html>", "https://example.com/x"), null);
  });
});

describe("falling back to the social preview tags", () => {
  const html = `<html><head>
    <meta property="og:title" content="Cropped Denim Jacket" />
    <meta content="https://cdn.example/j.jpg" property="og:image" />
    <meta property="og:site_name" content="Example Store" />
    <meta property="product:price:amount" content="95.00" />
    <meta property="product:price:currency" content="EUR" />
  </head></html>`;

  test("reads either attribute order", () => {
    const p = fromOpenGraph(html, "https://example.com/p")!;
    assert.equal(p.name, "Cropped Denim Jacket");
    assert.deepEqual(p.imageUrls, ["https://cdn.example/j.jpg"]);
    assert.equal(p.retailer, "Example Store");
    assert.equal(p.pricePaid, 95);
    assert.equal(p.currency, "EUR");
    assert.equal(p.subcategory, "denim-jacket");
  });

  test("a bare <title> is better than nothing", () => {
    const p = fromOpenGraph("<html><head><title>Silk Scarf</title></head></html>", "https://x.example/p")!;
    assert.equal(p.name, "Silk Scarf");
  });

  test("entities are decoded, not left raw", () => {
    const p = fromOpenGraph(
      `<meta property="og:title" content="Levi&#39;s 501 &amp; Co Jeans">`,
      "https://x.example/p",
    )!;
    assert.equal(p.name, "Levi's 501 & Co Jeans");
  });
});

describe("choosing the best reading of a page", () => {
  test("Shopify wins when it answered", () => {
    const shopifyJson = JSON.stringify({ product: { title: "From Shopify", images: [] } });
    const html = `<script type="application/ld+json">{"@type":"Product","name":"From JSON-LD"}</script>`;
    assert.equal(extractProduct("https://x.example/products/y", { shopifyJson, html }).name, "From Shopify");
  });

  test("JSON-LD beats Open Graph", () => {
    const html =
      `<meta property="og:title" content="From OG">` +
      `<script type="application/ld+json">{"@type":"Product","name":"From JSON-LD"}</script>`;
    assert.equal(extractProduct("https://x.example/p", { html }).name, "From JSON-LD");
  });

  test("a page with nothing readable says so instead of inventing", () => {
    const result = extractProduct("https://x.example/p", { html: "<html><body>nope</body></html>" });
    assert.equal(result.source, "none");
    assert.deepEqual(result.found, []);
    assert.equal(result.name, undefined);
  });
});

/*
 * The honesty check. An import that quietly produced a finished-looking item
 * would be scoring fit at the confidence of a guessed size while presenting it
 * as a real answer, so measurements must always be named as outstanding.
 */
describe("what the import admits it cannot know", () => {
  test("measurements are always still needed, however good the page was", () => {
    const rich = fromShopify(
      JSON.stringify({
        product: {
          title: "Merino Jumper", vendor: "Example", body_html: "100% merino wool",
          images: [{ src: "https://cdn.example/1.jpg" }], variants: [{ price: "1" }],
        },
      }),
      "https://shop.example/products/x",
    )!;
    assert.ok(rich.found.length >= 4, "expected a well-populated import");
    assert.ok(
      stillNeeded(rich).some((s) => /measurement/i.test(s)),
      "a rich import stopped asking for measurements",
    );
  });

  test("what's missing is listed, not just what was found", () => {
    const thin = fromOpenGraph(`<meta property="og:title" content="Something">`, "https://x.example/p")!;
    const needed = stillNeeded(thin);
    for (const expected of [/measurement/i, /size/i, /fabric/i, /photo/i]) {
      assert.ok(needed.some((s) => expected.test(s)), `${expected} was not listed as missing`);
    }
  });
});

describe("working out what the garment is", () => {
  test("shop words map onto the app's own catalogue", () => {
    for (const [text, subcategory] of [
      ["Merino Crew Neck Jumper", "sweater"],
      ["Organic Cotton Tee", "t-shirt"],
      ["Slim Fit Chinos", "chinos"],
      ["Leather Chelsea Boots", "chelsea-boots"],
      ["Quilted Gilet", "vest"],
      ["Lightweight Rain Shell", "rain-shell"],
      ["Selvedge Denim Jeans", "jeans"],
      ["Wool Overcoat", "wool-coat"],
    ] as const) {
      assert.equal(classify(text)?.subcategory, subcategory, text);
    }
  });

  test("the longer name wins, so a dress shirt isn't a dress", () => {
    // "shirt" and "dress" both appear; picking the wrong one puts a shirt in
    // the dress category and drapes it to the knee on the figure.
    const got = classify("Poplin Dress Shirt");
    assert.equal(got?.category, "top");
    assert.equal(got?.subcategory, "dress-shirt");
  });

  test("an unrecognisable name is left for the user rather than guessed", () => {
    assert.equal(classify("The Everyday Essential No. 4"), null);
  });

  /*
   * A crew-neck t-shirt came back as a sweater, because "crew neck" was in the
   * synonym table pointing at sweater and, being the longer phrase, outvoted
   * "tee". Necklines, fabrics, washes and fits describe a garment; they never
   * name one, and any of them left in that table can only ever beat the word
   * that does.
   */
  test("a neckline never decides what the garment is", () => {
    for (const name of [
      "Crew-Neck T-Shirt",
      "Soft Wash Crew-Neck Tee",
      "Vintage Crewneck T-Shirt",
      "Luxe-Touch Crew Neck Tee",
      "Slub Cotton Crew-Neck Tee",
      "V-Neck Tee",
      "Scoop Neck Tee",
    ]) {
      assert.equal(classify(name)?.subcategory, "t-shirt", name);
    }
  });

  test("a crew neck on something that really is a jumper still reads as one", () => {
    assert.equal(classify("Merino Crew-Neck Jumper")?.subcategory, "sweater");
    assert.equal(classify("Crew Neck Sweater")?.subcategory, "sweater");
  });

  test("a fabric never decides what the garment is", () => {
    assert.equal(classify("Denim Shirt")?.category, "top");
    assert.equal(classify("Knit Polo Shirt")?.subcategory, "polo");
    assert.equal(classify("Corduroy Trousers")?.category, "bottom");
    assert.equal(classify("Leather Jacket")?.subcategory, "leather-jacket");
  });

  test("the last garment word wins, because that is where English puts it", () => {
    // Modifiers hang off the front of a product name; the head noun ends it.
    // "Sweater Vest" is the clean case: both words name garments, and the one
    // it actually is comes last.
    assert.equal(classify("Sweater Vest")?.subcategory, "vest");
    assert.equal(classify("Day Dress")?.category, "dress");
    // Length would have picked "sweater" here for being the longer word.
    assert.notEqual(classify("Sweater Vest")?.subcategory, "sweater");
  });

  test("a garment word the catalogue has no type for is left alone", () => {
    // "Jacket Dress" names two things this app has no bare term for; guessing
    // between them would be worse than the dropdown the user already has.
    assert.equal(classify("Jacket Dress"), null);
  });
});

describe("which text is allowed to decide the category", () => {
  test("the name wins over a description that mentions other garments", () => {
    const guess = classifyBest(
      "Slub Cotton Tee",
      "A lightweight tee to layer under a sweater or a wool coat.",
    );
    assert.equal(guess?.subcategory, "t-shirt");
  });

  test("a name that says nothing hands over to the prose", () => {
    const guess = classifyBest("The Essential No. 4", "A merino jumper for cold mornings.");
    assert.equal(guess?.subcategory, "sweater");
  });

  test("nothing anywhere is left for the user", () => {
    assert.equal(classifyBest("No. 4", "Made in Portugal."), null);
  });
});

describe("reading fibre content", () => {
  test("percentages are parsed and normalised", () => {
    assert.deepEqual(parseFabric("98% Cotton, 2% Elastane"), { cotton: 0.98, elastane: 0.02 });
    assert.deepEqual(parseFabric("100% Linen"), { linen: 1 });
  });

  test("a named fibre with no percentage still counts", () => {
    assert.deepEqual(parseFabric("Made from soft cashmere"), { cashmere: 1 });
  });

  test("merino beats the generic wool it also matches", () => {
    assert.deepEqual(parseFabric("100% merino wool"), { merino: 1 });
  });

  test("shares always sum to one even when the shop's rounding doesn't", () => {
    const f = parseFabric("34% cotton, 33% polyester, 33% viscose")!;
    const total = Object.values(f).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `summed to ${total}`);
  });

  test("text with no fibre in it returns nothing", () => {
    assert.equal(parseFabric("Ships in 2 days. 30% off this week."), undefined);
  });
});

describe("naming the shop", () => {
  test("comes from the host when the page doesn't say", () => {
    assert.equal(retailerFrom("https://www.example-shop.com/p/1"), "Example-shop");
    assert.equal(retailerFrom("https://www2.hm.com/x"), "Hm");
    assert.equal(retailerFrom("garbage"), undefined);
  });
});
