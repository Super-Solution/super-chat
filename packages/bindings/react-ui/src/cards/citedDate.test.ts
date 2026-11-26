import { describe, expect, it } from "vitest";
import { citedDate } from "./General.js";

describe("citedDate", () => {
  it("leaves a bare year as the year", () => {
    expect(citedDate("1980", { locale: "en-US" })).toBe("1980");
  });
  it("shows a day as a day, never as a moment, and never the day before", () => {
    expect(citedDate("1977-01-01", { locale: "en-US", timeZone: "America/Los_Angeles" })).toBe("1/1/1977");
    expect(citedDate("2024-03-05", { locale: "en-GB" })).toBe("05/03/2024");
  });
  it("still formats a real moment as a datetime", () => {
    expect(citedDate("2024-03-05T10:30:00Z", { locale: "en-US", timeZone: "UTC" })).toMatch(/10:30/);
  });
  it("hands back what it cannot read", () => {
    expect(citedDate("last spring", { locale: "en-US" })).toBe("last spring");
  });
});
