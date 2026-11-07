// Drawn marks shared by the cards and the transcript. They replace unicode
// glyphs and emoji (✓ ○ ◐ ● ✕ 📎 📄), which rendered in whatever font the host
// happened to load and never matched each other. One 12px box, one 1.5px
// stroke, currentColor, so tone and flavor tokens still decide the color.

import type { SVGProps } from "react";

export type StatusMarkKind = "done" | "active" | "pending" | "failed" | "skipped";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function a11y(label?: string): SVGProps<SVGSVGElement> {
  return label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
}

export function StatusMark({ kind, label, size = 12 }: { kind: StatusMarkKind; label?: string; size?: number }) {
  return (
    <svg className="sc-mark" width={size} height={size} viewBox="0 0 12 12" {...a11y(label)}>
      {kind === "done" ? <path d="M2.5 6.3 4.9 8.6 9.5 3.6" {...stroke} /> : null}
      {kind === "failed" ? <path d="M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6" {...stroke} /> : null}
      {kind === "skipped" ? <path d="M3 6h6" {...stroke} /> : null}
      {kind === "pending" ? <circle cx="6" cy="6" r="4" {...stroke} /> : null}
      {kind === "active" ? (
        <>
          <circle cx="6" cy="6" r="4" {...stroke} />
          <circle cx="6" cy="6" r="1.75" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

/** A chevron for sort direction and "jump down"; points down unless `up`. */
export function Chevron({ up = false, size = 10 }: { up?: boolean; size?: number }) {
  return (
    <svg className="sc-mark" width={size} height={size} viewBox="0 0 12 12" aria-hidden>
      <path d={up ? "M3 7.5 6 4.5l3 3" : "M3 4.5 6 7.5l3-3"} {...stroke} />
    </svg>
  );
}

export type ToneIconKind = "info" | "warning" | "danger" | "success";

export function ToneIcon({ kind }: { kind: ToneIconKind }) {
  return (
    <svg className="sc-mark" width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      {kind === "info" ? (
        <>
          <circle cx="8" cy="8" r="6" {...stroke} />
          <path d="M8 7.25v3.5M8 5.1v.05" {...stroke} />
        </>
      ) : null}
      {kind === "warning" ? <path d="M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.4v.05" {...stroke} /> : null}
      {kind === "danger" ? (
        <>
          <circle cx="8" cy="8" r="6" {...stroke} />
          <path d="M8 4.75v3.75M8 11v.05" {...stroke} />
        </>
      ) : null}
      {kind === "success" ? <path d="M3.5 8.4 6.6 11.3 12.5 4.9" {...stroke} /> : null}
    </svg>
  );
}

export function AttachIcon() {
  return (
    <svg className="sc-mark" width={15} height={15} viewBox="0 0 24 24" aria-hidden>
      <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" {...stroke} strokeWidth={1.8} />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg className="sc-mark" width={13} height={13} viewBox="0 0 24 24" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5" {...stroke} strokeWidth={1.8} />
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg className="sc-mark" width={13} height={13} viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" {...stroke} strokeWidth={1.8} />
      <path d="m21 15-5-5L5 21" {...stroke} strokeWidth={1.8} />
    </svg>
  );
}
