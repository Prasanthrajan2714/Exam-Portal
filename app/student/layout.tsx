import { LayoutDashboard, NotebookText, UserCog } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell, type NavItem } from "@/components/app-shell";
import { logout } from "@/app/login/actions";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const nav: NavItem[] = [
  { href: "/student/dashboard", label: "My exams", icon: <LayoutDashboard className="size-4" /> },
  { href: "/student/notes", label: "Study Notes", icon: <NotebookText className="size-4" /> },
  { href: "/student/profile", label: "My account", icon: <UserCog className="size-4" /> },
];

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "STUDENT" || !session.studentId) {
    redirect("/login");
  }

  // Read the live record rather than trusting the JWT: an admin who disables a
  // student mid-session must lock them out on the next request, not whenever
  // their token happens to expire.
  const student = await prisma.student.findUnique({
    where: { id: session.studentId },
    include: { batch: { select: { name: true } } },
  });
  if (!student || student.status !== "ACTIVE") redirect("/login?disabled=1");

  return (
    <AppShell
      nav={nav}
      userName={student.name}
      userRole={student.batch.name}
      logoutAction={logout}
    >
      {children}
    </AppShell>
  );
}
