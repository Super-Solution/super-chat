import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelsProvider, zhTW } from "../labels.js";
import { Thinking, thinkingLines } from "./Thinking.js";

describe("thinkingLines", () => {
  it("keeps a short paragraph whole and splits a long English one into sentences", () => {
    expect(thinkingLines("Short thought.\n\nAnother one.")).toEqual(["Short thought.", "Another one."]);
    const long = Array.from({ length: 8 }, (_, i) => `This is sentence number ${i} of a long paragraph.`).join(" ");
    const lines = thinkingLines(long);
    expect(lines.length).toBe(8);
    expect(lines[0]).toBe("This is sentence number 0 of a long paragraph.");
  });

  it("splits Chinese at its own full stop, and counts a Chinese character as two wide", () => {
    // 100 characters is 200 columns wide: past the point where one line would clamp.
    const zh = Array.from({ length: 5 }, (_, i) => `第${i}個想法是先確認使用者真正想問的是什麼問題。`).join("");
    const lines = thinkingLines(zh);
    expect(lines.length).toBe(5);
    for (const line of lines) expect(line.endsWith("。")).toBe(true);
    // 70 characters would be "short" by count alone but is 140 columns: still one line, not split.
    const medium = "這是一段不到八十個字的短想法，".repeat(4);
    expect(thinkingLines(medium)).toEqual([medium]);
  });
});

describe("Thinking labels", () => {
  it("say the time spent in the words in force", () => {
    expect(renderToString(<Thinking text="Considering." elapsedMs={3000} />)).toContain("for 3s");
    const html = renderToString(
      <LabelsProvider labels={zhTW}>
        <Thinking text="想一下。" elapsedMs={3000} />
      </LabelsProvider>,
    );
    expect(html).toContain("已思考");
    expect(html).toContain("3 秒");
    expect(html).toContain("展開或收合思考過程");
  });
});
