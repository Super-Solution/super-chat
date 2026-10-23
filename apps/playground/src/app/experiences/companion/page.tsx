"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CardSkeleton, ThinkingState } from "@super-solution/super-chat-ui";
import { ExperienceBar, FrameworkXray, MockStreamText, type ExperienceTrace } from "@/components/experience";
import { createDemoExperience, type DemoStage, type DemoExperiencePayload as DemoPayload } from "@/agent/demo-experiences";
import styles from "./companion.module.css";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5.2" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-5" },
  { id: "oneapi", label: "One API", defaultModel: "openai-compatible/model" },
] as const;

const CHECK_INS = [
  { id: "quiet", label: "Keep it quiet", prompt: "Everything feels loud today. Can we keep this quiet?" },
  { id: "steady", label: "Stay with me", prompt: "I don’t need advice. Could you just stay with me for a minute?" },
  { id: "bright", label: "Something bright", prompt: "I made it through a difficult afternoon. Help me mark that." },
] as const;
type CheckInId = (typeof CHECK_INS)[number]["id"];

const REPLIES: Record<CheckInId, string> = {
  quiet: "We can make this moment smaller. No questions and no fixing—just one slow breath. I’ll stay quiet with you.",
  steady: "I’m right here. We don’t need to solve anything before you’re ready. We can simply let this minute be enough.",
  bright: "Then let’s mark this little turn toward lighter. You showed up for yourself today, and that counts.",
};

const HEART_PATTERN = [12, 29, 48, 68, 86] as const;

function MiloAvatar({ small = false }: { small?: boolean }) {
  return <span className={small ? styles.avatarSmall : styles.avatar} aria-hidden="true">M</span>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></svg>;
}

function HeartIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2 4.6 13A5 5 0 0 1 11.5 5.8l.5.6.5-.6A5 5 0 0 1 19.4 13L12 20.2Z" /></svg>;
}

function QuietBreathCard() {
  return (
    <section
      className={styles.breathCard}
      aria-label="Breathing exercise: breathe in for four seconds, then breathe out for six seconds."
    >
      <div className={styles.breathCopy}>
        <strong>One quiet breath</strong>
        <p>No need to get it right. Follow the circle once, or simply watch.</p>
        <span>In for 4 · out for 6</span>
      </div>
      <div className={styles.breathVisual} aria-hidden="true">
        <i className={styles.breathHalo} />
        <i className={styles.breathCore} />
        <div className={styles.breathPhases}>
          <span className={styles.breatheIn}>Breathe in</span>
          <span className={styles.breatheOut}>Breathe out</span>
          <span className={styles.breatheStatic}>Slow breath</span>
        </div>
      </div>
    </section>
  );
}

function PresenceCard() {
  return (
    <section className={styles.presenceCard} aria-label="Quiet companion card">
      <div className={styles.presenceMark} aria-hidden="true"><MiloAvatar small /></div>
      <div>
        <strong>Quiet company</strong>
        <p>I’ll stay here. You don’t have to answer or make anything better.</p>
        <span><i aria-hidden="true" /> Here for the next minute</span>
      </div>
    </section>
  );
}

function KeepsakeCard({ burst, demoRun, onWarmth }: { burst: number; demoRun: number; onWarmth: () => void }) {
  return (
    <section className={styles.keepsake} aria-label="Generated keepsake">
      <div className={styles.keepsakeHead}><span>For later</span><HeartIcon /></div>
      <blockquote><MockStreamText text="You made room for yourself today. That matters." active streamKey={`${demoRun}-keepsake`} speedMs={42} /></blockquote>
      <p>From the note you chose to share</p>
      <button type="button" onClick={onWarmth}><HeartIcon /> Send a little warmth</button>
      <div className={styles.heartField} aria-hidden="true" key={burst}>{HEART_PATTERN.map((left, index) => <i key={`${burst}-${index}`} style={{ left: `${left}%`, animationDelay: `${index * 80}ms` }} />)}</div>
    </section>
  );
}

export default function CompanionExperience() {
  const [checkIn, setCheckIn] = useState<CheckInId>("steady");
  const [customPrompt, setCustomPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [burst, setBurst] = useState(0);
  const [demoRun, setDemoRun] = useState(0);
  const [demoStage, setDemoStage] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [providerIndex, setProviderIndex] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>(PROVIDERS[0].defaultModel);
  const [runData, setRunData] = useState<DemoPayload | null>(null);
  const [activeStage, setActiveStage] = useState<DemoStage | null>(null);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [apiStatus, setApiStatus] = useState<"idle" | "loading" | "playing" | "complete" | "fallback">("idle");
  const threadEnd = useRef<HTMLDivElement>(null);

  const selectedProvider = PROVIDERS[providerIndex];
  const availableModels = runData?.availableModels[selectedProvider.id] ?? [selectedProvider.defaultModel];
  const userMessage = customPrompt || CHECK_INS.find((item) => item.id === checkIn)?.prompt || "Stay with me for a minute.";
  const completedCard = checkIn === "quiet" ? "breathing-guide" : checkIn === "steady" ? "presence-card" : "keepsake";
  const trace: ExperienceTrace = {
    skill: activeStage?.skill ?? "supportive-companion",
    tools: activeStage?.tools ?? [],
    content: demoStage >= 3 ? ["text", "memory", "generated-ui"] : demoStage >= 1 ? ["text"] : [],
    card: demoStage >= 3 ? completedCard : activeStage?.card ?? "pending",
    provider: `${runData?.provider ?? selectedProvider.id} · simulated`,
    model: runData?.model ?? selectedModel,
    steps: completedSteps,
    inputTokens: activeStage?.inputTokens ?? 0,
    outputTokens: activeStage?.outputTokens ?? 0,
    duration: `${(elapsedMs / 1000).toFixed(1)}s`,
  };

  useEffect(() => {
    if (!hasStarted) return;
    const timers: number[] = [];
    setDemoStage(0);
    setIsPlaying(true);
    setActiveStage(null);
    setCompletedSteps(0);
    setElapsedMs(0);
    setApiStatus("loading");

    const schedule = (payload: DemoPayload, stages: DemoStage[]) => {
      // Give the connection and card skeleton enough time to read as an
      // intentional mock API state before the first streamed token arrives.
      let elapsed = 450;
      stages.forEach((stage, index) => {
        elapsed += stage.delayMs;
        const stageElapsed = elapsed;
        timers.push(window.setTimeout(() => {
          setActiveStage(stage);
          setCompletedSteps(index + 1);
          setElapsedMs(stageElapsed);
          setDemoStage(stage.id === "listen" ? 1 : stage.id === "remember" ? 2 : 3);
          if (stage.id === "celebrate" && checkIn === "bright") setBurst((value) => value + 1);
          if (index === stages.length - 1) { setIsPlaying(false); setApiStatus("complete"); }
        }, elapsed));
      });
      setRunData(payload);
      setApiStatus("playing");
    };

    const payload = createDemoExperience("companion", selectedProvider.id, selectedModel);
    schedule(payload, payload.stages);
    return () => { timers.forEach((timer) => window.clearTimeout(timer)); };
  }, [checkIn, demoRun, hasStarted, selectedModel, selectedProvider.id]);

  useEffect(() => {
    if (!hasStarted) return;
    threadEnd.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
  }, [demoStage, hasStarted]);

  const begin = (id: CheckInId, prompt?: string) => {
    setCheckIn(id);
    setCustomPrompt(prompt ?? "");
    setHasStarted(true);
    setDemoRun((value) => value + 1);
  };

  const sendDraft = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    begin("steady", message);
  };

  const resetDemo = () => {
    setHasStarted(false);
    setIsPlaying(false);
    setDemoStage(0);
    setRunData(null);
    setActiveStage(null);
    setCompletedSteps(0);
    setElapsedMs(0);
    setApiStatus("idle");
    setCustomPrompt("");
  };

  const thinkingLabel = apiStatus === "loading" ? "Connecting" : activeStage?.label ?? "Thinking";

  return (
    <main className={styles.page} data-experience="companion">
      <ExperienceBar current="companion" product="Milo Companion" />
      <section className={styles.app} aria-label="Milo companion chat">
        <aside className={styles.sidebar}>
          <div className={styles.sidebarBrand}><MiloAvatar /><div><strong>Milo</strong><span>your quiet companion</span></div></div>
          <button className={styles.newChat} type="button" onClick={resetDemo}>New conversation</button>
          <nav aria-label="Recent conversations">
            <strong>Recent</strong>
            <button type="button" className={styles.activeThread}>Today’s check-in</button>
            <button type="button">A hard afternoon</button>
            <button type="button">Small wins</button>
          </nav>
          <p>Memory is off in this demo.</p>
        </aside>

        <section className={styles.chatShell}>
          <header className={styles.chatHeader}>
            <div><MiloAvatar small /><span><strong>Milo</strong><small>{isPlaying ? "Responding…" : "Here with you"}</small></span></div>
            {hasStarted ? <button type="button" onClick={() => setDemoRun((value) => value + 1)}>Replay</button> : null}
          </header>

          <div className={styles.thread} aria-live="polite">
            <div className={styles.threadInner}>
              <article className={styles.assistantTurn}>
                <MiloAvatar small />
                <div className={styles.messageBody}>
                  <strong>Milo</strong>
                  <p>Hey, I’m Milo. You can tell me what this moment feels like, or choose a place to begin.</p>
                </div>
              </article>

              {!hasStarted ? (
                <div className={styles.prompts} aria-label="Conversation starters">
                  {CHECK_INS.map((item) => <button key={item.id} type="button" onClick={() => begin(item.id)}>{item.label}<span>{item.prompt}</span></button>)}
                </div>
              ) : (
                <>
                  <article className={styles.userTurn}><p>{userMessage}</p></article>
                  <article className={styles.assistantTurn}>
                    <MiloAvatar small />
                    <div className={styles.messageBody}>
                      <strong>Milo</strong>
                      {demoStage === 0 ? (
                        <>
                          <div className={styles.thinking}><ThinkingState label={thinkingLabel} /></div>
                          <div className={styles.cardLoading}><CardSkeleton lines={2} delayMs={140} /></div>
                        </>
                      ) : <p><MockStreamText text={REPLIES[checkIn]} active streamKey={`${demoRun}-reply`} /></p>}
                      {demoStage === 2 ? <div className={styles.cardLoading}><CardSkeleton lines={2} delayMs={100} /></div> : null}
                      {demoStage >= 3 && checkIn === "quiet" ? <QuietBreathCard /> : null}
                      {demoStage >= 3 && checkIn === "steady" ? <PresenceCard /> : null}
                      {demoStage >= 3 && checkIn === "bright" ? <KeepsakeCard burst={burst} demoRun={demoRun} onWarmth={() => setBurst((value) => value + 1)} /> : null}
                    </div>
                  </article>
                </>
              )}
              <div ref={threadEnd} />
            </div>
          </div>

          <footer className={styles.composerArea}>
            <div className={styles.runtimeBar}>
              <label><span>Provider</span><select value={selectedProvider.id} onChange={(event) => { const next = Math.max(0, PROVIDERS.findIndex((provider) => provider.id === event.target.value)); setProviderIndex(next); setSelectedModel(PROVIDERS[next].defaultModel); resetDemo(); }}>{PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
              <label><span>Model</span><select value={selectedModel} onChange={(event) => { setSelectedModel(event.target.value); resetDemo(); }}>{availableModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
              <div className={styles.runDetails}><FrameworkXray trace={trace} /></div>
            </div>
            <form className={styles.composer} onSubmit={sendDraft}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message Milo" aria-label="Message Milo" />
              <button type="submit" disabled={!draft.trim()} aria-label="Send message"><SendIcon /></button>
            </form>
            <p>Demo only. Nothing is saved.</p>
          </footer>
        </section>
      </section>
    </main>
  );
}
