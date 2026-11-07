"use client";

import styles from "./defi.module.css";
import { AgentActionIcon } from "./vendor/AgentActionIcon";

type AgentCardKind = "compose" | "scallop" | "bluefinPerp";
type RunPhase = "proposal" | "simulated" | "executing" | "complete";

type AgentCardData = {
  title: string;
  summary: string;
  fromLabel: string;
  fromValue: string;
  toLabel: string;
  toValue: string;
  policyLabel: string;
  policyBefore: string;
  policyAfter: string;
  policyLimit: string;
  steps: string[];
};

const CARD_META: Record<AgentCardKind, { title: string; venue: string; mark: string }> = {
  compose: { title: "Agent combo", venue: "one atomic PTB", mark: "⛓" },
  scallop: { title: "Agent lend", venue: "Scallop · Sup Wallet", mark: "⊕" },
  bluefinPerp: { title: "Agent perp", venue: "Bluefin Pro · agent-signed", mark: "⇆" },
};

const LIFECYCLE: Record<AgentCardKind, string[]> = {
  compose: ["Plan", "Quote", "Build", "Submit", "Confirm"],
  scallop: ["Plan", "Build", "Submit", "Confirm"],
  bluefinPerp: ["Plan", "Place", "Confirm"],
};

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4.5 10.2 3.3 3.3 7.7-7.7" />
    </svg>
  );
}

function AgentIntent({ kind, card }: { kind: AgentCardKind; card: AgentCardData }) {
  if (kind === "compose") {
    return (
      <>
        <p className={styles.agentIntent}>Run 2 actions as one atomic strategy.</p>
        <ol className={styles.agentPlan}>
          <li>Swap {card.fromValue} into {card.toValue}</li>
          <li>Supply 35,000 USDC to the approved lending pool</li>
        </ol>
      </>
    );
  }

  if (kind === "scallop") {
    return <p className={styles.agentIntent}>Supply <span className={styles.agentChip}>{card.fromValue}</span> to earn yield in the Scallop vault.</p>;
  }

  return <p className={styles.agentIntent}><span className={styles.agentChip}>LONG</span> <span className={styles.agentChip}>SUI-PERP</span> with <span className={styles.agentChip}>250 USDC · 5×</span> isolated margin.</p>;
}

export function SupWalletAgentCard({
  kind,
  card,
  phase,
  completedSteps,
  executorEnabled,
  autoRunning,
}: {
  kind: AgentCardKind;
  card: AgentCardData;
  phase: RunPhase;
  completedSteps: number;
  executorEnabled: boolean;
  autoRunning: boolean;
}) {
  const meta = CARD_META[kind];
  const state = phase === "complete" ? "settled" : phase === "executing" ? "running" : "preview";
  const lifecycle = LIFECYCLE[kind];
  const activeIndex = phase === "complete" ? lifecycle.length : phase === "executing" ? Math.min(completedSteps, lifecycle.length - 1) : 0;
  const status = phase === "complete"
    ? "Confirmed"
    : phase === "executing"
      ? lifecycle[activeIndex]
      : "Ready to run";
  const action = kind === "compose" ? "compound" : kind === "scallop" ? "stake" : "perp";

  return (
    <section className={styles.agentCard} aria-labelledby="proposal-title">
      <header className={styles.agentCardHead}>
        <span className={styles.agentCardIcon} aria-hidden="true">{meta.mark}</span>
        <span>
          <h2 id="proposal-title">{meta.title}</h2>
          <small>{meta.venue}</small>
        </span>
      </header>

      <div className={styles.agentCardBody}>
        <AgentActionIcon
          action={action}
          phase={state}
          side={kind === "bluefinPerp" ? "long" : undefined}
          lev={kind === "bluefinPerp" ? 5 : undefined}
          combo={kind === "compose" ? [
            { label: "ETH→USDC", verb: "swap" },
            { label: "SCALLOP", verb: "in" },
          ] : undefined}
          chip={status}
          sponsored
          className={styles.agentActionStage}
        />
        <AgentIntent kind={kind} card={card} />

        <div className={styles.agentRows}>
          <div><span>{card.fromLabel}</span><strong>{card.fromValue}</strong></div>
          <div><span>{card.toLabel}</span><strong>{card.toValue}</strong></div>
          <div><span>{card.policyLabel}</span><strong>{card.policyBefore} → {card.policyAfter}</strong></div>
          <div><span>Guardrail</span><strong>{card.policyLimit}</strong></div>
        </div>

        {phase === "executing" ? (
          <div className={styles.agentStepper} aria-label="Execution progress">
            {lifecycle.map((step, index) => (
              <span key={step} data-state={index < activeIndex ? "done" : index === activeIndex ? "now" : "next"}>
                {step}
              </span>
            ))}
          </div>
        ) : null}

        {phase === "complete" ? (
          <div className={styles.agentSettled} role="status">
            <span><CheckIcon className={styles.settledCheck} />Transaction confirmed</span>
            <small>mock_7f3c…a19e</small>
          </div>
        ) : phase === "proposal" || phase === "simulated" ? (
          <button className={`${styles.agentRunButton} ${autoRunning ? styles.agentRunCounting : ""}`} type="button" disabled>
            {autoRunning ? <i aria-hidden="true" /> : null}
            <span>{executorEnabled ? "Starting agent execution…" : phase === "simulated" ? "Policy verified" : "Run with agent"}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
