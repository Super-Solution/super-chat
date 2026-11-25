import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelsProvider, enLabels, useLabels, zhTW } from "./labels.js";

const Probe = ({ pick }: { pick: (l: ReturnType<typeof useLabels>) => string }) => <>{pick(useLabels())}</>;

describe("labels", () => {
  it("are English with no provider", () => {
    expect(renderToString(<Probe pick={(l) => l.send} />)).toBe("Send");
  });

  it("swap the whole language, or one word, and nest", () => {
    expect(renderToString(<LabelsProvider labels={zhTW}><Probe pick={(l) => l.send} /></LabelsProvider>)).toBe("送出");
    expect(renderToString(<LabelsProvider labels={{ send: "Ask" }}><Probe pick={(l) => `${l.send}/${l.stop}`} /></LabelsProvider>)).toBe("Ask/Stop");
    expect(
      renderToString(
        <LabelsProvider labels={zhTW}>
          <LabelsProvider labels={{ send: "問" }}>
            <Probe pick={(l) => `${l.send}/${l.stop}`} />
          </LabelsProvider>
        </LabelsProvider>,
      ),
    ).toBe("問/停止");
  });

  it("merge the panel's words into the same table", () => {
    expect(renderToString(<LabelsProvider labels={{ panel: { close: "X" } }}><Probe pick={(l) => `${l.panel.close}/${l.panel.open}`} /></LabelsProvider>)).toBe("X/Open");
  });

  it("say the same things in zh-TW as in English: every key, and parameterised ones return text", () => {
    expect(Object.keys(zhTW).sort()).toEqual(Object.keys(enLabels).sort());
    expect(Object.keys(zhTW.panel).sort()).toEqual(Object.keys(enLabels.panel).sort());
    expect(Object.keys(zhTW.providerTools).sort()).toEqual(Object.keys(enLabels.providerTools).sort());
    for (const [key, value] of Object.entries(zhTW)) {
      if (typeof value !== "function") continue;
      const sample = (value as (...a: unknown[]) => string)(2, "x", "y", "z");
      expect(typeof sample, key).toBe("string");
      expect(sample, key).not.toMatch(/undefined|NaN/);
    }
  });

  it("do not leave English in the zh-TW preset where a Chinese word exists", () => {
    // A copy-paste of the English table with nothing translated would pass the key check above.
    const same = Object.entries(zhTW).filter(([k, v]) => typeof v === "string" && v === (enLabels as Record<string, unknown>)[k]);
    expect(same.map(([k]) => k)).toEqual([]);
  });
});
