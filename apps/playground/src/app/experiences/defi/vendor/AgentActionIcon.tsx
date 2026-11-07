"use client";

import { DefiActionAnimation, type ScenePhase, type ActionKind, type RouteStop, type RouteAlt, type ComboStop } from "./DefiActionAnimation";

type ActionIconKind = "stake" | "unstake" | "withdraw" | "farm" | "harvest" | "compound" | "vault" | "pool" | "perp" | "trade" | "buy" | "sell" | "coin" | "mint" | "burn" | "nft" | "authorize" | "bridge";

// The agent-card STAGE: a full-bleed, phase-reactive scene (DefiActionAnimation)
// with a live status chip floating over it. EVERY action-icon kind resolves to a
// motif — the mapper (lib/txscene/action-icon.ts) is exhaustive over payloads, so
// every AgentRun / UserTxRun card gets a scene. The chip replaces the old text
// Stepper: one small label that always says what the run is doing right now,
// leaving the rest of the card to the animation.
const LIVE: Record<ActionIconKind, ActionKind> = {
  stake: "stake",
  unstake: "unstake",
  withdraw: "withdraw",
  farm: "farm",
  harvest: "harvest",
  compound: "compound",
  vault: "vault",
  pool: "pool",
  perp: "perp",
  trade: "swap",
  buy: "order",
  sell: "order",
  coin: "send",
  mint: "mint",
  burn: "burn",
  nft: "mint", // reserved kind with no current producer — mint reads closest
  authorize: "authorize",
  bridge: "bridge",
};

function toneOf(phase: ScenePhase): "idle" | "run" | "ok" | "err" {
  switch (phase) {
    case "running": return "run";
    case "settled": return "ok";
    case "failed": return "err";
    default: return "idle";
  }
}

export function AgentActionIcon({
  action,
  phase = "preview",
  side,
  lev,
  coinUrl,
  coinUrl2,
  coins,
  route,
  splits,
  alts,
  combo,
  chip,
  sponsored,
  className,
}: {
  action: ActionIconKind;
  phase?: ScenePhase;
  side?: "long" | "short";
  lev?: number;
  coinUrl?: string;
  coinUrl2?: string;
  /** ALL input coins (multiSwap): each gets its own converge lane into coinUrl2. */
  coins?: RouteStop[];
  /** Aggregator router path (swap): venue stops (name + protocol mark) the coin hops through. */
  route?: RouteStop[];
  splits?: number;
  /** Secondary parallel routes (stops + input share) drawn as rails under the main line. */
  alts?: RouteAlt[];
  /** Strategy-composer steps — the compound kind renders them as an atomic pipeline. */
  combo?: ComboStop[];
  /** Status-chip label (e.g. the active step). Omitted → no chip. */
  chip?: string;
  /** Agent runs pay no gas — show the small "Gas sponsored by SupWallet" badge. */
  sponsored?: boolean;
  className?: string;
}) {
  const kind = LIVE[action];
  return (
    <div className={`aa-stage aa-hero${className ? ` ${className}` : ""}`} data-phase={phase}>
      <DefiActionAnimation kind={kind} phase={phase} side={side} lev={lev} coinUrl={coinUrl} coinUrl2={coinUrl2} coins={coins} route={route} splits={splits} alts={alts} combo={combo} sponsored={sponsored} />
      {chip ? (
        // key on the label so each status change re-runs the pop-in animation
        <div className="aa-chip" data-tone={toneOf(phase)} key={chip}>
          <span className="aa-chip__dot" />
          <span className="aa-chip__tx">{chip}</span>
        </div>
      ) : null}
    </div>
  );
}
