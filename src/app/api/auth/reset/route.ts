import { NextResponse } from "next/server";
import { z } from "zod";
import { claimPasswordReset, deleteSessionsFor, setPassword } from "@/lib/db";
import { hashPassword, hashToken, passwordProblem } from "@/lib/auth";
import { parseJsonBody } from "@/lib/http";
import { LIMITS, caller, consume, tooMany } from "@/lib/server/rateLimit";

const schema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().max(200),
});

/**
 * Finishes a password reset.
 *
 * The password is checked before the token is claimed, deliberately: a typo
 * that produces too short a password must not burn a link somebody has only
 * one of. That ordering is safe here only because the two failures are
 * indistinguishable from outside — a short password returns the same 400
 * whether the token was live or nonsense, so the endpoint never becomes a way
 * to test tokens for free. Reordering these two checks would break that, so
 * they belong in this order and not the other.
 */
export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  // Skipped when nobody can be identified, rather than counted against one
  // bucket everybody shares — five requests would otherwise stop every
  // outstanding reset link on the instance from being redeemed.
  const who = caller(req);
  if (who.identified) {
    const verdict = await consume(`reset-submit:${who.id}`, LIMITS.passwordReset);
    if (!verdict.ok) return tooMany(verdict.retryAfter, "attempts");
  }

  const problem = passwordProblem(parsed.data.password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const userId = await claimPasswordReset(hashToken(parsed.data.token));
  if (!userId) {
    return NextResponse.json(
      { error: "That link has expired or has already been used. Ask for a new one." },
      { status: 400 },
    );
  }

  await setPassword(userId, await hashPassword(parsed.data.password));

  /*
   * Every session, including the one making this request. People reset a
   * password because they think somebody else has it, and leaving that
   * person's session alive would make the reset theatre.
   */
  await deleteSessionsFor(userId);

  return NextResponse.json({ ok: true });
}
