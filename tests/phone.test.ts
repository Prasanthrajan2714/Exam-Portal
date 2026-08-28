import { describe, expect, it } from "vitest";
import { phoneDigits, phoneError } from "@/lib/phone";

/**
 * Mobile numbers, checked while the admin still has the student in front of
 * them rather than months later when a result never arrives.
 */

describe("phoneError", () => {
  it("accepts ten digits", () => {
    expect(phoneError("9876543210")).toBeNull();
  });

  it("accepts ten digits however they are spaced or punctuated", () => {
    // Refusing an admin's formatting teaches them nothing.
    expect(phoneError("98765 43210")).toBeNull();
    expect(phoneError("98765-43210")).toBeNull();
    expect(phoneError("(98765) 43210")).toBeNull();
    expect(phoneError("+91 98765 43210")).toBeNull();
    expect(phoneError("919876543210")).toBeNull();
  });

  it("refuses fewer than ten and says how many there are", () => {
    expect(phoneError("98765432")).toContain("8 digit");
    expect(phoneError("987654321")).toContain("9 digit");
  });

  it("refuses more than ten", () => {
    expect(phoneError("98765432101")).toContain("11 digits");
  });

  it("accepts an empty value, because a number is optional", () => {
    // This is about the shape of a number that was given, not about demanding
    // one — students are added from spreadsheets that often have no phone.
    expect(phoneError("")).toBeNull();
    expect(phoneError("   ")).toBeNull();
  });

  it("counts digits, not characters", () => {
    expect(phoneError("abcdefghij")).toContain("0 digit");
  });
});

describe("phoneDigits", () => {
  it("strips everything that is not a digit", () => {
    expect(phoneDigits("+91 (98765) 43210")).toBe("9876543210");
  });

  it("drops an Indian country code", () => {
    expect(phoneDigits("919876543210")).toBe("9876543210");
  });

  it("leaves a twelve-digit number that is not a country code alone", () => {
    expect(phoneDigits("123456789012")).toBe("123456789012");
  });
});
