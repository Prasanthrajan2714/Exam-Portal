import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // `server-only` throws unless imported from a React Server Component. The
      // modules under test are server modules, so stub it out to exercise them
      // directly.
      "server-only": path.join(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: [path.join(root, "tests/setup-env.ts")],
    // The integration suite writes to a real database; keep files serial so two
    // of them can never interleave against the same rows.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
