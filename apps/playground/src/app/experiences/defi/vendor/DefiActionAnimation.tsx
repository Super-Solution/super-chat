"use client";

// DeFi action motifs — the CINEMA update. Each agent money-card gets a full-bleed
// STAGE: a wide (260×140) scene with set dressing (accent spotlight, dot grid,
// floor shadows, ambient drift-motes) and a DIMENSIONAL (立體/擬物) coin system.
// A coin is a solid disc: cylinder SIDE (darker) + foreshortened elliptical top
// FACE (lighter) + rim ring — top-lit, physical, chip-like. In-app the face
// carries the real CoinMetadata image (useCoinIcons); in /dev it's a token.
//
// SEMANTIC palette (each hue means something): BLUE = value/principal · GREEN =
// gain/relief · ORANGE = leverage/risk/debt. Shading stops derive from app tokens
// via color-mix, so scenes theme light/dark.
//
// Every motif tells a concrete PHYSICAL story with the coin as actor (stake coins
// clock in on a glowing pedestal, the vault's dial spins shut, the perp reel rolls
// to the position's real leverage over racing candles, a swap vortex trades two
// coins with motion trails…). SVG built imperatively so each part animates alone.
//
// PHASE-REACTIVE: `phase` (preview | running | settled | failed) drives the stage.
// preview = calm loop · running = the same loop with more energy (timeScale) ·
// settled = the motif freezes on its resting frame + a one-shot green ripple-burst
// celebration · failed = frozen + CSS shake/desaturate (see STYLES). Gated behind
// (prefers-reduced-motion: no-preference); reduced motion gets the settled frame.
// aria-hidden — the card's IntentLine + Rows stay the authoritative record.

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

export type ScenePhase = "preview" | "running" | "settled" | "failed";

gsap.registerPlugin(useGSAP);

const NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, string | number>;
type El = SVGGraphicsElement & { _org?: string; _ax?: number; _ay?: number };

function el(tag: string, attrs: Attrs = {}): El {
  const e = document.createElementNS(NS, tag) as unknown as El;
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

// Stage geometry — every motif composes against these.
const W = 260;
const H = 140;
const CX = 130;
const FLOOR = 114; // ground line most motifs stand on

// Stage-level VELOCITY field for the `running` (broadcasting) phase. A set of
// stretched streaks that sweep across the stage — the reference's speed-line burst,
// horizontalized. Purely CSS-driven (see .aa-speed / @keyframes aa-rush in STYLES):
// randomized y / length / width + negative animation-delay give continuous emission
// with layered depth, themed via --aa-spark, self-gated under reduced-motion. Mounted
// behind the motif so every action reads as "rushing out" without touching a builder.
function makeSpeedField(): El {
  const g = el("g", { class: "aa-speed" });
  const N = 11;
  for (let i = 0; i < N; i++) {
    const depth = Math.random(); // 0 = far/faint, 1 = near/bold
    const y = 22 + Math.random() * (H - 44);
    const len = 24 + depth * 46;
    const ln = el("line", {
      x1: 0, y1: y.toFixed(1), x2: len.toFixed(1), y2: y.toFixed(1),
      "stroke-width": (1.4 + depth * 1.8).toFixed(1),
    });
    ln.style.setProperty("--op", (0.16 + depth * 0.3).toFixed(2));
    ln.style.setProperty("--d", (0.62 + Math.random() * 0.5).toFixed(2) + "s");
    ln.style.setProperty("--delay", "-" + (Math.random() * 1.4).toFixed(2) + "s");
    g.appendChild(ln);
  }
  return g;
}

const STYLES = `
  .aa-stage { position: relative; overflow: hidden; }
  .aa-frame { position: relative; width: 100%; background: transparent; overflow: hidden; }
  .aa-frame svg {
    display: block; width: 100%; height: auto; aspect-ratio: ${W} / ${H}; overflow: visible;
    --aa-blue: var(--av-accent);
    --aa-blue-top: color-mix(in srgb, var(--av-accent), #ffffff 46%);
    --aa-blue-dk:  color-mix(in srgb, var(--av-accent), #000000 34%);
    --aa-blue2:     color-mix(in srgb, var(--av-accent), #ffffff 20%);
    --aa-blue2-top: color-mix(in srgb, var(--av-accent), #ffffff 62%);
    --aa-blue2-dk:  var(--av-accent);
    --aa-grn: var(--av-bull);
    --aa-grn-top: color-mix(in srgb, var(--av-bull), #ffffff 44%);
    --aa-grn-dk:  color-mix(in srgb, var(--av-bull), #000000 30%);
    --aa-red: var(--av-bear, #d9534f);
    --aa-ten: #ff8a3d; --aa-ten-top: #ffb27a; --aa-ten-dk: #c9611f;
    --aa-water:    color-mix(in srgb, var(--av-accent), #0a1636 46%);
    --aa-water-hi: color-mix(in srgb, var(--av-accent), #ffffff 12%);
    --aa-spark: color-mix(in srgb, var(--av-accent), #ffffff 60%);
    --aa-soil: #5a4426; --aa-leaf: #4fd08a; --aa-sun: #ffc44d;
    --aa-dim: var(--av-muted);
    --aa-obj:   color-mix(in srgb, var(--av-muted) 15%, transparent);
    --aa-obj-2: color-mix(in srgb, var(--av-muted) 30%, transparent);
    --aa-slot:  color-mix(in srgb, var(--av-ink) 40%, var(--av-paper));
    --aa-mono: var(--av-mono);
    --aa-spotlight: color-mix(in srgb, var(--av-accent) 14%, transparent);
    --aa-grid: color-mix(in srgb, var(--av-muted) 32%, transparent);
    --aa-shadow: color-mix(in srgb, var(--av-ink) 16%, transparent);
  }
  /* full-bleed hero inside a card body (body padding is 16px) */
  .aa-stage.aa-hero {
    margin: -16px -16px 14px;
    width: calc(100% + 32px);
    border-bottom: var(--av-hair) solid var(--av-line-ink);
    background:
      radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--av-accent) 5%, transparent), transparent 70%);
  }
  /* Illustration sits at 3/4 scale, centered in the full-bleed band, so the money
     card doesn't dominate the chat column. Ratio is fixed (260/140), so capping the
     frame width scales height with it — no side gutters, no letterboxing. */
  .aa-stage.aa-hero .aa-frame { max-width: 75%; margin-inline: auto; }
  /* legacy compact embed (kept for callers that don't want the hero bleed) */
  .aa-frame.aa-card { margin: 0 auto; background: transparent; }

  /* ── status chip ─────────────────────────────────────────────────────────── */
  .aa-chip {
    position: absolute; top: 10px; left: 12px; z-index: 2;
    display: inline-flex; align-items: center; gap: 7px;
    max-width: calc(100% - 24px);
    padding: 5px 11px 5px 9px;
    border: var(--av-hair) solid var(--av-line-ink);
    border-radius: 999px;
    background: color-mix(in srgb, var(--av-paper) 82%, transparent);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    font-family: var(--av-mono); font-size: 10px; font-weight: 700;
    letter-spacing: .06em; text-transform: uppercase;
    color: var(--av-ink);
    animation: aa-chip-in .34s cubic-bezier(.22,1,.36,1);
    white-space: nowrap; overflow: hidden;
  }
  .aa-chip__tx { overflow: hidden; text-overflow: ellipsis; }
  .aa-chip__dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--av-muted); }
  .aa-chip[data-tone="run"] .aa-chip__dot { background: var(--av-accent); animation: aa-dot-pulse 1.1s ease-in-out infinite; }
  .aa-chip[data-tone="run"] { border-color: color-mix(in srgb, var(--av-accent) 45%, var(--av-line-ink)); }
  .aa-chip[data-tone="ok"] .aa-chip__dot { background: var(--av-bull); }
  .aa-chip[data-tone="ok"] { border-color: color-mix(in srgb, var(--av-bull) 55%, var(--av-line-ink)); color: var(--av-bull); }
  .aa-chip[data-tone="err"] .aa-chip__dot { background: var(--av-danger, #d9534f); }
  .aa-chip[data-tone="err"] { border-color: color-mix(in srgb, var(--av-danger, #d9534f) 55%, var(--av-line-ink)); color: var(--av-danger-ink, #d9534f); }
  @keyframes aa-chip-in { from { transform: translateY(-6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes aa-dot-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--av-accent) 45%, transparent); } 55% { box-shadow: 0 0 0 5px transparent; } }

  /* ── phase feedback on the whole stage ───────────────────────────────────── */
  .aa-stage[data-phase="failed"] .aa-frame { animation: aa-shake .5s cubic-bezier(.36,.07,.19,.97); filter: saturate(.35); opacity: .88; }
  @keyframes aa-shake {
    10%, 90% { transform: translateX(-2px); }
    20%, 80% { transform: translateX(4px); }
    30%, 50%, 70% { transform: translateX(-6px); }
    40%, 60% { transform: translateX(6px); }
  }
  .aa-stage[data-phase="settled"]::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--av-bull) 65%, transparent);
    animation: aa-okring 1.4s ease-out forwards;
  }
  @keyframes aa-okring { 0% { opacity: 0; } 18% { opacity: 1; } 100% { opacity: 0; } }

  /* ── velocity field · mounted only while broadcasting (phase="running") ─────
     The reference speed-line burst, horizontalized for the 260×140 stage:
     stretched streaks sweep left→right (the direction of broadcast), behind the
     motif. Negative-delay per line ⇒ continuous emission; each fades in→hold→out
     and grows (scaleX) as it rushes. Layered depth via per-line --op. */
  .aa-speed line {
    stroke: var(--aa-spark); stroke-linecap: round;
    transform-box: fill-box; transform-origin: left center;
    opacity: 0;
    animation: aa-rush var(--d, .8s) cubic-bezier(.302435,.381352,.55,.956352) var(--delay, 0s) infinite;
  }
  @keyframes aa-rush {
    0%   { transform: translateX(-70px) scaleX(.12); opacity: 0; }
    14%  { opacity: var(--op, .3); }
    80%  { opacity: var(--op, .3); }
    100% { transform: translateX(248px) scaleX(1); opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .aa-chip, .aa-chip[data-tone="run"] .aa-chip__dot { animation: none; }
    .aa-stage[data-phase="failed"] .aa-frame { animation: none; }
    .aa-stage[data-phase="settled"]::after { animation: none; opacity: 0; }
    .aa-speed line { animation: none; opacity: 0; }
  }
`;

// ── palettes (semantic) ──────────────────────────────────────────────────────
type Pal = { main: string; top: string; dk: string };
const BLUE: Pal = { main: "var(--aa-blue)", top: "var(--aa-blue-top)", dk: "var(--aa-blue-dk)" };
const BLUE2: Pal = { main: "var(--aa-blue2)", top: "var(--aa-blue2-top)", dk: "var(--aa-blue2-dk)" };
const TEN: Pal = { main: "var(--aa-ten)", top: "var(--aa-ten-top)", dk: "var(--aa-ten-dk)" };

// ── coin primitives ──────────────────────────────────────────────────────────
const RX = 19, RY = 14, H_EDGE = 4;
let COIN_UID = 0;
function coinParts(cx: number, topY: number, pal: Pal, sc = 1, img?: string) {
  const rx = RX * sc, ry = RY * sc, h = Math.max(2, H_EDGE * sc);
  const g = el("g");
  const edge = el("ellipse", { cx, cy: topY + h, rx, ry, fill: pal.dk });
  const face = el("ellipse", { cx, cy: topY, rx, ry, fill: pal.top });
  g.append(edge, face);
  if (img) {
    const uid = `aac${COIN_UID++}`;
    const clip = el("clipPath", { id: uid });
    clip.append(el("ellipse", { cx, cy: topY, rx, ry }));
    g.append(clip, el("image", { href: img, x: cx - rx, y: topY - ry, width: rx * 2, height: ry * 2, preserveAspectRatio: "none", "clip-path": `url(#${uid})` }));
  }
  const rim = el("ellipse", { cx, cy: topY, rx: rx - 1.5, ry: ry - 1.5, fill: "none", stroke: img ? "var(--av-on-accent)" : pal.main, "stroke-width": 1.4, opacity: img ? 0.35 : 0.5 });
  g.append(rim);
  return { g, edge, face, rim, cx, topY, rx, ry };
}
function coin(cx: number, topY: number, pal: Pal, sc = 1, img?: string): El {
  return coinParts(cx, topY, pal, sc, img).g;
}

// Front-view coin: round face (full logo) + thin bottom edge; scaleY 0→1 flips it
// up from edge-on to facing you.
function frontCoin(cx: number, cy: number, r: number, img?: string): El {
  const g = el("g");
  g.append(el("ellipse", { cx, cy: cy + r * 0.18, rx: r, ry: r, fill: "var(--aa-blue-dk)" }));
  g.append(el("circle", { cx, cy, r, fill: "var(--aa-blue-top)" }));
  if (img) {
    const uid = `aac${COIN_UID++}`;
    const clip = el("clipPath", { id: uid });
    clip.append(el("circle", { cx, cy, r }));
    g.append(clip, el("image", { href: img, x: cx - r, y: cy - r, width: r * 2, height: r * 2, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${uid})` }));
  }
  g.append(el("circle", { cx, cy, r: r - 1.5, fill: "none", stroke: img ? "var(--av-on-accent)" : "var(--aa-blue)", "stroke-width": 1.4, opacity: img ? 0.35 : 0.5 }));
  return g;
}

// ── sparkle (8-point) + loops ────────────────────────────────────────────────
function sparkle(cx: number, cy: number, s: number, color = "var(--aa-spark)"): El {
  const pts: [number, number][] = [[0, -s], [s * 0.24, -s * 0.24], [s, 0], [s * 0.24, s * 0.24], [0, s], [-s * 0.24, s * 0.24], [-s, 0], [-s * 0.24, -s * 0.24]];
  const d = "M" + pts.map(([x, y]) => `${cx + x},${cy + y}`).join(" L") + " Z";
  const p = el("path", { d, fill: color });
  p._org = `${cx}px ${cy}px`;
  return p;
}
function breathe(spark: El, i: number) {
  gsap.set(spark, { transformOrigin: spark._org, scale: 1, opacity: 0.9 });
  gsap.to(spark, { y: "-=6", duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.3 });
  gsap.to(spark, { scale: 1.15, opacity: 0.6, duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.3 });
}
function floatSpark(spark: El, i: number) {
  gsap.set(spark, { transformOrigin: spark._org });
  gsap.to(spark, { scale: 1, opacity: 0.85, duration: 0.4, ease: "back.out(1.6)" });
  gsap.to(spark, { y: "-=5", duration: 1.6, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 0.2 + i * 0.3 });
}

// up/down arrow at absolute (cx,cy) — no transform attr, GSAP owns y clean
function dirArrow(cx: number, cy: number, s: number, color: string, down: boolean): El {
  const w = 6 * s, sh = 9 * s, sw = 2.6 * s, hh = 6 * s;
  const d = down
    ? `M${cx},${cy + hh + sh} L${cx + w},${cy + sh} L${cx + sw},${cy + sh} L${cx + sw},${cy} L${cx - sw},${cy} L${cx - sw},${cy + sh} L${cx - w},${cy + sh} Z`
    : `M${cx},${cy - hh - sh} L${cx + w},${cy - sh} L${cx + sw},${cy - sh} L${cx + sw},${cy} L${cx - sw},${cy} L${cx - sw},${cy - sh} L${cx - w},${cy - sh} Z`;
  return el("path", { d, fill: color, opacity: 0.9 });
}

// soft contact shadow under a grounded object
function floorShadow(cx: number, cy: number, rx: number): El {
  return el("ellipse", { cx, cy, rx, ry: rx * 0.22, fill: "var(--aa-shadow)" });
}

// ── stage dressing: spotlight + dot grid + ambient drift-motes ───────────────
// Appended FIRST so it sits behind every motif. The motes drift upward forever —
// the stage always feels alive even while a motif rests between loop beats.
function dressStage(svg: SVGSVGElement): { layer: El; motes: El[] } {
  const layer = el("g");
  const defs = el("defs");
  const gid = `aaspot${COIN_UID++}`;
  const rg = el("radialGradient", { id: gid, cx: "50%", cy: "45%", r: "60%" });
  rg.append(
    el("stop", { offset: "0%", "stop-color": "var(--av-accent)", "stop-opacity": 0.13 }),
    el("stop", { offset: "62%", "stop-color": "var(--av-accent)", "stop-opacity": 0.05 }),
    el("stop", { offset: "100%", "stop-color": "var(--av-accent)", "stop-opacity": 0 }),
  );
  const pid = `aagrid${COIN_UID++}`;
  const pat = el("pattern", { id: pid, width: 16, height: 16, patternUnits: "userSpaceOnUse" });
  pat.append(el("circle", { cx: 1.2, cy: 1.2, r: 1.05, fill: "var(--aa-grid)" }));
  defs.append(rg, pat);
  const grid = el("rect", { x: 0, y: 0, width: W, height: H, fill: `url(#${pid})`, opacity: 0.5 });
  const spot = el("ellipse", { cx: CX, cy: 64, rx: 124, ry: 66, fill: `url(#${gid})` });
  // 6 drift-motes at golden-ratio spread; sizes/durations vary deterministically
  const motes: El[] = [];
  for (let i = 0; i < 6; i++) {
    const mx = 22 + ((i * 89) % (W - 44));
    const my = 30 + ((i * 53) % 84);
    const r = 1.2 + (i % 3) * 0.5;
    const m = el("circle", { cx: mx, cy: my, r, fill: "var(--aa-spark)", opacity: 0 });
    motes.push(m);
  }
  layer.append(defs, grid, spot, ...motes);
  svg.appendChild(layer);
  return { layer, motes };
}
function driftMotes(motes: El[]) {
  motes.forEach((m, i) => {
    gsap.set(m, { opacity: 0 });
    gsap.to(m, { opacity: 0.5, duration: 1.2, delay: 0.3 + i * 0.35, ease: "power1.inOut" });
    gsap.to(m, { y: -14 - (i % 3) * 6, duration: 4.2 + (i % 4), ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.5 });
    gsap.to(m, { x: (i % 2 === 0 ? 6 : -6), duration: 5 + (i % 3), ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.4 });
  });
}

// ── "Sponsored · SupWallet" — a small bottom-left badge for AGENT runs. The agent
// pays NO gas: the SupWallet sponsor covers it from its SIP-58 address balance. A clean
// fuel-pump icon makes the subject (gas) obvious; "Sponsored" states the value.
// Renders statically (always visible, incl. reduced-motion / ?static); animateGasBadge()
// adds a soft breathing glow only under (prefers-reduced-motion: no-preference).
function gasSponsorBadge(svg: SVGSVGElement): { glow: El; nozzle: El; body: El } {
  const g = el("g", { class: "aa-gasbadge", transform: "translate(9 120)" });
  const pill = el("rect", {
    x: 0, y: 0, width: 99, height: 16, rx: 8,
    fill: "color-mix(in srgb, var(--av-accent) 7%, transparent)",
    stroke: "color-mix(in srgb, var(--av-accent) 20%, transparent)", "stroke-width": 0.6,
  });
  // fuel pump: dispenser body + screen + base + a holstered nozzle hose
  const icon = el("g", { transform: "translate(9.5 8)" });
  const glow = el("circle", { r: 6.2, fill: "var(--aa-blue)", opacity: 0 });
  const base = el("rect", { x: -3.6, y: 4, width: 6.2, height: 1.2, rx: 0.55, fill: "var(--aa-blue)" });
  const body = el("rect", { x: -3, y: -5, width: 4.7, height: 9.2, rx: 1.2, fill: "var(--aa-blue)" });
  const screen = el("rect", { x: -1.85, y: -3.4, width: 2.7, height: 2, rx: 0.4, fill: "var(--aa-blue-top)", opacity: 0.92 });
  const nozzle = el("path", {
    d: "M1.7,-3.2 q2.3,0.1 2.3,2.4 v2.1", fill: "none",
    stroke: "var(--aa-blue)", "stroke-width": 0.95, "stroke-linecap": "round",
  });
  icon.append(glow, base, body, screen, nozzle);
  const label = el("text", { x: 19.5, y: 10.6, "font-size": 6.4, "font-family": "inherit" });
  const t1 = el("tspan", { fill: "var(--av-accent)", "font-weight": 700 }); t1.textContent = "Sponsored";
  const t2 = el("tspan", { fill: "var(--aa-dim)", "font-weight": 500 }); t2.textContent = " · SupWallet";
  label.append(t1, t2);
  g.append(pill, icon, label);
  svg.appendChild(g);
  return { glow, nozzle, body };
}
function animateGasBadge({ glow, nozzle, body }: { glow: El; nozzle: El; body: El }): gsap.core.Timeline {
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.5, delay: 0.9 });
  // soft, slow "sponsor is covering it" breath: a glow swells behind the pump while the
  // pump body eases up a hair and the nozzle brightens — calm, not busy.
  tl.fromTo(glow, { opacity: 0, scale: 0.68, transformOrigin: "50% 50%" }, { opacity: 0.32, scale: 1.32, duration: 0.85, ease: "sine.out" }, 0)
    .to(glow, { opacity: 0, duration: 1.0, ease: "sine.in" }, 0.85)
    .fromTo(body, { scaleY: 1, transformOrigin: "50% 100%" }, { scaleY: 1.05, duration: 0.85, ease: "sine.out" }, 0)
    .to(body, { scaleY: 1, transformOrigin: "50% 100%", duration: 1.0, ease: "sine.in" }, 0.85)
    .fromTo(nozzle, { opacity: 0.55 }, { opacity: 1, duration: 0.85, ease: "sine.out" }, 0)
    .to(nozzle, { opacity: 0.55, duration: 1.0, ease: "sine.in" }, 0.85);
  return tl;
}

// one-shot celebration: double ring ripple + radial spark burst at the hero spot
function successBeat(root: El, cx = CX, cy = 72) {
  const g = el("g");
  const ring1 = el("circle", { cx, cy, r: 18, fill: "none", stroke: "var(--aa-grn)", "stroke-width": 3, opacity: 0 });
  const ring2 = el("circle", { cx, cy, r: 18, fill: "none", stroke: "var(--aa-grn-top)", "stroke-width": 2, opacity: 0 });
  const sparks: El[] = [];
  for (let i = 0; i < 10; i++) {
    const s = sparkle(cx, cy, i % 2 === 0 ? 6 : 4.2, i % 3 === 2 ? "var(--aa-grn-top)" : "var(--aa-grn)");
    sparks.push(s);
  }
  g.append(ring1, ring2, ...sparks);
  root.append(g);
  const tl = gsap.timeline({ onComplete: () => g.remove() });
  tl.fromTo(ring1, { scale: 0.35, opacity: 0.95, svgOrigin: `${cx} ${cy}` }, { scale: 2.6, opacity: 0, duration: 0.9, ease: "power2.out" }, 0);
  tl.fromTo(ring2, { scale: 0.35, opacity: 0.8, svgOrigin: `${cx} ${cy}` }, { scale: 2.0, opacity: 0, duration: 0.75, ease: "power2.out" }, 0.12);
  sparks.forEach((s, i) => {
    const a = (i / sparks.length) * Math.PI * 2;
    const dist = 34 + (i % 3) * 12;
    tl.fromTo(
      s,
      { x: 0, y: 0, scale: 0.4, opacity: 1, transformOrigin: s._org },
      { x: Math.cos(a) * dist, y: Math.sin(a) * dist * 0.72 - 6, scale: 0.9, opacity: 0, duration: 0.7 + (i % 3) * 0.12, ease: "power2.out" },
      0.04,
    );
  });
  return tl;
}

// ── organic sprout (farm/harvest) ────────────────────────────────────────────
function curlLeaf(ax: number, ay: number, rotDeg: number, size: number): El {
  const L = 26 * size, w = 11 * size;
  const local: (string | number)[][] = [["M", 0, 0], ["C", -w, -L * 0.38, -w * 0.5, -L * 0.85, 3 * size, -L], ["C", w * 0.7, -L * 0.82, w, -L * 0.34, 0, 0], ["Z"]];
  const r = (rotDeg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  const tf = (x: number, y: number): [number, number] => [ax + (x * cs - y * sn), ay + (x * sn + y * cs)];
  let d = "";
  for (const s of local) {
    if (s[0] === "M") { const [X, Y] = tf(s[1] as number, s[2] as number); d += `M${X.toFixed(1)},${Y.toFixed(1)} `; }
    else if (s[0] === "C") { const [a, b] = tf(s[1] as number, s[2] as number), [c, dd] = tf(s[3] as number, s[4] as number), [e, f] = tf(s[5] as number, s[6] as number); d += `C${a.toFixed(1)},${b.toFixed(1)} ${c.toFixed(1)},${dd.toFixed(1)} ${e.toFixed(1)},${f.toFixed(1)} `; }
    else d += "Z";
  }
  const p = el("path", { d, fill: "var(--aa-leaf)" });
  p._ax = ax; p._ay = ay;
  return p;
}
function makeSprout(bx = CX, by = FLOOR - 8) {
  const g = el("g");
  const stem = el("path", { d: `M${bx},${by} C ${bx - 4},${by - 12} ${bx + 6},${by - 20} ${bx + 4},${by - 35}`, fill: "none", stroke: "var(--aa-leaf)", "stroke-width": 2.8, "stroke-linecap": "round", pathLength: 100, "stroke-dasharray": 100, "stroke-dashoffset": 100 });
  const lLow = curlLeaf(bx + 1, by - 13, -128, 0.82);
  const lRight = curlLeaf(bx + 3, by - 24, 62, 1.06);
  const lTop = curlLeaf(bx + 4, by - 33, -22, 0.94);
  g.append(stem, lLow, lRight, lTop);
  return { g, stem, leaves: [lLow, lRight, lTop] };
}

type Api = { play: () => gsap.core.Timeline | null; stat: () => void };
/** One aggregator-route waypoint: venue name + its protocol mark when we have one. */
export type RouteStop = { label: string; logo?: string };
/** A secondary parallel route: its stops + share of the input it carries. */
export type RouteAlt = { stops: RouteStop[]; sharePct: number };
// coinUrl/coinUrl2 = the real CoinMetadata icons for this action's asset(s).
// lev = perp leverage (the reel lands on it); side tints direction.
// route/splits = the aggregator's live router path (swap only): venue stops the
// coin hops through, and how many parallel routes the trade splits across.
// coins = ALL input coins (multiSwap): each becomes its own converge lane.
type Builder = (root: El, side: "long" | "short", coinUrl?: string, coinUrl2?: string, lev?: number, route?: RouteStop[], splits?: number, alts?: RouteAlt[], combo?: ComboStop[], coins?: RouteStop[]) => Api;

// ─── ① Position / 進駐 · earning ─────────────────────────────────────────────

// REBUILT — the asset CLOCKS IN: coins drop one-by-one onto a glowing pedestal,
// each landing squashes + fires a ring wave; yield glints then orbit the stack.
const buildStake: Builder = (root, _s, coinUrl) => {
  const shadow = floorShadow(CX, FLOOR + 4, 34);
  // pedestal: two stacked slabs + glow seam
  const slabB = el("rect", { x: CX - 40, y: FLOOR - 2, width: 80, height: 8, rx: 3, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.6 });
  const slabT = el("rect", { x: CX - 30, y: FLOOR - 8, width: 60, height: 7, rx: 3, fill: "var(--aa-obj)", stroke: "var(--aa-dim)", "stroke-width": 1.4 });
  const seam = el("line", { x1: CX - 26, y1: FLOOR - 8, x2: CX + 26, y2: FLOOR - 8, stroke: "var(--aa-spark)", "stroke-width": 1.6, opacity: 0 });
  const BY2 = FLOOR - 18, MY2 = FLOOR - 30, TY2 = FLOOR - 42;
  const cB = coin(CX, BY2, BLUE, 1, coinUrl), cM = coin(CX, MY2, BLUE, 1, coinUrl), cT = coin(CX, TY2, BLUE, 1, coinUrl);
  const rings = [0, 1, 2].map(() => el("ellipse", { cx: CX, cy: FLOOR - 4, rx: 26, ry: 7, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2, opacity: 0 }));
  const sp = [sparkle(86, 44, 9), sparkle(CX, 30, 11), sparkle(174, 48, 9)];
  root.append(shadow, slabB, slabT, seam, ...rings, cB, cM, cT, ...sp);
  const stat = () => {
    gsap.set([cB, cM, cT], { y: 0, opacity: 1, scaleY: 1 });
    gsap.set(seam, { opacity: 0.5 });
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    sp.forEach((s) => gsap.set(s, { scale: 0, opacity: 0, y: 0, transformOrigin: s._org }));
    gsap.set(seam, { opacity: 0 });
    const drop = (c: El, ring: El, from: number, at: string | number) => {
      const tlPart = gsap.timeline();
      tlPart.fromTo(c, { y: from, opacity: 0, scaleY: 1, transformOrigin: "center bottom" }, { y: 0, opacity: 1, duration: 0.42, ease: "power2.in" });
      tlPart.to(c, { scaleY: 0.82, duration: 0.09, ease: "power1.in" });
      tlPart.to(c, { scaleY: 1, duration: 0.3, ease: "elastic.out(1.4, 0.5)" });
      tlPart.fromTo(ring, { scale: 0.4, opacity: 0.9, svgOrigin: `${CX} ${FLOOR - 4}` }, { scale: 1.9, opacity: 0, duration: 0.55, ease: "power2.out" }, "-=.36");
      tl.add(tlPart, at);
      return tlPart;
    };
    const tl = gsap.timeline();
    drop(cB, rings[0], -70, 0);
    drop(cM, rings[1], -62, 0.34);
    drop(cT, rings[2], -58, 0.68);
    tl.to(seam, { opacity: 0.55, duration: 0.5, ease: "power1.out" }, 1.0);
    tl.to(seam, { opacity: 0.25, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: -1 });
    tl.add(() => sp.forEach((s, i) => floatSpark(s, i)), 1.15);
    return tl;
  };
  return { play, stat };
};

// ENRICHED — coin buries into soil, the sun arcs up and beams, sprout grows and
// SWAYS in a loop; a passing glint rain feeds it.
const buildFarm: Builder = (root, _s, coinUrl) => {
  const soil = el("path", { d: `M${CX - 56},${FLOOR} Q${CX},${FLOOR - 7} ${CX + 56},${FLOOR}`, fill: "none", stroke: "var(--aa-soil)", "stroke-width": 5, "stroke-linecap": "round" });
  const mound = el("path", { d: `M${CX - 18},${FLOOR - 1} Q${CX},${FLOOR - 10} ${CX + 18},${FLOOR - 1} Z`, fill: "var(--aa-soil)", opacity: 0.55 });
  const sun = el("g");
  const sunCore = el("circle", { cx: CX + 62, cy: 34, r: 11, fill: "var(--aa-sun)" });
  const rays: El[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r1 = 15, r2 = 20;
    rays.push(el("line", { x1: CX + 62 + Math.cos(a) * r1, y1: 34 + Math.sin(a) * r1, x2: CX + 62 + Math.cos(a) * r2, y2: 34 + Math.sin(a) * r2, stroke: "var(--aa-sun)", "stroke-width": 2.4, "stroke-linecap": "round" }));
  }
  sun.append(sunCore, ...rays);
  const c = coin(CX, FLOOR - 10, BLUE, 0.95, coinUrl);
  const { g, stem, leaves } = makeSprout(CX, FLOOR - 6);
  const drops = [0, 1, 2].map((i) => el("ellipse", { cx: CX - 26 + i * 26, cy: 36, rx: 2.2, ry: 4, fill: "var(--aa-water-hi)", opacity: 0 }));
  const sp = sparkle(CX - 40, 46, 9);
  root.append(soil, mound, sun, c, g, ...drops, sp);
  const SUN_O = `${CX + 62} 34`;
  const stat = () => {
    gsap.set(c, { opacity: 0 });
    gsap.set(stem, { strokeDashoffset: 0 });
    leaves.forEach((l) => gsap.set(l, { svgOrigin: `${l._ax} ${l._ay}`, scale: 1 }));
    gsap.set(sun, { y: 0, opacity: 1 });
    gsap.set(sp, { transformOrigin: sp._org, scale: 1, opacity: 0.9, y: 0 });
  };
  const play = () => {
    gsap.set(c, { y: -34, opacity: 0 });
    gsap.set(stem, { strokeDashoffset: 100 });
    leaves.forEach((l) => gsap.set(l, { svgOrigin: `${l._ax} ${l._ay}`, scale: 0 }));
    gsap.set(sun, { y: 26, opacity: 0 });
    gsap.set(sp, { scale: 0, opacity: 0, y: 0, transformOrigin: sp._org });
    gsap.to(sun, { rotation: 360, duration: 26, ease: "none", repeat: -1, svgOrigin: SUN_O });
    const tl = gsap.timeline();
    tl.fromTo(c, { y: -34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power2.in" });
    tl.to(c, { y: 9, opacity: 0, duration: 0.3, ease: "power1.in" }); // buried
    tl.to(sun, { y: 0, opacity: 1, duration: 0.6, ease: "back.out(1.4)" }, "-=.2"); // sun rises
    drops.forEach((d, i) => {
      tl.fromTo(d, { y: 0, opacity: 0.9 }, { y: 46, opacity: 0, duration: 0.55, ease: "power1.in" }, 0.9 + i * 0.14);
    });
    tl.to(stem, { strokeDashoffset: 0, duration: 0.65, ease: "power1.out" }, "-=.35");
    tl.to(leaves, { scale: 1, duration: 0.36, ease: "back.out(2.3)", stagger: 0.13 }, "-=.34");
    // sway loop
    tl.add(() => {
      gsap.to(g, { rotation: 3.2, svgOrigin: `${CX} ${FLOOR - 6}`, duration: 1.9, ease: "sine.inOut", yoyo: true, repeat: -1 });
      breathe(sp, 0);
    }, "-=.02");
    return tl;
  };
  return { play, stat };
};

// ENRICHED — compounding: the tower duplicates upward while a ×N multiplier badge
// flips through 1→2→3→4; sparks celebrate each doubling.
const buildCompound: Builder = (root, _s, coinUrl, _c2, _lev, _route, _splits, _alts, combo) => {
  // The strategy composer supplies its real steps — render the atomic pipeline
  // when there's an actual PIPELINE (≥2 stations). A 0–1 step compose has nothing
  // to walk through, so it gets the compounding FLYWHEEL instead.
  if (combo && combo.length > 1) return buildCombo(root, coinUrl, combo);
  // THE FLYWHEEL: yield visibly leaves the stack, rides the orbit, and DIVES BACK
  // IN — and that impact is what spawns the next coin. Growth is CAUSED on-screen,
  // and each successive lap runs faster (compounding accelerates). The ×N counter
  // is a real digit reel (the perp reel grammar), not a text swap.
  const SX = CX - 10;
  const shadow = floorShadow(SX, FLOOR + 2, 30);
  const base = el("ellipse", { cx: SX, cy: FLOOR - 2, rx: 24, ry: 5.5, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.6 });
  const coins = [0, 1, 2, 3].map((i) => coin(SX, FLOOR - 12 - i * 12, BLUE, 1, coinUrl));
  const topYof = (i: number) => FLOOR - 12 - i * 12;
  // the yield's orbit track (faint, dashed — the flywheel's rail)
  const orbit = el("ellipse", { cx: SX + 34, cy: 62, rx: 52, ry: 30, fill: "none", stroke: "var(--aa-grid)", "stroke-width": 1.4, "stroke-dasharray": "3 7", opacity: 0.8 });
  // the yield spark that rides it (a glowing mote, not a full coin)
  const mote = el("circle", { cx: 0, cy: 0, r: 4, fill: "var(--aa-spark)", opacity: 0 });
  const moteGlow = el("circle", { cx: 0, cy: 0, r: 8.5, fill: "color-mix(in srgb, var(--aa-spark) 42%, transparent)", opacity: 0 });
  const impact = el("ellipse", { cx: SX, cy: 0, rx: 16, ry: 5, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2, opacity: 0 });
  // ×N digit reel (top-right)
  const RW = { x: CX + 40, y: 46, w: 42, h: 24 };
  const reelBox = el("rect", { x: RW.x, y: RW.y, width: RW.w, height: RW.h, rx: 12, fill: "var(--aa-obj)", stroke: "var(--aa-dim)", "stroke-width": 1.6 });
  const reelClipId = `aacmp${COIN_UID++}`;
  const reelClip = el("clipPath", { id: reelClipId });
  reelClip.append(el("rect", { x: RW.x + 1, y: RW.y + 1, width: RW.w - 2, height: RW.h - 2, rx: 11 }));
  const reel = el("g", { "clip-path": `url(#${reelClipId})` });
  const RSTEP2 = 22;
  const reelDigits: El[] = [];
  for (let i = 0; i < 4; i++) {
    const t = el("text", { x: RW.x + RW.w / 2, y: RW.y + 17 + i * RSTEP2, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "14", fill: "var(--aa-grn)" });
    t.textContent = `×${i + 1}`;
    reelDigits.push(t);
    reel.append(t);
  }
  const sp = [sparkle(SX - 36, 42, 9), sparkle(CX + 20, 28, 8)];
  root.append(shadow, base, orbit, ...coins, moteGlow, mote, impact, reelClip, reelBox, reel, ...sp);
  const REEL_O = `${RW.x + RW.w / 2} ${RW.y + RW.h / 2}`;
  const showR = (i: number) => -i * RSTEP2; // reel offset for ×(i+1)
  const reset = () => {
    coins.forEach((cc, i) => gsap.set(cc, { scale: i === 0 ? 1 : 0, opacity: i === 0 ? 1 : 0, y: 0, scaleY: 1, transformOrigin: "center" }));
    gsap.set(reelDigits, { y: showR(0) });
    gsap.set([mote, moteGlow], { opacity: 0, x: 0, y: 0 });
    gsap.set(impact, { opacity: 0 });
  };
  const stat = () => {
    coins.forEach((cc) => gsap.set(cc, { scale: 1, opacity: 1, y: 0, scaleY: 1, transformOrigin: "center" }));
    gsap.set(reelDigits, { y: showR(3) });
    gsap.set([mote, moteGlow], { opacity: 0 });
    gsap.set(orbit, { opacity: 0.8 });
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    sp.forEach((s) => gsap.set(s, { scale: 0, opacity: 0, y: 0, transformOrigin: s._org }));
    reset();
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.0, onRepeat: reset });
    // one flywheel LAP: yield lifts off the stack top → rides the orbit's right arc
    // → dives back into the stack — the impact spawns the next coin. `speed` < 1
    // makes each successive lap quicker: compounding accelerating before your eyes.
    const lap = (i: number, speed: number) => {
      const top = topYof(i - 1); // current stack top
      const start = { x: SX, y: top - 8 };
      // launch off the stack
      tl.set([mote, moteGlow], { x: 0, y: 0 }, `+=${0.08 * speed}`);
      tl.set([mote, moteGlow], { attr: { cx: start.x, cy: start.y } }, "<");
      tl.to([mote, moteGlow], { opacity: 1, duration: 0.12 * speed }, "<");
      // ride: up-right along the orbit, then swing down-right → dive back to the NEW top
      tl.to([mote, moteGlow], { x: 52, duration: 0.34 * speed, ease: "power1.out" }, "<");
      tl.to([mote, moteGlow], { y: -(start.y - 34), duration: 0.34 * speed, ease: "power2.out" }, "<");
      tl.to([mote, moteGlow], { x: 20, duration: 0.3 * speed, ease: "power1.in" }, ">");
      tl.to([mote, moteGlow], { y: topYof(i) - 6 - start.y, duration: 0.3 * speed, ease: "power2.in" }, "<");
      tl.to([mote, moteGlow], { x: 0, duration: 0.14 * speed, ease: "power2.in" }, ">");
      // IMPACT: mote vanishes into the stack → ring wave + squash → the next coin pops
      tl.set(impact, { attr: { cy: topYof(i) + 4 } });
      tl.to([mote, moteGlow], { opacity: 0, duration: 0.08 * speed }, "<");
      tl.fromTo(impact, { scale: 0.4, opacity: 0.95, svgOrigin: `${SX} ${topYof(i) + 4}` }, { scale: 1.7, opacity: 0, duration: 0.4 * speed, ease: "power2.out" }, "<");
      tl.fromTo(coins[i], { scale: 0, opacity: 0, y: 8, scaleY: 0.8 }, { scale: 1, opacity: 1, y: 0, scaleY: 1, duration: 0.4 * speed, ease: "elastic.out(1.1, 0.5)", transformOrigin: "center" }, "<+.05");
      // the reel RATCHETS up one notch with the pop
      tl.to(reelDigits, { y: showR(i), duration: 0.3 * speed, ease: "back.out(2.4)" }, "<");
      tl.fromTo(reelBox, { scale: 1.1 }, { scale: 1, duration: 0.24 * speed, ease: "back.out(3)", svgOrigin: REEL_O }, "<");
    };
    lap(1, 1);
    lap(2, 0.82);
    lap(3, 0.66);
    tl.add(() => sp.forEach((s, i) => floatSpark(s, i)), "-=.1");
    tl.to({}, { duration: 1.0 });
    tl.add(() => { sp.forEach((s) => gsap.killTweensOf(s)); gsap.set(sp, { scale: 0, opacity: 0, y: 0 }); });
    return tl;
  };
  return { play, stat };
};

// ENRICHED — the stake stack secured in a STRONGBOX: coins settle in, the shackle
// swings shut, then the combination DIAL spins with a click-back — locked, earning.
const buildVault: Builder = (root, _s, coinUrl) => {
  const shadow = floorShadow(CX, FLOOR + 6, 52);
  const body = el("rect", { x: CX - 48, y: 38, width: 96, height: 80, rx: 12, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2.5 });
  const win = el("rect", { x: CX - 37, y: 48, width: 74, height: 62, rx: 7, fill: "var(--aa-slot)" });
  const shackle = el("path", { d: `M${CX - 18},40 L${CX - 18},22 A18,18 0 0 1 ${CX + 18},22 L${CX + 18},40`, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 7, "stroke-linecap": "round" });
  // combination dial on the right pane
  const dial = el("g");
  const dialFace = el("circle", { cx: CX + 24, cy: 79, r: 10, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2 });
  const dialTick = el("line", { x1: CX + 24, y1: 79, x2: CX + 24, y2: 71.5, stroke: "var(--aa-spark)", "stroke-width": 2.2, "stroke-linecap": "round" });
  dial.append(dialFace, dialTick);
  const cB = coin(CX - 12, 98, BLUE, 0.8, coinUrl), cM = coin(CX - 12, 89, BLUE, 0.8, coinUrl), cT = coin(CX - 12, 80, BLUE, 0.8, coinUrl);
  const sp = [sparkle(CX - 26, 60, 7), sparkle(CX - 2, 55, 8)];
  root.append(shadow, body, win, shackle, cB, cM, cT, dial, ...sp);
  const PIVOT = `${CX + 18} 40`;
  const DIAL_O = `${CX + 24} 79`;
  const stat = () => {
    gsap.set([cB, cM, cT], { y: 0, opacity: 1 });
    gsap.set(shackle, { rotation: 0, opacity: 1, svgOrigin: PIVOT });
    gsap.set(dialTick, { rotation: 210, svgOrigin: DIAL_O });
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    sp.forEach((s) => gsap.set(s, { scale: 0, opacity: 0, y: 0, transformOrigin: s._org }));
    gsap.set(shackle, { rotation: 38, opacity: 1, svgOrigin: PIVOT });
    gsap.set(dialTick, { rotation: 0, svgOrigin: DIAL_O });
    const tl = gsap.timeline();
    tl.fromTo(cB, { y: -54, opacity: 0 }, { y: 0, opacity: 1, duration: 0.48, ease: "back.out(1.5)" });
    tl.fromTo(cM, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(2)" }, "-=.1");
    tl.fromTo(cT, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(2)" }, "-=.12");
    tl.add(() => sp.forEach((s, i) => floatSpark(s, i)), "-=.05");
    tl.to(shackle, { rotation: 0, duration: 0.55, ease: "back.out(2.4)", svgOrigin: PIVOT }, "-=.15");
    // the dial spins shut: overshoot forward, click back
    tl.to(dialTick, { rotation: 250, duration: 0.7, ease: "power2.inOut", svgOrigin: DIAL_O }, "-=.2");
    tl.to(dialTick, { rotation: 210, duration: 0.32, ease: "back.out(2.6)", svgOrigin: DIAL_O });
    return tl;
  };
  return { play, stat };
};

// REBUILT — providing liquidity is a PAIR: both coins are TOSSED into the pool
// one after the other (tumbling arcs), each impact throws a droplet crown +
// expanding surface ripples, and the WATER LEVEL RISES with every deposit (TVL
// grows). Once both settle on the bed, they pulse and an LP PEARL — the minted
// position — floats up and hovers beneath the surface. Bubbles drift forever.
const buildPool: Builder = (root, side, coinUrl, coinUrl2) => {
  const out = side === "short"; // withdraw / remove-liquidity → the pair comes OUT, level drops, LP burns
  const SURF = 66;
  const waterA = `M-4,${H + 4} L-4,${SURF} C30,${SURF - 6} 56,${SURF - 6} 90,${SURF} C124,${SURF + 6} 150,${SURF + 6} 184,${SURF} C218,${SURF - 6} 240,${SURF - 6} ${W + 4},${SURF} L${W + 4},${H + 4} Z`;
  const waterB = `M-4,${H + 4} L-4,${SURF} C30,${SURF + 6} 56,${SURF + 6} 90,${SURF} C124,${SURF - 6} 150,${SURF - 6} 184,${SURF} C218,${SURF + 6} 240,${SURF + 6} ${W + 4},${SURF} L${W + 4},${H + 4} Z`;
  const gid = `aapw${COIN_UID++}`;
  const grad = el("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse", x1: CX, y1: SURF - 8, x2: CX, y2: H });
  grad.append(
    el("stop", { offset: "0%", "stop-color": "var(--aa-water-hi)", "stop-opacity": 0.5 }),
    el("stop", { offset: "7%", "stop-color": "var(--aa-water)", "stop-opacity": 0.6 }),
    el("stop", { offset: "55%", "stop-color": "var(--aa-water)", "stop-opacity": 0.32 }),
    el("stop", { offset: "100%", "stop-color": "var(--aa-water)", "stop-opacity": 0 }),
  );
  const defs = el("defs");
  defs.append(grad);
  const waterG = el("g"); // level rises by shifting the whole body up
  const water = el("path", { d: waterA, fill: `url(#${gid})` });
  waterG.append(water);
  // the pair — A lands left of center, B right; both wear their real icons
  const AXp = CX - 40, BXp = CX + 40;
  const cA = coin(AXp, 96, BLUE, 0.9, coinUrl);
  const cB = coin(BXp, 94, BLUE2, 0.9, coinUrl2 ?? coinUrl);
  // splash kit per impact: 5-droplet crown + 2 expanding surface ripples
  const crownFor = (ix: number) =>
    [[-46, -30], [-26, -44], [-2, -50], [24, -44], [44, -28]].map(() =>
      el("ellipse", { cx: ix, cy: SURF - 2, rx: 2.6, ry: 4.4, fill: "var(--aa-water-hi)", opacity: 0 }));
  const ripplesFor = (ix: number) =>
    [0, 1].map(() => el("ellipse", { cx: ix, cy: SURF + 1, rx: 14, ry: 3.6, fill: "none", stroke: "var(--aa-water-hi)", "stroke-width": 1.8, opacity: 0 }));
  const crownA = crownFor(AXp), crownB = crownFor(BXp);
  const rippleA = ripplesFor(AXp), rippleB = ripplesFor(BXp);
  const crownT: [number, number][] = [[-46, -30], [-26, -44], [-2, -50], [24, -44], [44, -28]];
  // the LP pearl — the minted position, glowing between the pair
  const pearl = el("g");
  const pearlGlow = el("circle", { cx: CX, cy: 92, r: 9, fill: "color-mix(in srgb, var(--av-accent) 30%, transparent)" });
  const pearlCore = el("circle", { cx: CX, cy: 92, r: 5, fill: "var(--aa-spark)", stroke: "var(--aa-blue)", "stroke-width": 1.6 });
  const pearlHi = el("circle", { cx: CX - 1.6, cy: 90.4, r: 1.4, fill: "#fff", opacity: 0.85 });
  pearl.append(pearlGlow, pearlCore, pearlHi);
  const bubbles = [0, 1, 2, 3].map((i) => el("circle", { cx: CX - 44 + i * 30, cy: 108, r: 2 + (i % 2), fill: "none", stroke: "var(--aa-water-hi)", "stroke-width": 1.4, opacity: 0 }));
  const sp = [sparkle(CX - 62, 96, 8), sparkle(CX + 60, 92, 7)];
  root.append(defs, cA, cB, pearl, waterG, ...crownA, ...crownB, ...rippleA, ...rippleB, ...bubbles, ...sp);
  const PEARL_O = `${CX} 92`;
  const stat = () => {
    if (out) {
      // withdrawn: the pair has surfaced up-and-out, the level dropped, the LP is gone
      gsap.set(cA, { x: -14, y: -74, rotation: -14, opacity: 1, transformOrigin: "center" });
      gsap.set(cB, { x: 14, y: -76, rotation: 14, opacity: 1, transformOrigin: "center" });
      gsap.set(waterG, { y: 2 });
      gsap.set([...crownA, ...crownB, ...rippleA, ...rippleB], { opacity: 0 });
      gsap.set(pearl, { opacity: 0, scale: 0, svgOrigin: PEARL_O });
      gsap.set(bubbles, { opacity: 0 });
      sp.forEach((s) => gsap.set(s, { scale: 1, opacity: 0.5, transformOrigin: s._org }));
      return;
    }
    gsap.set(cA, { x: 0, y: 0, rotation: -12, opacity: 1, transformOrigin: "center" });
    gsap.set(cB, { x: 0, y: 0, rotation: 12, opacity: 1, transformOrigin: "center" });
    gsap.set(waterG, { y: -5 });
    gsap.set([...crownA, ...crownB], { opacity: 0 });
    gsap.set([...rippleA, ...rippleB], { opacity: 0 });
    gsap.set(pearl, { y: -14, opacity: 1, scale: 1, svgOrigin: PEARL_O });
    gsap.set(bubbles, { opacity: 0 });
    sp.forEach((s) => gsap.set(s, { scale: 1, opacity: 0.7, transformOrigin: s._org }));
  };
  // one toss: coin arcs in from off-screen, tumbling; crown + ripples + level rise on impact
  const toss = (tl: gsap.core.Timeline, c: El, fromX: number, spinTo: number, crown: El[], ripples: El[], level: number, at: number) => {
    tl.fromTo(c, { x: fromX, y: -92, rotation: 0, opacity: 1 }, { x: 0, y: -26, rotation: spinTo * 0.7, duration: 0.55, ease: "power2.in" }, at);
    const impact = at + 0.55;
    crown.forEach((d, i) => {
      tl.fromTo(d, { x: 0, y: 0, opacity: 0.95, scale: 1 }, { x: crownT[i][0], y: crownT[i][1], opacity: 0, scale: 0.5, duration: 0.6, ease: "power1.out" }, impact);
    });
    ripples.forEach((r, i) => {
      tl.fromTo(r, { scale: 0.3, opacity: 0.9, svgOrigin: `${Number(r.getAttribute("cx"))} ${SURF + 1}` }, { scale: 2.4 + i, opacity: 0, duration: 0.7 + i * 0.2, ease: "power2.out" }, impact + i * 0.08);
    });
    tl.to(waterG, { y: `-=${level}`, duration: 0.5, ease: "sine.out" }, impact); // TVL rises
    tl.to(c, { y: 0, rotation: spinTo, duration: 1.1, ease: "power1.out" }, impact - 0.04); // sink + settle
  };
  // one extraction: the coin surfaces from the pool and lifts up-and-out; the level DROPS
  const extract = (tl: gsap.core.Timeline, c: El, spinFrom: number, toX: number, crown: El[], ripples: El[], ix: number, level: number, at: number) => {
    tl.set(c, { x: 0, y: 0, rotation: spinFrom, opacity: 1, transformOrigin: "center" }, at);
    crown.forEach((d, i) => {
      tl.fromTo(d, { x: 0, y: 0, opacity: 0.9, scale: 1 }, { x: crownT[i][0], y: crownT[i][1], opacity: 0, scale: 0.5, duration: 0.6, ease: "power1.out" }, at);
    });
    ripples.forEach((r, i) => {
      tl.fromTo(r, { scale: 0.3, opacity: 0.85, svgOrigin: `${ix} ${SURF + 1}` }, { scale: 2.4 + i, opacity: 0, duration: 0.7 + i * 0.2, ease: "power2.out" }, at + i * 0.08);
    });
    tl.to(waterG, { y: `+=${level}`, duration: 0.6, ease: "sine.out" }, at); // TVL drops as liquidity leaves
    tl.to(c, { y: -84, x: toX, rotation: 0, duration: 0.75, ease: "power2.out" }, at + 0.02); // surfaces + lifts away
  };
  const play = () => {
    gsap.set([cA, cB], { opacity: 0 });
    gsap.set(waterG, { y: 0 });
    gsap.set([...crownA, ...crownB], { x: 0, y: 0, opacity: 0, scale: 1 });
    sp.forEach((s) => gsap.set(s, { scale: 0, opacity: 0, transformOrigin: s._org }));
    gsap.to(water, { attr: { d: waterB }, duration: 2.2, ease: "sine.inOut", yoyo: true, repeat: -1 });
    bubbles.forEach((b, i) => {
      gsap.fromTo(b, { y: 0, opacity: 0 }, { y: -30 - (i % 2) * 10, opacity: 0.6, duration: 2.4 + i * 0.4, ease: "sine.in", repeat: -1, delay: 1.4 + i * 0.7, onRepeat: () => gsap.set(b, { opacity: 0 }) });
      gsap.to(b, { x: i % 2 === 0 ? 5 : -5, duration: 1.2, ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.35 });
    });
    if (out) {
      // WITHDRAW: the LP position dissolves, the pair surfaces and lifts OUT, level drops.
      const otl = gsap.timeline({ repeat: -1, repeatDelay: 1.4 });
      otl.set(cA, { x: 0, y: 0, rotation: -12, opacity: 1, transformOrigin: "center" });
      otl.set(cB, { x: 0, y: 0, rotation: 12, opacity: 1, transformOrigin: "center" });
      otl.set(waterG, { y: -5 });
      otl.set(pearl, { y: -14, opacity: 1, scale: 1, svgOrigin: PEARL_O });
      otl.set([...crownA, ...crownB], { x: 0, y: 0, opacity: 0, scale: 1 });
      otl.set(sp, { scale: 0, opacity: 0 });
      // ① the LP position swells then bursts into sparks (the position is closed)
      otl.to(pearl, { scale: 1.25, duration: 0.22, ease: "power1.out", svgOrigin: PEARL_O }, 0.3);
      otl.to(pearl, { scale: 0, opacity: 0, duration: 0.34, ease: "power2.in", svgOrigin: PEARL_O }, 0.52);
      otl.fromTo(sp, { scale: 0, opacity: 0 }, { scale: 1, opacity: 0.85, duration: 0.3, ease: "back.out(1.6)", stagger: 0.08 }, 0.5);
      otl.to(sp, { scale: 0.6, opacity: 0, duration: 0.5, ease: "power1.in", stagger: 0.06 }, 0.95);
      // ② the pair surfaces and lifts OUT — A up-left, B up-right; the level drops
      extract(otl, cA, -12, -16, crownA, rippleA, AXp, 2.5, 0.82);
      extract(otl, cB, 12, 16, crownB, rippleB, BXp, 2.5, 1.02);
      // ③ a gentle settle bob at the extracted height
      otl.to([cA, cB], { y: "-=4", duration: 1.0, ease: "sine.inOut", yoyo: true, repeat: 1, transformOrigin: "center" }, ">-0.2");
      otl.to({}, { duration: 0.2 });
      return otl;
    }
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4 });
    tl.set([cA, cB], { opacity: 0, x: 0, y: 0, rotation: 0, transformOrigin: "center" });
    tl.set(waterG, { y: 0 });
    tl.set(pearl, { y: 0, opacity: 0, scale: 0, svgOrigin: PEARL_O });
    tl.set(sp, { scale: 0, opacity: 0 });
    // ① the pair is tossed in — A from the left, B from the right a beat later
    toss(tl, cA, -66, -12, crownA, rippleA, 2.5, 0.1);
    toss(tl, cB, 66, 12, crownB, rippleB, 2.5, 0.75);
    // ② the coins pulse… and the LP pearl rises between them
    tl.to([cA, cB], { scale: 1.07, duration: 0.18, ease: "sine.inOut", yoyo: true, repeat: 1, transformOrigin: "center" }, 2.35);
    tl.to(pearl, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(2.4)" }, 2.6);
    tl.to(pearl, { y: -14, duration: 0.9, ease: "power1.out" }, 2.75);
    tl.to(pearl, { y: -10, duration: 1.1, ease: "sine.inOut", yoyo: true, repeat: 1 }, ">"); // hover bob
    // ③ rewards shimmer in the water
    tl.to(sp, { scale: 1, opacity: 0.8, duration: 0.4, ease: "back.out(1.6)", stagger: 0.15 }, 2.9);
    tl.to(sp, { y: "-=5", duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: 1, stagger: 0.1 }, ">-1.6");
    tl.to({}, { duration: 0.2 });
    return tl;
  };
  return { play, stat };
};

// ─── ② Return / 收成 ─────────────────────────────────────────────────────────

// REBUILT — the STRONGBOX UNLOCKS and releases your money: the dial spins BACK,
// the shackle pops open, the window glows, and the coin launches with a speed-line
// burst, flying a clean parabola into your pouch — which swallows it with a gulp;
// the confirmation ring + check fire ON the pouch and the camera punches in on the
// catch. The exact inverse of buildVault's "locked, earning" — money coming HOME.
const buildWithdraw: Builder = (root, _s, coinUrl) => {
  const cameraRig = makeCamera(root);
  const host = cameraRig.cam;
  // strongbox (buildVault's vocabulary, releasing instead of locking)
  const BX0 = 34, BW = 84, BTOP = 42, BBOT = FLOOR;
  const Bc = BX0 + BW / 2;
  const shadowV = floorShadow(Bc, FLOOR + 5, 46);
  const body = el("rect", { x: BX0, y: BTOP, width: BW, height: BBOT - BTOP, rx: 11, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2.4 });
  const win = el("rect", { x: BX0 + 10, y: BTOP + 9, width: BW - 20, height: BBOT - BTOP - 18, rx: 6, fill: "var(--aa-slot)" });
  const winGlow = el("rect", { x: BX0 + 10, y: BTOP + 9, width: BW - 20, height: BBOT - BTOP - 18, rx: 6, fill: "color-mix(in srgb, var(--av-accent) 30%, transparent)", opacity: 0 });
  const shackle = el("path", { d: `M${Bc - 16},${BTOP + 2} L${Bc - 16},${BTOP - 14} A16,16 0 0 1 ${Bc + 16},${BTOP - 14} L${Bc + 16},${BTOP + 2}`, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 6.4, "stroke-linecap": "round" });
  const dial = el("g");
  const dialFace = el("circle", { cx: Bc + 22, cy: BBOT - 22, r: 9, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2 });
  const dialTick = el("line", { x1: Bc + 22, y1: BBOT - 22, x2: Bc + 22, y2: BBOT - 28.5, stroke: "var(--aa-spark)", "stroke-width": 2.2, "stroke-linecap": "round" });
  dial.append(dialFace, dialTick);
  const PIVOT = `${Bc + 16} ${BTOP + 2}`;
  const DIAL_O = `${Bc + 22} ${BBOT - 22}`;
  // launch speed-lines (burst behind the coin as it leaves the box)
  const CY0 = BTOP + 34;
  const burst = [0, 1, 2].map((i) => el("line", { x1: Bc + 6, y1: CY0 - 6 + i * 6, x2: Bc + 6 + 16 + i * 7, y2: CY0 - 6 + i * 6, stroke: "var(--aa-spark)", "stroke-width": 2, "stroke-linecap": "round", opacity: 0 }));
  // pouch wallet (right)
  const WXc = 202, WW = 56, WTOP = 66, WBOT = 108;
  const Wmid = (WTOP + WBOT) / 2;
  const shadowW = floorShadow(WXc, FLOOR + 2, 32);
  const pouch = el("rect", { x: WXc - WW / 2, y: WTOP, width: WW, height: WBOT - WTOP, rx: 9, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2.2 });
  const stitch = el("rect", { x: WXc - WW / 2 + 5, y: WTOP + 5, width: WW - 10, height: WBOT - WTOP - 10, rx: 6, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.55 });
  // coin slot on the pouch top — flashes as the coin enters (no janky flap)
  const slot = el("line", { x1: WXc - 14, y1: WTOP + 1, x2: WXc + 14, y2: WTOP + 1, stroke: "var(--aa-blue)", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.6 });
  const clasp = el("circle", { cx: WXc + WW / 2 - 9, cy: Wmid, r: 3.4, fill: "var(--aa-blue)", opacity: 0.9 });
  // the travelling coin + brighter ghost trail
  const cw = coin(Bc, CY0, BLUE, 0.9, coinUrl);
  const ghosts = [0, 1].map((i) => {
    const g = coin(Bc, CY0, BLUE, 0.8 - i * 0.1, coinUrl);
    gsap.set(g, { opacity: 0 });
    return g;
  });
  // confirmation anchored ON the pouch
  const check = el("path", { d: `M${WXc - 8},${Wmid} L${WXc - 2.5},${Wmid + 5.5} L${WXc + 9},${Wmid - 6.5} `, fill: "none", stroke: "var(--aa-grn)", "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round", pathLength: 100, "stroke-dasharray": 100, "stroke-dashoffset": 100 });
  const ring = el("circle", { cx: WXc, cy: Wmid, r: 14, fill: "none", stroke: "var(--aa-grn-top)", "stroke-width": 2.4, opacity: 0 });
  const sp = [sparkle(WXc + 30, WTOP - 16, 7), sparkle(Bc + 28, BTOP - 18, 7)];
  host.append(shadowV, shadowW, body, win, winGlow, shackle, dial, ...burst, ...ghosts, cw, pouch, stitch, slot, clasp, ring, check, ...sp);
  const DX = WXc - Bc;
  const LIFT = -(CY0 - (WTOP - 16)); // arc peak clears the pouch mouth
  const DROP = WTOP + 10 - CY0 - LIFT; // then falls into the slot
  const stat = () => {
    cameraRig.set(CX, 74, 1);
    gsap.set([cw, ...ghosts], { opacity: 0 });
    gsap.set(shackle, { rotation: 34, svgOrigin: PIVOT });   // popped open
    gsap.set(dialTick, { rotation: 0, svgOrigin: DIAL_O });   // spun back
    gsap.set(winGlow, { opacity: 0.35 });
    gsap.set(check, { strokeDashoffset: 0 });
    gsap.set(ring, { opacity: 0 });
    gsap.set(burst, { opacity: 0 });
    gsap.set(slot, { opacity: 0.6 });
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    sp.forEach((s) => gsap.set(s, { scale: 0, opacity: 0, y: 0, transformOrigin: s._org }));
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.15 });
    cameraRig.set(CX, 74, 1);
    tl.set([cw, ...ghosts], { x: 0, y: 0, opacity: 0, rotation: 0, scale: 1, transformOrigin: "center" });
    tl.set(shackle, { rotation: 0, svgOrigin: PIVOT });
    tl.set(dialTick, { rotation: 210, svgOrigin: DIAL_O });
    tl.set(winGlow, { opacity: 0 });
    tl.set(check, { strokeDashoffset: 100 });
    tl.set(ring, { opacity: 0, scale: 1, svgOrigin: `${WXc} ${Wmid}` });
    tl.set(burst, { opacity: 0, x: 0 });
    tl.set(slot, { opacity: 0.6, scaleX: 1, svgOrigin: `${WXc} ${WTOP}` });
    tl.set(pouch, { scaleY: 1, svgOrigin: `${WXc} ${WBOT}` });
    // ① UNLOCK: the dial spins back with a click, the shackle pops open, glow rises
    tl.to(dialTick, { rotation: -30, duration: 0.55, ease: "power2.inOut", svgOrigin: DIAL_O });
    tl.to(dialTick, { rotation: 0, duration: 0.28, ease: "back.out(2.6)", svgOrigin: DIAL_O });
    tl.to(shackle, { rotation: 34, duration: 0.4, ease: "back.out(2.8)", svgOrigin: PIVOT }, "-=.15");
    tl.to(winGlow, { opacity: 0.8, duration: 0.28, ease: "power1.out" }, "<");
    // ② LAUNCH: the coin appears in the window and takes off with a speed burst
    tl.to(cw, { opacity: 1, duration: 0.16 }, ">-.05");
    tl.to(burst, { opacity: 0.9, x: 10, duration: 0.16, ease: "power1.out", stagger: 0.03 }, ">+.05");
    tl.to(burst, { opacity: 0, x: 26, duration: 0.28, ease: "power1.in", stagger: 0.03 }, ">-.05");
    tl.to(winGlow, { opacity: 0.12, duration: 0.5 }, "<");
    // clean parabola: x sweeps, y rises then falls into the slot; ghosts trail behind
    [cw, ...ghosts].forEach((e, i) => {
      const t0 = i === 0 ? "<-.15" : `<+${0.07}`;
      if (i > 0) tl.set(e, { opacity: 0.34 - i * 0.12 }, t0);
      tl.to(e, { x: DX, duration: 0.66, ease: "power1.inOut" }, t0);
      tl.to(e, { y: LIFT, duration: 0.33, ease: "power2.out" }, "<");
      tl.to(e, { y: LIFT + DROP, duration: 0.33, ease: "power2.in" }, "<+.33");
      tl.to(e, { rotation: 150, duration: 0.66, ease: "none" }, "<-.33");
      if (i > 0) tl.set(e, { opacity: 0 }, "<+.38");
    });
    // ③ the CATCH: slot flashes, coin is swallowed, pouch gulps — camera punches in
    tl.to(slot, { opacity: 1, scaleX: 1.25, duration: 0.12, ease: "power1.out" }, ">-.12");
    tl.to(cw, { opacity: 0, scale: 0.4, duration: 0.14, ease: "power2.in" }, "<");
    tl.to(slot, { opacity: 0.6, scaleX: 1, duration: 0.25, ease: "back.out(2)" }, ">");
    tl.fromTo(pouch, { scaleY: 1 }, { scaleY: 0.92, duration: 0.1, ease: "power1.in", svgOrigin: `${WXc} ${WBOT}` }, "<-.1");
    tl.to(pouch, { scaleY: 1, duration: 0.3, ease: "back.out(3)" }, ">");
    cameraRig.zoomTo(tl, WXc, Wmid, 1.16, 0.32, "<-.05");
    // ④ RECEIVED: ring + check fire on the pouch itself, sparks bloom, camera eases back
    tl.fromTo(ring, { scale: 0.4, opacity: 0.95 }, { scale: 1.7, opacity: 0, duration: 0.5, ease: "power2.out" }, "<+.05");
    tl.to(check, { strokeDashoffset: 0, duration: 0.32, ease: "power1.out" }, "<+.08");
    tl.add(() => sp.forEach((s, i) => floatSpark(s, i)), "<+.1");
    cameraRig.reset(tl, 0.5, ">+.35");
    tl.to({}, { duration: 0.6 });
    tl.add(() => { sp.forEach((s) => gsap.killTweensOf(s)); gsap.set(sp, { scale: 0, opacity: 0, y: 0 }); });
    tl.to(check, { strokeDashoffset: 100, duration: 0.2 });
    return tl;
  };
  return { play, stat };
};

// ENRICHED — beam-up: a light cone snaps on, the hero coin rises through it and
// FLIPS to face you while the rest of the stack sinks away; sparks float.
const buildUnstake: Builder = (root, _s, coinUrl) => {
  const beam = el("path", { d: `M${CX - 12},18 L${CX + 12},18 L${CX + 30},${FLOOR} L${CX - 30},${FLOOR} Z`, fill: "var(--aa-spotlight)", opacity: 0 });
  const shadow = floorShadow(CX, FLOOR + 2, 30);
  const base = coin(CX, FLOOR - 14, BLUE, 1, coinUrl);
  const mid = coin(CX, FLOOR - 24, BLUE, 1, coinUrl);
  const hero = frontCoin(CX, FLOOR - 36, 16, coinUrl);
  const sp = [sparkle(CX - 52, 30, 10), sparkle(CX + 50, 58, 8), sparkle(CX + 30, 24, 7)];
  root.append(beam, shadow, base, mid, hero, ...sp);
  const HERO_UP = -44;
  const stat = () => {
    gsap.set(hero, { y: HERO_UP, scaleY: 1, opacity: 1, transformOrigin: "center" });
    gsap.set([mid, base], { y: 24, opacity: 0 });
    gsap.set(beam, { opacity: 0 });
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    gsap.set(hero, { y: 0, scaleY: 0.42, opacity: 1, transformOrigin: "center" });
    gsap.set([mid, base], { y: 0, opacity: 1 });
    gsap.set(beam, { opacity: 0, svgOrigin: `${CX} 18`, scaleY: 0.2 });
    sp.forEach((s) => gsap.set(s, { scale: 1, opacity: 0, y: 0, transformOrigin: s._org }));
    const tl = gsap.timeline();
    tl.to(beam, { opacity: 0.9, scaleY: 1, duration: 0.4, ease: "power2.out" });
    tl.to(hero, { y: HERO_UP, scaleY: 1, duration: 0.7, ease: "power2.out" }, "-=.15");
    tl.to([mid, base], { y: 24, opacity: 0, duration: 0.55, ease: "power1.in" }, "-=.6");
    tl.to(beam, { opacity: 0.25, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: -1 }, "-=.2");
    tl.to(sp, { opacity: 0.9, duration: 0.35, ease: "power1.out", stagger: 0.08 }, "-=.5");
    tl.add(() => sp.forEach((s, i) => gsap.to(s, { y: "-=5", duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.22 })));
    return tl;
  };
  return { play, stat };
};

// ENRICHED — harvest: the plant pulls free, three berries pop off the leaves and
// arc into a basket that slides in from the right; sparks float over the haul.
const buildHarvest: Builder = (root) => {
  const soil = el("line", { x1: CX - 54, y1: FLOOR - 6, x2: CX + 30, y2: FLOOR - 6, stroke: "var(--aa-soil)", "stroke-width": 4.5, "stroke-linecap": "round" });
  const { g, stem, leaves } = makeSprout(CX - 14, FLOOR - 10);
  gsap.set(stem, { strokeDashoffset: 0 });
  leaves.forEach((l) => gsap.set(l, { svgOrigin: `${l._ax} ${l._ay}`, scale: 1 }));
  // basket: half-ellipse with weave lines
  const basket = el("g");
  const bowl = el("path", { d: `M${CX + 40},92 A24,17 0 0 0 ${CX + 88},92 L${CX + 82},110 A18,10 0 0 1 ${CX + 46},110 Z`, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2, "stroke-linejoin": "round" });
  const weave1 = el("path", { d: `M${CX + 44},99 Q${CX + 64},106 ${CX + 84},99`, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 1.2, opacity: 0.6 });
  basket.append(bowl, weave1);
  const berries = [0, 1, 2].map((i) => el("circle", { cx: CX - 20 + i * 9, cy: FLOOR - 40 - (i % 2) * 9, r: 4.2, fill: i === 1 ? "var(--aa-grn-top)" : "var(--aa-grn)" }));
  const sp = [sparkle(CX - 48, 36, 9), sparkle(CX + 66, 60, 8)];
  root.append(soil, g, basket, ...berries, ...sp);
  const PLANT_UP = -26;
  const stat = () => {
    gsap.set(g, { y: PLANT_UP, opacity: 1 });
    gsap.set(basket, { x: 0, opacity: 1 });
    berries.forEach((b, i) => gsap.set(b, { x: CX + 64 - Number(b.getAttribute("cx")), y: 96 - Number(b.getAttribute("cy")) + (i % 2) * 3, opacity: 1 }));
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    gsap.set(g, { y: 0, opacity: 1 });
    gsap.set(basket, { x: 60, opacity: 0 });
    berries.forEach((b) => gsap.set(b, { x: 0, y: 0, opacity: 1, scale: 1, transformOrigin: "center" }));
    sp.forEach((s) => gsap.set(s, { scale: 1, opacity: 0, y: 0, transformOrigin: s._org }));
    const tl = gsap.timeline();
    tl.to(basket, { x: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)" });
    tl.to(g, { y: 4, duration: 0.16, ease: "power1.in" }, "-=.2");
    tl.to(g, { y: PLANT_UP, duration: 0.6, ease: "power2.out" });
    berries.forEach((b, i) => {
      const bx = Number(b.getAttribute("cx")), by = Number(b.getAttribute("cy"));
      const txTo = CX + 58 + i * 7 - bx, tyTo = 94 - by + (i % 2) * 3;
      tl.to(b, { x: txTo * 0.55, y: tyTo * 0.4 - 22, duration: 0.28, ease: "power1.out" }, 0.72 + i * 0.12);
      tl.to(b, { x: txTo, y: tyTo, duration: 0.3, ease: "power2.in" }, ">");
      tl.to(b, { scale: 0.92, duration: 0.1, ease: "power1.in" }, ">").to(b, { scale: 1, duration: 0.18, ease: "back.out(3)" }, ">");
    });
    tl.to(sp, { opacity: 0.9, duration: 0.35, ease: "power1.out", stagger: 0.08 }, "-=.2");
    tl.add(() => sp.forEach((s, i) => gsap.to(s, { y: "-=5", duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.22 })));
    return tl;
  };
  return { play, stat };
};

// ─── ③ Leverage / 張力 ───────────────────────────────────────────────────────

// REBUILT as a TRADING TERMINAL — everything anchored inside one chart panel
// (fusing the PerpTicket's vocabulary): side badge with a fast ×N leverage reel,
// scrolling candles CLIPPED to the panel, the ENTRY line sweeping in and FILLING
// on touch (ring burst + FILLED stamp + scene jolt + a PnL ticker counting up),
// and the liquidation line holding safe distance on the risk side.
const buildPerp: Builder = (root, side, _c1, _c2, lev) => {
  const cameraRig = makeCamera(root);
  const host = cameraRig.cam;
  const down = side === "short";
  const dirColor = down ? "var(--aa-red)" : "var(--aa-grn)";
  const target = Math.max(2, Math.min(20, Math.round(lev ?? 5)));
  // ── the panel (the anchor everything lives in) ─────────────────────────────
  const P = { x: 28, y: 30, w: 204, h: 88 };
  const panel = el("rect", { x: P.x, y: P.y, width: P.w, height: P.h, rx: 10, fill: "color-mix(in srgb, var(--av-paper) 45%, transparent)", stroke: "var(--aa-dim)", "stroke-width": 1.6, opacity: 0.9 });
  const clipId = `aaperp${COIN_UID++}`;
  const clip = el("clipPath", { id: clipId });
  clip.append(el("rect", { x: P.x + 1.5, y: P.y + 1.5, width: P.w - 3, height: P.h - 3, rx: 9 }));
  const inner = el("g", { "clip-path": `url(#${clipId})` });
  // ── candles, clipped to the panel — each individually dimmed so the price dot
  //    can LIGHT THEM UP as it sweeps past ─────────────────────────────────────
  const tape = el("g");
  const cds: El[] = [];
  for (let i = 0; i < 14; i++) {
    const cxC = P.x + 8 + i * 19;
    const bull = (i * 7) % 3 !== 0;
    const bodyH = 7 + ((i * 5) % 11);
    const yTop = P.y + 26 + ((i * 9) % 34);
    const cd = el("g", { opacity: 0.38 });
    cd.append(
      el("line", { x1: cxC, y1: yTop - 4, x2: cxC, y2: yTop + bodyH + 4, stroke: "var(--aa-dim)", "stroke-width": 1.1, opacity: 0.7 }),
      el("rect", { x: cxC - 3, y: yTop, width: 6, height: bodyH, rx: 1.5, fill: bull ? "var(--aa-grn)" : "var(--aa-red)", opacity: 0.45 }),
    );
    cds.push(cd);
    tape.append(cd);
  }
  inner.append(tape);
  // ── side badge + fast leverage reel (top-left, inside the panel) ───────────
  const BD = { x: P.x + 10, y: P.y + 8, h: 17 };
  const sideTxt = down ? "SHORT" : "LONG";
  const badgeW = sideTxt.length * 6.6 + 14;
  const badge = el("rect", { x: BD.x, y: BD.y, width: badgeW, height: BD.h, rx: 8.5, fill: `color-mix(in srgb, ${down ? "var(--aa-red)" : "var(--aa-grn)"} 20%, transparent)`, stroke: dirColor, "stroke-width": 1.5 });
  const badgeTx = el("text", { x: BD.x + badgeW / 2, y: BD.y + 12, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "9.5", fill: dirColor, "letter-spacing": ".05em" });
  badgeTx.textContent = sideTxt;
  // reel window right after the badge: "×" + rolling digits
  const RW = { x: BD.x + badgeW + 6, y: BD.y, w: 34, h: BD.h };
  const reelBox = el("rect", { x: RW.x, y: RW.y, width: RW.w, height: RW.h, rx: 8.5, fill: "color-mix(in srgb, var(--aa-ten) 16%, transparent)", stroke: "var(--aa-ten)", "stroke-width": 1.5 });
  const reelClipId = `aaperp${COIN_UID++}`;
  const reelClip = el("clipPath", { id: reelClipId });
  reelClip.append(el("rect", { x: RW.x + 1, y: RW.y + 1, width: RW.w - 2, height: RW.h - 2, rx: 7.5 }));
  const reel = el("g", { "clip-path": `url(#${reelClipId})` });
  const RSTEP = 16;
  const digits: El[] = [];
  for (let i = 0; i < target; i++) {
    const t = el("text", { x: RW.x + RW.w / 2 + 3, y: RW.y + 12.5 + i * RSTEP, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "11", fill: "var(--aa-ten-top)" });
    t.textContent = String(i + 1);
    digits.push(t);
    reel.append(t);
  }
  const times = el("text", { x: RW.x + 6, y: RW.y + 12.5, "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "10", fill: "var(--aa-ten)" });
  times.textContent = "×";
  // ── entry + liquidation lines (the ticket's risk picture, on the chart) ────
  const entryY = P.y + (down ? 34 : 52);
  const liqY = down ? P.y + 16 : P.y + 74;
  const entry = el("line", { x1: P.x + 6, y1: entryY, x2: P.x + P.w - 6, y2: entryY, stroke: dirColor, "stroke-width": 2, "stroke-dasharray": "5 5", "stroke-linecap": "round" });
  const entryTag = el("text", { x: P.x + P.w - 10, y: entryY - 4, "text-anchor": "end", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "7.5", fill: dirColor, "letter-spacing": ".06em" });
  entryTag.textContent = "ENTRY";
  const liq = el("line", { x1: P.x + 6, y1: liqY, x2: P.x + P.w - 6, y2: liqY, stroke: "var(--aa-red)", "stroke-width": 1.3, "stroke-dasharray": "2.5 5", opacity: 0.65 });
  const liqTag = el("text", { x: P.x + P.w - 10, y: liqY - 3.5, "text-anchor": "end", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "7", fill: "var(--aa-red)", opacity: 0.75, "letter-spacing": ".06em" });
  liqTag.textContent = "LIQ";
  inner.append(liq, liqTag, entry, entryTag);
  // ── the FILL beat: crossing ring, FILLED stamp, PnL ticker ─────────────────
  const CROSS = { x: P.x + P.w - 44, y: entryY };
  const ring = el("circle", { cx: CROSS.x, cy: CROSS.y, r: 9, fill: "none", stroke: "var(--aa-grn-top)", "stroke-width": 2.4, opacity: 0 });
  // the PRICE is the actor: this dot runs the tape left→right into the entry line;
  // the fill is their collision. Ghosts trail it; candles light up as it passes.
  const dot = el("circle", { cx: CROSS.x, cy: CROSS.y, r: 3.2, fill: dirColor, opacity: 0 });
  const dotGhosts = [0, 1].map((i) => el("circle", { cx: CROSS.x, cy: CROSS.y, r: 2.6 - i * 0.7, fill: dirColor, opacity: 0 }));
  const DOT_DX = P.x + 14 - CROSS.x; // start offset (left edge of the tape)
  const APPR = down ? 1 : -1; // approach the entry from the non-liq side
  const stamp = el("g");
  const STW = 56;
  const STX = P.x + P.w - 10 - STW; // top-right of the panel, clear of the chart
  const stampBox = el("rect", { x: STX, y: P.y + 8, width: STW, height: 17, rx: 8.5, fill: "color-mix(in srgb, var(--aa-grn) 14%, var(--av-paper))", stroke: "var(--aa-grn)", "stroke-width": 1.8 });
  const stampTx = el("text", { x: STX + STW / 2, y: P.y + 20, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "9.5", fill: "var(--aa-grn)", "letter-spacing": ".12em" });
  stampTx.textContent = "FILLED";
  stamp.append(stampBox, stampTx);
  const STAMP_O = `${STX + STW / 2} ${P.y + 16.5}`;
  const pnl = el("text", { x: RW.x + RW.w + 8, y: RW.y + 12.5, "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "10", fill: "var(--aa-grn)", opacity: 0 });
  pnl.textContent = "+0.0%";
  const sp = [sparkle(P.x + P.w + 12, 44, 7, "var(--aa-ten-top)"), sparkle(P.x - 12, 96, 7, "var(--aa-ten-top)")];
  host.append(clip, reelClip, panel, inner, badge, badgeTx, reelBox, reel, times, ring, ...dotGhosts, dot, stamp, pnl, ...sp);
  const showD = (d: number) => -(d - 1) * RSTEP;
  const pnlTarget = 4 + target * 0.8; // the ticker's resting profit, scaled by leverage
  const stat = () => {
    cameraRig.set(CX, P.y + P.h / 2, 1);
    gsap.set(digits, { y: showD(target) });
    gsap.set([badge, badgeTx, reelBox, times, entryTag], { opacity: 1, y: 0 });
    gsap.set(entry, { scaleX: 1, opacity: 1 });
    gsap.set([liq, liqTag], { opacity: 0.7 });
    gsap.set(stamp, { scale: 1, rotation: -6, opacity: 1, svgOrigin: STAMP_O });
    gsap.set(dot, { opacity: 1, x: 0, y: 0 });
    gsap.set(dotGhosts, { opacity: 0 });
    gsap.set(cds, { opacity: 0.38 });
    gsap.set(pnl, { opacity: 1 });
    pnl.textContent = `+${pnlTarget.toFixed(1)}%`;
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    sp.forEach((s) => gsap.set(s, { scale: 0, opacity: 0, y: 0, transformOrigin: s._org }));
    gsap.to(tape, { x: -38, duration: 3.2, ease: "none", repeat: -1, modifiers: { x: gsap.utils.unitize(gsap.utils.wrap(-38, 0)) } });
    const counter = { v: 0 };
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.3 });
    cameraRig.set(CX, P.y + P.h / 2, 1);
    tl.set(digits, { y: showD(1) });
    tl.set([badge, badgeTx, reelBox, times], { opacity: 0, y: -8 });
    tl.set(entry, { scaleX: 0, transformOrigin: "right center", opacity: 1 });
    tl.set(entryTag, { opacity: 0 });
    tl.set([liq, liqTag], { opacity: 0 });
    tl.set(stamp, { scale: 0, rotation: 14, opacity: 0, svgOrigin: STAMP_O });
    tl.set([ring, dot, ...dotGhosts], { opacity: 0 });
    tl.set([dot, ...dotGhosts], { x: DOT_DX, y: APPR * 14 });
    tl.set(cds, { opacity: 0.38 });
    tl.set(pnl, { opacity: 0 });
    tl.add(() => { counter.v = 0; pnl.textContent = "+0.0%"; });
    // ① the ticket arrives: badge drops in, the reel RIPS past the leverage and
    //    RATCHETS back — a real slot-machine land, not a single tween
    tl.to([badge, badgeTx, reelBox, times], { opacity: 1, y: 0, duration: 0.32, ease: "back.out(2.2)", stagger: 0.04 });
    tl.fromTo(reelBox, { scaleY: 1 }, { scaleY: 1.12, duration: 0.16, ease: "power1.out", svgOrigin: `${RW.x + RW.w / 2} ${RW.y + RW.h / 2}` }, "-=.05");
    tl.to(digits, { y: showD(target) - RSTEP * 0.55, duration: Math.min(0.45, 0.16 + target * 0.022), ease: "power2.in" }, "<");
    tl.to(digits, { y: showD(target), duration: 0.34, ease: "back.out(2.4)" }, ">");
    tl.to(reelBox, { scaleY: 1, duration: 0.28, ease: "back.out(3)", svgOrigin: `${RW.x + RW.w / 2} ${RW.y + RW.h / 2}` }, "<");
    // ② the market order sweeps in: entry line draws right→left, LIQ fades in
    tl.to(entry, { scaleX: 1, duration: 0.4, ease: "power2.out" }, ">+.05");
    tl.to(entryTag, { opacity: 1, duration: 0.2 }, ">-.1");
    tl.to([liq, liqTag], { opacity: 0.7, duration: 0.35 }, "<");
    // ③ PRICE RUNS THE TAPE: the dot (with ghost trail) hunts the entry line —
    //    candles light up as it passes, LIQ pulses with tension as it nears
    const HUNT = 0.95;
    tl.to(dot, { opacity: 1, duration: 0.1 }, ">-.05");
    dotGhosts.forEach((g, i) => tl.to(g, { opacity: 0.35 - i * 0.14, duration: 0.1 }, "<"));
    [dot, ...dotGhosts].forEach((e, i) => {
      const t0 = i === 0 ? "<" : `<+${0.06}`;
      tl.to(e, { x: 0, duration: HUNT, ease: "power1.inOut" }, t0);
      tl.to(e, { y: APPR * 7, duration: HUNT * 0.36, ease: "sine.inOut" }, "<");
      tl.to(e, { y: APPR * 11, duration: HUNT * 0.3, ease: "sine.inOut" }, `<+${HUNT * 0.36}`);
      tl.to(e, { y: 0, duration: HUNT * 0.34, ease: "power2.in" }, `<+${HUNT * 0.3}`);
    });
    tl.to(cds, { opacity: 0.85, duration: 0.12, stagger: HUNT / 15, ease: "power1.out" }, `<-${HUNT}`);
    tl.to(cds, { opacity: 0.38, duration: 0.3, stagger: HUNT / 15, ease: "power1.in" }, "<+.14");
    tl.fromTo(liq, { opacity: 0.55 }, { opacity: 0.95, duration: 0.3, yoyo: true, repeat: 1, ease: "sine.inOut" }, `<+${HUNT * 0.4}`);
    tl.set(dotGhosts, { opacity: 0 }, `>+.02`);
    // ④ FILL — the collision: ring bursts, stamp slams, the CAMERA PUNCHES IN
    tl.fromTo(ring, { scale: 0.4, opacity: 0.95, svgOrigin: `${CROSS.x} ${CROSS.y}` }, { scale: 2.2, opacity: 0, duration: 0.5, ease: "power2.out" }, ">-.06");
    cameraRig.zoomTo(tl, CROSS.x, CROSS.y, 1.22, 0.3, "<");
    tl.to(stamp, { scale: 1, rotation: -6, opacity: 1, duration: 0.26, ease: "back.out(2.6)" }, "<+.08");
    tl.fromTo(root, { y: down ? -2.5 : 2.5 }, { y: 0, duration: 0.32, ease: "elastic.out(1.6,0.4)" }, "<");
    tl.fromTo(entry, { opacity: 1 }, { opacity: 0.45, duration: 0.12, yoyo: true, repeat: 3 }, "<");
    cameraRig.reset(tl, 0.55, ">+.25");
    // ④ the position breathes: PnL ticks up, sparks bloom, stamp settles
    tl.to(pnl, { opacity: 1, duration: 0.2 }, ">");
    tl.to(counter, {
      v: pnlTarget, duration: 0.9, ease: "power2.out",
      onUpdate: () => { pnl.textContent = `+${counter.v.toFixed(1)}%`; },
    }, "<");
    tl.to(sp, { scale: 1, opacity: 1, duration: 0.25, ease: "back.out(2)", stagger: 0.1 }, "<+.2");
    tl.to(sp, { scale: 0.55, opacity: 0.5, duration: 0.8, ease: "sine.inOut", yoyo: true, repeat: 1, stagger: 0.1 }, ">-.4");
    tl.to(stamp, { scale: 0.96, duration: 0.9, ease: "sine.inOut" }, "<");
    tl.to({}, { duration: 0.35 });
    return tl;
  };
  return { play, stat };
};

// ─── ④ Transfer / form · 位移 · 變形 ─────────────────────────────────────────

// ENRICHED — the coin is sleeved into a capsule that SEALS and launches through
// the chevron gate with speed lines; the gate flashes as it passes.
const buildSend: Builder = (root, _s, coinUrl) => {
  const chev = el("path", { d: `M${CX + 58},56 L${CX + 74},72 L${CX + 58},88 M${CX + 42},56 L${CX + 58},72 L${CX + 42},88`, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 3.4, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.7 });
  const c = coin(CX - 66, 70, BLUE, 1, coinUrl);
  // capsule: two half-shells that close around the coin
  const shellL = el("path", { d: `M${CX - 66},46 A26,26 0 0 0 ${CX - 66},98`, fill: "none", stroke: "var(--aa-blue)", "stroke-width": 3, "stroke-linecap": "round", opacity: 0 });
  const shellR = el("path", { d: `M${CX - 66},46 A26,26 0 0 1 ${CX - 66},98`, fill: "none", stroke: "var(--aa-blue)", "stroke-width": 3, "stroke-linecap": "round", opacity: 0 });
  // Speed lines — a stretched burst that streaks out BEHIND the coin as it launches
  // (the reference's velocity language, applied to Send's natural "speed moment").
  // Randomized y across the coin's height, length, width + depth → not a flat trio.
  // Built before `pod`, appended before `pod`, so they always sit UNDER the coin.
  const SPD = 7;
  const lines = Array.from({ length: SPD }, (_, i) => {
    const y = 48 + (i / (SPD - 1)) * 44 + (Math.random() * 6 - 3); // spread across coin
    const len = 12 + Math.random() * 26;
    return el("line", {
      x1: 0, y1: y.toFixed(1), x2: len.toFixed(1), y2: y.toFixed(1),
      stroke: "var(--aa-spark)", "stroke-width": (1.4 + Math.random() * 1.8).toFixed(1),
      "stroke-linecap": "round", opacity: 0,
    });
  });
  const pod = el("g");
  pod.append(c, shellL, shellR);
  root.append(chev, ...lines, pod); // pod LAST ⇒ coin paints over the lines
  const stat = () => {
    gsap.set(pod, { x: 0, opacity: 1 });
    gsap.set([shellL, shellR], { opacity: 0 });
    gsap.set(lines, { opacity: 0, x: 0, scaleX: 1 });
  };
  const play = () => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.7 });
    tl.set(pod, { x: 0, opacity: 0 });
    tl.set([shellL, shellR], { opacity: 0, x: 0 });
    tl.set(lines, { opacity: 0, x: 0, scaleX: 0.28, transformOrigin: "left center" });
    tl.to(pod, { opacity: 1, duration: 0.22 });
    // shells snap shut around the coin
    tl.fromTo(shellL, { opacity: 0, x: -10 }, { opacity: 0.9, x: 0, duration: 0.28, ease: "back.out(2.2)" }, "-=.05");
    tl.fromTo(shellR, { opacity: 0, x: 10 }, { opacity: 0.9, x: 0, duration: 0.28, ease: "back.out(2.2)" }, "<");
    // wind-up then LAUNCH
    tl.to(pod, { x: -8, duration: 0.18, ease: "power1.out" });
    tl.to(pod, { x: 128, duration: 0.5, ease: "power3.in" });
    // the burst: stretch (scaleX) + rush right, staggered so streaks fire in sequence
    // rather than in lockstep. Depth-varied peak opacity. Bezier mirrors the reference.
    tl.fromTo(lines,
      { opacity: 0, x: 34, scaleX: 0.28 },
      { opacity: (i: number) => 0.32 + ((i * 7) % 5) * 0.11, x: 150, scaleX: 1,
        duration: 0.46, ease: "power2.out", transformOrigin: "left center",
        stagger: { each: 0.045, from: "edges" } },
      "-=.46");
    tl.to(lines, { opacity: 0, x: "+=28", duration: 0.24, ease: "power1.in", stagger: { each: 0.03, from: "edges" } }, "-=.2");
    tl.to(pod, { x: 170, opacity: 0, duration: 0.24, ease: "power1.in" }, "-=.24");
    tl.fromTo(chev, { opacity: 0.7 }, { opacity: 1, duration: 0.14, yoyo: true, repeat: 1 }, "-=.32");
    return tl;
  };
  return { play, stat };
};

// ── camera: a zoomable/pannable viewport over a motif ─────────────────────────
// Wraps a builder's content in a `cam` group clipped to the viewport, and
// animates cam's transform so a target point scales up to screen center — a real
// camera push-in. Because the clip lives on a STATIC parent, off-screen content
// is cropped instead of spilling onto the card. The stage backdrop (grid/motes)
// sits OUTSIDE the camera, so it holds as a parallax plate while the scene zooms.
function makeCamera(root: El): {
  cam: El;
  zoomTo: (tl: gsap.core.Timeline, tx: number, ty: number, scale: number, dur: number, at?: gsap.Position) => void;
  reset: (tl: gsap.core.Timeline, dur: number, at?: gsap.Position) => void;
  set: (tx: number, ty: number, scale: number) => void;
} {
  const uid = `aacam${COIN_UID++}`;
  const defs = el("defs");
  const clip = el("clipPath", { id: uid });
  clip.append(el("rect", { x: 0, y: 0, width: W, height: H }));
  defs.append(clip);
  const wrap = el("g", { "clip-path": `url(#${uid})` }); // static: fixed viewport crop
  const cam = el("g"); // this transforms
  wrap.append(cam);
  root.append(defs, wrap);
  const to = (s: number, tx: number, ty: number) => ({ x: W / 2 - s * tx, y: H / 2 - s * ty, scale: s, transformOrigin: "0 0" });
  return {
    cam,
    zoomTo: (tl, tx, ty, scale, dur, at = "<") => {
      tl.to(cam, { ...to(scale, tx, ty), duration: dur, ease: "power3.inOut" }, at);
    },
    reset: (tl, dur, at = "<") => {
      tl.to(cam, { x: 0, y: 0, scale: 1, transformOrigin: "0 0", duration: dur, ease: "power3.inOut" }, at);
    },
    set: (tx, ty, scale) => gsap.set(cam, to(scale, tx, ty)),
  };
}

// ROUTED swap — EVERY parallel route drawn as its own full lane (fixing the
// "shows only one" read). The paying token on the left fans into N lanes, each
// with its protocol-logo stations and input share; a rider coin flows down each
// lane at once, lighting its stations, and all lanes converge into the received
// token on the right with a scene push for punch. Dominant lane is brightest.
function buildSwapRouted(root: El, coinUrl: string | undefined, coinUrl2: string | undefined, route: RouteStop[], _splits: number, alts: RouteAlt[]): Api {
  const cameraRig = makeCamera(root);
  const host = cameraRig.cam;
  // assemble ALL routes uniformly (main + alts), largest share first, cap 3 lanes
  const altR = alts.filter((a) => a.stops.length > 0);
  const mainShare = altR.length ? Math.max(0, 100 - altR.reduce((a, r) => a + r.sharePct, 0)) : 100;
  const allRoutes = [{ stops: route, share: mainShare }, ...altR.map((a) => ({ stops: a.stops, share: a.sharePct }))].slice(0, 4);
  const laneN = allRoutes.length;
  const LX = 38, RX = 222, midCY = 72;
  const spread = laneN === 1 ? 0 : laneN === 2 ? 32 : laneN === 3 ? 30 : 25;
  const laneCY = (i: number) => midCY + (i - (laneN - 1) / 2) * spread;

  // left (paying) + right (received) terminals
  const shadowL = floorShadow(LX, midCY + 20, 20);
  const fromTok = coin(LX, midCY - 7, BLUE, 0.92, coinUrl);
  const toTok = frontCoin(RX, midCY, 14, coinUrl2);
  const toSpark = sparkle(RX + 16, midCY - 22, 7);

  const R = 10.5;
  type Lane = { g: El; lane: El; riders: El[]; stationNodes: { g: El; halo: El; ring: El; x: number; y: number }[]; share: El; y: number; pts: { x: number; y: number }[]; dominant: boolean };
  const lanes: Lane[] = allRoutes.map((rt, i) => {
    const y = laneCY(i);
    const dominant = i === 0;
    const g = el("g");
    const sN = Math.min(rt.stops.length, 3);
    const sx = (j: number) => LX + 40 + (j + 0.5) * ((RX - 40 - (LX + 40)) / sN);
    const pts = [{ x: LX + 12, y: midCY }, ...Array.from({ length: sN }, (_, j) => ({ x: sx(j), y })), { x: RX - 12, y: midCY }];
    // smooth cubic through the fan
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      d += ` C${a.x + (b.x - a.x) / 2},${a.y} ${a.x + (b.x - a.x) / 2},${b.y} ${b.x},${b.y}`;
    }
    // stream thickness + brightness ∝ split weight — the signature aggregator look
    const sw = 1.3 + (rt.share / 100) * 3.4;
    const lane = el("path", { d, fill: "none", stroke: dominant ? "var(--aa-blue)" : "var(--aa-blue2)", "stroke-width": sw.toFixed(2), "stroke-linecap": "round", opacity: (0.4 + (rt.share / 100) * 0.42).toFixed(2), pathLength: 100, "stroke-dasharray": 100, "stroke-dashoffset": 100 });
    g.append(lane);
    const stationNodes = rt.stops.slice(0, 3).map((stop, j) => {
      const x = sx(j);
      const sg = el("g");
      const halo = el("circle", { cx: x, cy: y, r: R + 4, fill: "color-mix(in srgb, var(--av-accent) 24%, transparent)", opacity: 0 });
      const disc = el("circle", { cx: x, cy: y, r: R, fill: "var(--av-paper)", stroke: "var(--aa-dim)", "stroke-width": 1.5 });
      sg.append(halo, disc);
      if (stop.logo) {
        const cid = `aasl${COIN_UID++}`;
        const cp = el("clipPath", { id: cid });
        cp.append(el("circle", { cx: x, cy: y, r: R - 1.4 }));
        sg.append(cp, el("image", { href: stop.logo, x: x - (R - 1.4), y: y - (R - 1.4), width: (R - 1.4) * 2, height: (R - 1.4) * 2, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${cid})` }));
      } else {
        const mono = el("text", { x, y: y + 3.2, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "9", fill: "var(--av-ink)" });
        mono.textContent = (stop.label[0] ?? "?").toUpperCase();
        sg.append(mono);
      }
      const ring = el("circle", { cx: x, cy: y, r: R + 2, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2, opacity: 0 });
      const name = el("text", { x, y: y + R + 9.5, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "6.8", fill: "var(--aa-dim)", "letter-spacing": ".04em" });
      name.textContent = stop.label.toUpperCase().slice(0, 12);
      sg.append(ring, name);
      g.append(sg);
      return { g: sg, halo, ring, x, y };
    });
    const share = el("text", { x: RX - 20, y: y < midCY ? y - R - 5 : y + R + 16, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "8.5", fill: dominant ? "var(--aa-blue)" : "var(--aa-dim)", "letter-spacing": ".05em" });
    share.textContent = `${rt.share}%`;
    g.append(share);
    // more tokens flow down the fatter (higher-share) lanes — a denser liquidity stream
    const riderN = Math.min(5, Math.max(2, Math.round(rt.share / 22)));
    const riders = Array.from({ length: riderN }, (_, k) => {
      const rc = coin(pts[0].x, pts[0].y, dominant ? BLUE : BLUE2, Math.max(0.18, (dominant ? 0.6 : 0.5) - k * 0.09), coinUrl);
      gsap.set(rc, { opacity: 0 });
      return rc;
    });
    g.append(...riders);
    return { g, lane, riders, stationNodes, share, y, pts, dominant };
  });

  const badge = el("text", { x: LX - 6, y: 130, "text-anchor": "start", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "8.5", fill: "var(--aa-dim)", "letter-spacing": ".12em", opacity: 0 });
  badge.textContent = laneN > 1 ? `SPLIT ×${laneN}` : "1 ROUTE";
  host.append(shadowL, ...lanes.map((l) => l.g), fromTok, toTok, toSpark, badge);

  const stat = () => {
    cameraRig.set(CX, midCY, 1);
    lanes.forEach((l) => {
      gsap.set(l.lane, { strokeDashoffset: 0 });
      gsap.set(l.g, { opacity: 1 });
      l.stationNodes.forEach((s) => { gsap.set(s.g, { scale: 1, opacity: 1, svgOrigin: `${s.x} ${s.y}` }); gsap.set(s.halo, { opacity: 0.45 }); gsap.set(s.ring, { opacity: 0 }); });
      gsap.set(l.share, { opacity: 0.85 });
      gsap.set(l.riders, { opacity: 0 });
    });
    gsap.set(fromTok, { opacity: 1, scale: 1, transformOrigin: "center" });
    gsap.set(toTok, { opacity: 1, scale: 1, transformOrigin: "center" });
    gsap.set(toSpark, { transformOrigin: toSpark._org, scale: 1, opacity: 0.85, y: 0 });
    gsap.set(badge, { opacity: laneN > 1 ? 0.75 : 0 });
  };

  const play = () => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.15 });
    cameraRig.set(CX, midCY, 1);
    tl.set(fromTok, { opacity: 0, scale: 0.7, transformOrigin: "center" });
    tl.set(toTok, { opacity: 0, scale: 0.6, transformOrigin: "center" });
    tl.set(toSpark, { scale: 0, opacity: 0, y: 0, transformOrigin: toSpark._org });
    tl.set(badge, { opacity: 0 });
    lanes.forEach((l) => {
      tl.set(l.lane, { strokeDashoffset: 100 });
      tl.set(l.g, { opacity: 1 });
      l.stationNodes.forEach((s) => { tl.set(s.g, { scale: 0, opacity: 0, svgOrigin: `${s.x} ${s.y}` }); tl.set(s.halo, { opacity: 0 }); tl.set(s.ring, { opacity: 0, scale: 1, svgOrigin: `${s.x} ${s.y}` }); });
      tl.set(l.share, { opacity: 0 });
      tl.set(l.riders, { opacity: 0, x: 0, y: 0 });
    });
    // ① the paying token lands, every lane draws itself, stations pop in
    tl.to(fromTok, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" });
    lanes.forEach((l, li) => {
      tl.to(l.lane, { strokeDashoffset: 0, duration: 0.6, ease: "power1.inOut" }, 0.2 + li * 0.08);
      l.stationNodes.forEach((s, si) => tl.to(s.g, { scale: 1, opacity: 1, duration: 0.36, ease: "back.out(2.4)" }, 0.4 + li * 0.08 + si * 0.1));
      tl.to(l.share, { opacity: l.dominant ? 0.9 : 0.7, duration: 0.3 }, 0.5 + li * 0.08);
    });
    if (laneN > 1) tl.to(badge, { opacity: 0.75, duration: 0.35 }, 0.6);
    // ② the value SPLITS: a rider flows down every lane at once, lighting stations
    const T0 = 1.05;
    const RIDE = 0.5;
    let maxEnd = T0;
    lanes.forEach((l) => {
      const legs = l.pts.length - 1;
      l.riders.forEach((rc, k) => {
        const start = T0 + k * 0.15; // wider stagger ⇒ a continuous stream down each lane
        if (k === 0) tl.to(rc, { opacity: 1, duration: 0.16 }, start);
        else { tl.set(rc, { opacity: Math.max(0.16, 0.4 - k * 0.07) }, start); }
        for (let i = 1; i < l.pts.length; i++) {
          const at = start + (i - 1) * RIDE;
          tl.to(rc, { x: l.pts[i].x - l.pts[0].x, y: l.pts[i].y - l.pts[0].y, duration: RIDE, ease: "power1.inOut" }, at);
          if (k === 0 && i <= l.stationNodes.length) {
            const s = l.stationNodes[i - 1];
            tl.to(s.halo, { opacity: 0.9, duration: 0.14 }, at + RIDE - 0.08);
            tl.fromTo(s.ring, { scale: 0.8, opacity: 0.95 }, { scale: 1.3, opacity: 0, duration: 0.42, ease: "power2.out" }, "<");
            tl.fromTo(s.g, { scale: 1 }, { scale: 1.12, duration: 0.1, ease: "power1.out", yoyo: true, repeat: 1, svgOrigin: `${s.x} ${s.y}` }, "<");
            tl.to(s.halo, { opacity: 0.45, duration: 0.35 }, ">");
          }
        }
        const end = start + legs * RIDE;
        maxEnd = Math.max(maxEnd, end);
        tl.to(rc, { scale: 0.4, opacity: 0, duration: 0.2, ease: "power2.in", transformOrigin: "center" }, end - 0.05);
      });
    });
    // ③ converge: received token pops, a gentle scene push punches the arrival
    cameraRig.zoomTo(tl, RX - 6, midCY, 1.12, 0.5, maxEnd - 0.35);
    tl.to(toTok, { opacity: 1, scale: 1, duration: 0.42, ease: "back.out(2.2)" }, maxEnd - 0.1);
    tl.fromTo(toTok, { scale: 1.14 }, { scale: 1, duration: 0.3, ease: "back.out(3)", transformOrigin: "center" }, ">");
    tl.to(toSpark, { scale: 1, opacity: 0.9, duration: 0.3, ease: "back.out(1.8)" }, "<");
    cameraRig.reset(tl, 0.55, ">+.1");
    tl.to(toSpark, { y: "-=5", duration: 1.0, ease: "sine.inOut", yoyo: true, repeat: 1 }, "<");
    return tl;
  };
  return { play, stat };
}


// MULTI-SWAP CONSOLIDATION — every input coin gets its OWN lane converging into
// the single received coin: sources pop in as a left column, lanes draw toward
// the target, each source drains riders (stamped with ITS icon) down its lane,
// and every arrival pumps the target bigger. Reads as "dust → one coin".
function buildSwapConverge(root: El, coins: RouteStop[], toUrl?: string): Api {
  const cameraRig = makeCamera(root);
  const host = cameraRig.cam;
  const shown = coins.slice(0, 4);
  const extra = coins.length - shown.length;
  const n = shown.length;
  const LX = 46, RX = 214, midCY = 72;
  const spread = n === 1 ? 0 : n === 2 ? 36 : n === 3 ? 31 : 26;
  const srcY = (i: number) => midCY + (i - (n - 1) / 2) * spread;

  const shadowR = floorShadow(RX, midCY + 22, 22);
  const toTok = frontCoin(RX, midCY, 15, toUrl);
  const toSpark = sparkle(RX + 18, midCY - 24, 7);
  const ring = el("circle", { cx: RX, cy: midCY, r: 19, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2, opacity: 0 });

  type Src = { g: El; tok: El; name: El; lane: El; riders: El[]; pts: { x: number; y: number }[] };
  const srcs: Src[] = shown.map((c, i) => {
    const y = srcY(i);
    const g = el("g");
    // lane: a smooth cubic from the source into the target's left edge
    const pts = [{ x: LX + 13, y }, { x: LX + (RX - LX) * 0.55, y: midCY + (y - midCY) * 0.4 }, { x: RX - 17, y: midCY }];
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      d += ` C${a.x + (b.x - a.x) / 2},${a.y} ${a.x + (b.x - a.x) / 2},${b.y} ${b.x},${b.y}`;
    }
    const lane = el("path", { d, fill: "none", stroke: i === 0 ? "var(--aa-blue)" : "var(--aa-blue2)", "stroke-width": 1.9, "stroke-linecap": "round", opacity: 0.55, pathLength: 100, "stroke-dasharray": 100, "stroke-dashoffset": 100 });
    const tok = coin(LX, y, i % 2 ? BLUE2 : BLUE, 0.95, c.logo);
    const name = el("text", { x: LX, y: y + 21, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "6.8", fill: "var(--aa-dim)", "letter-spacing": ".05em" });
    name.textContent = c.label.toUpperCase().slice(0, 8);
    const riders = [0, 1].map((k) => {
      const rc = coin(pts[0].x, pts[0].y, i % 2 ? BLUE2 : BLUE, Math.max(0.2, 0.55 - k * 0.18), c.logo);
      gsap.set(rc, { opacity: 0 });
      return rc;
    });
    g.append(lane, ...riders, tok, name);
    return { g, tok, name, lane, riders, pts };
  });

  const badge = el("text", { x: LX - 8, y: 130, "text-anchor": "start", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "8.5", fill: "var(--aa-dim)", "letter-spacing": ".12em", opacity: 0 });
  badge.textContent = extra > 0 ? `CONSOLIDATE ×${coins.length} (+${extra} MORE)` : `CONSOLIDATE ×${coins.length}`;
  host.append(shadowR, ...srcs.map((s) => s.g), ring, toTok, toSpark, badge);

  const stat = () => {
    cameraRig.set(CX, midCY, 1);
    srcs.forEach((s) => {
      gsap.set(s.lane, { strokeDashoffset: 0 });
      gsap.set(s.tok, { opacity: 0.65, scale: 0.92, transformOrigin: "center" });
      gsap.set(s.name, { opacity: 0.7 });
      gsap.set(s.riders, { opacity: 0 });
    });
    gsap.set(toTok, { opacity: 1, scale: 1, transformOrigin: "center" });
    gsap.set(toSpark, { transformOrigin: toSpark._org, scale: 1, opacity: 0.85, y: 0 });
    gsap.set(ring, { opacity: 0 });
    gsap.set(badge, { opacity: 0.75 });
  };

  const play = () => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.1 });
    cameraRig.set(CX, midCY, 1);
    tl.set(toTok, { opacity: 0, scale: 0.55, transformOrigin: "center" });
    tl.set(toSpark, { scale: 0, opacity: 0, y: 0, transformOrigin: toSpark._org });
    tl.set(badge, { opacity: 0 });
    srcs.forEach((s) => {
      tl.set(s.lane, { strokeDashoffset: 100 });
      tl.set(s.tok, { opacity: 0, scale: 0.4, transformOrigin: "center" });
      tl.set(s.name, { opacity: 0 });
      tl.set(s.riders, { opacity: 0, x: 0, y: 0 });
    });
    // ① the dust lines up: sources pop in, lanes draw toward the (still empty) target
    srcs.forEach((s, i) => {
      tl.to(s.tok, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.2)" }, i * 0.09);
      tl.to(s.name, { opacity: 0.75, duration: 0.25 }, i * 0.09 + 0.08);
      tl.to(s.lane, { strokeDashoffset: 0, duration: 0.55, ease: "power1.inOut" }, 0.25 + i * 0.08);
    });
    tl.to(badge, { opacity: 0.75, duration: 0.3 }, 0.55);
    // ② every source DRAINS down its lane at once; each arrival pumps the target
    const T0 = 1.0, RIDE = 0.55;
    let firstHit = Infinity, lastHit = 0;
    srcs.forEach((s, i) => {
      s.riders.forEach((rc, k) => {
        const start = T0 + i * 0.12 + k * 0.34;
        tl.to(rc, { opacity: k === 0 ? 0.9 : 0.5, duration: 0.12 }, start);
        for (let p = 1; p < s.pts.length; p++) {
          tl.to(rc, { x: s.pts[p].x - s.pts[0].x, y: s.pts[p].y - s.pts[0].y, duration: RIDE / (s.pts.length - 1), ease: p === 1 ? "power1.in" : "power1.out" }, start + (p - 1) * (RIDE / (s.pts.length - 1)));
        }
        const hit = start + RIDE;
        firstHit = Math.min(firstHit, hit);
        lastHit = Math.max(lastHit, hit);
        tl.to(rc, { scale: 0.35, opacity: 0, duration: 0.16, ease: "power2.in", transformOrigin: "center" }, hit - 0.06);
        // the target swells with every arrival
        tl.fromTo(toTok, { scale: "+=0" }, { scale: 1.07, duration: 0.11, ease: "power1.out", transformOrigin: "center" }, hit - 0.03);
        tl.to(toTok, { scale: 1, duration: 0.2, ease: "back.out(2)", transformOrigin: "center" }, hit + 0.08);
        if (k === 0) tl.fromTo(ring, { scale: 0.7, opacity: 0.9, svgOrigin: `${RX} ${midCY}` }, { scale: 1.45, opacity: 0, duration: 0.4, ease: "power2.out" }, hit - 0.03);
      });
      // the source deflates as its value leaves
      tl.to(s.tok, { opacity: 0.55, scale: 0.86, duration: 0.5, ease: "power1.inOut", transformOrigin: "center" }, T0 + i * 0.12 + 0.2);
    });
    // the target COIN materialises at the first arrival
    tl.to(toTok, { opacity: 1, scale: 1, duration: 0.34, ease: "back.out(2.4)" }, firstHit - 0.2);
    // ③ settle: gentle push-in on the received coin + sparkle float
    cameraRig.zoomTo(tl, RX - 8, midCY, 1.1, 0.5, lastHit - 0.15);
    tl.to(toSpark, { scale: 1, opacity: 0.9, duration: 0.3, ease: "back.out(1.8)" }, lastHit + 0.05);
    cameraRig.reset(tl, 0.55, ">+.15");
    tl.to(toSpark, { y: "-=5", duration: 1.0, ease: "sine.inOut", yoyo: true, repeat: 1 }, "<");
    return tl;
  };
  return { play, stat };
}

// ENRICHED — the swap vortex: both coins sweep around the orbit with GHOST
// trails (delayed clones that light up while moving), pass each other, and
// settle in traded positions; a ring pulses at each crossover. When the live
// aggregator route is known, the ROUTED variant above takes over. When MANY
// input coins are given (multiSwap), the CONSOLIDATION variant takes over.
const buildSwap: Builder = (root, _s, coinUrl, coinUrl2, _lev, route, splits, alts, _combo, coins) => {
  if (coins && coins.length > 1) return buildSwapConverge(root, coins, coinUrl2);
  if (route && route.length > 0) return buildSwapRouted(root, coinUrl, coinUrl2, route, splits ?? 1, alts ?? []);
  const AX = CX - 66, BX = CX + 66, AY = 74, BY2 = 66;
  const DX = BX - AX; // travel span
  const orbit = el("ellipse", { cx: CX, cy: 70, rx: 78, ry: 26, fill: "none", stroke: "var(--aa-grid)", "stroke-width": 1.6, "stroke-dasharray": "3 7", opacity: 0.8 });
  const pulse = el("ellipse", { cx: CX, cy: 70, rx: 20, ry: 10, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2.2, opacity: 0 });
  // each coin = lead + 2 ghosts built at the SAME spot; ghosts replay the lead's
  // path a beat behind at low opacity — a motion trail with zero per-frame work.
  const mkSet = (x: number, y: number, pal: Pal, img?: string) => {
    const ghosts = [0, 1].map((i) => {
      const g = coin(x, y, pal, 0.94 - i * 0.12, img);
      gsap.set(g, { opacity: 0 });
      return g;
    });
    return { lead: coin(x, y, pal, 1, img), ghosts };
  };
  const A = mkSet(AX, AY, BLUE, coinUrl);
  const B = mkSet(BX, BY2, BLUE2, coinUrl2);
  root.append(orbit, pulse, ...A.ghosts, ...B.ghosts, A.lead, B.lead);
  const stat = () => {
    gsap.set(A.lead, { x: DX, y: BY2 - AY });
    gsap.set(B.lead, { x: -DX, y: AY - BY2 });
    gsap.set([...A.ghosts, ...B.ghosts], { opacity: 0 });
    gsap.set(pulse, { opacity: 0 });
  };
  // one half-orbit leg for a coin-set: x sweeps across while y arcs to a peak
  // then eases to the end; ghosts replay the identical path a beat behind.
  const leg = (tl: gsap.core.Timeline, set: { lead: El; ghosts: El[] }, fromX: number, toX: number, peakY: number, endY: number, at: number) => {
    [set.lead, ...set.ghosts].forEach((e, i) => {
      const t0 = at + i * 0.09;
      if (i > 0) {
        tl.set(e, { opacity: 0.3 - i * 0.11 }, t0);
        tl.set(e, { opacity: 0 }, t0 + 0.94);
      }
      tl.fromTo(e, { x: fromX }, { x: toX, duration: 0.9, ease: "power2.inOut", immediateRender: false }, t0);
      tl.to(e, { y: peakY, duration: 0.45, ease: "sine.out" }, t0);
      tl.to(e, { y: endY, duration: 0.45, ease: "sine.in" }, t0 + 0.45);
    });
  };
  const play = () => {
    gsap.set([A.lead, B.lead], { x: 0, y: 0, scale: 1, transformOrigin: "center" });
    gsap.set([...A.ghosts, ...B.ghosts], { x: 0, y: 0, opacity: 0 });
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.8 });
    // leg 1 — trade places: A arcs over the top, B dips under the bottom
    leg(tl, A, 0, DX, -26, BY2 - AY, 0);
    leg(tl, B, 0, -DX, 26, AY - BY2, 0);
    tl.fromTo(pulse, { scale: 0.5, opacity: 0.9, svgOrigin: `${CX} 70` }, { scale: 1.9, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.32);
    tl.to([A.lead, B.lead], { scale: 1.06, duration: 0.14, ease: "power1.out", transformOrigin: "center" }, 1.0);
    tl.to([A.lead, B.lead], { scale: 1, duration: 0.3, ease: "back.out(2.5)", transformOrigin: "center" }, 1.14);
    tl.to({}, { duration: 0.5 }, 1.44);
    // leg 2 — swap back so the loop is seamless
    const T2 = 2.0;
    leg(tl, A, DX, 0, BY2 - AY - 26, 0, T2);
    leg(tl, B, -DX, 0, AY - BY2 + 26, 0, T2);
    tl.fromTo(pulse, { scale: 0.5, opacity: 0.9, svgOrigin: `${CX} 70` }, { scale: 1.9, opacity: 0, duration: 0.5, ease: "power2.out" }, T2 + 0.32);
    tl.to({}, { duration: 0.2 }, T2 + 1.0);
    return tl;
  };
  return { play, stat };
};

// KEPT (already the richest) — order slip unrolls, swallows the paying coin,
// shivers, takes the CONFIRMED stamp, spits out the purchase. Recentered wide +
// conveyor dashes under the flow.
const buildOrder: Builder = (root, side, coinUrl, coinUrl2) => {
  const inUrl = side === "short" ? coinUrl : coinUrl2;
  const outUrl = side === "short" ? coinUrl2 : coinUrl;
  const belt = el("line", { x1: CX - 96, y1: 104, x2: CX + 96, y2: 104, stroke: "var(--aa-grid)", "stroke-width": 2, "stroke-dasharray": "6 8" });
  const cIn = coin(CX - 76, 64, BLUE, 0.92, inUrl);
  const tick = el("g");
  const paper = el("rect", { x: CX - 30, y: 30, width: 60, height: 70, rx: 5, fill: "var(--aa-obj)", stroke: "var(--aa-dim)", "stroke-width": 2 });
  const title = el("rect", { x: CX - 21, y: 39, width: 25, height: 4.5, rx: 2, fill: "var(--aa-dim)", opacity: 0.7 });
  const mkLine = (y: number, x2: number) => el("path", {
    d: `M${CX - 21},${y} Q${CX - 14},${y - 3} ${CX - 7},${y} T${CX + 7},${y} T${x2},${y}`,
    fill: "none", stroke: "var(--aa-blue)", "stroke-width": 2.6, "stroke-linecap": "round",
    pathLength: 100, "stroke-dasharray": 100, "stroke-dashoffset": 100,
  });
  const lines = [mkLine(54, CX + 22), mkLine(66, CX + 18), mkLine(78, CX + 8)];
  const SEAL_CX = CX + 13, SEAL_CY = 89;
  const seal = el("g");
  seal.append(
    el("circle", { cx: SEAL_CX, cy: SEAL_CY, r: 9, fill: "color-mix(in srgb, var(--aa-grn) 16%, transparent)", stroke: "var(--aa-grn)", "stroke-width": 2.4 }),
    el("path", { d: `M${SEAL_CX - 4.5},${SEAL_CY} L${SEAL_CX - 1.5},${SEAL_CY + 3} L${SEAL_CX + 4.5},${SEAL_CY - 3.5}`, fill: "none", stroke: "var(--aa-grn)", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  );
  const flash = el("circle", { cx: SEAL_CX, cy: SEAL_CY, r: 13, fill: "none", stroke: "var(--aa-grn-top)", "stroke-width": 2.5, opacity: 0 });
  tick.append(paper, title, ...lines, flash, seal);
  const cOut = frontCoin(CX + 74, 66, 16, outUrl);
  const sp = sparkle(CX + 96, 38, 8);
  root.append(belt, cIn, tick, cOut, sp);
  const TOP = `${CX} 30`, MID = `${CX} 65`;
  const SEAL_O = `${SEAL_CX} ${SEAL_CY}`;
  const stat = () => {
    gsap.set(tick, { scaleY: 1, rotation: 0, svgOrigin: TOP });
    lines.forEach((l) => gsap.set(l, { strokeDashoffset: 0 }));
    gsap.set(cIn, { opacity: 0 });
    gsap.set(seal, { scale: 1, rotation: 0, svgOrigin: SEAL_O });
    gsap.set(flash, { opacity: 0 });
    gsap.set(cOut, { x: 0, scale: 1, opacity: 1, transformOrigin: "center" });
    gsap.set(sp, { transformOrigin: sp._org, scale: 1, opacity: 0.9, y: 0 });
  };
  const reset = () => {
    gsap.set(tick, { scaleY: 0, rotation: 0, svgOrigin: TOP });
    lines.forEach((l) => gsap.set(l, { strokeDashoffset: 100 }));
    gsap.set(cIn, { x: 0, y: 0, scale: 1, opacity: 0, transformOrigin: "center" });
    gsap.set(seal, { scale: 0, rotation: -30, svgOrigin: SEAL_O });
    gsap.set(flash, { scale: 0.5, opacity: 0, svgOrigin: SEAL_O });
    gsap.set(cOut, { x: -52, scale: 0, opacity: 0, transformOrigin: "center" });
    gsap.set(sp, { scale: 0, opacity: 0, y: 0, transformOrigin: sp._org });
  };
  const play = () => {
    reset();
    gsap.to(belt, { attr: { "stroke-dashoffset": -14 }, duration: 0.8, ease: "none", repeat: -1 });
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.0, onRepeat: reset });
    tl.to(tick, { scaleY: 1, duration: 0.45, ease: "back.out(1.4)" });
    tl.to(lines, { strokeDashoffset: 0, duration: 0.3, stagger: 0.12, ease: "power1.inOut" }, "-=.15");
    tl.to(cIn, { opacity: 1, duration: 0.18 }, "-=.25");
    tl.to(cIn, { x: 62, scale: 0.38, opacity: 0, duration: 0.55, ease: "power2.in" });
    tl.to(tick, { scaleY: 0.93, duration: 0.12, ease: "power1.in" }).to(tick, { scaleY: 1, duration: 0.22, ease: "back.out(3)" });
    tl.to(tick, { rotation: 1.6, duration: 0.07, yoyo: true, repeat: 3, svgOrigin: MID });
    tl.set(tick, { rotation: 0 });
    tl.to(seal, { scale: 1, rotation: 0, duration: 0.3, ease: "back.out(2.4)" });
    tl.fromTo(flash, { scale: 0.5, opacity: 0.9 }, { scale: 1.7, opacity: 0, duration: 0.5, ease: "power2.out" }, "-=.18");
    tl.to(tick, { rotation: -3, duration: 0.12, ease: "power2.in", svgOrigin: MID }, "+=.08").to(tick, { rotation: 0, duration: 0.3, ease: "back.out(2)" });
    tl.to(cOut, { x: 0, scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.7)" }, "<");
    tl.to(sp, { scale: 1, opacity: 0.9, duration: 0.3, ease: "back.out(1.6)" }, "-=.2");
    tl.to(sp, { y: "-=5", duration: 1.2, ease: "sine.inOut", yoyo: true, repeat: 1 });
    tl.to({}, { duration: 0.3 });
    return tl;
  };
  return { play, stat };
};

// ENRICHED — the mint press slams, sparks SHOWER, the fresh coin pops out and does
// a proud little wobble-spin before the next strike.
const buildMint: Builder = (root) => {
  const shadow = floorShadow(CX, FLOOR + 2, 40);
  const anvil = el("path", { d: `M${CX - 34},${FLOOR - 12} L${CX + 34},${FLOOR - 12} L${CX + 25},${FLOOR} L${CX - 25},${FLOOR} Z`, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2, "stroke-linejoin": "round" });
  const press = el("rect", { x: CX - 25, y: 34, width: 50, height: 22, rx: 3, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2.5 });
  const stem = el("rect", { x: CX - 5, y: 18, width: 10, height: 18, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2 });
  const flash = el("circle", { cx: CX, cy: FLOOR - 26, r: 22, fill: "none", stroke: "var(--aa-blue-top)", "stroke-width": 2.5, opacity: 0 });
  const c = coin(CX, FLOOR - 28, BLUE);
  const shower: El[] = [];
  for (let i = 0; i < 7; i++) shower.push(sparkle(CX, FLOOR - 30, 3.4 + (i % 3), i % 2 === 0 ? "var(--aa-spark)" : "var(--aa-blue-top)"));
  const sp = [sparkle(CX - 52, 74, 8), sparkle(CX + 54, 70, 8)];
  root.append(shadow, anvil, c, flash, press, stem, ...shower, ...sp);
  const stat = () => {
    gsap.set([press, stem], { y: 0 });
    gsap.set(c, { scale: 1, opacity: 1, y: 0, rotation: 0, transformOrigin: "center" });
    gsap.set(flash, { opacity: 0 });
    gsap.set(shower, { opacity: 0 });
    sp.forEach((s) => gsap.set(s, { transformOrigin: s._org, scale: 1, opacity: 0.9, y: 0 }));
  };
  const play = () => {
    gsap.set(c, { scale: 0, opacity: 0, y: 0, rotation: 0, transformOrigin: "center" });
    gsap.set(flash, { scale: 0.5, opacity: 0, svgOrigin: `${CX} ${FLOOR - 26}` });
    gsap.set(shower, { opacity: 0 });
    sp.forEach((s) => gsap.set(s, { scale: 0, opacity: 0, y: 0, transformOrigin: s._org }));
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9 });
    tl.fromTo([press, stem], { y: -16 }, { y: 42, duration: 0.24, ease: "power3.in" });
    tl.fromTo(flash, { scale: 0.5, opacity: 0.9 }, { scale: 1.9, opacity: 0, duration: 0.6, ease: "power2.out" }, "-=.02");
    shower.forEach((s, i) => {
      const a = (i / shower.length) * Math.PI - Math.PI; // fan upward
      tl.fromTo(s, { x: 0, y: 0, opacity: 1, scale: 1, transformOrigin: s._org }, { x: Math.cos(a) * (26 + (i % 3) * 10), y: Math.sin(a) * 30 - 6, opacity: 0, scale: 0.4, duration: 0.55 + (i % 3) * 0.1, ease: "power2.out" }, "-=.58");
    });
    tl.fromTo(c, { scale: 0, opacity: 0, y: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2.2)", transformOrigin: "center" }, "-=.45");
    tl.to([press, stem], { y: -16, duration: 0.32, ease: "power2.out" }, "-=.28");
    // proud wobble-spin
    tl.to(c, { rotation: 8, duration: 0.18, ease: "sine.inOut" }).to(c, { rotation: -6, duration: 0.2, ease: "sine.inOut" }).to(c, { rotation: 0, duration: 0.24, ease: "back.out(2)" });
    tl.add(() => sp.forEach((s, i) => floatSpark(s, i)), "-=.2");
    tl.to({}, { duration: 0.6 });
    tl.add(() => { sp.forEach((s) => gsap.killTweensOf(s)); gsap.set(sp, { scale: 0, opacity: 0, y: 0 }); });
    tl.set(c, { scale: 0, opacity: 0, rotation: 0 });
    return tl;
  };
  return { play, stat };
};

// ENRICHED — flames lick up the seam FIRST, then the coin cracks apart and the
// halves fall away as embers rise (debt destroyed).
const buildBurn: Builder = (root) => {
  const CBX = CX, CBY = 72, O = `${CBX} ${CBY}`;
  const leftHalf = el("path", { d: `M${CBX},50 A22,22 0 0 0 ${CBX},94 L${CBX + 1},85 L${CBX - 3},77 L${CBX + 3},68 L${CBX - 4},59 Z`, fill: "var(--aa-blue-top)", stroke: "var(--aa-blue-dk)", "stroke-width": 1.4, "stroke-linejoin": "round" });
  const rightHalf = el("path", { d: `M${CBX},50 A22,22 0 0 1 ${CBX},94 L${CBX + 1},85 L${CBX - 3},77 L${CBX + 3},68 L${CBX - 4},59 Z`, fill: "var(--aa-blue)", stroke: "var(--aa-blue-dk)", "stroke-width": 1.4, "stroke-linejoin": "round" });
  // flame tongues along the seam
  const mkFlame = (fx: number, fy: number, s: number) => el("path", {
    d: `M${fx},${fy} C${fx - 4 * s},${fy - 5 * s} ${fx - 2 * s},${fy - 9 * s} ${fx},${fy - 12 * s} C${fx + 2 * s},${fy - 9 * s} ${fx + 4 * s},${fy - 5 * s} ${fx},${fy} Z`,
    fill: "var(--aa-ten)", opacity: 0,
  });
  const flames = [mkFlame(CBX - 1, 60, 0.9), mkFlame(CBX + 2, 72, 1.15), mkFlame(CBX - 2, 84, 0.8)];
  const embers = [[-8, 0], [6, -4], [-2, -8], [10, -2], [-12, -5]].map(([x, y], i) => sparkle(CBX + x, CBY - 20 + y, 3.5 + (i % 2), "var(--aa-ten-top)"));
  root.append(leftHalf, rightHalf, ...flames, ...embers);
  const stat = () => {
    gsap.set(leftHalf, { x: -7, y: 3, rotation: -12, opacity: 1, svgOrigin: O });
    gsap.set(rightHalf, { x: 7, y: 3, rotation: 12, opacity: 1, svgOrigin: O });
    gsap.set(flames, { opacity: 0 });
    embers.forEach((e) => gsap.set(e, { opacity: 0 }));
  };
  const play = () => {
    gsap.set([leftHalf, rightHalf], { x: 0, y: 0, rotation: 0, opacity: 1, svgOrigin: O });
    gsap.set(flames, { opacity: 0, scaleY: 0.4, transformOrigin: "center bottom" });
    embers.forEach((e) => gsap.set(e, { scale: 1, opacity: 0, x: 0, y: 0, transformOrigin: e._org }));
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.0 });
    tl.to({}, { duration: 0.35 });
    // fire takes along the seam
    tl.to(flames, { opacity: 0.95, scaleY: 1, duration: 0.3, ease: "back.out(2)", stagger: 0.12 });
    tl.to(flames, { scaleY: 1.25, duration: 0.22, ease: "sine.inOut", yoyo: true, repeat: 2, stagger: 0.08 });
    // crack apart
    tl.to(flames, { opacity: 0, duration: 0.2 }, "+=.05");
    tl.to(leftHalf, { x: -24, y: 14, rotation: -40, opacity: 0, duration: 0.62, ease: "power1.in", svgOrigin: O }, "<");
    tl.to(rightHalf, { x: 24, y: 14, rotation: 40, opacity: 0, duration: 0.62, ease: "power1.in", svgOrigin: O }, "<");
    embers.forEach((e, i) => tl.fromTo(e, { y: 0, x: 0, opacity: 0.95, scale: 1 }, { y: -36, x: (i - 2) * 8, opacity: 0, scale: 0.4, duration: 0.75, ease: "power1.out" }, "<+.05"));
    tl.to({}, { duration: 0.3 });
    return tl;
  };
  return { play, stat };
};

// ENRICHED — the signature: quill signs three wavy lines, then a WAX SEAL stamps
// the corner with an emboss flash (permission granted — no value moves).
const buildAuthorize: Builder = (root) => {
  const paper = el("rect", { x: CX - 62, y: 36, width: 124, height: 72, rx: 5, fill: "var(--aa-obj)", stroke: "var(--aa-dim)", "stroke-width": 2 });
  const fold = el("path", { d: `M${CX + 42},36 L${CX + 62},36 L${CX + 62},56 Z`, fill: "var(--aa-obj-2)" });
  const mkLine = (y: number, x2: number) => el("path", {
    d: `M${CX - 48},${y} Q${CX - 40},${y - 4} ${CX - 32},${y} T${CX - 16},${y} T${CX},${y} T${x2},${y}`,
    fill: "none", stroke: "var(--aa-blue)", "stroke-width": 3, "stroke-linecap": "round",
    pathLength: 100, "stroke-dasharray": 100, "stroke-dashoffset": 100,
  });
  const lines = [mkLine(56, CX + 28), mkLine(72, CX + 34), mkLine(88, CX + 6)];
  const quill = el("g");
  const shaft = el("path", { d: `M${CX + 24},60 L${CX + 52},28`, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 2, "stroke-linecap": "round" });
  const vane = el("path", { d: `M${CX + 38},50 C${CX + 42},38 ${CX + 50},31 ${CX + 55},27 C${CX + 52},38 ${CX + 48},47 ${CX + 44},56 Z`, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.2, "stroke-linejoin": "round" });
  quill.append(shaft, vane);
  // wax seal (drops in at the end)
  const SEAL_X = CX + 40, SEAL_Y = 92;
  const wax = el("g");
  wax.append(
    el("circle", { cx: SEAL_X, cy: SEAL_Y, r: 11, fill: "var(--aa-ten)", stroke: "var(--aa-ten-dk)", "stroke-width": 2 }),
    el("circle", { cx: SEAL_X, cy: SEAL_Y, r: 6.5, fill: "none", stroke: "var(--aa-ten-top)", "stroke-width": 1.8, opacity: 0.9 }),
    el("path", { d: `M${SEAL_X - 3.4},${SEAL_Y} L${SEAL_X - 0.8},${SEAL_Y + 2.8} L${SEAL_X + 3.6},${SEAL_Y - 2.6}`, fill: "none", stroke: "var(--aa-ten-top)", "stroke-width": 1.8, "stroke-linecap": "round" }),
  );
  const waxFlash = el("circle", { cx: SEAL_X, cy: SEAL_Y, r: 15, fill: "none", stroke: "var(--aa-ten-top)", "stroke-width": 2.4, opacity: 0 });
  const sp = sparkle(CX - 44, 28, 8);
  root.append(paper, fold, ...lines, waxFlash, wax, quill, sp);
  const WAX_O = `${SEAL_X} ${SEAL_Y}`;
  const stat = () => {
    lines.forEach((l) => gsap.set(l, { strokeDashoffset: 0 }));
    gsap.set(quill, { x: -18, y: 32, opacity: 1 });
    gsap.set(wax, { scale: 1, opacity: 1, svgOrigin: WAX_O });
    gsap.set(waxFlash, { opacity: 0 });
    gsap.set(sp, { transformOrigin: sp._org, scale: 1, opacity: 0.9, y: 0 });
  };
  const play = () => {
    lines.forEach((l) => gsap.set(l, { strokeDashoffset: 100 }));
    gsap.set(quill, { x: -70, y: 0, opacity: 1 });
    gsap.set(wax, { scale: 0, opacity: 0, svgOrigin: WAX_O });
    gsap.set(waxFlash, { opacity: 0, scale: 0.5, svgOrigin: WAX_O });
    gsap.set(sp, { scale: 0, opacity: 0, y: 0, transformOrigin: sp._org });
    const tl = gsap.timeline();
    tl.to(lines[0], { strokeDashoffset: 0, duration: 0.55, ease: "power1.inOut" }, 0);
    tl.to(quill, { x: 4, duration: 0.55, ease: "power1.inOut" }, 0);
    tl.to(quill, { x: -70, y: 16, duration: 0.22, ease: "power1.inOut" });
    tl.to(lines[1], { strokeDashoffset: 0, duration: 0.55, ease: "power1.inOut" }, ">");
    tl.to(quill, { x: 8, duration: 0.55, ease: "power1.inOut" }, "<");
    tl.to(quill, { x: -70, y: 32, duration: 0.22, ease: "power1.inOut" });
    tl.to(lines[2], { strokeDashoffset: 0, duration: 0.45, ease: "power1.inOut" }, ">");
    tl.to(quill, { x: -18, duration: 0.45, ease: "power1.inOut" }, "<");
    // the wax seal drops + embosses
    tl.fromTo(wax, { scale: 1.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.34, ease: "power3.in" }, "+=.1");
    tl.fromTo(waxFlash, { scale: 0.5, opacity: 0.95 }, { scale: 1.8, opacity: 0, duration: 0.55, ease: "power2.out" }, "-=.05");
    tl.to(wax, { scale: 0.94, duration: 0.08, ease: "power1.in" }, "-=.5").to(wax, { scale: 1, duration: 0.26, ease: "back.out(3.2)" });
    tl.add(() => floatSpark(sp, 0), "-=.05");
    return tl;
  };
  return { play, stat };
};

// ─── ⑤ Compose / 原子策略 ─────────────────────────────────────────────────────

/** One strategy-composer step for the combo pipeline: protocol mark + action verb. */
export type ComboStop = { label: string; logo?: string; verb: "swap" | "in" | "out" | "borrow" | "buy" | "stake" };

// The ATOMIC PIPELINE as a CINEMATIC WALKTHROUGH: the bracket draws, every step
// pops in as a protocol station, then the camera pushes IN on each station in
// turn while a verb-matched micro-beat plays there (swap spins / deposit sinks
// with a ripple / withdraw lifts / borrow-buy-stake mints a chip) — inactive
// stations dim for depth of field, the value coin carrying forward each step's
// output. After the last step the camera pulls OUT and the bracket pulses solid:
// the whole strategy sealed as ONE transaction. Timed on an absolute clock so the
// long sequence is deterministic (position-token chaining is too fragile here).
function buildCombo(root: El, coinUrl: string | undefined, combo: ComboStop[]): Api {
  const cameraRig = makeCamera(root);
  const host = cameraRig.cam;
  const stops = combo.length > 4 ? [...combo.slice(0, 3), { label: `+${combo.length - 3}`, verb: "in" as const }] : combo;
  const n = stops.length;
  const laneY = 68;
  const BR = { x: 18, y: 28, w: 224, h: 82, rx: 12 };
  const bracket = el("rect", { x: BR.x, y: BR.y, width: BR.w, height: BR.h, rx: BR.rx, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 1.8, "stroke-dasharray": "6 6", opacity: 0.8, pathLength: 100 });
  const bracketPulse = el("rect", { x: BR.x, y: BR.y, width: BR.w, height: BR.h, rx: BR.rx, fill: "none", stroke: "var(--aa-blue)", "stroke-width": 2.2, opacity: 0 });
  const tag = el("text", { x: BR.x + BR.w - 5, y: BR.y + BR.h + 12, "text-anchor": "end", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "8", fill: "var(--aa-dim)", "letter-spacing": ".1em", opacity: 0 });
  tag.textContent = "1 TX · ALL-OR-NOTHING";
  const stepNo = el("text", { x: BR.x + 6, y: BR.y + BR.h + 12, "text-anchor": "start", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "8", fill: "var(--aa-blue)", "letter-spacing": ".08em", opacity: 0 });
  const startX = BR.x + 18, endX = BR.x + BR.w - 18;
  const yOff = (i: number) => (n <= 2 ? 0 : i % 2 === 0 ? -8 : 10);
  const xs = stops.map((_, i) => startX + ((i + 1) * (endX - startX)) / (n + 1));
  const R = 12;
  const verbGlyph = (v: ComboStop["verb"], bx: number, by: number): El => {
    const g = el("g");
    g.append(el("circle", { cx: bx, cy: by, r: 5.5, fill: "var(--aa-blue)", stroke: "var(--av-paper)", "stroke-width": 1.4 }));
    const w = "var(--av-on-accent, #fff)";
    if (v === "in") g.append(el("path", { d: `M${bx},${by - 2.8} L${bx},${by + 1.6} M${bx - 1.9},${by - 0.3} L${bx},${by + 2.2} L${bx + 1.9},${by - 0.3}`, fill: "none", stroke: w, "stroke-width": 1.3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    else if (v === "out" || v === "stake") g.append(el("path", { d: `M${bx},${by + 2.8} L${bx},${by - 1.6} M${bx - 1.9},${by + 0.3} L${bx},${by - 2.2} L${bx + 1.9},${by + 0.3}`, fill: "none", stroke: w, "stroke-width": 1.3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    else if (v === "swap") g.append(el("path", { d: `M${bx - 2.6},${by - 1.2} L${bx + 2.6},${by - 1.2} M${bx + 1},${by - 2.6} L${bx + 2.6},${by - 1.2} M${bx + 2.6},${by + 1.2} L${bx - 2.6},${by + 1.2} M${bx - 1},${by + 2.6} L${bx - 2.6},${by + 1.2}`, fill: "none", stroke: w, "stroke-width": 1.2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    else {
      const t = el("text", { x: bx, y: by + 2.6, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "7", fill: w });
      t.textContent = v === "borrow" ? "$" : "¤";
      g.append(t);
    }
    return g;
  };
  const nodes = stops.map((stop, i) => {
    const x = xs[i], y = laneY + yOff(i);
    const g = el("g");
    const halo = el("circle", { cx: x, cy: y, r: R + 5, fill: "color-mix(in srgb, var(--av-accent) 24%, transparent)", opacity: 0 });
    const disc = el("circle", { cx: x, cy: y, r: R, fill: "var(--av-paper)", stroke: "var(--aa-dim)", "stroke-width": 1.6 });
    g.append(halo, disc);
    if (stop.logo) {
      const uid = `aacb${COIN_UID++}`;
      const clip = el("clipPath", { id: uid });
      clip.append(el("circle", { cx: x, cy: y, r: R - 1.5 }));
      g.append(clip, el("image", { href: stop.logo, x: x - (R - 1.5), y: y - (R - 1.5), width: (R - 1.5) * 2, height: (R - 1.5) * 2, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${uid})` }));
    } else {
      const mono = el("text", { x, y: y + 3.5, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "800", "font-size": "10", fill: "var(--av-ink)" });
      mono.textContent = (stop.label[0] ?? "?").toUpperCase();
      g.append(mono);
    }
    const badge = verbGlyph(stop.verb, x + R - 2.5, y + R - 2.5);
    g.append(badge);
    const ring = el("circle", { cx: x, cy: y, r: R + 2, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2, opacity: 0 });
    const name = el("text", { x, y: y + R + 12, "text-anchor": "middle", "font-family": "var(--aa-mono)", "font-weight": "700", "font-size": "7.5", fill: "var(--aa-dim)", "letter-spacing": ".05em" });
    name.textContent = stop.label.toUpperCase().slice(0, 14);
    g.append(ring, name);
    return { g, halo, ring, badge, x, y, verb: stop.verb, bx: x + R - 2.5, by: y + R - 2.5 };
  });
  const cw = coin(startX - 4, laneY - 6, BLUE, 0.7, coinUrl);
  const spark = sparkle(endX + 6, BR.y + 10, 7);
  const ripple = el("circle", { cx: 0, cy: 0, r: 10, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2, opacity: 0 });
  const chip = coin(0, 0, TEN, 0.5);
  gsap.set(chip, { opacity: 0 });
  const cwHome = { x: startX - 4, y: laneY - 6 };
  // the progress RAIL: one segment per hop, lit as the value travels it — by the
  // seal the whole pipeline glows, the "it all executed" receipt
  const railPts = [{ x: cwHome.x, y: cwHome.y }, ...nodes.map((nd) => ({ x: nd.x, y: nd.y }))];
  const rails = railPts.slice(1).map((b, i) => {
    const a = railPts[i];
    const mx = a.x + (b.x - a.x) / 2;
    return el("path", { d: `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`, fill: "none", stroke: "var(--aa-blue)", "stroke-width": 1.6, "stroke-linecap": "round", opacity: 0.55, pathLength: 100, "stroke-dasharray": 100, "stroke-dashoffset": 100 });
  });
  host.append(bracket, bracketPulse, tag, stepNo, ...rails, ...nodes.map((nd) => nd.g), cw, ripple, chip, spark);

  const stat = () => {
    gsap.set(host, { x: 0, y: 0, scale: 1 });
    gsap.set(bracket, { strokeDashoffset: 0, opacity: 0.8 });
    gsap.set(tag, { opacity: 0.75 });
    gsap.set(stepNo, { opacity: 0 });
    nodes.forEach((nd) => { gsap.set(nd.g, { scale: 1, opacity: 1, svgOrigin: `${nd.x} ${nd.y}` }); gsap.set(nd.halo, { opacity: 0.45 }); gsap.set(nd.ring, { opacity: 0 }); });
    gsap.set(rails, { strokeDashoffset: 0, opacity: 0.5 });
    gsap.set([cw, ripple, chip], { opacity: 0 });
    gsap.set(bracketPulse, { opacity: 0 });
    gsap.set(spark, { transformOrigin: spark._org, scale: 1, opacity: 0.9, y: 0 });
  };

  // one step's on-station micro-beat at absolute time `t`; returns its end time.
  const beat = (tl: gsap.core.Timeline, nd: (typeof nodes)[number], t: number): number => {
    const gx = nd.x - cwHome.x, gy = nd.y - cwHome.y;
    tl.to(nd.halo, { opacity: 1, duration: 0.16, ease: "power1.out" }, t);
    tl.fromTo(nd.ring, { scale: 0.8, opacity: 0.95, svgOrigin: `${nd.x} ${nd.y}` }, { scale: 1.4, opacity: 0, duration: 0.5, ease: "power2.out" }, t);
    tl.fromTo(nd.badge, { scale: 1 }, { scale: 1.5, duration: 0.14, ease: "back.out(3)", yoyo: true, repeat: 1, svgOrigin: `${nd.bx} ${nd.by}` }, t);
    if (nd.verb === "in") {
      tl.to(cw, { y: gy + 3, scale: 0.5, duration: 0.28, ease: "power2.in" }, t);
      tl.set(ripple, { attr: { cx: nd.x, cy: nd.y }, scale: 0.5, opacity: 0.9, svgOrigin: `${nd.x} ${nd.y}` }, t + 0.28);
      tl.to(ripple, { scale: 2.3, opacity: 0, duration: 0.5, ease: "power2.out" }, t + 0.28);
      tl.to(cw, { y: gy, scale: 0.7, duration: 0.22, ease: "back.out(2)" }, t + 0.42);
    } else if (nd.verb === "out") {
      tl.to(cw, { y: gy - 14, scale: 0.82, duration: 0.34, ease: "back.out(1.8)" }, t);
      tl.to(cw, { y: gy - 6, scale: 0.7, duration: 0.22, ease: "sine.inOut" }, t + 0.34);
    } else if (nd.verb === "swap") {
      tl.to(cw, { rotation: 180, duration: 0.36, ease: "power2.inOut" }, t);
      tl.fromTo(cw, { scale: 0.7 }, { scale: 0.86, duration: 0.16, yoyo: true, repeat: 1, ease: "sine.inOut" }, t);
      tl.set(cw, { rotation: 0 }, t + 0.38);
    } else {
      tl.set(chip, { x: nd.x, y: nd.y, scale: 0.42, opacity: 0.95, svgOrigin: `${nd.x} ${nd.y}` }, t + 0.06);
      tl.fromTo(chip, { y: nd.y, scale: 0.42 }, { y: nd.y - 18, scale: 0.74, opacity: 0, duration: 0.52, ease: "power2.out" }, t + 0.06);
      tl.fromTo(cw, { scale: 0.7 }, { scale: 0.8, duration: 0.14, yoyo: true, repeat: 1, ease: "sine.inOut" }, t + 0.06);
    }
    tl.to(nd.halo, { opacity: 0.42, duration: 0.3 }, t + 0.6);
    return t + 0.72;
  };

  const play = () => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.0 });
    // reset (t=0)
    tl.set(host, { x: 0, y: 0, scale: 1 }, 0);
    tl.set(bracket, { strokeDashoffset: 100, opacity: 0.8 }, 0);
    tl.set([tag, stepNo], { opacity: 0 }, 0);
    nodes.forEach((nd) => {
      tl.set(nd.g, { scale: 0, opacity: 0, svgOrigin: `${nd.x} ${nd.y}` }, 0);
      tl.set(nd.halo, { opacity: 0 }, 0);
      tl.set(nd.ring, { opacity: 0, scale: 1, svgOrigin: `${nd.x} ${nd.y}` }, 0);
    });
    tl.set(cw, { x: 0, y: 0, opacity: 0, scale: 0.7, rotation: 0, transformOrigin: "center" }, 0);
    tl.set([ripple, chip], { opacity: 0 }, 0);
    tl.set(rails, { strokeDashoffset: 100, opacity: 0.55 }, 0);
    tl.set(bracketPulse, { opacity: 0, scale: 1, svgOrigin: `${BR.x + BR.w / 2} ${BR.y + BR.h / 2}` }, 0);
    tl.set(spark, { scale: 0, opacity: 0, y: 0, transformOrigin: spark._org }, 0);
    // ① ESTABLISH (wide)
    tl.to(bracket, { strokeDashoffset: 0, duration: 0.6, ease: "power1.inOut" }, 0.05);
    nodes.forEach((nd, i) => tl.to(nd.g, { scale: 1, opacity: 1, duration: 0.36, ease: "back.out(2.4)" }, 0.25 + i * 0.1));
    tl.to(tag, { opacity: 0.75, duration: 0.3 }, 0.55);
    tl.to(cw, { opacity: 1, duration: 0.2 }, 0.75);
    tl.to(stepNo, { opacity: 0.9, duration: 0.2 }, 0.9);
    // ② WALK — absolute clock; zoom into each station, dim the rest, light the rail
    //    behind the value, play its beat. Each hop runs a touch FASTER (the pipeline
    //    finds its rhythm — atomic execution accelerating to the seal).
    let t = 1.15;
    nodes.forEach((nd, i) => {
      const f = Math.pow(0.9, i); // tempo escalation
      const others = nodes.filter((_, j) => j !== i).map((o) => o.g);
      tl.call(() => { stepNo.textContent = `STEP ${i + 1}/${n}`; }, undefined, t);
      cameraRig.zoomTo(tl, nd.x, nd.y, 1.8, 0.5 * f, t);
      if (others.length) tl.to(others, { opacity: 0.28, duration: 0.35 * f }, t);
      tl.to(nd.g, { opacity: 1, duration: 0.2 }, t);
      tl.to(rails[i], { strokeDashoffset: 0, duration: 0.32 * f, ease: "power1.inOut" }, t + 0.06);
      tl.to(cw, { x: nd.x - cwHome.x, y: nd.y - cwHome.y, duration: 0.32 * f, ease: "power1.inOut" }, t + 0.08);
      t = beat(tl, nd, t + 0.5 * f) + 0.12 * f;
    });
    // ③ SEAL (pull out): coin absorbed, the whole lit rail flashes, bracket double-
    //    pulses solid, the ALL-OR-NOTHING tag pops — the atomic receipt
    cameraRig.reset(tl, 0.55, t);
    tl.to(nodes.map((o) => o.g), { opacity: 1, duration: 0.4 }, t);
    tl.to(stepNo, { opacity: 0, duration: 0.25 }, t);
    tl.to(cw, { x: endX - cwHome.x, y: 0, duration: 0.42, ease: "power1.inOut" }, t + 0.1);
    tl.to(cw, { scale: 0.4, opacity: 0, duration: 0.2, ease: "power2.in" }, t + 0.5);
    tl.to(rails, { opacity: 0.95, duration: 0.16, ease: "power1.out" }, t + 0.5);
    tl.to(rails, { opacity: 0.5, duration: 0.5, ease: "power1.in" }, t + 0.72);
    tl.fromTo(bracketPulse, { opacity: 0.9, scale: 0.995, svgOrigin: `${BR.x + BR.w / 2} ${BR.y + BR.h / 2}` }, { opacity: 0, scale: 1.03, duration: 0.45, ease: "power2.out" }, t + 0.5);
    tl.fromTo(bracketPulse, { opacity: 0.55, scale: 1 }, { opacity: 0, scale: 1.05, duration: 0.5, ease: "power2.out", immediateRender: false }, t + 0.85);
    tl.fromTo(tag, { scale: 1, svgOrigin: `${BR.x + BR.w - 40} ${BR.y + BR.h + 9}` }, { scale: 1.12, duration: 0.16, yoyo: true, repeat: 1, ease: "power1.out" }, t + 0.55);
    tl.to(spark, { scale: 1, opacity: 0.9, duration: 0.3, ease: "back.out(1.8)" }, t + 0.6);
    tl.to(spark, { y: "-=5", duration: 1.0, ease: "sine.inOut", yoyo: true, repeat: 1 }, t + 0.9);
    return tl;
  };
  return { play, stat };
}


// boundary. The BTC stays on Bitcoin in committee custody; the hBTC only ever
// exists on Sui. Two real objects carry that, in buildAuthorize's register (a
// characterful silhouette + layered detail, not a bare geometric block):
//   • Bitcoin side — a SAFE: plate door, hinge barrels, rivets, spoke handwheel,
//     padlock shackle. The BTC goes in and the wheel spins shut.
//   • Sui side — a SCREW PRESS: frame posts, crown, a thread that extends as the
//     ram descends, and a horned anvil. It STRIKES new hBTC into existence.
//   deposit  (long):  BTC locked in the safe  -> press strikes -> hBTC MINTED
//   withdraw (short): press comes down on the hBTC -> BURNED -> wheel spins back,
//                     shackle pops -> the custodied BTC is RELEASED
const buildBridge: Builder = (root, side, coinUrl, coinUrl2) => {
  const LX = 62, RX2 = 198;
  const deposit = side !== "short";
  const BY = 56, BH = 46;                     // safe body
  const CYL = BY + 24;                        // coin resting inside the safe
  const CYR = 90;                             // coin struck on the anvil
  const WX = LX + 20, WY = BY + BH / 2;       // handwheel centre
  const wheelO = `${WX} ${WY}`;
  const OPEN = -13;                           // shackle raised (unlocked)
  const RAM_Y = 36, RAM_DROP = 30;

  // ── the chain boundary — value never crosses this line ──
  const seam = el("line", { x1: CX, y1: 24, x2: CX, y2: 118, stroke: "var(--aa-grid)", "stroke-width": 1.6, "stroke-dasharray": "4 6", opacity: 0.9 });
  const capT = el("line", { x1: CX - 4, y1: 24, x2: CX + 4, y2: 24, stroke: "var(--aa-grid)", "stroke-width": 1.6 });
  const capB = el("line", { x1: CX - 4, y1: 118, x2: CX + 4, y2: 118, stroke: "var(--aa-grid)", "stroke-width": 1.6 });
  // Chain labels go ABOVE their half, not below. The shared "Sponsored" gas badge
  // is bottom-left chrome (translate(9 120), 99 wide) and the BITCOIN caption at
  // y=131/x=62 landed inside it — two unrelated bits of text stacked on top of
  // each other. Above the seam cap (y=24) both sides are empty.
  const lab = (lx: number, text: string) => {
    const t = el("text", { x: lx, y: 15, "text-anchor": "middle", "font-size": 8, "font-weight": 700, "letter-spacing": 0.7, fill: "var(--aa-dim)" });
    t.textContent = text;
    return t;
  };
  // The letter is a FALLBACK, not a label: `coin()` already clips the real
  // CoinMetadata icon onto the disc, so stamping a glyph over it produced a coin
  // that looked like neither — hBTC's own icon (a white ₿ on blue) with an "h"
  // sitting on top of it. Draw the letter only when there is no icon to show.
  const faceCoin = (sx: number, sy: number, pal: Pal, sym: string, img?: string) => {
    const g = el("g");
    g.append(coin(sx, sy, pal, 0.64, img));
    if (!img) {
      const t = el("text", { x: sx, y: sy + 0.5, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, "font-weight": 800, fill: "var(--aa-blue-dk)" });
      t.textContent = sym;
      g.append(t);
    }
    return g;
  };

  // ── BITCOIN SIDE — the custody safe ──
  const body = el("rect", { x: LX - 34, y: BY, width: 68, height: BH, rx: 9, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2.2 });
  const door = el("rect", { x: LX - 27, y: BY + 7, width: 37, height: BH - 14, rx: 5, fill: "var(--aa-slot)", stroke: "var(--aa-dim)", "stroke-width": 1.3 });
  const hinges = [BY + 10, BY + BH - 19].map((hy) => el("rect", { x: LX - 37, y: hy, width: 6, height: 10, rx: 3, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.3 }));
  const rivets = [[LX - 30, BY + 4], [LX + 30, BY + 4], [LX - 30, BY + BH - 4], [LX + 30, BY + BH - 4]]
    .map(([rx, ry]) => el("circle", { cx: rx, cy: ry, r: 1.5, fill: "var(--aa-dim)", opacity: 0.6 }));
  // spoke handwheel — the detail that makes it read as a safe, not a box
  const wheel = el("g");
  wheel.append(el("circle", { cx: WX, cy: WY, r: 9, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 2 }));
  [0, 45, 90, 135].forEach((deg) => {
    const r = (deg * Math.PI) / 180, dx = Math.cos(r) * 8.6, dy = Math.sin(r) * 8.6;
    wheel.append(el("line", { x1: WX - dx, y1: WY - dy, x2: WX + dx, y2: WY + dy, stroke: "var(--aa-dim)", "stroke-width": 1.5, "stroke-linecap": "round" }));
  });
  wheel.append(el("circle", { cx: WX, cy: WY, r: 2.6, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.4 }));
  const shackle = el("path", { d: `M${LX - 12},${BY + 2} L${LX - 12},${BY - 11} A12,12 0 0 1 ${LX + 12},${BY - 11} L${LX + 12},${BY + 2}`, fill: "none", stroke: "var(--aa-dim)", "stroke-width": 5, "stroke-linecap": "round" });

  // ── SUI SIDE — the screw press ──
  const postL = el("rect", { x: RX2 - 32, y: 26, width: 5, height: 74, rx: 2, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.3 });
  const postR = el("rect", { x: RX2 + 27, y: 26, width: 5, height: 74, rx: 2, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.3 });
  const crown = el("rect", { x: RX2 - 34, y: 20, width: 68, height: 9, rx: 3, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.8 });
  // screw thread — extends as the ram descends
  const thread = el("g");
  for (let i = 0; i < 4; i++) thread.append(el("line", { x1: RX2 - 5, y1: 31 + i * 5, x2: RX2 + 5, y2: 33.5 + i * 5, stroke: "var(--aa-dim)", "stroke-width": 1.4, "stroke-linecap": "round", opacity: 0.75 }));
  const shaft = el("line", { x1: RX2, y1: 29, x2: RX2, y2: RAM_Y + 2, stroke: "var(--aa-dim)", "stroke-width": 2.4, "stroke-linecap": "round" });
  // ram: chamfered head + a highlight seam (bevelled, not a plain rect)
  const ram = el("g");
  ram.append(
    el("path", { d: `M${RX2 - 16},${RAM_Y} L${RX2 + 16},${RAM_Y} L${RX2 + 21},${RAM_Y + 6} L${RX2 + 21},${RAM_Y + 15} L${RX2 - 21},${RAM_Y + 15} L${RX2 - 21},${RAM_Y + 6} Z`, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 2, "stroke-linejoin": "round" }),
    el("line", { x1: RX2 - 15, y1: RAM_Y + 9, x2: RX2 + 15, y2: RAM_Y + 9, stroke: "var(--aa-dim)", "stroke-width": 1.2, opacity: 0.5 }),
    el("rect", { x: RX2 - 7, y: RAM_Y + 15, width: 14, height: 5, rx: 1.5, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.4 }), // die
  );
  // anvil with a rounded horn — a shape, not a slab
  const anvil = el("path", { d: `M${RX2 - 26},100 L${RX2 + 18},100 Q${RX2 + 32},105 ${RX2 + 18},110 L${RX2 - 20},110 Q${RX2 - 28},105 ${RX2 - 26},100 Z`, fill: "var(--aa-obj-2)", stroke: "var(--aa-dim)", "stroke-width": 1.8, "stroke-linejoin": "round" });
  const anvilBase = el("rect", { x: RX2 - 16, y: 110, width: 32, height: 5, rx: 2, fill: "var(--aa-obj)", stroke: "var(--aa-dim)", "stroke-width": 1.3 });

  const btc = faceCoin(LX - 8, CYL, TEN, "₿", coinUrl);
  const hbtc = faceCoin(RX2, CYR, BLUE, "h", coinUrl2);
  const coinO = `${RX2} ${CYR}`;
  // emboss flash on the struck coin (buildAuthorize's wax-seal language)
  const emboss = el("ellipse", { cx: RX2, cy: CYR, rx: 15, ry: 11, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2.2, opacity: 0 });
  const relRing = el("ellipse", { cx: LX - 8, cy: CYL, rx: 14, ry: 10, fill: "none", stroke: "var(--aa-spark)", "stroke-width": 2.2, opacity: 0 });
  const sparks = [0, 1, 2, 3].map((i) => sparkle(RX2, CYR, 3.2 + (i % 2), i % 2 ? "var(--aa-spark)" : "var(--aa-blue-top)"));

  root.append(
    seam, capT, capB, lab(LX, "BITCOIN"), lab(RX2, "SUI"),
    postL, postR, anvil, anvilBase, emboss, hbtc, crown, thread, shaft, ram,
    ...hinges, body, door, ...rivets, relRing, btc, wheel, shackle,
    ...sparks,
  );

  const stat = () => {
    gsap.set(btc, { x: 0, y: 0, opacity: deposit ? 1 : 0 });
    gsap.set(shackle, { y: deposit ? 0 : OPEN });
    gsap.set(wheel, { rotation: deposit ? 150 : 0, svgOrigin: wheelO });
    gsap.set([ram, shaft], { y: 0 });
    gsap.set(thread, { scaleY: 1, svgOrigin: `${RX2} 31` });
    gsap.set(hbtc, { scale: deposit ? 1 : 0, opacity: deposit ? 1 : 0, svgOrigin: coinO });
    gsap.set([emboss, relRing, ...sparks], { opacity: 0 });
  };
  const play = () => {
    gsap.set([emboss, relRing], { opacity: 0 });
    gsap.set(sparks, { opacity: 0, scale: 0 });
    gsap.set([ram, shaft], { y: 0 });
    gsap.set(thread, { scaleY: 1, svgOrigin: `${RX2} 31` });
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.7 });

    if (deposit) {
      gsap.set(hbtc, { scale: 0, opacity: 0, svgOrigin: coinO });
      gsap.set(shackle, { y: OPEN });
      gsap.set(wheel, { rotation: 0, svgOrigin: wheelO });
      // 1) the BTC drops into the safe on the Bitcoin side — and stays there
      tl.fromTo(btc, { y: -36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, ease: "power2.in" }, 0);
      tl.to(shackle, { y: 0, duration: 0.2, ease: "back.out(2.4)" }, 0.34);
      tl.to(wheel, { rotation: 150, duration: 0.46, ease: "power2.inOut", svgOrigin: wheelO }, 0.42);
      // 2) the press screws down and STRIKES new supply into existence on Sui
      tl.to([ram, shaft], { y: RAM_DROP, duration: 0.24, ease: "power3.in" }, 0.74);
      tl.to(thread, { scaleY: 1.85, duration: 0.24, ease: "power3.in", svgOrigin: `${RX2} 31` }, 0.74);
      tl.fromTo(hbtc, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.42, ease: "back.out(2.2)", svgOrigin: coinO }, 0.95);
      tl.fromTo(emboss, { scale: 0.5, opacity: 0.95, svgOrigin: coinO }, { scale: 1.8, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.97);
      sparks.forEach((s, i) => {
        const a = (i / sparks.length) * Math.PI * 2;
        tl.fromTo(s, { x: 0, y: 0, scale: 1, opacity: 0.95, transformOrigin: s._org },
          { x: Math.cos(a) * 22, y: Math.sin(a) * 18, scale: 0.4, opacity: 0, duration: 0.55, ease: "power2.out" }, 0.99);
      });
      tl.to([ram, shaft], { y: 0, duration: 0.34, ease: "power2.out" }, 1.06);
      tl.to(thread, { scaleY: 1, duration: 0.34, ease: "power2.out", svgOrigin: `${RX2} 31` }, 1.06);
    } else {
      gsap.set(hbtc, { scale: 1, opacity: 1, svgOrigin: coinO });
      gsap.set(btc, { x: 0, y: 0, opacity: 1 });
      gsap.set(shackle, { y: 0 });
      gsap.set(wheel, { rotation: 150, svgOrigin: wheelO });
      // 1) the press comes down and the hBTC is BURNED (it leaves the vault to the bridge)
      tl.to([ram, shaft], { y: RAM_DROP, duration: 0.24, ease: "power3.in" }, 0.1);
      tl.to(thread, { scaleY: 1.85, duration: 0.24, ease: "power3.in", svgOrigin: `${RX2} 31` }, 0.1);
      tl.to(hbtc, { scale: 0, opacity: 0, duration: 0.2, ease: "power2.in", svgOrigin: coinO }, 0.3);
      tl.fromTo(emboss, { scale: 0.5, opacity: 0.9, svgOrigin: coinO }, { scale: 1.8, opacity: 0, duration: 0.45, ease: "power2.out" }, 0.32);
      tl.to([ram, shaft], { y: 0, duration: 0.34, ease: "power2.out" }, 0.46);
      tl.to(thread, { scaleY: 1, duration: 0.34, ease: "power2.out", svgOrigin: `${RX2} 31` }, 0.46);
      // 2) custody opens and the real BTC is RELEASED to the user's address
      tl.to(wheel, { rotation: 0, duration: 0.44, ease: "power2.inOut", svgOrigin: wheelO }, 0.7);
      tl.to(shackle, { y: OPEN, duration: 0.24, ease: "back.out(2.2)" }, 0.98);
      tl.fromTo(relRing, { scale: 0.5, opacity: 0.85, svgOrigin: `${LX - 8} ${CYL}` }, { scale: 1.8, opacity: 0, duration: 0.5, ease: "power2.out" }, 1.06);
      tl.to(btc, { x: -34, opacity: 0, duration: 0.48, ease: "power2.in" }, 1.1);
    }
    tl.to({}, { duration: 0.5 });
    return tl;
  };
  return { play, stat };
};

// ── registry ─────────────────────────────────────────────────────────────────
export const ACTION_KINDS = [
  "stake", "farm", "compound", "vault", "pool",
  "unstake", "harvest", "withdraw",
  "perp",
  "swap", "order", "send", "mint", "burn", "authorize",
  "bridge",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

const BUILDERS: Record<ActionKind, Builder> = {
  stake: buildStake, farm: buildFarm, compound: buildCompound, vault: buildVault, pool: buildPool,
  unstake: buildUnstake, harvest: buildHarvest, withdraw: buildWithdraw,
  perp: buildPerp,
  swap: buildSwap, order: buildOrder, send: buildSend, mint: buildMint, burn: buildBurn, authorize: buildAuthorize,
  bridge: buildBridge,
};

/** One DeFi action scene — dimensional coin, semantic hue, phase-reactive stage.
 *  coinUrl/coinUrl2: real CoinMetadata icons stamped onto the value coins.
 *  lev: perp leverage — the reel rolls to it. phase drives loop/settle/fail.
 *  route/splits: the aggregator's live router path (swap becomes a venue-hop). */
export function DefiActionAnimation({
  kind, side = "long", phase = "preview", coinUrl, coinUrl2, coins, lev, route, splits, alts, combo, sponsored = false, className,
}: {
  kind: ActionKind;
  side?: "long" | "short";
  phase?: ScenePhase;
  coinUrl?: string;
  coinUrl2?: string;
  /** ALL input coins (multiSwap): the swap motif becomes a per-coin converge scene. */
  coins?: RouteStop[];
  lev?: number;
  route?: RouteStop[];
  splits?: number;
  alts?: RouteAlt[];
  combo?: ComboStop[];
  /** Show the small "Gas sponsored by SupWallet" badge — agent runs pay no gas. */
  sponsored?: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const prevPhase = useRef<ScenePhase>(phase);

  useGSAP(
    () => {
      const svg = svgRef.current;
      if (!svg) return;
      // Clear any leftover from a prior build (StrictMode double-invoke / HMR).
      gsap.killTweensOf(Array.from(svg.querySelectorAll("*")));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const { motes } = dressStage(svg);
      // Velocity streaks sit BEHIND the motif and only while broadcasting. CSS owns
      // the motion (and its reduced-motion off-switch), so this is append-only.
      if (phase === "running") svg.appendChild(makeSpeedField());
      const root = el("g");
      svg.appendChild(root);
      const api = BUILDERS[kind](root, side, coinUrl, coinUrl2, lev, route, splits, alts, combo, coins);
      // Small "Gas sponsored by SupWallet" badge — sits ON TOP of the motif (chrome).
      const gas = sponsored ? gasSponsorBadge(svg) : null;

      const was = prevPhase.current;
      prevPhase.current = phase;

      let tl: gsap.core.Timeline | null = null;
      let beat: gsap.core.Timeline | null = null;
      let gasTl: gsap.core.Timeline | null = null;
      // ?static freezes every motif at its settled frame (dev preview / screenshots)
      const frozen = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("static");
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        if (frozen) { api.stat(); return; }
        driftMotes(motes);
        if (gas) gasTl = animateGasBadge(gas);
        if (phase === "settled") {
          api.stat();
          // celebrate ONLY on a live transition into settled — a card re-mounted
          // already-settled (history) just shows the resting frame.
          if (was === "running" || was === "preview") beat = successBeat(root);
        } else if (phase === "failed") {
          api.stat(); // CSS owns the shake/desaturate
        } else {
          tl = api.play();
          tl?.timeScale(phase === "running" ? 1.18 : 1);
          // Dev-only: stash the timeline so a hidden pane (rAF paused) can still be
          // verified by manually SEEKING it (svg.__aaTL.progress(x)) from the console.
          if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
            (svg as unknown as { __aaTL?: gsap.core.Timeline | null }).__aaTL = tl;
          }
        }
      });
      mm.add("(prefers-reduced-motion: reduce)", () => { api.stat(); });

      return () => {
        tl?.kill();
        beat?.kill();
        gasTl?.kill();
        gsap.killTweensOf(Array.from(svg.querySelectorAll("*")));
        mm.revert();
        while (svg.firstChild) svg.removeChild(svg.firstChild);
      };
    },
    // phase IS a dependency: transitions rebuild the scene into the right state
    // (running loop / settled frame + celebration / failed frame). route joins to
    // a string so a new-but-equal array doesn't tear the timeline down.
    { dependencies: [kind, side, coinUrl, coinUrl2, lev, phase, sponsored, route?.map((r) => `${r.label}~${r.logo ?? ""}`).join("|") ?? "", splits ?? 0, alts?.map((a) => `${a.sharePct}:${a.stops.map((st) => st.label).join(",")}`).join("|") ?? "", combo?.map((c) => `${c.verb}~${c.label}~${c.logo ?? ""}`).join("|") ?? "", coins?.map((c) => `${c.label}~${c.logo ?? ""}`).join("|") ?? ""] },
  );

  return (
    <div className={`aa-frame${className ? ` ${className}` : ""}`} aria-hidden="true">
      {/* href + precedence → React 19 hoists this once, not per tile */}
      <style href="defi-action-motifs" precedence="default">{STYLES}</style>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" />
    </div>
  );
}
