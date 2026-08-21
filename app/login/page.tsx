import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · FirstBench Exam Portal" };

export default async function LoginPage() {
  // Already signed in — don't show a login form they'd have to bounce off.
  const session = await getSession();
  if (session) {
    redirect(session.role === "ADMIN" ? "/admin/dashboard" : "/student/dashboard");
  }

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
      {/* Brand wash: the logo yellow at low intensity, so the sign-in screen
          reads as FirstBench before you even get to the logo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--primary-soft),transparent_75%)]"
      />
      <div className="relative">
        <LoginForm />
      </div>
    </main>
  );
}
