import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { countUsers } from "@/lib/db";
import { signupsClosed } from "@/lib/server/policy";
import { AuthForm } from "@/components/AuthForm";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create an account — FitCheck" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/");

  // The first account is always allowed, or a closed instance could never be
  // set up in the first place.
  if (signupsClosed() && (await countUsers()) > 0) {
    return (
      <div className="mx-auto max-w-sm">
        <h1 className="display text-3xl font-semibold">Registration is closed</h1>
        <Card className="mt-6 p-5 text-sm text-[var(--color-muted)]">
          This instance isn&apos;t accepting new accounts. If you already have one,{" "}
          <a href="/login" className="text-[var(--color-accent)] hover:underline">
            sign in
          </a>
          .
        </Card>
      </div>
    );
  }

  return <AuthForm mode="signup" />;
}
