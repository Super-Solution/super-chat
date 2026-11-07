"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CardSkeleton, ThinkingState } from "@super-solution/super-chat-ui";
import {
  ExperienceBar,
  FrameworkXray,
  MockStreamText,
  type ExperienceTrace,
} from "@/components/experience";
import { createDemoExperience, DEMO_MODELS, type DemoStage as ApiStage } from "@/agent/demo-experiences";
import styles from "./legal.module.css";

type RiskId = "liability" | "indemnity" | "renewal";
type DemoStage = "ready" | "uploading" | "analyzing" | "flagged" | "card" | "failed";

type Risk = {
  id: RiskId;
  section: string;
  page: number;
  title: string;
  severity: "High" | "Medium";
  signal: string;
  current: string;
  fallback: string;
  rationale: string;
  citation: string;
};

const RISKS: Risk[] = [
  {
    id: "liability",
    section: "§ 10.1",
    page: 7,
    title: "Asymmetric liability cap",
    severity: "High",
    signal: "Vendor remedies are capped while Customer exposure is not.",
    current:
      "Vertex's aggregate liability will not exceed fees paid in the preceding three months. Customer's payment, indemnity, and confidentiality obligations are uncapped.",
    fallback:
      "Each party's aggregate liability will not exceed fees paid or payable in the preceding twelve months, subject to mutually applicable exclusions.",
    rationale:
      "A three-month cap is materially below the commercial value of the term, while the carve-outs place nearly all residual exposure on Customer.",
    citation: "Vertex MSA § 10.1, lines 171–178",
  },
  {
    id: "indemnity",
    section: "§ 8.2",
    page: 6,
    title: "Unbounded indemnity",
    severity: "High",
    signal: "No causation limit and no exclusion for indirect loss.",
    current:
      "Customer will indemnify Vertex from any and all claims, losses, damages, costs, and expenses arising from or relating to Customer's use of the Services.",
    fallback:
      "Customer will indemnify Vertex from third-party claims to the extent directly caused by Customer's material breach of this Agreement or unlawful use of the Services.",
    rationale:
      "The current clause reaches first-party and remote losses without tying recovery to breach, fault, or a third-party claim.",
    citation: "Vertex MSA § 8.2, lines 142–147",
  },
  {
    id: "renewal",
    section: "§ 13.3",
    page: 9,
    title: "Narrow non-renewal window",
    severity: "Medium",
    signal: "Notice must be delivered 90 days before renewal.",
    current:
      "The Order renews automatically for successive one-year terms unless either party gives at least ninety days' prior written notice.",
    fallback:
      "The Order renews only with written confirmation from both parties, or may be declined on thirty days' written notice before the end of the then-current term.",
    rationale:
      "The long notice window can lock the business into another annual term before budget and performance review are complete.",
    citation: "Vertex MSA § 13.3, lines 224–229",
  },
];

const PROVIDERS = [
  { id: "openai", label: "OpenAI", model: "gpt-5.2" },
  { id: "anthropic", label: "Anthropic", model: "claude-sonnet-5" },
  { id: "oneapi", label: "One API", model: "openai-compatible/model" },
] as const;

const STAGE_COPY: Record<DemoStage, string> = {
  ready: "Ready for review",
  uploading: "Reading source document",
  analyzing: "Testing clauses against counsel policy",
  flagged: "Three findings located",
  card: "Review complete",
  failed: "Demo unavailable — run again",
};

function Icon({ name }: { name: "play" | "copy" | "bookmark" | "page" | "minus" | "plus" }) {
  const paths = {
    play: <path d="m8 5 9 7-9 7Z" />,
    copy: <><rect x="8" y="8" width="10" height="11" rx="1" /><path d="M15 8V5H5v11h3" /></>,
    bookmark: <path d="M7 4h10v16l-5-3-5 3Z" />,
    page: <><path d="M7 3h8l4 4v14H7Z" /><path d="M15 3v5h4M10 12h6M10 16h6" /></>,
    minus: <path d="M6 12h12" />,
    plus: <path d="M6 12h12M12 6v12" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Clause({ risk, active, staged, enabled, onSelect }: {
  risk: Risk;
  active: boolean;
  staged: boolean;
  enabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.clause} ${active ? styles.clauseActive : ""} ${staged ? styles.clauseStaged : ""}`}
      aria-pressed={active}
      aria-label={`${risk.section}, ${risk.title}. ${staged ? "Fallback language staged." : "Open finding."}`}
      disabled={!enabled}
      onClick={onSelect}
    >
      {staged ? <><del>{risk.current}</del><ins>{risk.fallback}</ins></> : risk.current}
    </button>
  );
}

export default function LegalExperience() {
  const [stage, setStage] = useState<DemoStage>("ready");
  const [activeRiskId, setActiveRiskId] = useState<RiskId>("liability");
  const [stagedRisks, setStagedRisks] = useState<RiskId[]>([]);
  const [providerId, setProviderId] = useState<(typeof PROVIDERS)[number]["id"]>("openai");
  const [model, setModel] = useState<string>(PROVIDERS[0].model);
  const [modelCatalog, setModelCatalog] = useState(DEMO_MODELS);
  const [apiStages, setApiStages] = useState<ApiStage[]>([]);
  const [apiStageIndex, setApiStageIndex] = useState(-1);
  const [apiError, setApiError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const runController = useRef<AbortController | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const activeRisk = RISKS.find((risk) => risk.id === activeRiskId) ?? RISKS[0];
  const provider = PROVIDERS.find((option) => option.id === providerId) ?? PROVIDERS[0];
  const findingsVisible = stage === "flagged" || stage === "card";
  const briefVisible = stage === "card";
  const isRunning = stage === "uploading" || stage === "analyzing" || stage === "flagged";
  const currentApiStage = apiStageIndex >= 0 ? apiStages[apiStageIndex] : undefined;
  const activeIsStaged = stagedRisks.includes(activeRisk.id);

  useEffect(() => () => {
    runController.current?.abort();
    timers.current.forEach(clearTimeout);
  }, []);

  const trace = useMemo<ExperienceTrace>(() => {
    const visibleStages = apiStages.slice(0, Math.max(0, apiStageIndex + 1));
    const durationMs = visibleStages.reduce((total, item) => total + item.delayMs, 0);
    return {
      skill: currentApiStage?.skill ?? "contract-review",
      tools: currentApiStage?.tools ?? ["document.ingest"],
      content: briefVisible ? ["document", "annotation", "agent-card"] : ["document"],
      card: briefVisible ? currentApiStage?.card ?? "comparison" : "pending",
      provider: `${provider.label} · simulated`,
      model,
      steps: visibleStages.length,
      inputTokens: currentApiStage?.inputTokens ?? 0,
      outputTokens: currentApiStage?.outputTokens ?? 0,
      duration: `${(durationMs / 1000).toFixed(1)}s`,
    };
  }, [apiStageIndex, apiStages, briefVisible, currentApiStage, model, provider.label]);

  function wait(delayMs: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      timers.current.push(timer);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  function resetReview() {
    runController.current?.abort();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStage("ready");
    setApiStages([]);
    setApiStageIndex(-1);
    setApiError(null);
    setStagedRisks([]);
    setCopied(false);
    setActiveRiskId("liability");
  }

  async function runDemo() {
    resetReview();
    const controller = new AbortController();
    runController.current = controller;
    setStage("uploading");

    const payload = createDemoExperience("legal", providerId, model);
    setApiStages(payload.stages);
    setModelCatalog(payload.availableModels);
    for (let index = 0; index < payload.stages.length; index += 1) {
      if (controller.signal.aborted) return;
      setApiStageIndex(index);
      setStage(index === 0 ? "uploading" : index === 1 ? "analyzing" : "flagged");
      await wait(payload.stages[index].delayMs, controller.signal);
    }
    if (!controller.signal.aborted) setStage("card");
  }

  function selectProvider(id: (typeof PROVIDERS)[number]["id"]) {
    const nextProvider = PROVIDERS.find((option) => option.id === id) ?? PROVIDERS[0];
    setProviderId(nextProvider.id);
    setModel(nextProvider.model);
    resetReview();
  }

  function selectModel(nextModel: string) {
    setModel(nextModel);
    resetReview();
  }

  function selectRisk(id: RiskId) {
    setActiveRiskId(id);
    setCopied(false);
  }

  function toggleRedline() {
    setStagedRisks((current) => current.includes(activeRisk.id)
      ? current.filter((id) => id !== activeRisk.id)
      : [...current, activeRisk.id]);
  }

  async function copyBrief() {
    const brief = `${activeRisk.title}\n${activeRisk.rationale}\nFallback: ${activeRisk.fallback}\nSource: ${activeRisk.citation}`;
    try {
      await navigator.clipboard.writeText(brief);
    } catch {
      // The visible confirmation keeps the demo usable when clipboard permission is unavailable.
    }
    setCopied(true);
  }

  return (
    <div className={styles.page}>
      <ExperienceBar current="legal" product="Counsel Workspace" />

      <header className={styles.matterToolbar}>
        <div className={styles.matterField}>
          <span>Matter</span>
          <strong>Northstar Labs v. Vertex Systems</strong>
        </div>
        <div className={`${styles.matterField} ${styles.documentField}`}>
          <span>Document</span>
          <strong>Vertex MSA (v2.3) · 2026-09-01</strong>
        </div>
        <label className={styles.selectField}>
          <span>Provider</span>
          <select value={providerId} onChange={(event) => selectProvider(event.target.value as (typeof PROVIDERS)[number]["id"])}>
            {PROVIDERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className={styles.selectField}>
          <span>Model</span>
          <select value={model} onChange={(event) => selectModel(event.target.value)}>
            {(modelCatalog[providerId] ?? [model]).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className={styles.reviewFocus}>
          <span>Review focus</span>
          <strong>Risk &amp; negotiation</strong>
        </div>
        <button type="button" className={styles.runButton} onClick={() => void runDemo()} disabled={isRunning}>
          <Icon name="play" />
          {isRunning ? "Reviewing…" : briefVisible ? "Run again" : "Run review"}
        </button>
      </header>

      <main className={styles.workspace}>
        <aside className={styles.findingsPane} aria-label="Contract findings">
          <header className={styles.paneHeader}>
            <h1>Findings</h1>
            <span>{findingsVisible ? RISKS.length : 0}</span>
          </header>

          {findingsVisible ? (
            <ol className={styles.findingList}>
              {RISKS.map((risk, index) => (
                <li key={risk.id}>
                  <button
                    type="button"
                    className={risk.id === activeRiskId ? styles.findingActive : ""}
                    aria-pressed={risk.id === activeRiskId}
                    onClick={() => selectRisk(risk.id)}
                  >
                    <span className={styles.findingNumber}>{index + 1}</span>
                    <span className={styles.findingContent}>
                      <span className={styles.findingTitle}>
                        <strong>{risk.title}</strong>
                        <em className={risk.severity === "High" ? styles.high : styles.medium}>{risk.severity}</em>
                      </span>
                      <span>{risk.signal}</span>
                      <small>{risk.section} · Page {risk.page}{stagedRisks.includes(risk.id) ? " · Added to redline" : ""}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.emptyFindings}>
              <span className={styles.emptyDocument}><Icon name="page" /></span>
              <strong>{isRunning ? STAGE_COPY[stage] : "No review has been run"}</strong>
              <p>Run the local demo to locate negotiation risks in the agreement.</p>
            </div>
          )}
          <footer className={styles.findingsFooter}>{findingsVisible ? "3 findings" : "Awaiting review"}</footer>
        </aside>

        <section className={styles.documentPane} aria-label="Source document">
          <div className={styles.documentToolbar}>
            <div className={styles.pageControls}>
              <Icon name="page" />
              <span>Page 7</span>
              <span>of 12</span>
            </div>
            <div className={styles.zoomControls}>
              <button type="button" disabled aria-label="Zoom out"><Icon name="minus" /></button>
              <span>100%</span>
              <button type="button" disabled aria-label="Zoom in"><Icon name="plus" /></button>
            </div>
          </div>

          <div className={styles.documentCanvas}>
            <article className={styles.paper} aria-label="Synthetic Vertex Master Services Agreement">
              <header className={styles.paperHeader}>
                <span>Vertex Systems, Inc.</span>
                <h2>Master Services Agreement</h2>
                <p>Effective September 1, 2026</p>
              </header>

              <p className={styles.recital}>This Master Services Agreement governs Customer&apos;s access to and use of the hosted software and related professional services described in an Order Form.</p>

              <section className={styles.contractSection}>
                <h3><span>8.</span> Indemnification</h3>
                <p><b>8.1 Vendor indemnity.</b> Vertex will defend Customer against a third-party claim alleging that the Services directly infringe a United States patent or copyright.</p>
                <p><b>8.2 Customer indemnity.</b> <Clause risk={RISKS[1]} active={findingsVisible && activeRiskId === "indemnity"} staged={stagedRisks.includes("indemnity")} enabled={findingsVisible} onSelect={() => selectRisk("indemnity")} /></p>
              </section>

              <section className={styles.contractSection}>
                <h3><span>10.</span> Limitation of Liability</h3>
                <p><b>10.1 Aggregate liability.</b> <Clause risk={RISKS[0]} active={findingsVisible && activeRiskId === "liability"} staged={stagedRisks.includes("liability")} enabled={findingsVisible} onSelect={() => selectRisk("liability")} /></p>
                <p><b>10.2 Excluded damages.</b> Neither party will be liable for lost profits or consequential damages, except for Customer obligations identified above.</p>
              </section>

              <section className={styles.contractSection}>
                <h3><span>13.</span> Term and Renewal</h3>
                <p><b>13.3 Renewal.</b> <Clause risk={RISKS[2]} active={findingsVisible && activeRiskId === "renewal"} staged={stagedRisks.includes("renewal")} enabled={findingsVisible} onSelect={() => selectRisk("renewal")} /></p>
              </section>

              <footer className={styles.paperFooter}><span>Vertex Systems, Inc. · Confidential</span><span>7</span></footer>
            </article>

            {stage === "uploading" ? (
              <div className={styles.processingOverlay} aria-hidden="true">
                <span className={styles.processingDocument}><Icon name="page" /></span>
                <strong>Reading Vertex MSA</strong>
                <div><i /></div>
              </div>
            ) : null}
            {stage === "analyzing" ? <div className={styles.scanLine} aria-hidden="true" /> : null}
          </div>
        </section>

        <aside className={styles.briefPane} aria-label="Selected finding brief">
          {briefVisible ? (
            <>
              <header className={styles.briefHeader}>
                <span>Finding {RISKS.findIndex((risk) => risk.id === activeRisk.id) + 1} of {RISKS.length}</span>
                <button type="button" className={styles.bookmarkButton} aria-label="Bookmark finding"><Icon name="bookmark" /></button>
              </header>
              <div className={styles.briefBody}>
                <div className={styles.briefTitle}>
                  <h2>{activeRisk.title}</h2>
                  <em className={activeRisk.severity === "High" ? styles.high : styles.medium}>{activeRisk.severity}</em>
                </div>
                <p className={styles.citation}>{activeRisk.section} · Page {activeRisk.page}</p>

                <section className={styles.analysis}>
                  <h3>Issue</h3>
                  <p><MockStreamText text={activeRisk.signal} active streamKey={`${apiStageIndex}-${activeRisk.id}-issue`} /></p>
                  <h3>Why it matters</h3>
                  <p><MockStreamText text={activeRisk.rationale} active streamKey={`${apiStageIndex}-${activeRisk.id}-rationale`} /></p>
                </section>

                <section className={styles.paperComparison}>
                  <h3>Current paper</h3>
                  <p className={styles.currentPaper}>{activeRisk.current}</p>
                  <h3>Counsel fallback</h3>
                  <p className={styles.fallbackPaper}><MockStreamText text={activeRisk.fallback} active streamKey={`${apiStageIndex}-${activeRisk.id}-fallback`} speedMs={28} /></p>
                </section>

                <button
                  type="button"
                  className={styles.sourceLink}
                  onClick={() => document.querySelector<HTMLElement>(`[aria-label^="${activeRisk.section}"]`)?.focus()}
                >
                  {activeRisk.citation}
                </button>
              </div>
              <footer className={styles.briefActions}>
                <button type="button" className={styles.redlineButton} onClick={toggleRedline}>
                  {activeIsStaged ? "Remove from redline" : "Add to redline"}
                </button>
                <button type="button" className={styles.copyButton} onClick={() => void copyBrief()} aria-label="Copy brief">
                  <Icon name="copy" />
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </footer>
            </>
          ) : (
            <div className={styles.emptyBrief}>
              {isRunning ? (
                <div className={styles.briefLoading}>
                  <ThinkingState label={STAGE_COPY[stage]} />
                  <CardSkeleton lines={4} delayMs={160} />
                </div>
              ) : (
                <>
                  <span className={styles.emptyRule} />
                  <h2>Selected brief</h2>
                  <p>Run the review, then select a finding to inspect counsel analysis and stage a redline.</p>
                </>
              )}
            </div>
          )}
        </aside>
      </main>

      <footer className={styles.statusBar}>
        <p><i aria-hidden="true" />Local mock API · synthetic agreement · no external provider call</p>
        <div className={styles.runStatus} role="status" aria-live="polite">
          <span>{briefVisible ? "Review ready" : apiError ?? currentApiStage?.label ?? STAGE_COPY[stage]}</span>
          {stagedRisks.length > 0 ? <b>{stagedRisks.length} redline{stagedRisks.length > 1 ? "s" : ""} staged</b> : null}
        </div>
        <div className={styles.runDock}><FrameworkXray trace={trace} /></div>
      </footer>
    </div>
  );
}
