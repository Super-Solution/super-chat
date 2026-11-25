import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyThread } from "./Suggestions.js";
import { LabelsProvider, zhTW } from "./labels.js";

describe("EmptyThread", () => {
  it("says what the thread is for, in the words in force", () => {
    const en = renderToString(<EmptyThread />);
    expect(en).toContain("How can I help?");
    expect(en).not.toContain("sc-suggestions");
    const zh = renderToString(<LabelsProvider labels={zhTW}><EmptyThread /></LabelsProvider>);
    expect(zh).toContain("需要什麼協助？");
  });
});
