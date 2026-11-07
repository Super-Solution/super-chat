"use client";

// Animation catalog — every motion primitive defined in packages/ui/src/styles.css,
// grouped by the job it does rather than by which component happens to use it.
//
// Each tile names the class and keyframe/transition that drives it and states its
// timing, so "where is this animation defined" is answerable by reading this page
// instead of grepping the stylesheet. Anything that plays once (`animation: … both`)
// gets a Replay button, wired by remounting the element on a fresh key — that is
// the only way to restart a CSS animation without JS driving it frame by frame.

import { type ReactNode, useEffect, useState } from "react";
import {
  Caret,
  CardSkeleton,
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
  ToastProvider,
  TodoList,
  useToast,
  type OrbVariant,
  type PlanStep,
  type PlanStepStatus,
  type TodoItem,
} from "@super-solution/super-chat-ui";
import { PanelHeader } from "@/components/Shell";

/* ── shared demo scaffolding ─────────────────────────────────────────────── */

/** Forces a remount on demand — the only way to restart a `both`-filled CSS animation. */
function useReplay(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, () => setN((x) => x + 1)];
}

function AniTile({
  name,
  timing,
  onReplay,
  children,
}: {
  name: string;
  timing: string;
  onReplay?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="dev__ani">
      <div className="dev__ani-demo">{children}</div>
      <div className="dev__ani-foot">
        <code className="sc-mono dev__ani-name">{name}</code>
        <span className="dev__ani-timing">{timing}</span>
      </div>
      {onReplay ? (
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={onReplay}>
          Replay
        </button>
      ) : null}
    </div>
  );
}

/** Loops 0..steps, then wraps — jumps straight to the last frame under reduced motion. */
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

/* ── orb families ─────────────────────────────────────────────────────────── */

function OrbFamily({ title, note, variants }: { title: string; note: string; variants: OrbVariant[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="dev__spec-label">{title}</div>
      <p className="dev__section-note" style={{ marginTop: 2, marginBottom: 10 }}>
        {note}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
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
              minWidth: 148,
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

/* ── value transitions: width/left interpolating on change, not a keyframe ─── */

function ValueMotionDemo() {
  const [pct, setPct] = useState({ progress: 35, gauge: 62, funnel: 48 });
  const randomize = () =>
    setPct({
      progress: Math.round(8 + Math.random() * 84),
      gauge: Math.round(8 + Math.random() * 84),
      funnel: Math.round(8 + Math.random() * 84),
    });

  return (
    <div className="dev__ani" style={{ gridColumn: "1 / -1" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <div className="dev__ani-foot" style={{ marginBottom: 6 }}>
            <code className="sc-mono dev__ani-name">.sc-progress__bar</code>
            <span className="dev__ani-timing">width · 160ms ease-in-out</span>
          </div>
          <div className="sc-progress" style={{ marginBottom: 0 }}>
            <div className="sc-progress__bar" style={{ width: `${pct.progress}%` }} />
          </div>
        </div>

        <div>
          <div className="dev__ani-foot" style={{ marginBottom: 6 }}>
            <code className="sc-mono dev__ani-name">.sc-gauge__needle</code>
            <span className="dev__ani-timing">left · 160ms ease-in-out</span>
          </div>
          <div className="sc-gauge__track" style={{ maxWidth: 320 }}>
            <div className="sc-gauge__band sc-tone--warning" style={{ left: "0%", width: "100%" }} />
            <div className="sc-gauge__needle" style={{ left: `${pct.gauge}%` }} />
          </div>
        </div>

        <div>
          <div className="dev__ani-foot" style={{ marginBottom: 6 }}>
            <code className="sc-mono dev__ani-name">.sc-funnel__bar</code>
            <span className="dev__ani-timing">width · 160ms ease-in-out</span>
          </div>
          <div className="sc-funnel__track" style={{ maxWidth: 320 }}>
            <div className="sc-funnel__bar" style={{ width: `${Math.max(2, pct.funnel)}%` }} />
          </div>
        </div>
      </div>
      <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" style={{ marginTop: 14, alignSelf: "flex-start" }} onClick={randomize}>
        Randomize values
      </button>
    </div>
  );
}

/* ── thinking demo: fade-in, chevron rotate, collapsible rows, stream push ─── */

const REASONING = [
  "Grepping styles.css for every @keyframes block and every bare `transition:` rule, since a motion can be either.",
  "Grouping the results by the job the motion does — loading, streaming, entrance, status — rather than by component.",
  "Cross-checking Orb.tsx: the 25 orb motions are computed as custom properties in JS, so the keyframes alone undercount them.",
  "Noting the reduced-motion block last — every animation here has to state what it freezes to, not just that it stops.",
];

const ANSWER =
  "Twelve categories, forty-plus named motions. Every tile below can be replayed on demand, and the reduced-motion note at the end explains what each one degrades to.";

function ThinkingDemo() {
  const step = useLoop(REASONING.length + 2, 900);
  const revealed = Math.min(step, REASONING.length);
  const done = step > REASONING.length;
  const text = REASONING.slice(0, revealed).join("\n\n");

  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setShown((n) => (n >= ANSWER.length ? 0 : n + 2)), 26);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <div className="dev__spec-label">ThinkingState — sc-shimmer text sweep</div>
        <div style={{ marginTop: 8 }}>
          <ThinkingState />
        </div>
      </div>
      <div>
        <div className="dev__spec-label">
          Thinking — line fade-in (420ms), stream push-transform (560ms), collapse to summary (grid-rows 320ms + chevron
          rotate 280ms)
        </div>
        <div style={{ marginTop: 8, minHeight: 190 }}>
          <Thinking text={text} streaming={!done} elapsedMs={4200} />
        </div>
      </div>
      <div>
        <div className="dev__spec-label">StreamingText — caret solid while landing, blinks once quiet</div>
        <div style={{ marginTop: 8, maxWidth: 560, minHeight: 60 }}>
          <StreamingText text={ANSWER.slice(0, shown)} streaming={shown < ANSWER.length} />
        </div>
      </div>
    </div>
  );
}

/* ── todo demo: staggered entrance, rolling counter, progress pie, collapse ── */

const TODO_LABELS = [
  "Grep every @keyframes and transition in styles.css",
  "Group motions by the job they do, not the component",
  "Build a live, replayable demo for each one",
  "Note the reduced-motion resting frame",
  "Wire the page into the dev nav",
];

function TodoDemo() {
  const step = useLoop(TODO_LABELS.length + 1, 1300);
  const items: TodoItem[] = TODO_LABELS.map((label, i) => ({
    label,
    status: i < step ? "done" : i === step ? "active" : "todo",
  }));
  return <TodoList items={items} title="Cataloging animations" />;
}

/* ── plan progress ────────────────────────────────────────────────────────
   Driven by real state rather than a scripted timeline, so every transition
   fires from an actual status flip — which is the only way to see that the
   spine, the check and the strike stay silent on mount and move only on
   change. One label is deliberately long enough to wrap in the narrow rail:
   the strike has to wipe across both lines, which is the thing a single
   absolutely-positioned bar cannot do. */

const PLAN_STEPS: { label: string; detail?: string }[] = [
  { label: "Locate the auth middleware", detail: "src/server/auth/verify.ts" },
  { label: "Trace where the signing secret is loaded from, and confirm it never reaches the client", detail: "3 call sites" },
  { label: "Pin the algorithm to HS256", detail: "reject 'none' and weak ciphers" },
  { label: "Validate the issuer and audience claims" },
  { label: "Run the regression suite", detail: "412 tests" },
  { label: "Open the pull request" },
];

/** The first step that has not settled — what advance/fail/skip act on. */
const cursorOf = (s: PlanStepStatus[]) => s.findIndex((x) => x === "pending" || x === "active");

function PlanDemo() {
  const [status, setStatus] = useState<PlanStepStatus[]>(() => PLAN_STEPS.map(() => "pending"));
  const [auto, setAuto] = useState(true);

  // pending → active → done, then wrap back to a fresh plan.
  const advance = () =>
    setStatus((prev) => {
      const i = cursorOf(prev);
      if (i < 0) return PLAN_STEPS.map(() => "pending");
      const next = [...prev];
      next[i] = prev[i] === "active" ? "done" : "active";
      return next;
    });

  const mark = (s: PlanStepStatus) =>
    setStatus((prev) => {
      const i = cursorOf(prev);
      if (i < 0) return prev;
      const next = [...prev];
      next[i] = s;
      return next;
    });

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(advance, 1500);
    return () => clearInterval(id);
  }, [auto]);

  const steps: PlanStep[] = PLAN_STEPS.map((s, i) => ({ ...s, status: status[i] }));

  return (
    <>
      <div className="dev__row">
        <button type="button" className="sc-btn sc-btn--sm" onClick={advance}>
          Advance
        </button>
        <button type="button" className="sc-btn sc-btn--sm" onClick={() => mark("failed")}>
          Fail current
        </button>
        <button type="button" className="sc-btn sc-btn--sm" onClick={() => mark("skipped")}>
          Skip current
        </button>
        <button type="button" className="sc-btn sc-btn--sm" onClick={() => setStatus(PLAN_STEPS.map(() => "pending"))}>
          Reset
        </button>
        <label className="dev__toggle">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          auto-advance
        </label>
      </div>

      <div className="dev__planrow">
        <div>
          <div className="dev__spec-label">Narrow rail — 260px</div>
          <div style={{ width: 260 }}>
            <PlanProgress steps={steps} title="Progress" />
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="dev__spec-label">Full width — same instance, same props</div>
          <PlanProgress steps={steps} title="Progress" />
          <div className="dev__spec-label" style={{ marginTop: 16 }}>
            Collapsed — the meter is the only thing left carrying progress
          </div>
          <PlanProgress steps={steps} title="Progress" defaultCollapsed />
        </div>
      </div>

      <div className="dev__anigrid" style={{ marginTop: 18 }}>
        {[
          [".sc-plan__spine::before", "scaleY · 520ms · transition"],
          [".sc-plan__spine::after", "sc-plan-drip · 1.45s · infinite"],
          [".sc-plan__draw", "stroke-dashoffset · 420ms +90ms"],
          [".sc-plan__label::after", "clip-path wipe · 520ms"],
          [".sc-plan__halo", "sc-plan-halo · 2.1s · ×2 offset"],
          [".sc-plan__seg::before", "sc-plan-flow · 1.6s · infinite"],
        ].map(([name, timing]) => (
          <div key={name} className="dev__ani" style={{ gap: 0 }}>
            <div className="dev__ani-foot">
              <code className="sc-mono dev__ani-name">{name}</code>
            </div>
            <span className="dev__ani-timing" style={{ marginTop: 4 }}>
              {timing}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── fade-in family: same keyframe, four different durations by context ────── */

function FadeTile({ name, ms, children }: { name: string; ms: number; children: ReactNode }) {
  const [n, replay] = useReplay();
  return (
    <AniTile name={name} timing={`sc-fade-in · ${ms}ms ease`} onReplay={replay}>
      <div key={n}>{children}</div>
    </AniTile>
  );
}

/* ── toast demo — needs its own provider, so it is scoped to this section ──── */

function ToastButtons() {
  const toast = useToast();
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="sc-btn sc-btn--sm" onClick={() => toast.show("Thread exported.")}>
        Show toast
      </button>
      <button type="button" className="sc-btn sc-btn--sm" onClick={() => toast.show("Draft saved.", "positive")}>
        Positive
      </button>
      <button type="button" className="sc-btn sc-btn--sm" onClick={() => toast.show("Send failed — retry.", "negative")}>
        Negative
      </button>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function DevAniPanel() {
  const [todoKey, setTodoKey] = useState(0);
  const [streamOn, setStreamOn] = useState(true);
  const [sendBusy, setSendBusy] = useState(false);

  return (
    <div className="dev__page">
      <PanelHeader title="Animations">
        Every motion primitive defined in <code className="sc-mono">packages/ui/src/styles.css</code>, grouped by the
        job it does rather than by which component happens to use it. Each tile names its class and the keyframe or
        transition behind it, so this page doubles as an index into the stylesheet. Motions that play once have a{" "}
        <strong>Replay</strong> button — remounting is the only way to restart a CSS animation without driving it from
        JS.
      </PanelHeader>

      {/* ── loading & progress ─────────────────────────────────────────── */}
      <section className="dev__section" style={{ marginTop: 0 }}>
        <h2 className="dev__section-title">Loading &amp; progress</h2>
        <p className="dev__section-note">
          Indefinite work (spinner, skeleton, shimmering label) loops forever because there is nothing else to signal
          "still going". Determinate work (progress, gauge, funnel) never loops — it interpolates its width or
          position whenever the underlying value changes, which is a plain CSS transition, not a keyframe.
        </p>
        <div className="dev__anigrid">
          <AniTile name=".sc-spinner / sc-spin" timing="700ms · linear · infinite">
            <span className="sc-spinner" />
            <span className="sc-muted" style={{ fontSize: 12, marginLeft: 6 }}>
              Loading…
            </span>
          </AniTile>

          <AniTile name=".sc-skeleton__bar / sc-shimmer" timing="1.2s · linear · infinite">
            <div className="sc-skeleton" style={{ width: "100%" }} role="status" aria-busy="true">
              <span className="sc-sr-only">Loading</span>
              <div className="sc-skeleton__bar sc-skeleton__bar--title" />
              <div className="sc-skeleton__bar" />
              <div className="sc-skeleton__bar" />
            </div>
          </AniTile>

          <AniTile name=".sc-shimmer (text) / sc-shine" timing="2.25s · custom ease · infinite">
            <ThinkingState label="Thinking" />
          </AniTile>

          <ValueMotionDemo />
        </div>

        <div className="dev__anigrid" style={{ marginTop: 12 }}>
          <AniTile name="CardSkeleton · media" timing="200ms delay · geometry-preserving">
            <CardSkeleton delayMs={0} hint={{ kind: "media", label: "Generating 2 images", count: 2, aspectRatio: "4 / 3" }} />
          </AniTile>
          <AniTile name="CardSkeleton · chart" timing="200ms delay · geometry-preserving">
            <CardSkeleton delayMs={0} hint={{ kind: "chart", label: "Building chart" }} />
          </AniTile>
          <AniTile name="CardSkeleton · table" timing="200ms delay · geometry-preserving">
            <CardSkeleton delayMs={0} hint={{ kind: "table", label: "Preparing comparison" }} />
          </AniTile>
          <AniTile name="CardSkeleton · document" timing="200ms delay · geometry-preserving">
            <CardSkeleton delayMs={0} hint={{ kind: "document", label: "Drafting document" }} />
          </AniTile>
        </div>
      </section>

      {/* ── streaming text & carets ────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">Streaming text &amp; carets</h2>
        <p className="dev__section-note">
          The caret is solid while tokens are landing and only starts blinking once the stream goes quiet — a caret
          that blinks mid-stream reads as a stall, so <code className="sc-mono">StreamingText</code> never applies the
          blink class during an active stream.
        </p>
        <div className="dev__anigrid">
          <AniTile name=".sc-caret / sc-caret-blink" timing="1s · step-end · infinite">
            <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Caret />
                <span className="sc-muted" style={{ fontSize: 11 }}>
                  blinking
                </span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Caret steady />
                <span className="sc-muted" style={{ fontSize: 11 }}>
                  steady
                </span>
              </span>
            </div>
          </AniTile>

          <AniTile name=".sc-msg__text--streaming::after" timing="steady on delta · blink after 420ms quiet">
            <div style={{ width: "100%" }}>
              <div className="sc-bubble" style={{ maxWidth: "100%" }}>
                <div className={"sc-msg__text" + (streamOn ? " sc-msg__text--streaming" : "")}>
                  The migration batches writes in groups of 500
                </div>
              </div>
              <button
                type="button"
                className="sc-btn sc-btn--ghost sc-btn--sm"
                style={{ marginTop: 8 }}
                onClick={() => setStreamOn((s) => !s)}
              >
                {streamOn ? "Stop streaming" : "Start streaming"}
              </button>
            </div>
          </AniTile>
        </div>
      </section>

      {/* ── thinking & reasoning ───────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">Thinking &amp; reasoning</h2>
        <p className="dev__section-note">
          Live-looping so every transition in the block fires on its own: entrance fade, the stream pushing itself up
          from the bottom edge while collapsed, and the fold into a "Thought for Ns" summary with its chevron rotate.
        </p>
        <ThinkingDemo />
      </section>

      {/* ── orb ──────────────────────────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">Orb — 25 status motions</h2>
        <p className="dev__section-note">
          Five families, five variants each. The geometry is computed once in <code className="sc-mono">Orb.tsx</code>{" "}
          and handed to CSS as custom properties, so every keyframe here only interpolates between positions —
          that split is what keeps 25 distinct motions on one small stylesheet. All of them draw in{" "}
          <code className="sc-mono">currentColor</code> and stop outright under reduced motion.
        </p>
        <OrbFamily title="Lattice · S" note="A 3×3 grid running waves, diagonal sweeps and perimeter comets." variants={LATTICE_VARIANTS} />
        <OrbFamily title="Lens · B" note="A few blurred discs focusing, revolving, blooming and handing off." variants={LENS_VARIANTS} />
        <OrbFamily title="Ring · C" note="Eight dots on a circle: chasing, pulsing, staggering." variants={RING_VARIANTS} />
        <OrbFamily title="Helix · G" note="A projected wireframe globe — spun whole, or turned one ring at a time." variants={HELIX_VARIANTS} />
        <OrbFamily title="Morph · M" note="Eight dots migrating between circle, square, diamond and scatter." variants={MORPH_VARIANTS} />
      </section>

      {/* ── to-do list ──────────────────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">To-do list — entrance, counters &amp; progress ring</h2>
        <p className="dev__section-note">
          Four motions in one component: items stagger in on mount (<code className="sc-mono">sc-todo-in</code>, 50ms
          per item), the header's done/total counter rolls digit by digit, the header's dotted ring fills as a{" "}
          <code className="sc-mono">@property</code>-animated conic gradient, and the active item's label shimmers.
          Click the header to see the list collapse — height animates via <code className="sc-mono">grid-template-rows</code>.
        </p>
        <div style={{ maxWidth: 440 }}>
          <TodoDemo key={todoKey} />
        </div>
        <button
          type="button"
          className="sc-btn sc-btn--ghost sc-btn--sm"
          style={{ marginTop: 10 }}
          onClick={() => setTodoKey((k) => k + 1)}
        >
          Replay
        </button>
      </section>

      {/* ── plan progress ───────────────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">Plan progress — the advancing thread</h2>
        <p className="dev__section-note">
          Run-scoped ambient state, so unlike <code className="sc-mono">TodoList</code> it is meant to live{" "}
          <em>outside</em> the transcript — a rail, a header, a drawer. The component therefore ships no position and
          no width: it fills whatever box the host gives it, and owns density instead. The same instance is rendered
          twice below, in a 260px rail and full width; the narrow one compacts on its own measurement via{" "}
          <code className="sc-mono">@container</code>, not the window.
        </p>
        <p className="dev__section-note">
          Five new motions telling one idea — a thread advancing downward. The three that mark a state{" "}
          <em>change</em> are transitions, not keyframes, so they fire only when a status actually flips and stay
          silent on mount: a plan that arrives already half-finished should not replay its own history. Drive it by
          hand below and watch each one fire.
        </p>
        <PlanDemo />
      </section>

      {/* ── enter / exit fades ─────────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">Enter / exit fades</h2>
        <p className="dev__section-note">
          The same <code className="sc-mono">sc-fade-in</code> keyframe — plain opacity 0→1 — reused at four different
          durations depending on how transient the thing is: a dropdown menu appears almost instantly, an attachment
          chip a little slower, so the eye can track what just got added.
        </p>
        <div className="dev__anigrid">
          <FadeTile name=".sc-ai__menu" ms={120}>
            <div className="sc-ai__menu" style={{ position: "static", boxShadow: "none", minWidth: 160 }}>
              <div className="sc-ai__menuitem" style={{ cursor: "default" }}>
                Attach file
              </div>
              <div className="sc-ai__menuitem" style={{ cursor: "default" }}>
                Attach image
              </div>
            </div>
          </FadeTile>

          <FadeTile name=".sc-ai__enhance" ms={160}>
            <button type="button" className="sc-ai__enhance">
              ✨ Improve
            </button>
          </FadeTile>

          <FadeTile name=".sc-ai__chip" ms={200}>
            <span className="sc-ai__chip">
              <span className="sc-ai__chip-name">brief.pdf</span>
            </span>
          </FadeTile>

          <FadeTile name=".sc-think" ms={320}>
            <ThinkingState label="Thinking" />
          </FadeTile>
        </div>
      </section>

      {/* ── toast ───────────────────────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">Toast — rise on enter</h2>
        <p className="dev__section-note">
          A toast is for something that already happened and is over — it self-dismisses, so unlike everything above
          it needs no replay button: firing another one is the replay.
        </p>
        <ToastProvider>
          <ToastButtons />
        </ToastProvider>
      </section>

      {/* ── micro-interactions ─────────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">Micro-interactions</h2>
        <p className="dev__section-note">
          Hover, focus and pressed-state transitions — short (120–140ms) so they read as instant feedback rather than
          motion in their own right. Try them directly.
        </p>
        <div className="dev__row" style={{ alignItems: "center" }}>
          <button type="button" className="sc-btn">
            Hover me — background 120ms
          </button>
          <button type="button" className="sc-btn sc-btn--primary">
            Primary — filter 120ms
          </button>
          <button
            type="button"
            className={"sc-ai__send" + (sendBusy ? " sc-ai__send--stop" : "")}
            onClick={() => setSendBusy((b) => !b)}
            title="sc-ai__send — opacity/filter 120ms"
          >
            {sendBusy ? "■" : "↑"}
          </button>
        </div>
        <div className="sc-choices" style={{ maxWidth: 360, marginTop: 12 }}>
          <button type="button" className="sc-choice">
            <span className="sc-choice__body">
              <span className="sc-choice__label">.sc-choice — border-color on hover</span>
            </span>
          </button>
          <button type="button" className="sc-choice sc-choice--selected">
            <span className="sc-choice__body">
              <span className="sc-choice__label">.sc-choice--selected — resting state</span>
            </span>
          </button>
        </div>
        <input className="sc-input" style={{ maxWidth: 360, marginTop: 12 }} placeholder=".sc-input — focus outline, no transition (instant)" />
      </section>

      {/* ── reduced motion ──────────────────────────────────────────────── */}
      <section className="dev__section">
        <h2 className="dev__section-title">prefers-reduced-motion</h2>
        <div className="sc-card sc-callout sc-callout--note">
          <span className="sc-callout__icon" aria-hidden>
            i
          </span>
          <div>
            <div className="sc-callout__title">Every animation on this page is decorative</div>
            <div className="sc-callout__body">
              It conveys "in progress", which the surrounding text already says — so under{" "}
              <code className="sc-mono">prefers-reduced-motion: reduce</code> each one stops outright rather than
              slowing down, and pins a legible resting frame instead of freezing mid-motion: the shimmer becomes flat
              muted text, the orb families collapse to a single static dot or disc, the caret stops blinking (steady,
              not hidden), and every collapsible loses its transition but keeps its open/closed state. Toggle the
              setting at the OS or browser level and reload this page to see it.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
