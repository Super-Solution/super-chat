"use client";

// Agent surfaces panel — the chat-side components, shown live.
//
// Everything here is driven by real props rather than baked-in demo markup, so
// what you see is what the Thread renders when a run produces the same state.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AgentInput,
  CodeBlock,
  HELIX_VARIANTS,
  LATTICE_VARIANTS,
  LENS_VARIANTS,
  MORPH_VARIANTS,
  ORB_TASKS,
  Orb,
  PlanProgress,
  RING_VARIANTS,
  StreamingText,
  Thinking,
  ThinkingState,
  TodoList,
  type AgentAttachment,
  type OrbVariant,
  type TodoItem,
} from "@super-solution/super-chat-ui";
import { PanelHeader } from "@/components/Shell";

const REASONING = [
  "Reading the request and the current selection, then locating the jwt.verify call inside the auth middleware.",
  "The verify call sets no algorithms allowlist, so a token signed with 'none' or a weak cipher could be accepted.",
  "Tracing where the signing secret is loaded from and confirming it is never logged or sent back to the client.",
  "Planning to pin the algorithm to HS256 and to validate the issuer and audience claims on every incoming request.",
  "Scanning the existing tests around the middleware so the fix stays covered and nothing downstream regresses.",
  "Drafting the patch with a focused regression test that rejects tampered, expired, and unsigned tokens.",
];

const ANSWER =
  "Generating your release notes for v2.4 — summarising the 28 merged pull requests, grouping the changes by area, and flagging anything that needs a migration note before the tag goes out.";

const SAMPLE_CODE = `export const sum = (a: number, b: number) =>
  a + b;

export const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);`;

const TODO_LABELS = [
  "Scaffold the project structure",
  "Build the component registry",
  "Implement entitlement gating",
  "Wire up Stripe checkout",
  "Polish the landing page",
];

/**
 * Resolve after `ms`, but reject early if `signal` aborts — checking
 * `signal.aborted` only after the full wait already elapsed would mean
 * cancelling never actually shortens it.
 */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Re-runs `tick` on an interval until `steps` is reached, then restarts. */
function useLoop(steps: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setI(steps);
      return;
    }
    const id = setInterval(() => setI((n) => (n >= steps ? 0 : n + 1)), ms);
    return () => clearInterval(id);
  }, [steps, ms]);
  return i;
}

function OrbFamily({ title, note, variants }: { title: string; note: string; variants: OrbVariant[] }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="dev__spec-label">{title}</div>
      <p className="dev__section-note" style={{ marginTop: 2 }}>
        {note}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        {variants.map((v) => (
          <div
            key={v}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 12px 8px 8px",
              border: "1px solid var(--sc-border)",
              borderRadius: "var(--sc-radius)",
              background: "var(--sc-surface)",
              minWidth: 150,
            }}
          >
            <Orb variant={v} size={22} />
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
              <code className="sc-mono" style={{ fontSize: 11 }}>
                {v}
              </code>
              <span className="sc-muted" style={{ fontSize: 11 }}>
                {ORB_TASKS[v]}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AgentUiPanel() {
  // Reasoning stream: reveal one line at a time, then settle into "done".
  const step = useLoop(REASONING.length + 2, 900);
  const revealed = Math.min(step, REASONING.length);
  const thinkingDone = step > REASONING.length;
  const reasoningText = REASONING.slice(0, revealed).join("\n\n");

  // Answer stream, two characters per tick.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setShown((n) => (n >= ANSWER.length ? 0 : n + 2)), 28);
    return () => clearInterval(id);
  }, []);

  // To-do progress.
  const todoStep = useLoop(TODO_LABELS.length + 1, 1800);
  const todos: TodoItem[] = useMemo(
    () =>
      TODO_LABELS.map((label, i) => ({
        label,
        status: i < todoStep ? "done" : i === todoStep ? "active" : "todo",
      })),
    [todoStep],
  );

  // Composer state.
  const [sent, setSent] = useState<{ text: string; skills: string[]; model?: string }[]>([]);
  const [model, setModel] = useState("claude-opus-5");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const nextId = useRef(1);

  return (
    <div className="dev__page">
      <PanelHeader title="Agent surfaces">
        The chat-side components: what the agent shows while it is working, and what the user types into. These are
        plain props-in components — the <code className="sc-mono">Thread</code> wires them to run state, but each one
        renders standalone. Styling comes from the same <code className="sc-mono">--sc-*</code> tokens as everything
        else, so they follow the theme without any per-component overrides.
      </PanelHeader>

      <section className="dev__section" style={{ marginTop: 0 }}>
        <h2 className="dev__section-title">Thinking &amp; reasoning</h2>
        <p className="dev__section-note">
          Three levels of the same idea. <code className="sc-mono">ThinkingState</code> is a bare shimmering label for
          when there is nothing to show but the wait. <code className="sc-mono">Thinking</code> streams the reasoning
          itself behind a soft fade, then folds into a “Thought for Ns” summary the user can reopen. The orb is the
          smallest of the three and sits inline anywhere.
        </p>

        <div style={{ display: "grid", gap: 20, marginTop: 14 }}>
          <div>
            <div className="dev__spec-label">ThinkingState</div>
            <div style={{ marginTop: 8 }}>
              <ThinkingState />
            </div>
          </div>

          <div>
            <div className="dev__spec-label">Thinking — live stream, then collapsed summary</div>
            <div style={{ marginTop: 8, minHeight: 210 }}>
              <Thinking text={reasoningText} streaming={!thinkingDone} elapsedMs={5000} />
            </div>
          </div>

          <div>
            <div className="dev__spec-label">Orb — inline and as a status pill</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <Orb variant="S1" />
              <Orb variant="C1" />
              <Orb variant="G1" />
              <Orb variant="S3" pill label="Working…" />
              <Orb variant="B3" pill label="Generating…" />
            </div>
          </div>
        </div>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Orb variants</h2>
        <p className="dev__section-note">
          Twenty-five motions across five families. The geometry is computed in JS and handed to CSS as custom
          properties, so the keyframes only interpolate between positions — that is what keeps this many distinct
          animations on one small stylesheet. Every orb draws in <code className="sc-mono">currentColor</code> and
          stops entirely under <code className="sc-mono">prefers-reduced-motion</code>.
        </p>
        <div style={{ marginTop: 14 }}>
          <OrbFamily title="Lattice · S" note="A 3×3 grid running waves, diagonal sweeps and perimeter comets." variants={LATTICE_VARIANTS} />
          <OrbFamily title="Lens · B" note="A few blurred discs focusing, revolving, blooming and handing off." variants={LENS_VARIANTS} />
          <OrbFamily title="Ring · C" note="Eight dots on a circle: chasing, pulsing, staggering." variants={RING_VARIANTS} />
          <OrbFamily title="Helix · G" note="A projected wireframe globe — spun whole, or turned one ring at a time." variants={HELIX_VARIANTS} />
          <OrbFamily title="Morph · M" note="Eight dots migrating between circle, square, diamond and scatter." variants={MORPH_VARIANTS} />
        </div>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Streaming text</h2>
        <p className="dev__section-note">
          The caret is solid while tokens are landing and only blinks once the stream goes quiet — a caret that blinks
          mid-stream reads as a stall. In the Thread this is fed straight from the run's text parts.
        </p>
        <div style={{ marginTop: 12, maxWidth: 620, minHeight: 72 }}>
          <StreamingText text={ANSWER.slice(0, shown)} streaming={shown < ANSWER.length} />
        </div>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Code block</h2>
        <p className="dev__section-note">
          Filename bar, copy button and a line-number gutter. The gutter is a real grid column rather than a
          <code className="sc-mono"> ::before</code> counter, so selecting the code by hand copies the code and not the
          numbers. This is what the <code className="sc-mono">code</code> card renders.
        </p>
        <div style={{ marginTop: 12, maxWidth: 620 }}>
          <CodeBlock code={SAMPLE_CODE} filename="utils.ts" highlight={[4, 5]} />
        </div>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">To-do list</h2>
        <p className="dev__section-note">
          The header carries the whole state — a dotted progress pie while work runs, a filled check when it is done —
          so the list can be collapsed without losing the thread. The counter rolls digit by digit and the active item
          shimmers.
        </p>
        <div style={{ marginTop: 12, maxWidth: 420 }}>
          <TodoList items={todos} />
        </div>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Plan progress</h2>
        <p className="dev__section-note">
          The run's plan, with live status — run-scoped rather than per-turn, so it belongs outside the transcript in
          a rail or header. It ships no position and no width and fills whatever box the host gives it; what it owns
          is density, folding to a single bar whose segmented meter keeps carrying progress. Collapse it to see.
        </p>
        <div style={{ marginTop: 12, maxWidth: 420 }}>
          <PlanProgress
            steps={[
              { label: "Locate the auth middleware", detail: "src/server/auth/verify.ts", status: "done" },
              { label: "Trace where the signing secret is loaded from", detail: "3 call sites", status: "done" },
              { label: "Pin the algorithm to HS256", detail: "reject 'none' and weak ciphers", status: "active" },
              { label: "Run the regression suite", status: "pending" },
              { label: "Open the pull request", status: "pending" },
            ]}
          />
        </div>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Data table</h2>
        <p className="dev__section-note">
          The <code className="sc-mono">sc-table--grid</code> modifier turns the standard table into a bordered grid
          card. Same markup, same tokens — one class.
        </p>
        <div style={{ marginTop: 12, maxWidth: 460 }}>
          <div className="sc-table-wrap">
            <table className="sc-table sc-table--grid">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Context</th>
                  <th>$/1M in</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["claude-opus-5", "200k", "$3.00"],
                  ["gpt-5.6", "400k", "$5.00"],
                  ["llama-3.1", "128k", "$0.90"],
                ].map((row) => (
                  <tr key={row[0]}>
                    <td>
                      <code className="sc-mono">{row[0]}</code>
                    </td>
                    <td>{row[1]}</td>
                    <td>{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Agent input</h2>
        <p className="dev__section-note">
          A contenteditable rather than a textarea, because skill pills have to sit inline with the text and delete as
          one unit. Type <code className="sc-mono">/</code> to open the skill palette, or use the{" "}
          <code className="sc-mono">+</code> menu. “Improve” is a seam: pass{" "}
          <code className="sc-mono">onEnhance</code> and it calls your endpoint, honours the abort signal, and lets the
          user revert to what they actually wrote.
        </p>
        <div
          style={{
            marginTop: 12,
            maxWidth: 620,
            border: "1px solid var(--sc-border)",
            borderRadius: "var(--sc-radius)",
            background: "var(--sc-bg)",
          }}
        >
          <AgentInput
            models={[
              { id: "claude-opus-5", name: "Claude Opus 5", desc: "Most capable — best for complex, multi-step reasoning.", context: "200k context" },
              { id: "gpt-5.6", name: "GPT-5.6", desc: "Strong all-round performance and tool use.", context: "400k context" },
              { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", desc: "Long context — good for large documents and codebases.", context: "1M context" },
            ]}
            model={model}
            onModelChange={setModel}
            skills={[
              { id: "deep-research", name: "Deep Research", desc: "Multi-source investigation with citations" },
              { id: "code-review", name: "Code Review", desc: "Read the diff and flag real defects" },
              { id: "web-search", name: "Web Search", desc: "Look it up before answering" },
              { id: "summarize", name: "Summarize", desc: "Condense long input" },
            ]}
            attachments={attachments}
            onAttach={(file, kind) =>
              setAttachments((a) => [...a, { id: String(nextId.current++), name: file.name, kind }])
            }
            onRemoveAttachment={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
            onEnhance={async (prompt, signal) => {
              await abortableDelay(1400, signal);
              return `${prompt.trim()} — rewritten to be specific: state the goal, the relevant constraints, the expected output format, and note any assumptions.`;
            }}
            onSubmit={(text, meta) => setSent((s) => [{ text, ...meta }, ...s].slice(0, 4))}
          />
        </div>

        {sent.length ? (
          <div className="sc-card" style={{ maxWidth: 620 }}>
            <div className="sc-card__title">Submitted</div>
            <ul className="sc-list">
              {sent.map((sub, i) => (
                <li key={i} className="sc-mono" style={{ fontSize: 12 }}>
                  {JSON.stringify(sub)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
