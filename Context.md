**FirstBench Online Exam Portal**

I am going to build a online exam portal, which is students going to write a online exam MCQ \- Objective pattern I will give you the details below.

First create a login page for Admin and students, in single page.

 

**Admin login**

Create a batch or create a class : First admin needs to create batch or class, eg IIT Batch, Class 6, class 7, etc…

**Add a student:** Here admin needs to add a student, Student Name, Phone number, Class details (which is above mentioned above class or batch details), email id, School name. while adding name itself Student username should be auto generate. here we need to do bulk upload also at a time we can add multiple students through excel file, give that option also and mention there itself sample file format.

**Modify or delete:** Here which is already added a student, if any modifications need like phone number change or email id change we should modify here and suppose we need to delete if any student name wrongly added means we can delete here, and one more option I need for disable, if I disable any student id means he should not get any exam or any activities.

**Create Exam:** Here have to create a exam, once I click a create exam it should open one page there, I will enter Exam name, Class or batch which is already we added it should be list here, and subjects (Math, physics, chemistry Biology) Some time if I will conduct full exam means I will select all subject like ( JEE Means – Math, Physics, Chemistry or NEET Means – Physics, Chemistry, Biology ), so I can able to select multiple subjects also if I need means. and Exam date if I click exam date means calendar should be open and I will select date, and timing this is exam timing if I select morning 9.00 am to 11.00 a.m means exam should be available on students’ portal only mentioned time, once this time over means should not allow to take a exam, after that time exam should be disabled. and exam duration if I will set exam duration time will be 30 mins means once students started exam timer also should start after 30 mins exam should be close so that exam time duration will be only 30 mins. and number of questions need to enter here eg if I am going to conduct math exam means after selecting math no of questions 20 like this I have to mention, if JEE exam means Math 20, Physics 20, Chemistry 20 like this I need to enter, and marking Pattern Each question how many marks, and each question how much have negative mark that also need to mention Eg ( Each question Correct means \+4 Marks, Wrong answer means \-1 ) like this I need mention mark pattern to creating exam.

**Upload a question paper:** Here only need to upload a question paper, if I will click the upload a question paper should open page there already which is I created above exams should be listout, then I click that already created exam there I will upload question paper which id word document file, and there itself I need to upload a answer sheet in excel file, which is .xlsx format, after submitting here this exam should be show in student portal which class we allocated to this exam that class alone should be attend this exam, and after finishing exam immediate result we can show or not that also we need to keep information there, yes means immediate result should show, No means after examination time over then only it should show.

 

**Reopen :** In this case Assume that students writing exam, while attending exam power cut or any internet issues happened student side means this exam will stopped so like this any one face this issues means they have to raise request from student portal, that request should be appear from here, so admin do validate and he will give permission means student will get access to continue from where he or she struck.

 

**Student Login**

In this login page only students will login and write a exam.

Once admin created or added a student from admin side students should get User name and Password through mail or through administrator will keep a options that will send mail or admin will give, after logging in students he or he can see if any exam added or available for their class ( Eg if already admin created Class 6th  standard for Math exam 3 hours like timing already discussed above, now 6th standard student when he login that should be available in his dash board with exam status Pending or incomplete, ih he finished means exam status should change completed. ) student while writing exam power cut or any internet interruption happened after that is not able to attend means he has to give request to admin. ) Exam should be available only once, once students started they closed and open means they cant take test admin permission needed.

 

 

 

 

 

 

 

 

 


---

# Where the build stands

*Everything above is the original brief and is left as written. Everything below
records what actually exists, as of 25 Aug 2026, so a fresh session can pick the
work up without re-deriving it. Last commit: `8230339`.*

## Running it

```
npm run dev          # http://localhost:3000  — runs `prisma generate` first, deliberately
npm test             # vitest — 155 passing, 1 skipped (the live-API translation test)
npm run e2e          # playwright — 10 passing, one full admin+student journey
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:seed      # demo batch, admin, students
```

PostgreSQL 17 runs natively on this machine. `.env` holds `DATABASE_URL` and
`ANTHROPIC_API_KEY`; it is not committed.

## Stack

Next.js 16.3.1 (Turbopack, App Router, server actions) · Prisma 7.9.1 over
`@prisma/adapter-pg`, client generated to `lib/generated/prisma` · Tailwind 4 ·
`jose` cookie sessions · bcryptjs · zod · sonner toasts · lucide icons ·
mammoth + jszip to read .docx · exceljs to read .xlsx · `docx` to emit the
template files · nodemailer · `@anthropic-ai/sdk`.

**`AGENTS.md` is not decoration.** This Next.js version has breaking changes
against the model's training data — read the relevant guide in
`node_modules/next/dist/docs/` before writing Next.js code. That block is
rewritten by `next dev` on every start; commit it rather than fighting it.

## The shape of the code

- `app/admin/*` — batches, students (incl. bulk .xlsx upload), exams, papers,
  notes, reports, reopen requests, dashboard.
- `app/student/*` — dashboard, profile, notes, results, and
  `exams/[examId]/solutions`.
- `app/exam/[attemptId]` — the exam runner itself.
- `app/api/*` — attempt autosave/submit, template downloads, upload serving,
  exports.
- `lib/*` — every rule worth testing, extracted out of the pages (see below).
- `components/ui/primitives.tsx` — the house UI: `PageHeader`, `Card`, `Table`,
  `Badge`, `EmptyState`, `Alert`, `Stat`. Match it; do not introduce a second
  visual vocabulary.

Server actions all return the `ActionResult` shape from `lib/action-result.ts`
(`ok` / `fail` / `zodFieldErrors`).

## The flow as built

Batch → students → **Create exam** (subjects and per-subject counts, marks and
negative marks, date, window, duration, **medium**) → the paper upload happens
**inside that same flow**, not on a separate page → parse .docx + answer-key
.xlsx → translate if the medium is Tamil → work out solutions → **Publish**.

**Question papers** is a list plus *Edit* and *reuse for another batch* — it is
not a second upload route. Reuse physically copies the stored images so the two
exams cannot corrupt each other.

Students see the exam only in its window, sit it once, and an interruption is
handled by a reopen request the admin approves.

## Rules that live in exactly one place

Each of these was inlined in a page once, drifted, and caused a real bug. They
are pure functions with their own tests now — extend them there, never re-inline.

- **`lib/exam-window.ts`** — `examPhase`, `isWindowOpen`, `computeDeadline`
  (never past the window), `extendDeadline` (re-bases from now when the deadline
  already slipped), `adminExamStatus` (Draft/Active/Scheduled/Closed),
  `examCardStatus`, `examCardSection` (exhaustive `switch` — a status with no
  section silently drops the card off the student's dashboard, which happened),
  `canReadSolutions`, `canShowResult`.
- **`lib/solutions.ts`** — `solutionsBlockingPublish` / `publishBlockMessage`
  gate publishing; `solveBatch` works questions out. **Both** `publishExam` and
  `publishPaper` call the gate: `publishPaper` sets the status directly and was
  otherwise an unguarded third way past it. Saving a draft is never gated.
- **`lib/glossary.ts`** — loads `Glossary/Tamil-{MATH,PHY,CHE,BIO}.md`,
  longest-match-first with containment suppression, aliases split on `" or "`.
- **`lib/translation-review.ts`** — tells a correct passthrough apart from a
  real translation miss.

## How solutions work, and why

Claude solves each question **from the question and its options alone** and is
**never shown the answer key**. That is the entire point: agreement is then real
evidence, not an echo. Any disagreement names the questions and blocks
publishing — a wrong key marks correct students down with nothing downstream to
catch it.

Model is **`claude-opus-5`**, chosen deliberately. A weaker model disagrees with
*correct* keys on hard Physics and Chemistry; the admin learns to click past the
warnings and the feature becomes worthless. Roughly $1–1.50 for a 180-question
paper, once, at publish time.

Every solution is editable, and **"Write one myself"** exists so an unreachable
API cannot leave a paper permanently unpublishable. That is also the path the
acceptance journey takes, so no test run ever spends money.

Students read the solutions once the **window** closes — the whole batch,
including those who never sat it. Keyed on the window and not the reader's own
attempt, because someone who submitted early must not read the answers while the
rest of the room is still writing.

## Tamil medium

Chosen per exam at creation and locked once questions exist. Technical terms are
pinned from the board glossary; the rest is model translation. Identity entries
(ADP → ADP) are listed separately as "keep these in English exactly".

## Traps that have already bitten

1. **Stale Prisma client — five separate times.** After a schema change the dev
   server keeps the old client and reports `Unknown argument 'x'` for a column
   that plainly exists. `npm run dev` regenerates on start; still restart the
   server after migrating.
2. **Word equations are WMF/EMF**, which no browser renders. `lib/wmf.ts`
   rasterises them through Windows GDI+ via PowerShell (Windows-only; returns
   `null` elsewhere). Display size comes from the metafile's `PhysicalDimension`,
   **not** the raster — using raster size made one inline formula fill a whole
   option.
3. **Glossary false positives.** Physics lists NOT/AND/OR as logic operators and
   "on" as a closed switch; unfiltered they put a literal "(NOT)" into real Tamil
   output. Hence `STOPWORDS`.
4. **Internal capitals mark a formula.** `PCl₃`, `NaOH`, `KMnO₄` are not
   untranslated prose; an earlier "any letter" heuristic flagged every formula
   and every numeric answer.
5. **There was no backup.** A migration of mine truncated 5 exams, 24 questions
   and 3 attempts, unrecoverably. `pg_dump` before anything destructive.
6. **Shell escaping.** `node -e` string surgery has mangled this repo more than
   once (`\p{L}` losing backslashes, `` ` `` ending a template literal). Use the
   Write/Edit tools or a real script file.

## Standing instructions from Prasanth

- **Commit locally. Push only when told.** Remote is
  `https://github.com/Prasanthrajan2714/Exam-Portal.git`.
- **API usage for translation and solutions only.** Nothing else without asking.

## Open

- *Show a student's current password* — not possible, passwords are bcrypt
  hashes. The reset-password flow stands and nothing was changed. Prasanth said
  this would be discussed later.
- Solution generation has **never been run against a real paper**; it spends his
  credit, so that first run is his to make.
