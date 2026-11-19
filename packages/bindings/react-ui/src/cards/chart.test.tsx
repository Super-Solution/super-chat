import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChartCard } from "@supersolutions/super-chat-core";
import { ChartCardView } from "./Chart.js";

const spend: ChartCard = {
  kind: "chart",
  title: "Spend",
  xType: "category",
  series: [{ name: "Spend", type: "bar", points: [["Jul", 104_000], ["Aug", 112_000], ["Sep", 165_000]] }],
};

describe("ChartCardView", () => {
  it("labels one axis in one unit", () => {
    const html = renderToStaticMarkup(<ChartCardView spec={spend} card={{ id: "c", spec: spend }} />);
    expect(html).toContain(">150K<");
    expect(html).toContain(">50K<");
    expect(html).not.toContain("50,000");
    expect(html).not.toContain(">0K<");
  });

  it("renders a narrow layout beside the wide one for small containers", () => {
    const html = renderToStaticMarkup(<ChartCardView spec={spend} card={{ id: "c", spec: spend }} />);
    expect(html).toContain("sc-chart__plot--wide");
    expect(html).toContain("sc-chart__plot--narrow");
  });
});
