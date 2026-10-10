import { describe, expect, it } from "vitest";
import { degreeFromText } from "@/lib/linkedin/profile-degree";

describe("connection degree from the profile badge", () => {
  it("reads the badge forms", () => {
    expect(degreeFromText("Jane Doe · 1st\nHead of Growth")).toBe(1);
    expect(degreeFromText("Jane Doe\n1st degree connection")).toBe(1);
    expect(degreeFromText("Jane Doe • 2nd")).toBe(2);
    expect(degreeFromText("3rd+")).toBe(3);
    expect(degreeFromText("1st")).toBe(1);
  });

  it("ignores a 1st that isn't the badge", () => {
    expect(degreeFromText("Sam Lee · 2nd\nPartner at 1st Round Capital")).toBe(2);
    expect(degreeFromText("Sam Lee\nPartner at 1st Round Capital\nWon 1st place")).toBeNull();
    expect(degreeFromText("Head of 1st-party data · 3rd")).toBe(3);
  });
});
