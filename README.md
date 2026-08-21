# FirstBench Online Exam Portal

An MCQ examination portal for FirstBench batches and school classes. Admins
create batches, enrol students, schedule multi-subject exams and upload question
papers; students sit those exams under a timer and get auto-graded results.

Built from the specification in [`Context.md`](./Context.md).

---

## Quick start

Requires **Node 20+** and **PostgreSQL 16+**.

```bash
npm install

cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
npm run setup                 # migrate + generate + seed
npm run dev
```

Open <http://localhost:3000> and sign in as **`admin` / `admin123`**.
Change that password before anyone else can reach the server.

No local Postgres? `docker compose up -d` starts one matching `.env.example`.

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session JWT signing key — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `UPLOAD_DIR` | Where question papers and extracted images are written (default `./uploads`) |
| `SMTP_*`, `MAIL_FROM` | Credential emails. **Leave `SMTP_HOST` empty and messages print to the console** — development needs no mail server |

---

## How it works

### Admin

1. **Batches** — create "Class 6", "IIT Batch" and so on. Everything else hangs off these.
2. **Students** — add individually (username auto-generated from the name, password generated and emailed) or **bulk upload** an `.xlsx`. The bulk flow parses and validates first, shows you exactly which rows will import, and only writes when you confirm; afterwards you can download a sheet of every generated login.
3. **Create exam** — pick the batch, tick subjects (with JEE and NEET presets), set the question count per subject, the date, the availability window, the per-student duration, and the marking scheme.
4. **Question paper** — download the pre-filled `.docx` and `.xlsx` templates, fill them in, upload both. The parser reads the paper, matches it against the answer key, and shows **every question for review** before anything is saved. Diagrams pasted into Word are extracted automatically. Publish when it looks right.
5. **Results** — scorecards with subject splits, batch ranking, question-wise item analysis, and Excel export.
6. **Reopen requests** — approve or reject students whose exam was interrupted.

### Student

Sees only exams for their own batch, and only inside the scheduled window. The
exam screen is the familiar JEE/NEET layout: subject tabs, a colour-coded
question palette, mark-for-review, and a countdown. Every answer saves to the
server as it is clicked.

An exam may be entered **once**. If it is closed — power cut, dropped
connection — the student raises a resume request and an administrator approves
it; they then continue from exactly where they stopped, with every saved answer
intact and, optionally, extra time.

---

## Design notes

**The server owns the clock.** Every timing decision — whether a window is open,
how long is left, when to auto-submit — is computed server-side from stored
instants in [`lib/exam-window.ts`](./lib/exam-window.ts). The browser countdown
is a display of that value and re-syncs on every save. A tampered client clock
buys nothing.

**One attempt, enforced by the database.** `@@unique([examId, studentId])` on
`Attempt` is what actually prevents a second sitting, not application code.

**Nothing is graded twice.** `finaliseAttempt` is idempotent, so a manual submit
racing the expiry sweep cannot double-write.

**Unanswered is not wrong.** Negative marking applies only to wrong answers, so
an abandoned attempt is never pushed below zero for questions never reached.

**Parsing is never trusted.** Word documents have no reliable structure, so the
parser's output always goes to an editable review screen before it can be
published — a mis-read question is caught by a human, not discovered mid-exam.

**Answers survive the tab dying.** Auto-save uses `keepalive`, so an answer
clicked a moment before the browser closes still reaches the server.

Reusable logic lives in one place each and is called from every path:
`lib/exam-window.ts`, `lib/grading.ts`, `lib/username.ts`, `lib/mailer.ts`,
`lib/attempts.ts`.

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and serve |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit + integration tests (integration needs the database) |
| `npm run test:unit` | Pure-logic tests only |
| `npm run e2e` | Playwright acceptance journey in a real browser |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Seed subjects and the admin account |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | **Drops and rebuilds the database** |

## Testing

- **Unit** — grading (negative marking, ties, per-question overrides), exam-window arithmetic, username collisions, and both file parsers against generated fixtures.
- **Integration** — the whole pipeline against a real Postgres: parse a `.docx`, match the key, publish, start an attempt, save answers, reopen, grade, and sweep an abandoned attempt.
- **End-to-end** — Playwright drives the full acceptance journey in Chromium: admin creates everything, a student sits the exam, is locked out on re-entry, is approved, resumes with answers intact, submits, and both sides see the result.

```bash
npm test && npm run e2e
```

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma 7 with
the `pg` driver adapter · PostgreSQL · Radix primitives · ExcelJS · Mammoth.

Authentication is a small JWT-cookie implementation (`jose` + `bcryptjs`) in
[`lib/session.ts`](./lib/session.ts) and [`lib/auth.ts`](./lib/auth.ts) rather
than a framework: the portal only ever needs username-and-password, and this
keeps a beta dependency off the critical path.

## Deploying

The app is env-configured and runs anywhere Node does.

1. Point `DATABASE_URL` at a managed Postgres and set a real `AUTH_SECRET`.
2. `npm run build`, then `npm run db:deploy` and `npm start`.
3. Configure `SMTP_*` so students receive their logins.
4. **`UPLOAD_DIR` must be persistent storage.** On a platform with an ephemeral
   filesystem (Vercel and similar), question-paper images will disappear between
   deployments — swap `lib/uploads.ts` for S3 or equivalent blob storage first.
