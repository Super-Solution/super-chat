import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatDelta, formatValue, STABLE_FORMAT } from "@supersolutions/super-chat-ui-core";
import { FormattedDelta, FormattedValue } from "./FormattedValue.js";

const NOON_UTC = Date.UTC(2026, 7, 3, 12);

describe("server-rendered values", () => {
  it("use the fixed format, whatever the server's own locale and time zone", () => {
    expect(renderToStaticMarkup(<FormattedValue value={NOON_UTC} format="datetime" />)).toBe(
      formatValue(NOON_UTC, "datetime", STABLE_FORMAT),
    );
    expect(renderToStaticMarkup(<FormattedValue value={28000} format="currency" />)).toBe("$28,000");
  });

  it("apply to deltas too", () => {
    expect(renderToStaticMarkup(<FormattedDelta delta={6.4} format="percent" />)).toBe(
      formatDelta(6.4, "percent", STABLE_FORMAT),
    );
  });
});
