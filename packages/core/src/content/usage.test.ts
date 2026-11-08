import { describe, expect, it } from "vitest";
import { addUsage } from "./parts.js";

describe("addUsage", () => {
  it("sums every field, including cache writes", () => {
    expect(
      addUsage(
        { inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedInputTokens: 4, cacheCreationInputTokens: 5, reasoningTokens: 6 },
        { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedInputTokens: 40, cacheCreationInputTokens: 50, reasoningTokens: 60 },
      ),
    ).toEqual({ inputTokens: 11, outputTokens: 22, totalTokens: 33, cachedInputTokens: 44, cacheCreationInputTokens: 55, reasoningTokens: 66 });
  });

  it("keeps 'not reported' distinct from zero", () => {
    const sum = addUsage({ inputTokens: 5 }, { outputTokens: 2 });
    expect(sum).toMatchObject({ inputTokens: 5, outputTokens: 2 });
    expect(sum.cachedInputTokens).toBeUndefined();
    expect(sum.cacheCreationInputTokens).toBeUndefined();
  });

  it("returns the first operand when there is nothing to add", () => {
    const a = { inputTokens: 1 };
    expect(addUsage(a, undefined)).toBe(a);
  });
});
