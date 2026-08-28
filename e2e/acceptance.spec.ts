import { expect, test, type Locator, type Page } from "@playwright/test";
import { answerKeyXlsx, questionPaperDocx, studentsXlsx } from "./fixtures";

/**
 * The acceptance walkthrough from the plan, driven through a real browser
 * against a real database: admin sets everything up, a student sits the exam,
 * is interrupted, is let back in, submits, and both sides see the result.
 *
 * A run stamp keeps each execution's data distinct so the suite can be re-run
 * without cleaning the database first.
 */
const STAMP = Date.now().toString(36).slice(-5);
const BATCH = `E2E Batch ${STAMP}`;
const EXAM = `E2E Mock ${STAMP}`;
const STUDENT = `Arjun Test${STAMP}`;

// Carried between tests in this ordered file.
const ctx = { username: "", password: "", examId: "" };

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/** Buttons appear in both the page header and the empty state; either will do. */
function firstButton(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true }).first();
}

/**
 * A required Field renders a "*" inside its <label>, so it lands in the
 * accessible name — an exact "Batch or class" would never match
 * "Batch or class*". Anchoring still keeps "Batch or class" from also matching
 * "Batch or class name".
 */
function field(scope: Page | Locator, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}\\*?$`));
}

function dialog(page: Page) {
  return page.getByRole("dialog");
}

/**
 * Radix only wires the trigger up once React has hydrated, and a `goto` →
 * `click` on a warm dev server is quick enough to land first — the click is
 * then swallowed and the dialog never opens. Retry until it actually does.
 */
async function openDialog(page: Page, trigger: string) {
  const panel = dialog(page);
  await expect(async () => {
    await firstButton(page, trigger).click();
    await expect(panel).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return panel;
}

/** Subject tabs live in the exam header; the palette also has per-subject buttons. */
function subjectTab(page: Page, subject: string) {
  return page.locator("header").getByRole("button", { name: new RegExp(subject) });
}

test.describe.configure({ mode: "serial" });

test("admin can sign in and lands on the admin dashboard", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("rejects a wrong password without revealing whether the user exists", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect username or password.")).toBeVisible();
});

test("admin creates a batch", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/batches");
  await openDialog(page, "New batch");

  // Batches and classes are the same thing here, hence the doubled-up label.
  await field(dialog(page), "Batch or class name").fill(BATCH);
  await dialog(page).getByRole("button", { name: "Create batch" }).click();

  await expect(page.getByRole("cell", { name: BATCH, exact: true })).toBeVisible();
});

test("admin adds a student and is shown generated credentials once", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/students");
  await openDialog(page, "Add student");

  const form = dialog(page);
  // The batch comes first and the rest of the form stays disabled until it is
  // chosen, so this is the order the dialog now enforces.
  await field(form, "Batch or class").selectOption({ label: BATCH });
  await field(form, "Student name").fill(STUDENT);

  // The username is generated from the name — wait for it to populate.
  // The roll number is generated from the batch chosen above, not from the name.
  await expect(form.getByLabel("Roll number")).not.toHaveValue("", { timeout: 15_000 });

  await field(form, "Email").fill(`arjun${STAMP}@example.com`);
  await field(form, "Phone number").fill("9876543210");
  await form.getByRole("button", { name: "Add student", exact: true }).click();

  await expect(page.getByText("is ready to sign in")).toBeVisible();

  // Capture the credentials — the only moment the password exists in plaintext.
  ctx.username = (await page.getByTestId("credential-username").innerText()).trim();
  ctx.password = (await page.getByTestId("credential-password").innerText()).trim();

  expect(ctx.username.length).toBeGreaterThan(2);
  expect(ctx.password.length).toBeGreaterThanOrEqual(8);

  await page.getByRole("button", { name: "Done" }).click();

  // The list is paginated and sorted by name, so a student just added is rarely
  // on the first page — which is what the search box is for.
  await page.goto(`/admin/students?q=${encodeURIComponent(STUDENT)}`);
  await expect(page.getByRole("cell", { name: STUDENT, exact: true })).toBeVisible();
});

test("bulk upload imports valid rows and rejects a malformed one", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/students/bulk");

  await page.locator('input[name="file"]').setInputFiles({
    name: "students.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await studentsXlsx(BATCH),
  });
  await page.getByRole("button", { name: "Read the file" }).click();

  // The preview must reconcile: 3 read, 2 importable, 1 rejected.
  await expect(page.getByText("Rows read")).toBeVisible();
  await expect(page.getByText("Email is not valid")).toBeVisible();

  const importButton = page.getByRole("button", { name: /^Import 2 students?$/ });
  await expect(importButton).toBeVisible();
  await importButton.click();

  await expect(page.getByText("Import complete")).toBeVisible();
  // Same as above: found by searching rather than by being on the first page.
  await page.goto(`/admin/students?q=${encodeURIComponent("Ravi Verma")}`);
  // Not an exact name: the cell also carries the school from the spreadsheet,
  // so its accessible name is "Ravi Verma St Josephs". And .first(), because
  // re-runs leave earlier Ravi Vermas behind — this asks that one is there
  // rather than that exactly one is.
  await expect(
    page.getByRole("cell", { name: /Ravi Verma/ }).first(),
  ).toBeVisible();
});

test("admin creates an exam and uploads its paper without leaving Create Exam", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/admin/exams/new");

  // Ticking a subject is the first thing that needs React, so it doubles as the
  // hydration gate for the controlled date/time fields below.
  await pickSubject(page, "Mathematics", 2);
  await pickSubject(page, "Physics", 2);
  await expect(page.getByText(/Total:\s*4 questions/)).toBeVisible();

  await field(page, "Exam name").fill(EXAM);
  await field(page, "Batch or class").selectOption({ label: BATCH });

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  await field(page, "Exam date").fill(
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  );

  // Opened five minutes ago, closing in two hours — but never past midnight,
  // since the window is built from a single date plus two wall-clock times.
  const start = new Date(now.getTime() - 5 * 60_000);
  const midnight = new Date(now).setHours(23, 59, 0, 0);
  const end = new Date(Math.min(now.getTime() + 2 * 60 * 60_000, midnight));
  await field(page, "Opens at").fill(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
  await field(page, "Closes at").fill(`${pad(end.getHours())}:${pad(end.getMinutes())}`);
  await field(page, "Duration (minutes)").fill("30");

  await page.getByRole("button", { name: "Create exam" }).click();

  // Step 1 is saved without going anywhere: the admin stays on the create
  // screen and the upload takes over in place. The saved summary is the gate.
  await expect(page.getByText("Exam details saved")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/admin\/exams\/new$/);

  // The details they typed are shown back to them, and the exam already exists
  // as a draft they can return to.
  await expect(page.getByText(BATCH, { exact: true })).toBeVisible();
  await expect(page.getByText(/Mathematics · 2, Physics · 2 · 4 questions/)).toBeVisible();
  await expect(page.getByText(/saved as a draft/)).toBeVisible();

  // The picker's onChange is what enables the submit button, so it only counts
  // once React has hydrated.
  const readButton = page.getByRole("button", { name: "Read the documents" });
  await expect(async () => {
    await page.locator('input[name="paper"]').setInputFiles({
      name: "paper.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await questionPaperDocx(),
    });
    await expect(readButton).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page.locator('input[name="answerKey"]').setInputFiles({
    name: "key.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await answerKeyXlsx(),
  });
  await readButton.click();

  // Both [SUBJECT: …] headings understood, every question read, and the counts
  // reconcile against what the exam was created with.
  await expect(page.getByText("Questions read")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/2 found · 2 expected/)).toHaveCount(2);

  const stems = page.locator('textarea[id^="q-"]');
  await expect(stems).toHaveCount(4);
  await expect(stems.first()).toHaveValue("What is 2 + 2?");
  await expect(stems.nth(2)).toHaveValue("What is the SI unit of force?");

  // ------------------------------------------------------------- solutions
  // A paper cannot go live without worked solutions that agree with the answer
  // key. Typed here rather than asking Claude to work them out: the gate is
  // what this journey is checking, and a real solve would spend money on every
  // test run.
  const publish = page.getByRole("button", { name: "Publish to students" });
  await expect(publish, "unsolved papers must not be publishable").toBeDisabled();

  // Writing them by hand is the same route an admin takes when the API is
  // unavailable, so this covers that path too.
  const writeMyself = page.getByRole("button", { name: "Write one myself" });
  await expect(writeMyself).toHaveCount(4);
  for (let i = 3; i >= 0; i--) await writeMyself.nth(i).click();

  const workings = page.locator('textarea[id^="sol-"]');
  await expect(workings).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await workings.nth(i).fill(`Worked out step by step for question ${i + 1}.`);
    // Agree with the key: the disagreement path is covered by unit tests, and
    // this journey needs the paper to reach students.
    const keyText = await page.locator(`#sol-key-${i}`).innerText();
    const key = /Option ([ABCD])/.exec(keyText)?.[1];
    expect(key, `question ${i + 1} should have an answer key`).toBeTruthy();
    await page.locator(`select[id="sol-answer-${i}"]`).selectOption(key!);
  }

  await expect(publish).toBeEnabled();
  await publish.click();

  // Finishing the upload lands on the new exam, not in the papers section —
  // the whole job started and ended in one place.
  await expect(page.getByText(/questions are now live/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/\/admin\/exams\/(?!new$)[^/]+$/, { timeout: 20_000 });
  ctx.examId = page.url().split("/").pop()!;
  expect(ctx.examId.length).toBeGreaterThan(5);
  await expect(page.getByRole("heading", { name: EXAM })).toBeVisible();
  // "Active" everywhere now — the exam pages share one status definition.
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("4 / 4")).toBeVisible();
});

test("the question papers section lists that paper for viewing and reuse", async ({
  page,
}) => {
  await loginAsAdmin(page);

  // Papers moved out of the exams section; the old URL still has to resolve.
  await page.goto(`/admin/exams/${ctx.examId}/paper`);
  await expect(page).toHaveURL(new RegExp(`/admin/papers/${ctx.examId}$`));

  // "Question papers" lists one row per exam — a paper never exists on its own —
  // and "Preview" opens that paper's own page, where the saved questions live.
  await page.goto("/admin/papers");
  await page
    .locator("tr")
    .filter({ hasText: EXAM })
    .getByRole("link", { name: "Preview" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/admin/papers/${ctx.examId}$`));
  await expect(page.getByRole("heading", { name: EXAM })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved questions" })).toBeVisible();
});

test("student sits the exam, is locked out on re-entry, and resumes after approval", async ({
  page,
  context,
}) => {
  // Auto-save is invisible when it works and silent when it doesn't, so surface
  // any failing attempt API call rather than letting the UI look fine.
  const apiFailures: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/api/attempt/") && !response.ok()) {
      apiFailures.push(
        `${response.status()} ${response.url()} ${await response.text().catch(() => "")}`,
      );
    }
  });

  // ---------------------------------------------------------------- sign in
  await page.goto("/login");
  await page.getByLabel("Username").fill(ctx.username);
  await page.getByLabel("Password").fill(ctx.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/student\/dashboard/);

  await expect(page.getByRole("heading", { name: EXAM })).toBeVisible();
  // "Available now" is both a stat label and the card's badge; the badge is last.
  await expect(page.getByText("Available now").last()).toBeVisible();

  // ---------------------------------------------------------------- start
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\//);

  const paper = page.locator("main");

  const timer = page.getByRole("timer");
  await expect(timer).toBeVisible();
  await expect(subjectTab(page, "Mathematics")).toBeVisible();
  await expect(subjectTab(page, "Physics")).toBeVisible();
  await expect(paper.getByText("What is 2 + 2?")).toBeVisible();
  // The colour-coded palette is the other half of the JEE-style layout.
  await expect(page.getByRole("button", { name: "Mathematics question 1" })).toBeVisible();

  // The countdown only ticks once React has hydrated. Waiting for the first tick
  // guarantees the clicks below actually reach their handlers — a click landing
  // pre-hydration is silently dropped.
  const firstTick = await timer.innerText();
  await expect(timer).not.toHaveText(firstTick, { timeout: 15_000 });

  // Maths Q1: correct answer is B. Assert it registers before moving on — a
  // dropped click would otherwise look identical to a working one.
  await paper.getByRole("button", { name: /^B\b/ }).click();
  await expect(paper.getByRole("button", { name: /^B\b/ })).toHaveClass(/border-primary/);
  await page.getByRole("button", { name: "Save & Next" }).click();
  await expect(paper.getByText("What is 10 divided by 2?")).toBeVisible();

  // Maths Q2: correct answer is C, and flag it for review.
  await paper.getByRole("button", { name: /^C\b/ }).click();
  await expect(paper.getByRole("button", { name: /^C\b/ })).toHaveClass(/border-primary/);
  await page.getByRole("button", { name: /Mark for Review & Next/ }).click();
  // Marking advances to the next question, so verify via the palette: answered
  // *and* flagged is the purple-with-green-ring state.
  await expect(
    page.getByRole("button", { name: "Mathematics question 2" }),
  ).toHaveClass(/bg-review/);

  // Answers must have reached the server before the interruption below.
  expect(apiFailures, `attempt API failures:\n${apiFailures.join("\n")}`).toEqual([]);

  const examUrl = page.url();

  // ------------------------------------------------- interruption + lockout
  // Reloading stands in for the power cut: an exam may be entered only once.
  await page.goto(examUrl);
  await expect(page.getByText("This exam is already open")).toBeVisible();

  await page.getByRole("link", { name: "Back to my exams" }).click();
  await expect(page.getByText("Interrupted", { exact: true })).toBeVisible();

  // Only one way forward: Continue would just walk back into the lockout, so
  // the dashboard must not offer it here.
  await expect(page.getByRole("link", { name: "Continue" })).toHaveCount(0);

  // ---------------------------------------------------------------- request
  await page.getByRole("button", { name: "Request to resume" }).click();
  await dialog(page)
    .getByLabel("What happened?")
    .fill("The power went out at my house about five minutes into the exam.");
  await dialog(page).getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Waiting for your administrator")).toBeVisible();

  // ---------------------------------------------------------------- approve
  const adminPage = await context.browser()!.newPage();
  await loginAsAdmin(adminPage);
  await adminPage.goto("/admin/reopen-requests");
  await expect(adminPage.getByText(STUDENT)).toBeVisible();

  // Everything here is scoped to this run's own request, found by a student
  // name carrying this run's timestamp. A portal in use has other people
  // waiting, and "the first Approve button on the page" would reopen a
  // stranger's exam and hand them five extra minutes.
  const request = adminPage
    .locator("div")
    .filter({ has: adminPage.getByText(STUDENT) })
    .filter({ has: adminPage.getByRole("button", { name: "Approve", exact: true }) })
    .last();
  await expect(request.getByText(/power went out/)).toBeVisible();

  await request.getByRole("button", { name: "Approve", exact: true }).click();
  await dialog(adminPage).getByLabel("Extra time to grant (minutes)").fill("5");
  await dialog(adminPage).getByRole("button", { name: "Approve and reopen" }).click();
  // This request specifically is no longer waiting. Not "the page is empty" —
  // whether anyone else is still waiting is none of this test's business — and
  // not "the name is gone" either, since an approved request moves down into
  // the resolved list and keeps its name.
  await expect(request).toHaveCount(0);
  await adminPage.close();

  // ---------------------------------------------------------------- resume
  await page.reload();
  // Approval cleared the claim, so it is Continue and nothing else — the
  // student must not be asked to request a reopen they have already been given.
  await expect(page.getByRole("button", { name: "Request to resume" })).toHaveCount(0);
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/exam\//);

  // The saved answers survived the interruption — the point of the whole flow.
  await expect(paper.getByText("What is 2 + 2?")).toBeVisible();
  await expect(paper.getByRole("button", { name: /^B\b/ })).toHaveClass(/border-primary/);

  // ---------------------------------------------------------------- finish
  await subjectTab(page, "Physics").click();
  await expect(paper.getByText("What is the SI unit of force?")).toBeVisible();
  await paper.getByRole("button", { name: /^B\b/ }).click();
  await page.getByRole("button", { name: "Save & Next" }).click();
  await paper.getByRole("button", { name: /^C\b/ }).click();
  await page.getByRole("button", { name: "Save & Next" }).click();

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Submit your exam?")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Submit exam" }).click();

  // ---------------------------------------------------------------- result
  await expect(page).toHaveURL(/\/student\/results\//, { timeout: 20_000 });
  // All four correct: 4 × 4 = 16.
  await expect(page.getByText("16 / 16")).toBeVisible();
  await expect(page.getByText("Subject-wise breakdown")).toBeVisible();
});

test("admin sees the result, rank and question analysis", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/exams");
  await page.getByRole("link", { name: EXAM }).click();
  await page.getByRole("link", { name: "Results", exact: true }).first().click();

  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByText("Scorecard and rank")).toBeVisible();
  await expect(page.getByRole("cell", { name: STUDENT, exact: true })).toBeVisible();
  await expect(page.getByText("Question-wise analysis")).toBeVisible();

  // The Excel export must actually produce a file.
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export to Excel" }).click();
  expect((await download).suggestedFilename()).toMatch(/results\.xlsx$/);
});

test("a disabled student cannot sign in", async ({ page }) => {
  await loginAsAdmin(page);
  // Filtered rather than page one: the list is paginated and sorted by name.
  await page.goto(`/admin/students?q=${encodeURIComponent(STUDENT)}`);

  await page.getByRole("button", { name: `Disable ${STUDENT}` }).click();
  await dialog(page).getByRole("button", { name: "Disable", exact: true }).click();
  await expect(
    page.getByRole("row", { name: new RegExp(STUDENT) }).getByText("Disabled"),
  ).toBeVisible();

  // Still signed in as admin — /login would bounce straight to the dashboard.
  await page.context().clearCookies();

  await page.goto("/login");
  await page.getByLabel("Username").fill(ctx.username);
  await page.getByLabel("Password").fill(ctx.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/account has been disabled/i)).toBeVisible();
});

/**
 * Ticks a subject on the exam form and sets its question count. The checkbox is
 * React-controlled, so a click that lands before hydration is dropped without a
 * trace — retry until the box actually stays checked.
 */
async function pickSubject(page: Page, subject: string, count: number) {
  const box = page.getByRole("checkbox", { name: subject });
  await expect(async () => {
    await box.check();
    await expect(box).toBeChecked({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByLabel(`${subject} question count`).fill(String(count));
  await expect(page.getByLabel(`${subject} question count`)).toHaveValue(String(count));
}
