import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Layer 1 of the responsive test strategy (UI-SPEC 5.5).
 *
 * These assertions read the stylesheet as text. That sounds crude, and it is
 * exactly why it is worth having: the invariants below are the ones that fail
 * silently in a browser. A `var()` inside a query condition does not throw, it
 * just never matches. A third breakpoint does not break a build, it splits the
 * spec in half. `100vh` renders fine on a desktop and clips on a phone.
 *
 * jsdom is deliberately not used here or anywhere else in this repo for layout
 * work: it has no layout engine, so every box it measures is 0×0. Anything
 * that needs a real box goes to layer 2 (Playwright, tests/rwd.spec.ts).
 */

const CSS = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");
const PLAYGROUND_CSS = readFileSync(
  fileURLToPath(new URL("../../../apps/playground/src/app/globals.css", import.meta.url)),
  "utf8",
);

/**
 * Comments are stripped before any structural parse. The stylesheet documents
 * its own rules — the header spells out that `var()` in a query condition
 * fails silently, and writes one out to show what not to do. Reading prose as
 * CSS would make the sheet fail its own tests for explaining itself.
 */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const RULES = strip(CSS);
const PLAYGROUND_RULES = strip(PLAYGROUND_CSS);

/** Contents of every `@media (...)` / `@container (...)` prelude in a sheet. */
function queryConditions(css: string): string[] {
  return [...css.matchAll(/@(?:media|container)([^{]+)\{/g)].map((m) => (m[1] ?? "").trim());
}

/** Body of every block whose prelude matches, e.g. every compact-tier block. */
function blocksMatching(css: string, prelude: RegExp): string[] {
  const out: string[] = [];
  const re = /@(?:media|container)([^{]+)\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (!prelude.test(m[1] ?? "")) continue;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

describe("rwd — breakpoints", () => {
  // 5.1.2. The cost of a breakpoint is not writing it, it is verifying every
  // component against it. A fourth tier that sneaks in via one component's
  // convenience is how a two-tier spec quietly becomes untestable.
  it("uses only the two width literals the spec declares", () => {
    const widths = new Set<string>();
    for (const cond of queryConditions(RULES)) {
      for (const w of cond.matchAll(/(?:min|max)-width:\s*([^)]+)\)/g)) widths.add((w[1] ?? "").trim());
    }
    expect([...widths].sort()).toEqual(["600px", "900px"]);
  });

  // The rule is only worth having if it covers the app too. The playground had
  // drifted to a third value — 980px, for the run panel's side rail — which is
  // how a two-tier spec becomes a three-tier one nobody decided on.
  it("holds the app to the same two literals", () => {
    const widths = new Set<string>();
    for (const cond of queryConditions(PLAYGROUND_RULES)) {
      for (const w of cond.matchAll(/(?:min|max)-width:\s*([^)]+)\)/g)) widths.add((w[1] ?? "").trim());
    }
    for (const w of widths) expect(["600px", "900px"]).toContain(w);
  });

  // 5.1.3. The failure this catches is silent: a query condition containing
  // var() is invalid, and an invalid condition never matches. The rule would
  // simply never apply, on any screen, with nothing in the console.
  it("never puts var() in a query condition", () => {
    for (const cond of queryConditions(RULES)) expect(cond).not.toContain("var(");
    for (const cond of queryConditions(PLAYGROUND_RULES)) expect(cond).not.toContain("var(");
  });

  // 5.1.1. Width questions go to @container because the kit is embedded and a
  // media query cannot see the container it was dropped into. The two @media
  // width rules that remain are for position:fixed overlays, whose containing
  // block genuinely is the viewport.
  it("asks @container for width, not @media", () => {
    const mediaWidth = [...RULES.matchAll(/@media([^{]+)\{/g)]
      .map((m) => (m[1] ?? "").trim())
      .filter((c) => /(?:min|max)-width/.test(c));
    expect(mediaWidth).toEqual(["(max-width: 600px)"]);
    expect(RULES).toMatch(/@media \(max-width: 600px\) \{\s*\.sc-toasts/);
  });

  it("declares a query container on every element the width rules target", () => {
    for (const sel of [".sc-threadwrap", ".sc-thread", ".sc-card", ".sc-ai ", ".sc-composer "]) {
      const at = CSS.indexOf(sel + "{") >= 0 ? CSS.indexOf(sel + "{") : CSS.indexOf(sel);
      expect(CSS.slice(at, at + 400), `${sel} must be a query container`).toContain(
        "container-type: inline-size",
      );
    }
  });
});

describe("rwd — mobile viewport defects", () => {
  // 100vh includes the space under a mobile browser's toolbar, so the bottom
  // of a 100vh layout sits off-screen exactly where a composer lives.
  it("uses dvh, never vh, for full-height layout", () => {
    expect(CSS).not.toMatch(/\b100vh\b/);
    expect(PLAYGROUND_CSS).not.toMatch(/\b100vh\b/);
    expect(PLAYGROUND_CSS).toMatch(/\b100dvh\b/);
  });

  // Safari zooms in on a focused field under 16px and does not zoom back out.
  //
  // This is keyed on the pointer, not on width, and the distinction is not
  // pedantic: it first shipped in the compact tier and a tablet at 768px —
  // past that tier, still a touch device, still Safari — kept the 15px size
  // and the zoom with it. Layer 2 caught that at tablet-768.
  it("raises both composers to 16px on any touch device", () => {
    const coarse = blocksMatching(RULES, /pointer:\s*coarse/).join("\n");
    expect(coarse).toMatch(/\.sc-ai__editor,\s*\n\s*\.sc-composer__input \{ font-size: 16px; \}/);

    // And specifically NOT gated on a width, which would reintroduce the bug.
    const compact = blocksMatching(RULES, /max-width:\s*600px/).join("\n");
    expect(compact).not.toContain("font-size: 16px");
  });

  it("insets both composers for the home indicator", () => {
    for (const sel of [".sc-composer", ".sc-ai"]) {
      const at = CSS.indexOf(sel + " {");
      expect(CSS.slice(at, at + 700)).toContain("env(safe-area-inset-bottom)");
    }
  });
});

describe("rwd — touch", () => {
  // 5.3.1. Growing the controls themselves would thicken the composer bar and
  // undo 4.3's density, so the target is carried by a transparent ::after and
  // the assertion is that every small control has one.
  it("gives every small control a 44px hit area", () => {
    const coarse = blocksMatching(RULES, /pointer:\s*coarse/).join("\n");
    expect(coarse).toMatch(/width:\s*max\(100%,\s*44px\)/);
    expect(coarse).toMatch(/height:\s*max\(100%,\s*44px\)/);
    for (const sel of [
      ".sc-ai__icon",
      ".sc-ai__send",
      ".sc-ai__chip-x",
      ".sc-ai__pill-x",
      ".sc-code__copy",
      ".sc-jump",
    ]) {
      expect(coarse, `${sel} needs a touch target`).toContain(`${sel}::after`);
      const escaped = sel.replace(/[.\-]/g, (c) => "\\" + c);
      expect(coarse, `${sel}::after needs a positioned parent`).toMatch(
        new RegExp(`${escaped}\\s*[,{]`),
      );
    }
  });

  // 5.3.2. A tap can latch :hover until the next tap elsewhere, so a
  // hover-only swap does not merely fail to trigger on touch — it sticks.
  it("neutralises the to-do header's hover swap where there is no hover", () => {
    const noHover = blocksMatching(RULES, /hover:\s*none/).join("\n");
    expect(noHover).toContain(".sc-todo__head:hover .sc-todo__chevron { opacity: 0; }");
    expect(noHover).toMatch(/\.sc-todo__head:hover \.sc-todo__pie,?[\s\S]{0,120}opacity: 1/);
  });

  // Keyboard users have no hover either, so the affordance needs a second
  // route in. This one is not touch-specific and lives outside the query.
  it("reaches the same affordance by keyboard", () => {
    expect(CSS).toContain(".sc-todo__head:focus-visible .sc-todo__chevron { opacity: 1; }");
  });
});

describe("rwd — token discipline", () => {
  // Principle 3, now enforced. The agent surfaces landed after the D1 token
  // migration and reintroduced raw values: three copies of the overlay shadow
  // and a hardcoded white on the danger button.
  it("has no raw hex outside the token declarations", () => {
    const stripped = RULES.replace(/:root[^{]*\{[^}]*\}/g, "");
    const hex = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hex).toEqual([]);
  });

  // 2.0.3 named every type size, then the agent surfaces invented 11.5px and
  // 12.5px anyway. The single exemption is the chart label, which is painted
  // in the SVG's user space where the number is a coordinate, not a type size.
  it("sizes type from tokens, with one documented exemption", () => {
    const raw = [...CSS.matchAll(/^(?!.*--sc-fs-)(.*font-size:\s*[\d.]+px.*)$/gm)].map((m) => (m[1] ?? "").trim());
    expect(raw.filter((l) => !l.startsWith(".sc-chart__label"))).toEqual([
      // The one deliberate exception to the scale: 16 is not a design size,
      // it is the threshold Safari stops zooming at. A token would imply it
      // is ours to tune.
      ".sc-composer__input { font-size: 16px; }",
    ]);
  });
});
