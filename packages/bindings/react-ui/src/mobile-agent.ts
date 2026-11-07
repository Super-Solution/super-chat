/**
 * Portable interaction and motion contracts for native Agent surfaces.
 *
 * This entry deliberately imports no DOM, React, React Native or animation
 * runtime. Native hosts own rendering and localization; SuperChat owns the
 * stable action vocabulary, state semantics and reference motion values.
 */

export const SUPERCHAT_MOBILE_AGENT_CONTRACT_VERSION = 2 as const;

export type SuperChatMobileAgentZone =
  | "thread"
  | "composer"
  | "message";

export type SuperChatMobileAgentControl =
  | "action"
  | "selection"
  | "toggle";

export type SuperChatMobileAgentAvailability =
  | "always"
  | "when-supported"
  | "when-idle"
  | "when-running"
  | "when-draft";

export type SuperChatMobileAgentPresentation = "direct" | "menu" | "sheet";

export interface SuperChatMobileAgentActionSpec {
  id: string;
  zone: SuperChatMobileAgentZone;
  control: SuperChatMobileAgentControl;
  availability: SuperChatMobileAgentAvailability;
  presentation: SuperChatMobileAgentPresentation;
  defaultLabel: string;
  destructive?: boolean;
}

/**
 * Canonical action order is part of the porting contract: shell actions,
 * composer choices, run lifecycle, then message actions. A native host may
 * omit an action it cannot support, but must not render a control that has no
 * visible result.
 */
export const SUPERCHAT_MOBILE_AGENT_ACTIONS = [
  { id: "open-conversations", zone: "thread", control: "action", availability: "always", presentation: "direct", defaultLabel: "Chats" },
  { id: "select-conversation", zone: "thread", control: "selection", availability: "always", presentation: "direct", defaultLabel: "Open chat" },
  { id: "new-conversation", zone: "thread", control: "action", availability: "always", presentation: "direct", defaultLabel: "New chat" },
  { id: "delete-conversation", zone: "thread", control: "action", availability: "always", presentation: "direct", defaultLabel: "Delete", destructive: true },
  { id: "close-agent", zone: "thread", control: "action", availability: "always", presentation: "direct", defaultLabel: "Close" },
  { id: "open-composer-actions", zone: "composer", control: "action", availability: "always", presentation: "direct", defaultLabel: "Add" },
  { id: "attach-file", zone: "composer", control: "action", availability: "when-supported", presentation: "menu", defaultLabel: "Attach a file" },
  { id: "attach-image", zone: "composer", control: "action", availability: "when-supported", presentation: "menu", defaultLabel: "Attach an image" },
  { id: "remove-attachment", zone: "composer", control: "action", availability: "when-supported", presentation: "direct", defaultLabel: "Remove attachment" },
  { id: "select-skill", zone: "composer", control: "selection", availability: "when-supported", presentation: "menu", defaultLabel: "Skills" },
  { id: "remove-skill", zone: "composer", control: "action", availability: "when-supported", presentation: "direct", defaultLabel: "Remove skill" },
  { id: "select-model", zone: "composer", control: "selection", availability: "when-idle", presentation: "sheet", defaultLabel: "Model" },
  { id: "toggle-deep-research", zone: "composer", control: "toggle", availability: "when-idle", presentation: "sheet", defaultLabel: "Deep research" },
  { id: "voice-input", zone: "composer", control: "action", availability: "when-supported", presentation: "direct", defaultLabel: "Voice" },
  { id: "enhance-prompt", zone: "composer", control: "action", availability: "when-draft", presentation: "direct", defaultLabel: "Improve" },
  { id: "cancel-enhancement", zone: "composer", control: "action", availability: "when-draft", presentation: "direct", defaultLabel: "Cancel" },
  { id: "revert-enhancement", zone: "composer", control: "action", availability: "when-draft", presentation: "direct", defaultLabel: "Revert" },
  { id: "send-message", zone: "composer", control: "action", availability: "when-draft", presentation: "direct", defaultLabel: "Send" },
  { id: "stop-response", zone: "composer", control: "action", availability: "when-running", presentation: "direct", defaultLabel: "Stop" },
  { id: "copy-message", zone: "message", control: "action", availability: "always", presentation: "menu", defaultLabel: "Copy" },
  { id: "edit-message", zone: "message", control: "action", availability: "always", presentation: "menu", defaultLabel: "Edit" },
  { id: "retry-response", zone: "message", control: "action", availability: "when-idle", presentation: "direct", defaultLabel: "Retry" },
] as const satisfies readonly SuperChatMobileAgentActionSpec[];

export type SuperChatMobileAgentActionId =
  (typeof SUPERCHAT_MOBILE_AGENT_ACTIONS)[number]["id"];

export function superChatMobileAgentAction(
  id: SuperChatMobileAgentActionId,
): (typeof SUPERCHAT_MOBILE_AGENT_ACTIONS)[number] {
  const action = SUPERCHAT_MOBILE_AGENT_ACTIONS.find((item) => item.id === id);
  if (!action) throw new Error(`Unknown SuperChat Mobile Agent action: ${id}`);
  return action;
}

export interface SuperChatMobileAgentModelOption {
  id: string;
  label: string;
  provider?: string;
  description?: string;
  context?: string;
}

/** Same fallback rule used by AgentInput: exact selection, then first option. */
export function resolveSuperChatMobileAgentModel(
  models: readonly SuperChatMobileAgentModelOption[],
  selectedId?: string,
): SuperChatMobileAgentModelOption | undefined {
  return models.find((model) => model.id === selectedId) ?? models[0];
}

export type SuperChatMobileAgentOrbVariant = "C2" | "C3" | "C4";
export type SuperChatMobileAgentOrbActivity =
  | "listening"
  | "streaming"
  | "analyzing";
export type SuperChatMobileAgentOrbEasing =
  | "ease-in-out"
  | "ease-out-strong";

export type SuperChatMobileAgentOrbKeyframe = Readonly<{
  offset: number;
  opacity: number;
  scale?: number;
  easingToNext?: SuperChatMobileAgentOrbEasing;
}>;

export const SUPERCHAT_MOBILE_AGENT_ORB_ACTIVITY = {
  listening: "C2",
  streaming: "C3",
  analyzing: "C4",
} as const satisfies Record<
  SuperChatMobileAgentOrbActivity,
  SuperChatMobileAgentOrbVariant
>;

export const SUPERCHAT_MOBILE_AGENT_ORB = {
  geometry: {
    stage: 28,
    glyph: 20,
    dot: 3,
    ringRadius: 8,
    ringCount: 8,
  },
  easings: {
    easeInOut: [0.42, 0, 0.58, 1],
    easeOutStrong: [0.33, 1, 0.68, 1],
  },
  reducedMotionOpacity: 0.7,
  motion: {
    C2: {
      animationName: "sc-orb-ring-pulse",
      durationMs: 2000,
      keyframes: [
        { offset: 0, opacity: 0.18, scale: 0.7, easingToNext: "ease-in-out" },
        { offset: 0.5, opacity: 1, scale: 1.15, easingToNext: "ease-in-out" },
        { offset: 1, opacity: 0.18, scale: 0.7 },
      ],
    },
    C3: {
      animationName: "sc-orb-ring-comet",
      durationMs: 1800,
      keyframes: [
        { offset: 0, opacity: 0.08, easingToNext: "ease-in-out" },
        { offset: 0.12, opacity: 1, easingToNext: "ease-out-strong" },
        { offset: 0.35, opacity: 0.5, easingToNext: "ease-in-out" },
        { offset: 0.6, opacity: 0.12, easingToNext: "ease-in-out" },
        { offset: 1, opacity: 0.08 },
      ],
    },
    C4: {
      animationName: "sc-orb-ring-stagger",
      durationMs: 1600,
      keyframes: [
        { offset: 0, opacity: 1, easingToNext: "ease-in-out" },
        { offset: 0.5, opacity: 0.15, easingToNext: "ease-in-out" },
        { offset: 1, opacity: 1 },
      ],
    },
  },
} as const;

/** Normalized equivalent of the Web Orb's negative animation delays. */
export function superChatMobileAgentRingPhaseOffset(
  variant: SuperChatMobileAgentOrbVariant,
  index: number,
): number {
  const count = SUPERCHAT_MOBILE_AGENT_ORB.geometry.ringCount;
  const normalizedIndex = ((index % count) + count) % count;
  return variant === "C4"
    ? normalizedIndex % 2 === 0
      ? 0
      : 0.5
    : (count - 1 - normalizedIndex) / count;
}

/**
 * Native mirror of a tool's predictable output geometry. Keep this shape
 * dependency-free so an RN app can consume it without importing the Web UI or
 * core runtime into its view layer.
 */
export type SuperChatMobileAgentLoadingKind =
  | "media"
  | "chart"
  | "table"
  | "document"
  | "generic";

export interface SuperChatMobileAgentLoadingHint {
  kind: SuperChatMobileAgentLoadingKind;
  label: string;
  count?: number;
  /** Portable ratio expression, for example `1024 / 1536`. */
  aspectRatio?: string;
}

export type SuperChatMobileAgentStreamingPhase =
  | "idle"
  | "receiving"
  | "paused";

export type SuperChatMobileAgentMediaPhase =
  | "loading"
  | "ready"
  | "error";

/** Values shared with the Web design, expressed without CSS assumptions. */
export const SUPERCHAT_MOBILE_AGENT_LOADING = {
  skeletonDelayMs: 200,
  shimmerDurationMs: 1200,
  mediaDecodeFadeMs: 160,
  streamingQuietMs: 420,
  caretBlinkDurationMs: 1000,
  maxPreviewCount: 10,
  genericLineCount: 2,
  documentLineCount: 4,
  chartHeight: 180,
} as const;

/**
 * Sanitizes model/tool supplied geometry before it reaches a native layout.
 * Presentation metadata must never fail a run or allocate an unbounded number
 * of placeholder views.
 */
export function normalizeSuperChatMobileAgentLoadingHint(
  hint?: Partial<SuperChatMobileAgentLoadingHint>,
): SuperChatMobileAgentLoadingHint {
  const kind: SuperChatMobileAgentLoadingKind =
    hint?.kind === "media" ||
    hint?.kind === "chart" ||
    hint?.kind === "table" ||
    hint?.kind === "document"
      ? hint.kind
      : "generic";
  const count = Math.max(
    1,
    Math.min(
      SUPERCHAT_MOBILE_AGENT_LOADING.maxPreviewCount,
      Math.floor(Number.isFinite(hint?.count) ? hint?.count ?? 1 : 1),
    ),
  );
  const label = hint?.label?.trim() || "Preparing result";

  return {
    kind,
    label,
    count,
    ...(hint?.aspectRatio?.trim()
      ? { aspectRatio: hint.aspectRatio.trim() }
      : {}),
  };
}

/**
 * A native write-head stays solid while deltas arrive and blinks only after a
 * quiet gap. RN hosts can evaluate this from their animation clock without a
 * Web timer or DOM pseudo-element.
 */
export function resolveSuperChatMobileAgentStreamingPhase(input: {
  active: boolean;
  lastDeltaAt?: number;
  now: number;
  quietMs?: number;
}): SuperChatMobileAgentStreamingPhase {
  if (!input.active) return "idle";
  if (input.lastDeltaAt === undefined) return "receiving";
  const quietMs = Math.max(0, input.quietMs ?? SUPERCHAT_MOBILE_AGENT_LOADING.streamingQuietMs);
  return input.now - input.lastDeltaAt >= quietMs ? "paused" : "receiving";
}
