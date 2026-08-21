import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PasswordForm } from "./password-form";

export const metadata = { title: "My account · FirstBench" };

export default async function ProfilePage() {
  const { student } = await requireStudent();

  const user = await prisma.user.findUnique({
    where: { id: student.userId },
    select: { username: true, mustChangePassword: true },
  });

  return (
    <>
      <PageHeader
        title="My account"
        description="Your details and sign-in password."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Row label="Name" value={student.name} />
            <Row label="Username" value={user?.username ?? "—"} mono />
            <Row label="Batch or class" value={student.batch.name} />
            <Row label="School" value={student.schoolName || "—"} />
            <Row label="Email" value={student.email || "—"} />
            <Row label="Phone" value={student.phone || "—"} />

            <p className="pt-2 text-xs text-muted-foreground">
              To correct any of these, ask your administrator — they are managed
              from the admin side.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardBody>
            {user?.mustChangePassword && (
              <Alert tone="info" className="mb-4">
                You are still signing in with the password your administrator
                issued. Setting your own is a good idea, but not required.
              </Alert>
            )}
            <PasswordForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono font-medium" : "font-medium"}>{value}</span>
    </div>
  );
}
