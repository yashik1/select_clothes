import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in — FitCheck" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return <AuthForm mode="login" />;
}
