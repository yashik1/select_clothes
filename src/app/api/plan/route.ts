import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePlan, getOutfit, listPlans, newId, nowIso, savePlan } from "@/lib/db";
import { occasionSchema } from "@/lib/validate";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

/*
 * What you intend to wear, by day.
 *
 * One plan per date, so PUT is the right verb: the client names the day and
 * sends what goes on it. There is no POST, because "add another plan for
 * Thursday" is not a thing the calendar can draw.
 */

/** A plain calendar day. Not a timestamp — a plan is for a date, in your zone. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  // `2026-02-31` matches the pattern and is not a day. Round-tripping through
  // Date catches every such case without a month-length table.
  .refine((s) => {
    /*
     * The `Number.isNaN` guard is not belt-and-braces. A failed `.regex` leaves
     * the parse *dirty* rather than aborted, and zod runs a `.refine` on a dirty
     * value anyway — so this receives strings the pattern already rejected.
     * `new Date("not-a-dateT00:00:00Z")` is an Invalid Date, and calling
     * `toISOString()` on one throws a RangeError, which turned a 400 into a 500.
     */
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real date");

const putSchema = z.object({
  date: dateSchema,
  garmentIds: z.array(z.string().min(1).max(64)).min(1).max(12),
  outfitId: z.string().min(1).max(64).nullable().optional(),
  occasion: occasionSchema,
  note: z.string().trim().max(200).optional(),
});

export async function GET(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const range = z.object({ from: dateSchema, to: dateSchema }).safeParse({ from, to });
  if (!range.success) {
    return NextResponse.json({ error: "Give from and to as YYYY-MM-DD." }, { status: 400 });
  }

  return NextResponse.json({
    plans: await listPlans(auth.user.id, range.data.from, range.data.to),
  });
}

export async function PUT(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, putSchema, "Invalid plan");
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  /*
   * A plan may name the outfit it came from, and that id is later shown as a
   * link. Checking ownership here keeps a foreign id out of the row entirely,
   * rather than storing it and hoping every reader remembers to scope its own
   * lookup. The garment ids need no such check: they are only ever resolved
   * against this account's wardrobe, so an id we don't own simply isn't found.
   */
  const outfitId = input.outfitId && (await getOutfit(userId, input.outfitId))
    ? input.outfitId
    : null;

  const plan = await savePlan(userId, {
    id: newId(),
    date: input.date,
    garmentIds: input.garmentIds,
    outfitId,
    occasion: input.occasion,
    note: input.note?.length ? input.note : undefined,
    createdAt: nowIso(),
  });

  return NextResponse.json({ plan });
}

export async function DELETE(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const date = new URL(req.url).searchParams.get("date") ?? "";
  const parsed = dateSchema.safeParse(date);
  if (!parsed.success) {
    return NextResponse.json({ error: "Give a date as YYYY-MM-DD." }, { status: 400 });
  }

  await deletePlan(auth.user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
