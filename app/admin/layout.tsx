import {
  BarChart3,
  BookOpen,
  FileUp,
  LayoutDashboard,
  NotebookText,
  RotateCcw,
  Users,
  Layers,
} from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell, type NavItem } from "@/components/app-shell";
import { getSession } from "@/lib/auth";
import { logout } from "@/app/login/actions";

const nav: NavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { href: "/admin/batches", label: "Batches & Classes", icon: <Layers className="size-4" /> },
  { href: "/admin/students", label: "Students", icon: <Users className="size-4" /> },
  { href: "/admin/exams", label: "Exams", icon: <BookOpen className="size-4" /> },
  { href: "/admin/papers", label: "Question Papers", icon: <FileUp className="size-4" /> },
  { href: "/admin/notes", label: "Study Notes", icon: <NotebookText className="size-4" /> },
  { href: "/admin/reopen-requests", label: "Reopen Requests", icon: <RotateCcw className="size-4" /> },
  { href: "/admin/reports", label: "Reports", icon: <BarChart3 className="size-4" /> },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  return (
    <AppShell
      nav={nav}
      userName={session.username}
      userRole="Administrator"
      logoutAction={logout}
    >
      {children}
    </AppShell>
  );
}
