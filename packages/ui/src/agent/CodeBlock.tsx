"use client";

// Code block with a filename bar, line numbers and copy-to-clipboard.
//
// The gutter is a real grid column rather than a ::before counter, so selecting
// the code and copying by hand does not drag the line numbers along with it.

import { useEffect, useRef, useState } from "react";

export interface CodeBlockProps {
  code: string;
  /** Shown in the header. A filename reads better than a bare language tag. */
  lang?: string;
  filename?: string;
  /** Hide the gutter for short one-liners. */
  lineNumbers?: boolean;
  /** 1-based lines to tint — useful for pointing at the line under discussion. */
  highlight?: number[];
  /**
   * Filename to save as, extension included. Adds a Download button beside
   * Copy; omit it and only Copy is offered. Long output is the case that needs
   * this — selecting a 300-line block by hand is not a real affordance.
   */
  downloadName?: string;
}

const CopyIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" />
  </svg>
);

const CheckIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

// Rows beyond this render behind a "Show all" toggle — a multi-thousand-line
// file would otherwise put that many DOM rows on the page up front, unrendered
// or not, for a block nobody scrolled to.
const LINE_TRUNCATE_AT = 500;

const DownloadIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3.5v11m0 0 4-4m-4 4-4-4M4 19.5h16" />
  </svg>
);

export function CodeBlock({ code, lang, filename, lineNumbers = true, highlight, downloadName }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const lines = code.replace(/\n$/, "").split("\n");
  const marked = new Set(highlight ?? []);
  const title = filename ?? lang ?? "code";
  const truncated = lines.length > LINE_TRUNCATE_AT;
  const visibleLines = showAll ? lines : lines.slice(0, LINE_TRUNCATE_AT);

  const copy = () => {
    // clipboard is absent on http:// origins and in some embedded webviews;
    // failing silently would look like a dead button, so leave `copied` off.
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    });
  };

  const download = () => {
    if (!downloadName) return;
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Deferred rather than immediate: revoking in the same tick can cut the
    // download off before some browsers finish reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="sc-code">
      <div className="sc-code__head">
        <span className="sc-code__file">
          <svg className="sc-code__icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              d="m8 6-6 6 6 6M16 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sc-code__lang">{title}</span>
        </span>
        <button
          type="button"
          className="sc-code__copy"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        {downloadName ? (
          <button type="button" className="sc-code__copy" onClick={download} aria-label={`Download ${downloadName}`}>
            <DownloadIcon />
            <span>Download</span>
          </button>
        ) : null}
      </div>
      <div className={"sc-code__body" + (lineNumbers ? "" : " sc-code__body--nogutter")}>
        {visibleLines.map((line, i) => (
          <div
            className={"sc-code__row" + (marked.has(i + 1) ? " sc-code__row--mark" : "")}
            key={i}
          >
            {lineNumbers ? <span className="sc-code__ln">{i + 1}</span> : null}
            <code className="sc-code__line">{line || " "}</code>
          </div>
        ))}
      </div>
      {truncated ? (
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm sc-code__more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer lines" : `Show all (${lines.length} lines)`}
        </button>
      ) : null}
    </div>
  );
}
