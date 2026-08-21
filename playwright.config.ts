import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end acceptance tests. These run against a real dev server and a real
 * database — they are the proof that the admin and student journeys actually
 * work in a browser, not just that the modules typecheck.
 */
export default defineConfig({
  testDir: "./e2e",
  // The journey is a single ordered story (create batch → student → exam →
  // paper → sit it → results), so it must not be parallelised or retried.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
