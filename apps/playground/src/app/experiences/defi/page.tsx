"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CardSkeleton, ThinkingState } from "@super-solution/super-chat-ui";
import {
  ExperienceBar,
  FrameworkXray,
  MockStreamText,
  type ExperienceTrace,
} from "@/components/experience";
import {
  createDemoExperience,
  DEMO_MODELS as FALLBACK_MODELS,
  type DemoProvider,
  type DemoStage,
  type DemoExperiencePayload as DemoResponse,
} from "@/agent/demo-experiences";
import { SupWalletAgentCard } from "./SupWalletAgentCard";
import styles from "./defi.module.css";

type RunPhase = "proposal" | "simulated" | "executing" | "complete";
type AgentCardKind = "compose" | "scallop" | "bluefinPerp";

const CARD_SCENARIOS: Record<AgentCardKind, {
  menu: string; intent: string; title: string; summary: string;
  fromLabel: string; fromValue: string; toLabel: string; toValue: string;
  policyLabel: string; policyBefore: string; policyAfter: string; policyLimit: string;
  steps: string[];
}> = {
  compose: {
    menu: "Compose · rebalance", intent: "Bring volatile exposure back under the 25% policy limit.",
    title: "Rebalance volatile exposure", summary: "Sell ETH, then supply part of the USDC to the approved lending pool.",
    fromLabel: "From", fromValue: "14.20 ETH", toLabel: "Receive at least", toValue: "48,972 USDC",
    policyLabel: "Volatile exposure", policyBefore: "29.4%", policyAfter: "17.6%", policyLimit: "Limit 25%",
    steps: ["Allowance checked", "Swap submitted", "Supply submitted", "Position reconciled"],
  },
  scallop: {
    menu: "Scallop · lend", intent: "Put 500 USDC to work without leaving the approved lending policy.",
    title: "Lend USDC on Scallop", summary: "Supply 500 USDC to the Scallop lending pool and return the receipt to the vault.",
    fromLabel: "Asset", fromValue: "500 USDC", toLabel: "Destination", toValue: "Scallop pool",
    policyLabel: "Position state", policyBefore: "Idle", policyAfter: "Supplied", policyLimit: "Approved venue",
    steps: ["Balance checked", "Supply submitted", "Receipt received", "Position reconciled"],
  },
  bluefinPerp: {
    menu: "Bluefin · perp", intent: "Open a 5× SUI-PERP long with 250 USDC of isolated margin.",
    title: "Open SUI-PERP long", summary: "Use isolated margin and cap the position at the requested 5× leverage.",
    fromLabel: "Margin", fromValue: "250 USDC", toLabel: "Exposure", toValue: "1,250 USDC",
    policyLabel: "Leverage", policyBefore: "1×", policyAfter: "5×", policyLimit: "Isolated",
    steps: ["Margin checked", "Order submitted", "Fill confirmed", "Position reconciled"],
  },
};

const PROVIDER_LABELS: Record<DemoProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  oneapi: "1API",
};

const MANUAL_STAGES: DemoStage[] = [
  { id: "inspect", label: "Reading positions and policy", delayMs: 1200, skill: "portfolio-operations", tools: ["getPositions"], card: "stats", inputTokens: 860, outputTokens: 0 },
  { id: "simulate", label: "Simulating rebalance", delayMs: 1050, skill: "portfolio-operations", tools: ["getPositions", "simulateSwap"], card: "comparison", inputTokens: 1380, outputTokens: 208 },
  { id: "approve", label: "Checking execution authority", delayMs: 900, skill: "portfolio-operations", tools: ["simulateSwap", "executeSwap"], card: "confirm", inputTokens: 1720, outputTokens: 364 },
];

function ResetIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.6 7.2A6 6 0 1 1 4.2 12M4.6 7.2V3.8m0 3.4H8" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7 5 7 5-7 5V5Z" />
    </svg>
  );
}

function WalletMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="6" width="24" height="20" rx="3" />
      <path d="M4 11h24M21 16h7v6h-7a3 3 0 0 1 0-6Z" />
    </svg>
  );
}

export default function DefiExperiencePage() {
  const [phase, setPhase] = useState<RunPhase>("proposal");
  const [cardKind, setCardKind] = useState<AgentCardKind>("compose");
  const [executorEnabled, setExecutorEnabled] = useState(false);
  const [executionStep, setExecutionStep] = useState(0);
  const [provider, setProvider] = useState<DemoProvider>("openai");
  const [model, setModel] = useState("gpt-5.2");
  const [demoData, setDemoData] = useState<DemoResponse | null>(null);
  const [autoStageIndex, setAutoStageIndex] = useState(-1);
  const [autoRunning, setAutoRunning] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState("");
  const [draft, setDraft] = useState("");
  const [sentPrompt, setSentPrompt] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (!autoRunning || !demoData || autoStageIndex < 0) return;

    const stage = demoData.stages[autoStageIndex];
    if (!stage) return;

    if (stage.id === "inspect") {
      setPhase("proposal");
      setExecutorEnabled(false);
      setExecutionStep(0);
    } else if (stage.id === "simulate") {
      setPhase("simulated");
    } else if (stage.id === "approve") {
      setExecutorEnabled(true);
    }

    const timer = window.setTimeout(() => {
      if (autoStageIndex < demoData.stages.length - 1) {
        setAutoStageIndex((index) => index + 1);
        return;
      }

      setExecutionStep(1);
      setPhase("executing");
      setAutoRunning(false);
    }, stage.delayMs);

    return () => window.clearTimeout(timer);
  }, [autoRunning, autoStageIndex, demoData]);

  useEffect(() => {
    if (phase !== "executing") return;

    const timers = [
      window.setTimeout(() => setExecutionStep(2), 650),
      window.setTimeout(() => setExecutionStep(3), 1400),
      window.setTimeout(() => setExecutionStep(4), 2200),
      window.setTimeout(() => setPhase("complete"), 2900),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  useEffect(() => {
    if (!sentPrompt) return;
    threadEnd.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
  }, [autoStageIndex, phase, sentPrompt]);

  const completedSteps = phase === "complete" ? 4 : executionStep;
  function resetDemo() {
    requestController.current?.abort();
    setPhase("proposal");
    setExecutorEnabled(false);
    setExecutionStep(0);
    setAutoRunning(false);
    setAutoStageIndex(-1);
    setDemoLoading(false);
    setDemoError("");
    setSentPrompt("");
  }

  function selectProvider(nextProvider: DemoProvider) {
    resetDemo();
    setProvider(nextProvider);
    setModel((demoData?.availableModels ?? FALLBACK_MODELS)[nextProvider][0]);
    setDemoData(null);
  }

  function selectModel(nextModel: string) {
    resetDemo();
    setModel(nextModel);
    setDemoData(null);
  }

  async function runAutoDemo() {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setPhase("proposal");
    setExecutorEnabled(false);
    setExecutionStep(0);
    setAutoRunning(false);
    setAutoStageIndex(-1);
    setDemoError("");
    setDemoLoading(true);

    const data = createDemoExperience("defi", provider, model);
    setDemoData(data);
    setProvider(data.provider);
    setModel(data.model);
    setAutoStageIndex(0);
    setAutoRunning(true);
    setDemoLoading(false);
  }

  function startCard(kind: AgentCardKind) {
    const next = CARD_SCENARIOS[kind];
    setCardKind(kind);
    setSentPrompt(next.intent);
    void runAutoDemo();
  }

  function sendPrompt(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setSentPrompt(message);
    setDraft("");
    void runAutoDemo();
  }

  const controlsLocked = demoLoading || autoRunning || phase === "executing";
  const hasRunActivity = (demoData !== null && autoStageIndex >= 0) || phase !== "proposal";
  const proposalResolving = demoLoading || (autoRunning && autoStageIndex === 0);
  const conversationStarted = demoLoading || autoRunning || hasRunActivity;
  const models = (demoData?.availableModels ?? FALLBACK_MODELS)[provider];
  const manualStageIndex = phase === "proposal" ? 0 : phase === "simulated" && !executorEnabled ? 1 : 2;
  const activeStage = demoData && autoStageIndex >= 0 ? demoData.stages[autoStageIndex] : MANUAL_STAGES[manualStageIndex];
  const card = CARD_SCENARIOS[cardKind];
  const traceSteps = phase === "executing" || phase === "complete"
    ? 3 + completedSteps
    : demoData && autoStageIndex >= 0 ? autoStageIndex + 1 : manualStageIndex + 1;
  const elapsedMs = demoData && autoStageIndex >= 0
    ? demoData.stages.slice(0, autoStageIndex + 1).reduce((sum, stage) => sum + stage.delayMs, 0)
    : MANUAL_STAGES.slice(0, manualStageIndex + 1).reduce((sum, stage) => sum + stage.delayMs, 0);
  const reportedElapsedMs = hasRunActivity
    ? elapsedMs + (phase === "executing" || phase === "complete" ? 2900 : 0)
    : 0;
  const trace: ExperienceTrace = {
    skill: hasRunActivity ? activeStage.skill : "not started",
    tools: hasRunActivity
      ? phase === "executing" || phase === "complete" ? ["simulateSwap", "executeSwap"] : activeStage.tools
      : [],
    content: hasRunActivity ? ["text", "agent card"] : [],
    card: hasRunActivity ? `AgentRun.${cardKind}` : "none",
    provider: `${PROVIDER_LABELS[provider]} · simulated`,
    model,
    steps: hasRunActivity ? traceSteps : 0,
    inputTokens: hasRunActivity ? activeStage.inputTokens : 0,
    outputTokens: hasRunActivity ? phase === "complete" ? activeStage.outputTokens + 146 : activeStage.outputTokens : 0,
    duration: `${(reportedElapsedMs / 1000).toFixed(1)}s`,
  };
  const totalTokens = trace.inputTokens + trace.outputTokens;

  return (
    <div className={styles.page}>
      <ExperienceBar current="defi" product="SupWallet" />
      <section className={styles.app} aria-label="SupWallet agent chat">
        <aside className={styles.sidebar}>
          <div className={styles.sidebarBrand}><span className={styles.walletMark}><WalletMark /></span><div><strong>SupWallet</strong><span>Policy agent</span></div></div>
          <button className={styles.newChat} type="button" onClick={resetDemo}>New conversation</button>
          <nav aria-label="Recent SupWallet conversations">
            <strong>Recent</strong>
            <button className={styles.activeThread} type="button">Treasury rebalance</button>
            <button type="button">Lending policy</button>
            <button type="button">Perp risk review</button>
          </nav>
          <p>Simulation only. Nothing is signed.</p>
        </aside>

        <section className={styles.chatShell}>
          <header className={styles.chatHeader}>
            <div><span className={styles.agentMark} aria-hidden="true"><i /><i /><i /></span><span><strong>SupWallet agent</strong><small>{phase === "complete" ? "Complete" : phase === "executing" ? `Executing ${completedSteps}/4` : autoRunning || demoLoading ? "Responding…" : "Ready"}</small></span></div>
            {conversationStarted ? <button type="button" onClick={resetDemo}><ResetIcon /> New chat</button> : null}
          </header>

          <div className={styles.thread}>
            <div className={styles.threadInner}>
              <article className={styles.assistantTurn}>
                <span className={styles.agentMark} aria-hidden="true"><i /><i /><i /></span>
                <div className={styles.messageBody}>
                  <strong>SupWallet agent</strong>
                  <p>Tell me the outcome you want. I’ll turn policy, positions, and execution authority into a reviewable run.</p>
                </div>
              </article>

              {!conversationStarted ? (
                <div className={styles.prompts} aria-label="SupWallet card demos">
                  {(Object.keys(CARD_SCENARIOS) as AgentCardKind[]).map((kind) => (
                    <button key={kind} type="button" onClick={() => startCard(kind)}>
                      {CARD_SCENARIOS[kind].menu}<span>{CARD_SCENARIOS[kind].intent}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <article className={styles.userTurn}><p>{sentPrompt || card.intent}</p></article>
                  <article className={styles.assistantTurn}>
                    <span className={styles.agentMark} aria-hidden="true"><i /><i /><i /></span>
                    <div className={styles.messageBody}>
                      <strong>SupWallet agent</strong>
                      {proposalResolving ? (
                        <>
                          <div className={styles.proposalThinking}><ThinkingState label={activeStage.label} /></div>
                          <div className={styles.proposalSkeleton}><CardSkeleton lines={4} delayMs={120} /></div>
                        </>
                      ) : (
                        <>
                          <p><MockStreamText text={card.summary} active streamKey={`${demoData?.runId ?? phase}-${cardKind}`} speedMs={68} /></p>
                          <SupWalletAgentCard
                            kind={cardKind}
                            card={card}
                            phase={phase}
                            completedSteps={completedSteps}
                            executorEnabled={executorEnabled}
                            autoRunning={autoRunning}
                          />
                        </>
                      )}
                    </div>
                  </article>
                </>
              )}
              {demoError ? <p className={styles.demoError} role="alert">{demoError} Change the provider or try again.</p> : null}
              <div ref={threadEnd} aria-hidden="true" />
            </div>
          </div>

          <footer className={styles.composerArea}>
            <div className={styles.runtimeBar}>
              <label><span>Provider</span><select value={provider} disabled={controlsLocked} onChange={(event) => selectProvider(event.target.value as DemoProvider)}>{(Object.keys(PROVIDER_LABELS) as DemoProvider[]).map((option) => <option key={option} value={option}>{PROVIDER_LABELS[option]}</option>)}</select></label>
              <label><span>Model</span><select value={model} disabled={controlsLocked} onChange={(event) => selectModel(event.target.value)}>{models.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              <div className={styles.runDock}><FrameworkXray trace={trace} /></div>
            </div>
            <form className={styles.composer} onSubmit={sendPrompt}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask SupWallet" aria-label="Ask SupWallet" />
              <button type="submit" disabled={!draft.trim() || controlsLocked} aria-label="Send message"><PlayIcon /></button>
            </form>
            <p>Local mock API · no signing or broadcast</p>
          </footer>
        </section>
      </section>
    </div>
  );
}
