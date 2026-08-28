import { describe, expect, it } from "vitest";
import {
  academicYearError,
  batchCode,
  nextRollNumber,
  normaliseAcademicYear,
  rollNumber,
  rollPrefix,
  yearCode,
} from "@/lib/roll-number";

/**
 * Roll numbers built from a batch and the year it runs in.
 *
 * The old username came from the student's name, which said nothing about them,
 * collided between two people called the same thing, and left the second of
 * them signing in as `arjunkumar2`.
 */

describe("rollPrefix", () => {
  it("joins the batch and the year", () => {
    expect(rollPrefix("Foundation 6th", "2026-27")).toBe("f62627");
    expect(rollPrefix("NEET", "2026-27")).toBe("neet2627");
  });

  it("keeps the number that tells one class from the next", () => {
    // The whole point: F6 and F7 are different batches and must not both
    // shorten to F, or their students would share a numbering sequence.
    expect(batchCode("Foundation 6th")).toBe("f6");
    expect(batchCode("Foundation 7th")).toBe("f7");
    expect(batchCode("Class 6")).toBe("c6");
  });

  it("keeps an acronym whole, because NEET means something and N does not", () => {
    expect(batchCode("NEET")).toBe("neet");
    expect(batchCode("NEET - Repeaters")).toBe("neetr");
  });

  it("drops a long acronym to its initial rather than slicing it", () => {
    // "IITMAI" is not a word anybody would read out.
    expect(batchCode("IIT MAINS")).toBe("iitm");
  });

  it("takes initials from ordinary words", () => {
    expect(batchCode("Tech Team")).toBe("tt");
    expect(batchCode("Test Batch 1")).toBe("tb1");
  });

  it("ignores punctuation and spacing", () => {
    expect(batchCode("Class 6-B")).toBe("c6b");
    expect(batchCode("NEET — Repeaters")).toBe("neetr");
  });

  it("falls back when a batch name has nothing usable in it", () => {
    expect(batchCode("!!!")).toBe("batch");
  });

  it("leaves the year out when a batch has none", () => {
    // Every batch created before the field existed. Inventing a year would put
    // a wrong one on a mark sheet.
    expect(rollPrefix("IIT MAINS", null)).toBe("iitm");
    expect(rollPrefix("IIT MAINS", "")).toBe("iitm");
  });

  it("reads a year written either way round", () => {
    expect(yearCode("2026-27")).toBe("2627");
    expect(yearCode("2026-2027")).toBe("2627");
    expect(yearCode("2026")).toBe("26");
  });
});

describe("nextRollNumber", () => {
  it("starts at 001", () => {
    expect(nextRollNumber("iitm2627", [])).toBe("iitm2627001");
  });

  it("carries on from the highest in use", () => {
    expect(nextRollNumber("iitm2627", ["iitm2627001", "iitm2627002"])).toBe("iitm2627003");
  });

  it("does not reissue a number a departed student had", () => {
    // Counting the rows rather than reading the highest would hand 002 to a new
    // student after the old 002 left — and 002 is already on a mark sheet.
    expect(nextRollNumber("iitm2627", ["iitm2627001", "iitm2627003"])).toBe("iitm2627004");
  });

  it("ignores roll numbers from another batch or year", () => {
    expect(
      nextRollNumber("iitm2627", ["neet2627009", "iitm2526007", "iitm2627001"]),
    ).toBe("iitm2627002");
  });

  it("ignores a name that merely starts the same way", () => {
    // "iitm26270011" is not the eleventh student; the pattern is anchored.
    expect(nextRollNumber("iitm2627", ["iitm2627xyz", "iitm2627001"])).toBe("iitm2627002");
  });

  it("keeps counting past three digits", () => {
    expect(nextRollNumber("iitm2627", ["iitm2627999"])).toBe("iitm26271000");
  });

  it("pads a small number", () => {
    expect(rollNumber("iitm2627", 7)).toBe("iitm2627007");
  });
});

describe("academicYearError", () => {
  it("accepts two consecutive years, written either way", () => {
    expect(academicYearError("2026-27")).toBeNull();
    expect(academicYearError("2026-2027")).toBeNull();
    expect(academicYearError("2026 - 27")).toBeNull();
  });

  it("accepts an empty value, because the field is optional", () => {
    expect(academicYearError("")).toBeNull();
  });

  it("refuses a session that does not span consecutive years", () => {
    // "2026-29" is not a session, and finding that out from a roll number later
    // is much more expensive than saying so now.
    expect(academicYearError("2026-29")).toContain("consecutive");
    expect(academicYearError("2026-2026")).toContain("consecutive");
  });

  it("refuses anything that is not a pair of years", () => {
    expect(academicYearError("2026")).toContain("2026-27");
    expect(academicYearError("next year")).toContain("2026-27");
  });
});

describe("normaliseAcademicYear", () => {
  it("settles on one way of writing it", () => {
    expect(normaliseAcademicYear("2026-2027")).toBe("2026-27");
    expect(normaliseAcademicYear("2026 - 27")).toBe("2026-27");
    expect(normaliseAcademicYear("2026-27")).toBe("2026-27");
  });

  it("gives null for an empty value", () => {
    expect(normaliseAcademicYear("")).toBeNull();
    expect(normaliseAcademicYear("   ")).toBeNull();
  });
});
