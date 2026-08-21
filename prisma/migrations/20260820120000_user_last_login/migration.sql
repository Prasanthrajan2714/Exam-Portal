-- Records when an account last signed in, so the Students page can show who is
-- actually using the portal. Nullable: every existing account has no recorded
-- sign-in until its next one.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);
