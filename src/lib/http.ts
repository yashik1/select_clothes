/**
 * Request body reading.
 *
 * `req.json()` and `req.formData()` throw on a malformed body, and an
 * unhandled throw inside a route handler becomes a 500 — which says the server
 * broke when in fact the request was wrong. From the caller's side a body that
 * isn't JSON and a body that isn't the right shape are the same failure, so
 * both come back as 400 with something specific enough to act on.
 */
import { NextResponse } from "next/server";
import type { z } from "zod";

export type BodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

const badRequest = (error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status: 400 });

/** Raw JSON, for the routes that have to look at the body before validating it. */
export async function readJsonBody(req: Request): Promise<BodyResult<unknown>> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false, response: badRequest("Expected a JSON request body.") };
  }
}

/** JSON parsed and validated in one step — what most routes want. */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
  invalidMessage = "Invalid request",
): Promise<BodyResult<z.infer<S>>> {
  const read = await readJsonBody(req);
  if (!read.ok) return read;

  const parsed = schema.safeParse(read.data);
  if (!parsed.success) {
    return { ok: false, response: badRequest(invalidMessage, { issues: parsed.error.issues }) };
  }
  return { ok: true, data: parsed.data };
}

/** Multipart, which throws just as readily as JSON does. */
export async function readFormBody(req: Request): Promise<BodyResult<FormData>> {
  try {
    return { ok: true, data: await req.formData() };
  } catch {
    return { ok: false, response: badRequest("Expected a multipart form body.") };
  }
}
