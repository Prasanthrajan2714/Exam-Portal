import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// The portal has no marketing page — send everyone to where they belong.
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(session.role === "ADMIN" ? "/admin/dashboard" : "/student/dashboard");
}
