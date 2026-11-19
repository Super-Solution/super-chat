import { describe, expect, it } from "vitest";
import { formatDelta, formatValue, STABLE_FORMAT } from "./format.js";

const NOON_UTC = Date.UTC(2026, 7, 3, 12);

describe("formatValue options", () => {
  it("renders a datetime in the requested time zone and names it", () => {
    expect(formatValue(NOON_UTC, "datetime", STABLE_FORMAT)).toMatch(/^8\/3\/2026, 12:00:00\sPM UTC$/);
    expect(formatValue(NOON_UTC, "datetime", { locale: "en-US", timeZone: "Asia/Taipei" })).toMatch(/^8\/3\/2026, 8:00:00\sPM /);
  });

  it("uses the requested locale for numbers", () => {
    expect(formatValue(28000, "currency", STABLE_FORMAT)).toBe("$28,000");
    expect(formatValue(28000, "currency", { locale: "de-DE" })).toBe("$28.000");
    expect(formatValue(1234.5, "number", { locale: "de-DE" })).toBe("1.234,5");
    expect(formatValue(6.4, "percent", { locale: "de-DE" })).toBe("6,4%");
  });

  it("passes the options through a delta", () => {
    expect(formatDelta(-6.4, "percent", { locale: "de-DE" })).toBe("−6,4%");
  });
});
