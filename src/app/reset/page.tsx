import { ResetForm } from "@/components/ResetForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password — FitCheck" };

/**
 * Signed-in users are deliberately *not* redirected away: arriving here with a
 * live session is exactly what happens when somebody suspects their account is
 * compromised and wants the password changed, and bouncing them to the home
 * page would take the one tool they came for.
 *
 * The token arrives in the fragment (`/reset#token=…`), not the query string,
 * so the page itself never sees it — a fragment is not sent to the server at
 * all. A live credential in a query string is written into the server's access
 * log, and into whatever CDN, proxy or platform logging sits in front of it,
 * every one of which keeps full URLs by default. Reading it on the client
 * instead costs nothing, because the form was already a client component whose
 * only use for the token is to post it back.
 */
export default function ResetPage() {
  return <ResetForm />;
}
