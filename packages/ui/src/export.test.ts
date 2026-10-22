import { describe, expect, it } from "vitest";
import { threadToMarkdown } from "./export.js";
import type { Message } from "@super-solution/super-chat-core";

const msg = (role: Message["role"], parts: Message["parts"]): Message => ({ id: `${role}_1`, role, parts });

describe("threadToMarkdown", () => {
  it("renders a turn per speaker and drops the system prompt", () => {
    const md = threadToMarkdown([
      msg("system", [{ type: "text", text: "secret instructions" }]),
      msg("user", [{ type: "text", text: "hi" }]),
      msg("assistant", [{ type: "text", text: "hello" }]),
    ]);
    expect(md).not.toContain("secret instructions");
    expect(md).toContain("## You");
    expect(md).toContain("## Assistant");
  });

  it("renders a table card as a markdown table, not as JSON", () => {
    const md = threadToMarkdown([
      msg("assistant", [
        {
          type: "artifact",
          id: "c1",
          kind: "card:table",
          data: {
            spec: {
              kind: "table",
              columns: [
                { key: "n", label: "Name" },
                { key: "v", label: "Value" },
              ],
              rows: [{ n: "TVL", v: 42 }],
            },
          },
        },
      ]),
    ]);
    expect(md).toContain("| Name | Value |");
    expect(md).toContain("| TVL | 42 |");
    expect(md).not.toContain('"kind"');
  });

  it("keeps an unrecognised card's data rather than dropping it", () => {
    const md = threadToMarkdown([
      msg("assistant", [{ type: "artifact", id: "c2", kind: "card:weird", data: { spec: { kind: "weird", payload: 7 } } }]),
    ]);
    expect(md).toContain("payload");
  });

  it("reports a failed tool call and stays quiet about successful ones", () => {
    const md = threadToMarkdown([
      msg("assistant", [
        { type: "tool-result", callId: "a", name: "ok", output: { fine: true } },
        { type: "tool-result", callId: "b", name: "boom", output: {}, failure: "execution-error" },
      ]),
    ]);
    expect(md).toContain("`boom` failed: execution-error");
    expect(md).not.toContain("`ok`");
  });
});
