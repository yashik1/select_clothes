import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";
import { ForgotForm } from "@/components/ResetForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password — FitCheck" };

export default async function ForgotPage() {
  if (await currentUser()) redirect("/");
  return <ForgotForm />;
}
