import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress } from "./address";

/**
 * Fetching a URL somebody typed.
 *
 * This is the shape of request that gets an app owned: the server will connect
 * to whatever address the user names, from inside the network the database
 * lives on. `http://169.254.169.254/` is the cloud metadata service and hands
 * out credentials; `http://10.0.0.5:5432` is somebody else's Postgres. So the
 * host is resolved first and the request is refused unless every address it
 * answers with is public — checked again after each redirect, because a public
 * hostname is free to redirect to a private one.
 */

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

/**
 * Identifies itself honestly. This fetches one page a person is already
 * looking at, the way a "save to wishlist" button does — it is not a crawler,
 * so it takes no liberties and follows no links of its own.
 */
const USER_AGENT =
  "FitCheck/1.0 (+wardrobe import; one page per user request; contact: the operator of this instance)";

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImportError("Only http and https links can be imported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new ImportError("That address is not reachable from here.");
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new ImportError("That address is not reachable from here.");
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new ImportError("That site could not be found.", 502);
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ImportError("That address is not reachable from here.");
  }
}

/** A response body, capped so a huge page or image can't exhaust memory. */
async function readCapped(res: Response, limit: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ImportError("That file is too large to import.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface Fetched {
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: Buffer;
}

/**
 * Follows redirects by hand so each hop can be re-checked. `redirect: "follow"`
 * would let a public host bounce us into the private network on hop two,
 * which is the whole attack.
 */
export async function fetchPublic(
  rawUrl: string,
  accept: string,
  limit = MAX_BYTES,
): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new ImportError("That doesn't look like a link.");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "en" },
      });
    } catch {
      throw new ImportError("That page could not be reached.", 502);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new ImportError("That page could not be reached.", 502);
      url = new URL(location, url);
      continue;
    }

    return {
      finalUrl: url.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      bytes: res.ok ? await readCapped(res, limit) : Buffer.alloc(0),
    };
  }
  throw new ImportError("That link redirects too many times.", 502);
}

/** The same fetch, decoded, for pages rather than images. */
export async function fetchPublicText(rawUrl: string, accept: string): Promise<Fetched & { body: string }> {
  const res = await fetchPublic(rawUrl, accept);
  return { ...res, body: res.bytes.toString("utf8") };
}

