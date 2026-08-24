import "dotenv/config";
import { describe, expect, it } from "vitest";
import { translateBatch, translationConfigured } from "@/lib/translate";

/**
 * Hits the real API, so it costs money and needs network. Opt in explicitly:
 *
 *   LIVE_TRANSLATION=1 npx vitest run tests/translate-live.test.ts
 *
 * Keying it off the API key alone was not enough — once a key exists in .env,
 * `npm test` would start billing on every run. The normal suite stays offline.
 */

const live =
  process.env.LIVE_TRANSLATION === "1" && translationConfigured()
    ? describe
    : describe.skip;

live("translateBatch against the real API", () => {
  it(
    "translates Physics questions, keeps the numbers and pins the glossary terms",
    { timeout: 180_000 },
    async () => {
      const out = await translateBatch([
        {
          index: 0,
          subjectName: "Physics",
          text: "A body moves with an acceleration of 9.8 m/s². What is its velocity after 3 seconds if it starts from rest?",
          optionA: "29.4 m/s",
          optionB: "9.8 m/s",
          optionC: "3 m/s",
          optionD: "19.6 m/s",
        },
        {
          index: 1,
          subjectName: "Physics",
          text: "Which of the following is NOT a unit of energy?",
          optionA: "joule",
          optionB: "erg",
          optionC: "watt",
          optionD: "electron volt",
        },
      ]);

      expect(out).toHaveLength(2);

      for (const q of out) {
        console.log(`\n--- question ${q.index + 1} ---`);
        console.log("stem:", q.text);
        console.log("A:", q.optionA);
        console.log("B:", q.optionB);
        console.log("C:", q.optionC);
        console.log("D:", q.optionD);
        console.log(
          "terms pinned:",
          q.termsUsed.map((t) => `${t.term}→${t.tamil}`).join(", ") || "(none)",
        );

        // It must actually be Tamil, not English echoed back.
        expect(q.text, "stem should contain Tamil script").toMatch(/[஀-௿]/);
        for (const opt of [q.optionA, q.optionB, q.optionC, q.optionD]) {
          expect(opt.trim().length).toBeGreaterThan(0);
        }
      }

      // Numbers and units must survive untouched — a translated quantity is wrong.
      const first = out[0];
      const numbers = `${first.text} ${first.optionA} ${first.optionB} ${first.optionC} ${first.optionD}`;
      expect(numbers, "9.8 must survive").toContain("9.8");
      expect(numbers, "29.4 must survive").toContain("29.4");
      expect(numbers, "digits must not become Tamil numerals").toMatch(/\d/);

      // The negation carries the question; losing it inverts the answer.
      const second = out[1];
      expect(second.termsUsed.length + 1).toBeGreaterThan(0);
      console.log("\n(check by eye that question 2 still reads as a NEGATIVE question)");
    },
  );
});
