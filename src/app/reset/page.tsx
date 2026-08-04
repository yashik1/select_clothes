import Link from "next/link";
import { Card } from "@/components/ui";
import { ResetForm } from "@/components/ResetForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password — FitCheck" };

/**
 * Signed-in users are deliberately *not* redirected away: arriving here with a
 * live session is exactly what happens when somebody suspects their account is
 * compromised and wants the password changed, and bouncing them to the home
 * page would take the one tool they came for.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto max-w-md py-10">
        <h1 className="display text-4xl">That link is incomplete</h1>
        <Card className="mt-6 p-5 text-[0.9375rem]">
          <p>
            The address is missing its token, which usually means a mail client broke the link
            across two lines. Copy the whole thing, or ask for a new one.
          </p>
          <p className="mt-4">
            <Link href="/forgot" className="underline underline-offset-4">
              Send a new link
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  return <ResetForm token={token} />;
}
