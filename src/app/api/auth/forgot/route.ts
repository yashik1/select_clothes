import { NextResponse, after } from "next/server";
import { z } from "zod";
import {
  createPasswordReset, getUserByEmail, purgeExpiredRateLimits, purgeExpiredResets,
} from "@/lib/db";
import { hashToken, newSessionToken, normaliseEmail } from "@/lib/auth";
import { parseJsonBody } from "@/lib/http";
import { canEmailStrangers, publicOrigin, sendMail } from "@/lib/server/email";
import { LIMITS, caller, consume, tooMany } from "@/lib/server/rateLimit";

const schema = z.object({ email: z.string().max(254) });

/** Short, because it is a live credential sitting in somebody's inbox. */
const VALID_MINUTES = 45;

/**
 * Starts a password reset.
 *
 * Answers identically whether or not the address is registered. The whole
 * point of the matching error messages on sign-in is that this app will not
 * confirm who has an account, and a "no such address" here would give that
 * away through the back door.
 */
export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const email = normaliseEmail(parsed.data.email);

  const who = caller(req);

  /*
   * Keyed on the caller, so exhausting it costs the caller — but only while
   * the caller can be told apart from everyone else. Unidentified, this would
   * be one bucket shared by the world, and five requests would shut the
   * recovery path for every account on the instance. The per-inbox limit
   * further down carries it in that case.
   */
  if (who.identified) {
    const byCaller = await consume(`reset:from:${who.id}`, LIMITS.passwordReset);
    if (!byCaller.ok) return tooMany(byCaller.retryAfter, "reset requests");
  }

  const sameAnswer = NextResponse.json({
    ok: true,
    // The UI needs to know whether to promise an email or tell the operator to
    // read the log. It is a property of the deployment, not of the address, so
    // it reveals nothing about who has an account.
    delivery: canEmailStrangers() ? "email" : "log",
  });

  const user = await getUserByEmail(email);
  if (!user) return sameAnswer;

  const origin = publicOrigin();
  if (!origin) {
    console.error(
      "[reset] FITCHECK_PUBLIC_URL is not set, so there is no address to put in the link.",
    );
    return sameAnswer;
  }

  /*
   * How many messages this address may receive, regardless of who asked.
   *
   * Unlike the login route, a spent budget here is *not* an error: returning a
   * 429 would answer differently for a registered address than an unregistered
   * one, which is precisely the disclosure the identical `sameAnswer` exists to
   * prevent. So a flooded inbox simply stops receiving mail, silently, and the
   * caller cannot tell that from a successful send.
   *
   * The window is fifteen minutes rather than an hour because this counter can
   * be filled by someone else. Nobody should be locked out of recovering their
   * own account for longer than that.
   */
  const inbox = await consume(`reset:inbox:${email}`, LIMITS.resetInbox);
  if (!inbox.ok) return sameAnswer;

  const { token } = newSessionToken();
  const expiresAt = new Date(Date.now() + VALID_MINUTES * 60_000).toISOString();
  await createPasswordReset(hashToken(token), user.id, expiresAt);

  /*
   * Sent after the response, not before it, and through `after()` rather than
   * a bare floating promise.
   *
   * Not before, because awaiting an outbound HTTPS call to the mail provider
   * makes a registered address answer a few hundred milliseconds slower than
   * an unregistered one, and a stopwatch then reads out the membership list
   * that every identical response above exists to protect.
   *
   * Through `after()`, because on a serverless runtime the invocation can be
   * frozen or torn down the moment the response is sent — work not registered
   * this way is not guaranteed to finish, and "your link is on its way"
   * followed by no email and no log line is the worst failure this endpoint
   * has. `after()` is what keeps the runtime alive for it.
   */
  const link = `${origin}/reset#token=${token}`;
  after(async () => {
    try {
      await sendMail({
        to: user.email,
        subject: "Reset your FitCheck password",
        text:
          `Someone asked to reset the password for this address.\n\n` +
          `${link}\n\n` +
          `The link works once and expires in ${VALID_MINUTES} minutes. ` +
          `If it wasn't you, nothing has changed and you can ignore this.\n`,
      });
    } catch (err) {
      console.error("[reset] could not send the email:", err);
    }
    await purgeExpiredResets().catch(() => {});
    await purgeExpiredRateLimits().catch(() => {});
  });

  return sameAnswer;
}
