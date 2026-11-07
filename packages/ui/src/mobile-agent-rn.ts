/**
 * React Native design recipes for the portable Mobile Agent contract.
 *
 * This module intentionally does not import `react-native`. It returns
 * unitless layout values and semantic decisions that can be fed into
 * `StyleSheet.create`, Reanimated, or a host design system without forcing a
 * particular RN runtime or navigation library on the package.
 */

import {
  SUPERCHAT_MOBILE_AGENT_LOADING,
  normalizeSuperChatMobileAgentLoadingHint,
  type SuperChatMobileAgentLoadingHint,
  type SuperChatMobileAgentLoadingKind,
} from "./mobile-agent.js";

export const SUPERCHAT_MOBILE_AGENT_RN_CONTRACT_VERSION = 1 as const;

export type SuperChatMobileAgentRNPlatform = "ios" | "android";
export type SuperChatMobileAgentRNWindowClass =
  | "compact"
  | "medium"
  | "expanded";

export type SuperChatMobileAgentRNThreadListPresentation =
  | "screen"
  | "split-view";
export type SuperChatMobileAgentRNSelectionPresentation =
  | "bottom-sheet"
  | "popover";

export interface SuperChatMobileAgentRNLayoutInput {
  /** Current window width from `useWindowDimensions`, never a device model. */
  width: number;
  height?: number;
  platform: SuperChatMobileAgentRNPlatform;
  /** Current accessibility font scale from `useWindowDimensions`. */
  fontScale?: number;
}

export interface SuperChatMobileAgentRNLayout {
  windowClass: SuperChatMobileAgentRNWindowClass;
  isLandscape: boolean;
  gutter: number;
  contentMaxWidth: number;
  touchTarget: number;
  adjacentTouchGap: number;
  cardPaddingHorizontal: number;
  cardPaddingVertical: number;
  messageGap: number;
  userBubbleMaxWidthPercent: number;
  composerMinHeight: number;
  composerMaxHeight: number;
  mediaColumns: number;
  threadListPresentation: SuperChatMobileAgentRNThreadListPresentation;
  selectionPresentation: SuperChatMobileAgentRNSelectionPresentation;
  messageActionsPresentation: "context-menu";
  tablePresentation: "horizontal-scroll";
  keyboardBehavior: "padding" | "resize";
  safeAreaEdges: readonly ["top", "right", "bottom", "left"];
}

export interface SuperChatMobileAgentRNSkeletonRecipe {
  kind: SuperChatMobileAgentLoadingKind;
  label: string;
  delayMs: number;
  count: number;
  columns: number;
  lineCount: number;
  aspectRatio: number;
  chartHeight: number;
  shimmerDurationMs: number;
  mediaDecodeFadeMs: number;
  accessibilityRole: "progressbar";
  accessibilityLiveRegion: "polite";
}

/**
 * Native values are dp/pt and milliseconds. Typography and colors remain
 * semantic so RN hosts can map them to Dynamic Type / Material roles.
 */
export const SUPERCHAT_MOBILE_AGENT_RN_DESIGN = {
  windowBreakpoints: {
    medium: 600,
    expanded: 840,
  },
  spacing: {
    2: 2,
    4: 4,
    6: 6,
    8: 8,
    10: 10,
    12: 12,
    16: 16,
    20: 20,
    24: 24,
    32: 32,
    48: 48,
  },
  radius: {
    xs: 4,
    sm: 8,
    card: 12,
    composer: 18,
  },
  typography: {
    ios: {
      body: "body",
      ui: "subheadline",
      meta: "caption1",
      micro: "caption2",
    },
    android: {
      body: "bodyLarge",
      ui: "bodyMedium",
      meta: "labelMedium",
      micro: "labelSmall",
    },
  },
  colorRoles: [
    "background",
    "surface",
    "surfaceMuted",
    "separator",
    "text",
    "textMuted",
    "accent",
    "positive",
    "warning",
    "negative",
  ],
  motion: {
    feedbackMs: 120,
    enterMs: 240,
    panelMs: 400,
    enterTranslateY: 4,
  },
} as const;

export function resolveSuperChatMobileAgentRNWindowClass(
  width: number,
): SuperChatMobileAgentRNWindowClass {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  if (safeWidth >= SUPERCHAT_MOBILE_AGENT_RN_DESIGN.windowBreakpoints.expanded) {
    return "expanded";
  }
  if (safeWidth >= SUPERCHAT_MOBILE_AGENT_RN_DESIGN.windowBreakpoints.medium) {
    return "medium";
  }
  return "compact";
}

/**
 * Converts window dimensions into a small-screen-first composition. The
 * result restructures navigation and density instead of scaling a phone UI.
 */
export function resolveSuperChatMobileAgentRNLayout(
  input: SuperChatMobileAgentRNLayoutInput,
): SuperChatMobileAgentRNLayout {
  const width = Number.isFinite(input.width) ? Math.max(0, input.width) : 0;
  const height = Number.isFinite(input.height) ? Math.max(0, input.height ?? 0) : 0;
  const fontScale = Number.isFinite(input.fontScale) ? Math.max(1, input.fontScale ?? 1) : 1;
  const windowClass = resolveSuperChatMobileAgentRNWindowClass(width);
  const isLandscape = height > 0 && width > height;
  const gutter = windowClass === "expanded" ? 24 : windowClass === "medium" ? 20 : width < 360 ? 12 : 16;
  const availableWidth = Math.max(0, width - gutter * 2);
  const compactCanSplitMedia = (isLandscape || width >= 480) && fontScale < 1.3;
  const mediaColumns = windowClass === "expanded"
    ? fontScale >= 1.3 ? 2 : 3
    : windowClass === "medium"
      ? fontScale >= 1.3 ? 1 : 2
      : compactCanSplitMedia ? 2 : 1;
  const defaultComposerMax = windowClass === "compact" ? 160 : 180;
  const composerMaxHeight = height > 0
    ? Math.min(defaultComposerMax, Math.max(120, Math.floor(height * 0.32)))
    : defaultComposerMax;

  return {
    windowClass,
    isLandscape,
    gutter,
    contentMaxWidth: Math.min(840, availableWidth),
    touchTarget: input.platform === "android" ? 48 : 44,
    adjacentTouchGap: input.platform === "android" ? 8 : 6,
    cardPaddingHorizontal: windowClass === "compact" && width < 360 ? 12 : 16,
    cardPaddingVertical: 12,
    messageGap: 20,
    userBubbleMaxWidthPercent: windowClass === "compact" ? 88 : windowClass === "medium" ? 78 : 72,
    composerMinHeight: input.platform === "android" ? 56 : 52,
    composerMaxHeight,
    mediaColumns,
    threadListPresentation: windowClass === "compact" ? "screen" : "split-view",
    selectionPresentation: windowClass === "expanded" ? "popover" : "bottom-sheet",
    messageActionsPresentation: "context-menu",
    tablePresentation: "horizontal-scroll",
    keyboardBehavior: input.platform === "ios" ? "padding" : "resize",
    safeAreaEdges: ["top", "right", "bottom", "left"],
  };
}

function nativeAspectRatio(value?: string): number {
  if (!value) return 1;
  const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 1;
}

/** Produces the exact placeholder geometry an RN card renderer should reserve. */
export function resolveSuperChatMobileAgentRNSkeleton(
  hint: Partial<SuperChatMobileAgentLoadingHint> | undefined,
  layout: SuperChatMobileAgentRNLayout,
  reducedMotion = false,
): SuperChatMobileAgentRNSkeletonRecipe {
  const normalized = normalizeSuperChatMobileAgentLoadingHint(hint);
  const count = normalized.count ?? 1;

  return {
    kind: normalized.kind,
    label: normalized.label,
    delayMs: SUPERCHAT_MOBILE_AGENT_LOADING.skeletonDelayMs,
    count,
    columns: normalized.kind === "media" ? Math.min(count, layout.mediaColumns) : 1,
    lineCount: normalized.kind === "document"
      ? SUPERCHAT_MOBILE_AGENT_LOADING.documentLineCount
      : SUPERCHAT_MOBILE_AGENT_LOADING.genericLineCount,
    aspectRatio: nativeAspectRatio(normalized.aspectRatio),
    chartHeight: layout.windowClass === "compact" ? 160 : SUPERCHAT_MOBILE_AGENT_LOADING.chartHeight,
    shimmerDurationMs: reducedMotion ? 0 : SUPERCHAT_MOBILE_AGENT_LOADING.shimmerDurationMs,
    mediaDecodeFadeMs: reducedMotion ? 0 : SUPERCHAT_MOBILE_AGENT_LOADING.mediaDecodeFadeMs,
    accessibilityRole: "progressbar",
    accessibilityLiveRegion: "polite",
  };
}
