"use client";

import { Loader2, Lock, User } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" /> Signing in…
        </>
      ) : (
        "Sign in"
      )}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        {/* No shadow: it would trace the image's square box, not the badge. */}
        <BrandMark size={72} eager className="mx-auto mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight">
          FirstBench Exam Portal
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with the credentials issued to you.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        {state.error && <Alert tone="danger">{state.error}</Alert>}

        <Field label="Username" htmlFor="identifier" required>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="identifier"
              name="identifier"
              autoComplete="username"
              autoFocus
              required
              placeholder="e.g. arjunkumar"
              className="pl-9"
            />
          </div>
        </Field>

        <Field label="Password" htmlFor="password" required>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className="pl-9"
            />
          </div>
        </Field>

        <SubmitButton />
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Students and administrators sign in here. Lost your password? Ask your
        administrator to reset it.
      </p>
    </div>
  );
}
