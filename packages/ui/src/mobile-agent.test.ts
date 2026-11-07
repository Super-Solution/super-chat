import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SUPERCHAT_MOBILE_AGENT_ACTIONS,
  SUPERCHAT_MOBILE_AGENT_CONTRACT_VERSION,
  SUPERCHAT_MOBILE_AGENT_LOADING,
  SUPERCHAT_MOBILE_AGENT_ORB,
  SUPERCHAT_MOBILE_AGENT_ORB_ACTIVITY,
  normalizeSuperChatMobileAgentLoadingHint,
  resolveSuperChatMobileAgentModel,
  resolveSuperChatMobileAgentStreamingPhase,
  superChatMobileAgentRingPhaseOffset,
} from "./mobile-agent";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${here}/`), "utf8");

describe("SuperChat Mobile Agent contract", () => {
  it("versions the expanded design contract", () => {
    expect(SUPERCHAT_MOBILE_AGENT_CONTRACT_VERSION).toBe(2);
  });

  it("ships one unique semantic action vocabulary", () => {
    const ids = SUPERCHAT_MOBILE_AGENT_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "open-conversations", "select-conversation", "new-conversation", "delete-conversation", "close-agent",
      "open-composer-actions", "attach-file", "attach-image", "remove-attachment", "select-skill", "remove-skill",
      "select-model", "toggle-deep-research", "voice-input", "enhance-prompt",
      "cancel-enhancement", "revert-enhancement", "send-message", "stop-response",
      "copy-message", "edit-message", "retry-response",
    ]);
    expect(SUPERCHAT_MOBILE_AGENT_ACTIONS.find((action) => action.id === "delete-conversation"))
      .toMatchObject({ destructive: true });
  });

  it("uses the same deterministic model fallback as the Web composer", () => {
    const models = [
      { id: "fast", label: "Fast", provider: "Example" },
      { id: "deep", label: "Deep", context: "200K" },
    ];
    expect(resolveSuperChatMobileAgentModel(models, "deep")?.id).toBe("deep");
    expect(resolveSuperChatMobileAgentModel(models, "missing")?.id).toBe("fast");
    expect(resolveSuperChatMobileAgentModel([], "missing")).toBeUndefined();
  });

  it("maps native activities to the three reference ring states", () => {
    expect(SUPERCHAT_MOBILE_AGENT_ORB_ACTIVITY).toEqual({
      listening: "C2",
      streaming: "C3",
      analyzing: "C4",
    });
  });

  it("normalizes bounded loading geometry for native skeletons", () => {
    expect(normalizeSuperChatMobileAgentLoadingHint({
      kind: "media",
      label: "  Generating image  ",
      count: 20,
      aspectRatio: " 16 / 9 ",
    })).toEqual({
      kind: "media",
      label: "Generating image",
      count: 10,
      aspectRatio: "16 / 9",
    });
    expect(normalizeSuperChatMobileAgentLoadingHint({ kind: "invalid" as "generic", label: "" }))
      .toEqual({ kind: "generic", label: "Preparing result", count: 1 });
  });

  it("keeps the streaming caret solid until a real quiet gap", () => {
    const input = { active: true, lastDeltaAt: 1000, now: 1419 };
    expect(resolveSuperChatMobileAgentStreamingPhase(input)).toBe("receiving");
    expect(resolveSuperChatMobileAgentStreamingPhase({ ...input, now: 1420 })).toBe("paused");
    expect(resolveSuperChatMobileAgentStreamingPhase({ ...input, active: false })).toBe("idle");
    expect(SUPERCHAT_MOBILE_AGENT_LOADING.streamingQuietMs).toBe(420);
  });

  it("keeps the checked Web Orb geometry, phases and reduced-motion frame", () => {
    expect(SUPERCHAT_MOBILE_AGENT_ORB.geometry).toEqual({
      stage: 28, glyph: 20, dot: 3, ringRadius: 8, ringCount: 8,
    });
    expect(SUPERCHAT_MOBILE_AGENT_ORB.reducedMotionOpacity).toBe(0.7);
    expect(Array.from({ length: 8 }, (_, index) => superChatMobileAgentRingPhaseOffset("C3", index)))
      .toEqual([7 / 8, 6 / 8, 5 / 8, 4 / 8, 3 / 8, 2 / 8, 1 / 8, 0]);
    expect(Array.from({ length: 8 }, (_, index) => superChatMobileAgentRingPhaseOffset("C4", index)))
      .toEqual([0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5]);

    const orb = read("./agent/Orb.tsx");
    const css = read("./styles.css");
    expect(orb).toContain("const STAGE = 28");
    expect(orb).toContain("const RING_N = 8");
    expect(orb).toContain("const RING_R = 8");
    for (const motion of Object.values(SUPERCHAT_MOBILE_AGENT_ORB.motion)) {
      expect(css).toContain(`@keyframes ${motion.animationName}`);
      expect(css).toContain(`${motion.animationName} ${motion.durationMs / 1000}s ease-in-out`);
    }
  });

  it("remains portable and is exported as its own build entry", () => {
    const source = read("./mobile-agent.ts");
    expect(source).not.toMatch(/from ["'](?:react|react-native|@super-solution)/);
    const rnSource = read("./mobile-agent-rn.ts");
    expect(rnSource).not.toMatch(/from ["'](?:react|react-native|@super-solution)/);
    const pkg = JSON.parse(read("../../package.json")) as { exports: Record<string, unknown> };
    expect(pkg.exports["./mobile-agent"]).toBeDefined();
    expect(pkg.exports["./mobile-agent/react-native"]).toBeDefined();
  });
});
