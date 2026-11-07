# Mobile Agent design and port contract

The Mobile Agent package carries the Web surface's interaction and visual
intent into native apps without copying DOM structure or CSS. It has two entry
points:

```ts
import {
  SUPERCHAT_MOBILE_AGENT_ACTIONS,
  SUPERCHAT_MOBILE_AGENT_LOADING,
  SUPERCHAT_MOBILE_AGENT_ORB,
  resolveSuperChatMobileAgentStreamingPhase,
} from "@super-solution/super-chat-ui/mobile-agent";

import {
  SUPERCHAT_MOBILE_AGENT_RN_DESIGN,
  resolveSuperChatMobileAgentRNLayout,
  resolveSuperChatMobileAgentRNSkeleton,
} from "@super-solution/super-chat-ui/mobile-agent/react-native";
```

Both modules contain data and pure helpers. They do not import React, React
Native, Reanimated, Expo, or a navigation library. Native hosts keep control of
rendering, localization and platform integration while sharing one tested
behavior contract.

## What is preserved from the Web design

- Stable action ids and availability rules.
- Listening (`C2`), streaming (`C3`) and analyzing (`C4`) Orb states, including
  the checked 28-unit geometry, easing, phase and reduced-motion frame.
- A 200 ms anti-flicker delay before a skeleton appears.
- Kind-specific `media`, `chart`, `table`, `document` and `generic` skeletons.
- A stable `callId` output slot from tool call to skeleton to final card.
- Media geometry reserved before the asset loads, followed by a 160 ms decode
  fade or an immediate reveal under Reduce Motion.
- A streaming caret that stays solid while deltas arrive and starts blinking
  only after a real 420 ms quiet gap.

The native implementation must not reproduce CSS gradients, pseudo-elements,
HTML media controls or desktop popovers. Those are implementation details, not
the design.

## React Native layout

Resolve layout from the current window, not a device name. This handles phone
rotation, iPad Split View, Android multi-window and foldables with the same
code:

```tsx
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveSuperChatMobileAgentRNLayout } from
  "@super-solution/super-chat-ui/mobile-agent/react-native";

function useAgentLayout() {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = resolveSuperChatMobileAgentRNLayout({
    width: window.width,
    height: window.height,
    fontScale: window.fontScale,
    platform: Platform.OS === "android" ? "android" : "ios",
  });
  return { layout, insets };
}
```

The resolver uses three content-driven window classes:

| Window width | Structure |
| --- | --- |
| `< 600` compact | One thread screen, one media column by default, model and skill choices in bottom sheets |
| `600–839` medium | Thread list and detail split view, two media columns when text scale permits |
| `≥ 840` expanded | Capped 840-unit reading column, split view, popovers for anchored selection, up to three media columns |

Large text reduces media density before it can clip labels. Compact landscape
may use two media columns when the content still has room. Tables and code stay
complete inside horizontal `ScrollView`s; core functionality is never hidden
to make the phone layout fit.

Apply every safe-area edge. Keep the composer above the IME with `padding` on
iOS and resize/inset handling on Android. The returned 44 pt iOS and 48 dp
Android targets are minimum hit areas, not icon sizes. Thread navigation is a
native screen on compact windows and a split view on wider windows. Message
actions belong in the platform context menu; model, skill and attachment
selection use a bottom sheet until an expanded window can support a popover.

Typography and color values are semantic by design:

- map iOS roles to Dynamic Type and semantic system colors;
- map Android roles to the Material 3 type scale and color roles;
- leave `allowFontScaling` enabled and test at 1.3× font scale;
- use SF Symbols on iOS and Material Symbols on Android;
- preserve system Back, iOS edge-swipe Back and Android predictive Back.

## RN module boundaries

A native implementation should remain small and replaceable:

| Module | Responsibility |
| --- | --- |
| `AgentThreadScreen` | Safe area, native navigation, inverted or anchored message list, keyboard coordination |
| `AgentMessage` | Selectable text, user bubble, assistant prose, platform context-menu actions |
| `LiveToolOutput` | One wrapper keyed by `callId`; swaps skeleton for the correlated card without moving it |
| `AgentCardSkeleton` | Renders the resolved media/chart/table/document/generic recipe after `delayMs` |
| `AgentMediaCard` | Reserves numeric `aspectRatio`, reveals on `Image.onLoad` or player readiness, exposes a recovery action on error |
| `AgentComposer` | Multiline input, attachments, one primary send/stop action, bottom-sheet selectors, IME-safe submission |
| `AgentOrb` | One shared animation clock with per-dot phase; static reduced-motion frame |

Interactive cards such as confirm, choice and form are never collapsed or
replaced by a skeleton after they arrive. A hidden decision is an unreachable
decision.

## Skeletons and media

Convert the host/core loading hint once, then render from the recipe:

```tsx
const recipe = resolveSuperChatMobileAgentRNSkeleton(
  { kind: "media", label: "Generating images", count: 2, aspectRatio: "4 / 3" },
  layout,
  reduceMotionEnabled,
);

// Keep this wrapper mounted for the entire tool lifecycle.
<View key={callId} accessibilityLiveRegion={recipe.accessibilityLiveRegion}>
  {card ? <AgentCard card={card} /> : <AgentCardSkeleton recipe={recipe} />}
</View>;
```

Do not mount the skeleton until `delayMs` elapses; quick tools should complete
without flashing a placeholder. Animate only transform/opacity with one shared
clock. When `shimmerDurationMs` or `mediaDecodeFadeMs` is zero, render the same
geometry without motion. Announce the visible label once and mark decorative
bars inaccessible so screen readers do not traverse them.

For media, parse the portable ratio through the RN recipe and set the container
`aspectRatio` before starting the request. Images become ready on `onLoad`, not
merely when a URL is assigned. Audio and video should use the host's native
player and become ready from its metadata/readiness callback. An error keeps
the reserved frame and shows a concise retry or open action; it must not
collapse the thread.

## Streaming text

Record the timestamp of the most recent text delta and resolve the visual phase
from the animation clock:

```ts
const phase = resolveSuperChatMobileAgentStreamingPhase({
  active: run.status === "running",
  lastDeltaAt,
  now: Date.now(),
});
```

Render a small native `View` after the text as the write-head. `receiving` is
solid, `paused` blinks on the 1000 ms cycle, and `idle` removes it. Under Reduce
Motion, keep a solid caret for both live phases. Before any text exists, show
the truthful thinking/tool state instead of an empty caret.

## Action and model behavior

An unsupported action is omitted. If a product needs to advertise a future
capability, render it explicitly disabled with visible status; never ship a
control whose tap has no result. Model lists remain host supplied and selected
model fallback is exact id first, then the first available model.

Destructive actions use the platform confirmation surface. Selection actions
use native sheets or popovers according to the RN layout recipe. Direct actions
must provide immediate pressed feedback and a visible result.

## Orb implementation

Drive one linear shared clock for an Orb cycle and apply each keyframe's easing
only within its interval. `superChatMobileAgentRingPhaseOffset` replaces the
Web implementation's negative animation delays. When Reduce Motion is enabled,
stop the clock and render every dot at `reducedMotionOpacity`.

The contract is small enough to mirror into a native repository. If an app
cannot consume the package directly, keep a parity test against both entry
points and their contract version constants.
