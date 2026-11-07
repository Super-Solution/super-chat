import { describe, expect, it } from "vitest";

import {
  SUPERCHAT_MOBILE_AGENT_RN_DESIGN,
  resolveSuperChatMobileAgentRNLayout,
  resolveSuperChatMobileAgentRNSkeleton,
  resolveSuperChatMobileAgentRNWindowClass,
} from "./mobile-agent-rn";

describe("SuperChat React Native design recipes", () => {
  it("uses window classes rather than device names", () => {
    expect(resolveSuperChatMobileAgentRNWindowClass(320)).toBe("compact");
    expect(resolveSuperChatMobileAgentRNWindowClass(599)).toBe("compact");
    expect(resolveSuperChatMobileAgentRNWindowClass(600)).toBe("medium");
    expect(resolveSuperChatMobileAgentRNWindowClass(839)).toBe("medium");
    expect(resolveSuperChatMobileAgentRNWindowClass(840)).toBe("expanded");
    expect(resolveSuperChatMobileAgentRNWindowClass(Number.NaN)).toBe("compact");
  });

  it("keeps phone controls reachable and content single-column", () => {
    const ios = resolveSuperChatMobileAgentRNLayout({
      width: 320,
      height: 680,
      fontScale: 1.3,
      platform: "ios",
    });
    const android = resolveSuperChatMobileAgentRNLayout({
      width: 390,
      height: 844,
      platform: "android",
    });

    expect(ios).toMatchObject({
      windowClass: "compact",
      gutter: 12,
      touchTarget: 44,
      mediaColumns: 1,
      threadListPresentation: "screen",
      selectionPresentation: "bottom-sheet",
      keyboardBehavior: "padding",
      tablePresentation: "horizontal-scroll",
    });
    expect(android).toMatchObject({ touchTarget: 48, adjacentTouchGap: 8, keyboardBehavior: "resize" });
    expect(ios.contentMaxWidth).toBe(296);
    expect(ios.composerMaxHeight).toBeLessThanOrEqual(160);
    expect(resolveSuperChatMobileAgentRNLayout({ width: Number.NaN, platform: "ios" }).contentMaxWidth).toBe(0);
  });

  it("restructures wider windows and respects large text", () => {
    const medium = resolveSuperChatMobileAgentRNLayout({ width: 700, height: 900, platform: "ios" });
    const expandedLargeText = resolveSuperChatMobileAgentRNLayout({
      width: 1024,
      height: 768,
      fontScale: 1.4,
      platform: "android",
    });

    expect(medium).toMatchObject({ windowClass: "medium", mediaColumns: 2, threadListPresentation: "split-view" });
    expect(expandedLargeText).toMatchObject({
      windowClass: "expanded",
      mediaColumns: 2,
      selectionPresentation: "popover",
      isLandscape: true,
    });
    expect(expandedLargeText.contentMaxWidth).toBe(840);
  });

  it("turns loading hints into bounded, reduced-motion-aware RN skeletons", () => {
    const layout = resolveSuperChatMobileAgentRNLayout({ width: 390, height: 844, platform: "ios" });
    const recipe = resolveSuperChatMobileAgentRNSkeleton({
      kind: "media",
      label: "Generating images",
      count: 99,
      aspectRatio: "1024 / 1536",
    }, layout, true);

    expect(recipe).toMatchObject({
      kind: "media",
      label: "Generating images",
      count: 10,
      columns: 1,
      chartHeight: 160,
      shimmerDurationMs: 0,
      mediaDecodeFadeMs: 0,
      accessibilityRole: "progressbar",
      accessibilityLiveRegion: "polite",
    });
    expect(recipe.delayMs).toBe(200);
    expect(recipe.aspectRatio).toBeCloseTo(2 / 3);
    expect(SUPERCHAT_MOBILE_AGENT_RN_DESIGN.typography.ios.body).toBe("body");
    expect(SUPERCHAT_MOBILE_AGENT_RN_DESIGN.typography.android.body).toBe("bodyLarge");
  });
});
