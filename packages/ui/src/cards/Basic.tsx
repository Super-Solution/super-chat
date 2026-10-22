"use client";

// The read-only card renderers.

import { useMemo, useState, type SyntheticEvent } from "react";
import type {
  CodeCard,
  DiffCard,
  KeyValueCard,
  MarkdownCard,
  MediaCard,
  ProgressCard,
  StatsCard,
  TableCard,
  TableColumn,
  TimelineCard,
} from "@zzyzxlabs/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";
import { deltaTone, formatDelta, formatValue, toneClass } from "../format.js";
import { CodeBlock } from "../agent/CodeBlock.js";
import { newMarkdownStream, renderMarkdown, renderMarkdownStream } from "../markdown.js";
import { CardActions } from "./CardActions.js";
import { Chevron, StatusMark } from "./icons.js";

// Rows beyond this render behind a "Show all" toggle — a 200-row agent result
// would otherwise turn the card into the entire scroll surface.
const TABLE_TRUNCATE_AT = 30;

/** Header row + data rows, tab-separated — what Copy/Download hand off for
 * TableCardView. Values go through the same formatValue() the cells render,
 * so the export matches what's on screen rather than raw payload values. Tabs
 * and newlines inside a cell are flattened to a space; TSV has no escaping
 * mechanism for them. */
function tableToTsv(columns: TableColumn[], rows: Record<string, unknown>[]): string {
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, " ");
  const header = columns.map((c) => cell(c.label)).join("\t");
  const body = rows.map((row) => columns.map((c) => cell(formatValue(row[c.key], c.format))).join("\t")).join("\n");
  return rows.length ? `${header}\n${body}` : header;
}

export function TableCardView({ spec, partial }: CardRendererProps<TableCard>) {
  const [sortBy, setSortBy] = useState(spec.sortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(spec.sortDir ?? "desc");
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    if (!sortBy) return spec.rows;
    return [...spec.rows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      // Numeric when both sides are numeric, lexical otherwise — a mixed column
      // sorted purely as strings puts "10" before "9".
      const an = Number(av);
      const bn = Number(bv);
      const cmp =
        Number.isFinite(an) && Number.isFinite(bn) ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [spec.rows, sortBy, sortDir]);

  // A stable key per row: the row's own `id` when the payload carries one,
  // otherwise its position in spec.rows *before* sorting. Sorting reorders the
  // `rows` array on every column click — keying off the sorted array's index
  // would rekey (and remount) every row each time the user re-sorts.
  const originalIndex = useMemo(() => {
    const m = new Map<Record<string, unknown>, number>();
    spec.rows.forEach((row, i) => m.set(row, i));
    return m;
  }, [spec.rows]);
  const rowKey = (row: Record<string, unknown>): string | number => {
    const id = row["id"];
    if (typeof id === "string" || typeof id === "number") return id;
    return originalIndex.get(row) ?? -1;
  };

  // Truncation reads off the sorted array, not spec.rows — the user asked to
  // see the top 30 of *this* ordering, not the top 30 of whatever order the
  // agent originally sent.
  const truncated = rows.length > TABLE_TRUNCATE_AT;
  const visibleRows = showAll ? rows : rows.slice(0, TABLE_TRUNCATE_AT);

  const toggle = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-table-wrap">
        <table className="sc-table">
          <thead>
            <tr>
              {spec.columns.map((c) => (
                <th
                  key={c.key}
                  style={{ textAlign: c.align ?? "left" }}
                  aria-sort={sortBy === c.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {/* Sorting a table that is still filling would reshuffle it
                      on every row; it unlocks when the validated card lands. */}
                  <button type="button" className="sc-th-btn" onClick={() => toggle(c.key)} disabled={partial}>
                    {c.label}
                    {sortBy === c.key ? <Chevron up={sortDir === "asc"} /> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && !partial ? (
              <tr>
                <td colSpan={spec.columns.length} className="sc-muted">
                  No rows.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={rowKey(row)}>
                  {spec.columns.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                      {c.pill ? (
                        <span className="sc-pill">{formatValue(row[c.key], c.format)}</span>
                      ) : (
                        formatValue(row[c.key], c.format)
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm sc-table__more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show all (${rows.length})`}
        </button>
      ) : null}
      {spec.caption ? <div className="sc-muted sc-card__caption">{spec.caption}</div> : null}
      {partial ? null : (
        <CardActions getText={() => tableToTsv(spec.columns, rows)} filename="table.tsv" mimeType="text/tab-separated-values" />
      )}
    </div>
  );
}

export function StatsCardView({ spec }: CardRendererProps<StatsCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-stats">
        {spec.items.map((item, i) => (
          <div key={i} className="sc-stat">
            <div className="sc-stat__label">{item.label}</div>
            <div className={`sc-stat__value${toneClass(item.tone)}`}>{formatValue(item.value, item.format)}</div>
            {item.delta != null ? (
              <div className={`sc-stat__delta sc-tone--${deltaTone(item.delta)}`}>
                {formatDelta(item.delta, item.deltaFormat ?? "percent")}
              </div>
            ) : null}
            {item.hint ? <div className="sc-muted sc-stat__hint">{item.hint}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function KeyValueCardView({ spec }: CardRendererProps<KeyValueCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <dl className="sc-kv">
        {spec.items.map((item, i) => (
          <div key={i} className="sc-kv__row">
            <dt>{item.label}</dt>
            <dd className={`${item.mono ? "sc-mono" : ""}${toneClass(item.tone)}`}>{formatValue(item.value, item.format)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TimelineCardView({ spec }: CardRendererProps<TimelineCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <ol className="sc-timeline">
        {spec.events.map((e, i) => (
          <li key={i} className={`sc-timeline__item${toneClass(e.tone)}`}>
            <span className="sc-timeline__dot" aria-hidden />
            <div>
              <div className="sc-timeline__label">{e.label}</div>
              <div className="sc-muted sc-timeline__at">{formatValue(e.at, "datetime")}</div>
              {e.detail ? <div className="sc-timeline__detail">{e.detail}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ProgressCardView({ spec }: CardRendererProps<ProgressCard>) {
  const done = spec.steps.filter((s) => s.status === "done").length;
  const fraction = spec.fraction ?? (spec.steps.length ? done / spec.steps.length : 0);

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div
        className="sc-progress"
        role="progressbar"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="sc-progress__bar" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
      </div>
      <ul className="sc-steps">
        {spec.steps.map((s, i) => (
          <li key={i} className={`sc-step sc-step--${s.status}`}>
            <span className="sc-step__icon">
              <StatusMark kind={s.status} />
            </span>
            <span className="sc-step__label">{s.label}</span>
            {s.detail ? <span className="sc-muted sc-step__detail">{s.detail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type MediaItem = MediaCard["items"][number];

function MediaItemView({ item }: { item: MediaItem }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const type = item.mediaType?.toLowerCase() ?? "image/*";
  const label = item.alt ?? item.caption ?? (type.startsWith("audio/") ? "Generated audio" : type.startsWith("video/") ? "Generated video" : "Generated image");
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : undefined;

  const imageReady = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (typeof image.decode === "function") {
      void image.decode().catch(() => undefined).then(() => setState("ready"));
    } else {
      setState("ready");
    }
  };

  return (
    <figure className={`sc-media__item sc-media__item--${state}`}>
      <div
        className={`sc-media__viewport${type.startsWith("audio/") ? " sc-media__viewport--audio" : ""}`}
        style={ratio ? { aspectRatio: ratio } : undefined}
      >
        {state === "loading" ? (
          <div className="sc-media__decode sc-skeleton__surface" role="status" aria-live="polite">
            <span className="sc-sr-only">Loading generated media…</span>
          </div>
        ) : null}
        {state === "error" ? <div className="sc-media__error" role="alert">Media could not be loaded.</div> : null}
        {type.startsWith("audio/") ? (
          <audio
            src={item.url}
            controls
            preload="metadata"
            aria-label={label}
            onLoadedMetadata={() => setState("ready")}
            onError={() => setState("error")}
          />
        ) : type.startsWith("video/") ? (
          <video
            src={item.url}
            controls
            preload="metadata"
            aria-label={label}
            onLoadedMetadata={() => setState("ready")}
            onError={() => setState("error")}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.alt ?? item.caption ?? ""} loading="lazy" onLoad={imageReady} onError={() => setState("error")} />
        )}
      </div>
      {item.caption ? <figcaption className="sc-muted">{item.caption}</figcaption> : null}
    </figure>
  );
}

export function MediaCardView({ spec }: CardRendererProps<MediaCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className={spec.layout === "single" ? "sc-media sc-media--single" : "sc-media"}>
        {spec.items.map((item, i) => <MediaItemView key={`${item.url}:${i}`} item={item} />)}
      </div>
    </div>
  );
}

export function MarkdownCardView({ spec, partial }: CardRendererProps<MarkdownCard>) {
  // A body that is still growing re-renders only its open tail per update —
  // the same output renderMarkdown gives, without re-parsing settled blocks.
  const [stream] = useState(newMarkdownStream);
  const html = useMemo(
    () => (partial ? renderMarkdownStream(spec.body, stream) : renderMarkdown(spec.body)),
    [spec.body, partial, stream],
  );
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-prose" dangerouslySetInnerHTML={{ __html: html }} />
      {partial ? null : <CardActions getText={() => spec.body} filename="note.md" mimeType="text/markdown" />}
    </div>
  );
}

// Best-effort language → extension map for the download filename when the
// card has no explicit `filename`. Deliberately not exhaustive — "txt" is a
// safe fallback, not a bug, for anything not listed.
const CODE_EXT: Record<string, string> = {
  javascript: "js", js: "js", jsx: "jsx",
  typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py",
  json: "json", html: "html", css: "css", scss: "scss", less: "less",
  markdown: "md", md: "md",
  bash: "sh", shell: "sh", sh: "sh", zsh: "sh",
  yaml: "yml", yml: "yml",
  rust: "rs", go: "go", java: "java",
  c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", "c#": "cs",
  ruby: "rb", rb: "rb", php: "php", sql: "sql",
  swift: "swift", kotlin: "kt", kt: "kt",
};

function codeFilename(spec: CodeCard): string {
  if (spec.filename) return spec.filename;
  const ext = (spec.language && CODE_EXT[spec.language.toLowerCase()]) || "txt";
  return `snippet.${ext}`;
}

export function CodeCardView({ spec }: CardRendererProps<CodeCard>) {
  // No surrounding sc-card shell: CodeBlock already carries its own header,
  // border and actions. It takes the download filename rather than pairing
  // with CardActions, so the card offers one action row instead of two Copy
  // buttons that behave slightly differently.
  return (
    <CodeBlock
      code={spec.code}
      lang={spec.language}
      filename={spec.filename ?? spec.title}
      downloadName={codeFilename(spec)}
      // A single line needs no gutter; numbering it is just noise.
      lineNumbers={spec.code.trimEnd().includes("\n")}
    />
  );
}

export function DiffCardView({ spec }: CardRendererProps<DiffCard>) {
  // Line-level diff via longest-common-subsequence. Enough for a card; a real
  // review surface should use a proper diff view.
  const rows = useMemo(() => diffLines(spec.before.split("\n"), spec.after.split("\n")), [spec.before, spec.after]);

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-diff">
        {rows.map((row, i) => (
          <div key={i} className={`sc-diff__line sc-diff__line--${row.kind}`}>
            <span className="sc-diff__sign" aria-hidden>
              {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
            </span>
            <span>{row.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type DiffRow = { kind: "same" | "add" | "del"; text: string };

// Above this many lines on either side, even a minimal diff costs more than
// the linear fallback below (a 5000-line file with 5% of its lines edited:
// ~2.4 ms against ~0.08 ms), and that fallback is what such inputs have always
// shown.
const DIFF_LCS_LINE_CAP = 2000;

/**
 * Line diff, row for row what the old (n+1)×(m+1) LCS table produced, without
 * the table: that cost O(n·m) time and memory whatever the edit, 4M cells and
 * 20–45 ms for two 2000-line texts that differ in a single line.
 *
 * The old walk went forward, took a matching line whenever it could, and
 * otherwise deleted a[i] if that kept the diff minimal, else inserted b[j].
 * matchLines() replays exactly that walk, answering "does deleting keep it
 * minimal?" from a Myers search instead of the table, so the cost is
 * O((n+m)·D) for D changed lines. Rows are then laid out the way the old walk
 * emitted them: between two kept lines, every deletion before any insertion.
 *
 * The search is bounded. First it runs on the lines themselves with a small
 * budget, which covers ordinary edits. Failing that, it runs again on only the
 * lines that occur on BOTH sides: a line only one side has can never be kept,
 * so dropping it does not change which lines the walk keeps (matchLines
 * minds where the dropped ones were), and two texts that mostly differ shrink
 * to almost nothing. That second run may take a sixteenth as many steps as a
 * table over those lines has cells. Past that (shared lines, blank and brace
 * lines included, added, removed or moved in many places) lcsPairs() fills
 * that table and walks it the old way, so the rows are the same either way. A
 * grid the search cannot beat goes to the table directly: a tiny one, or one
 * side much longer than the other.
 */
export function diffLines(a: string[], b: string[]): DiffRow[] {
  if (a.length > DIFF_LCS_LINE_CAP || b.length > DIFF_LCS_LINE_CAP) return diffLinesFast(a, b);

  const n = a.length;
  const m = b.length;
  // A table no bigger than the first search's budget is the cheaper of the two.
  let pairs = n * m <= 16 * (n + m) ? lcsPairs(a, b, n, m) : searchPays(n, m) ? matchLines(a, b, 16 * (n + m)) : null;
  if (!pairs) {
    const idOf = new Map<string, number>();
    const bId = new Int32Array(m);
    for (let j = 0; j < m; j += 1) {
      let id = idOf.get(b[j]!);
      if (id === undefined) idOf.set(b[j]!, (id = idOf.size));
      bId[j] = id;
    }
    const inA = new Uint8Array(idOf.size);
    const aAt: number[] = [];
    const aKept: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = idOf.get(a[i]!);
      if (id === undefined) continue;
      inA[id] = 1;
      aAt.push(i);
      aKept.push(id);
    }
    const bAt: number[] = [];
    const bKept: number[] = [];
    for (let j = 0; j < m; j += 1) {
      if (!inA[bId[j]!]) continue;
      bAt.push(j);
      bKept.push(bId[j]!);
    }
    const n2 = aKept.length;
    const m2 = bKept.length;
    pairs = (searchPays(n2, m2) && matchLines(aKept, bKept, (n2 * m2) >> 4, bAt)) || lcsPairs(aKept, bKept, n, m, aAt, bAt);
    for (let q = 0; q < pairs.length; q += 2) {
      pairs[q] = aAt[pairs[q]!]!;
      pairs[q + 1] = bAt[pairs[q + 1]!]!;
    }
  }

  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  for (let q = 0; q < pairs.length; q += 2) {
    while (i < pairs[q]!) out.push({ kind: "del", text: a[i++]! });
    while (j < pairs[q + 1]!) out.push({ kind: "add", text: b[j++]! });
    out.push({ kind: "same", text: a[i++]! });
    j += 1;
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

// The search needs at least |n − m| rounds and round d takes d + 1 steps, so
// once (n − m)²/2 reaches the table's n·m cells it cannot win: one side much
// longer than the other (a new file, a few lines against a long text).
function searchPays(n: number, m: number): boolean {
  return (n - m) * (n - m) < 2 * n * m;
}

/**
 * The kept lines of the old LCS walk over `a` and `b`, as flat [i, j, …]
 * index pairs, or null once the search has taken more than `budget` steps.
 *
 * `bAt` is set when `a` and `b` are the filtered id sequences: bAt[j] is b[j]'s
 * index in the original text, so a gap in it marks lines only the new side
 * had. The old walk, standing on such a line, had nothing to match: it
 * deleted a[x] if that stayed minimal and otherwise inserted the line. Without
 * this the replay would pair a[x] with b[y] early — equally short, but not
 * the pairing the card used to show.
 */
function matchLines<T>(a: ArrayLike<T>, b: ArrayLike<T>, budget: number, bAt?: ArrayLike<number>): number[] | null {
  const pairs: number[] = [];
  let p = 0;
  let next = 0; // original index of the first new-side line the walk has not passed
  while (p < a.length && p < b.length && (!bAt || bAt[p] === next) && a[p] === b[p]) {
    pairs.push(p, p);
    if (bAt) next = bAt[p]! + 1;
    p += 1;
  }

  // Myers, run backwards from the end of both texts. After round d,
  // trace[d(d+1)/2 + i] holds, for diagonal k = kEnd - d + 2i (k = x - y), the
  // smallest x on it from which the rest of the texts is at most d edits away
  // (none = no such point). The first round's snake eats the common suffix,
  // which is why it is not trimmed up front: trimming would pair trailing
  // equal lines differently from the old walk (before [x, s], after [s, y, s]).
  const n = a.length - p;
  const m = b.length - p;
  const kEnd = n - m;
  const none = n + 1;
  let trace = new Int32Array(64);
  let work = 0;
  let d = 0;
  for (; ; d += 1) {
    const base = (d * (d + 1)) >> 1;
    work += d + 1;
    if (work > budget) return null;
    if (base + d + 1 > trace.length) {
      const grown = new Int32Array(Math.max(base + d + 1, Math.min(trace.length * 2, budget)));
      grown.set(trace);
      trace = grown;
    }
    const prev = base - d;
    for (let i = 0; i <= d; i += 1) {
      const k = kEnd - d + 2 * i;
      let x = d === 0 ? n : none;
      if (i < d) {
        // Step to (x+1, y) on diagonal k+1, a deletion.
        const s = trace[prev + i]!;
        const c = s > 0 ? s : 1;
        if (c <= n && c <= m + k + 1) x = c - 1;
      }
      if (i > 0) {
        // Step to (x, y+1) on diagonal k-1, an insertion.
        const s = trace[prev + i - 1]!;
        const c = s > k ? s : k;
        if (c <= n && c <= m + k - 1 && c < x) x = c;
      }
      if (i > 0 && i < d) {
        // Already within d-2 edits.
        const s = trace[prev - d + i]!;
        if (s < x) x = s;
      }
      if (x !== none) {
        let y = x - k;
        while (x > 0 && y > 0 && a[p + x - 1] === b[p + y - 1]) {
          x -= 1;
          y -= 1;
          work += 1;
        }
        if (work > budget) return null;
      }
      trace[base + i] = x;
    }
    const at = d - kEnd; // twice diagonal 0's index this round
    if (at >= 0 && at <= 2 * d && (at & 1) === 0 && trace[base + (at >> 1)] === 0) break;
  }

  // Replay the old walk. At (x, y) the rest is exactly r+1 edits away, so
  // deleting keeps the diff minimal iff (x+1, y) is within r.
  let x = 0;
  let y = 0;
  let r = d - 1;
  while (x < n && y < m) {
    const pending = bAt !== undefined && bAt[p + y] !== next;
    if (!pending && a[p + x] === b[p + y]) {
      pairs.push(p + x, p + y);
      if (bAt) next = bAt[p + y]! + 1;
      x += 1;
      y += 1;
      continue;
    }
    const at = x + 1 - y - kEnd + r;
    if (at >= 0 && at <= 2 * r && x + 1 >= trace[((r * (r + 1)) >> 1) + (at >> 1)]!) {
      x += 1;
      r -= 1;
    } else if (pending) {
      next = bAt![p + y]!; // the dropped lines are inserted; nothing else moves
    } else {
      if (bAt) next = bAt[p + y]! + 1;
      y += 1;
      r -= 1;
    }
  }
  return pairs;
}

/**
 * The old table walk itself, for what the search cannot do cheaply; same
 * [i, j, …] pairs as matchLines. With `aAt`/`bAt`, `a` and `b` are the lines
 * both sides share (aAt[i] is a[i]'s index in the n-line old text, bAt[j]
 * b[j]'s in the m-line new one). Leaving the other lines out of the table
 * changes no LCS length, so the walk still steps over all n and m lines,
 * reading each length at the shared line it has reached. The cap keeps every
 * length under 2^16.
 */
function lcsPairs<T>(a: ArrayLike<T>, b: ArrayLike<T>, n: number, m: number, aAt?: ArrayLike<number>, bAt?: ArrayLike<number>): number[] {
  const w = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const ai = a[i];
    for (let j = b.length - 1, at = i * w + j; j >= 0; j -= 1, at -= 1) {
      lcs[at] = ai === b[j] ? lcs[at + w + 1]! + 1 : Math.max(lcs[at + w]!, lcs[at + 1]!);
    }
  }
  const pairs: number[] = [];
  let i = 0;
  let j = 0;
  for (let x = 0, y = 0; x < n && y < m; ) {
    // Whether old line x and new line y are in the table, as a[i] and b[j].
    const inA = i < a.length && (aAt ? aAt[i] : i) === x;
    const inB = j < b.length && (bAt ? bAt[j] : j) === y;
    if (inA && inB && a[i] === b[j]) {
      pairs.push(i, j);
      i += 1;
      j += 1;
      x += 1;
      y += 1;
    } else if (lcs[(inA ? i + 1 : i) * w + j]! >= lcs[i * w + (inB ? j + 1 : j)]!) {
      if (inA) i += 1;
      x += 1;
    } else {
      if (inB) j += 1;
      y += 1;
    }
  }
  return pairs;
}

/**
 * O(n) fallback for inputs too large for full LCS. Trims the matching prefix
 * and suffix and treats everything between as one wholesale removal +
 * addition. It won't line up a match buried in the middle the way LCS would,
 * but it never allocates more than a handful of arrays no matter how large
 * the input is.
 */
function diffLinesFast(a: string[], b: string[]): { kind: "same" | "add" | "del"; text: string }[] {
  let start = 0;
  const maxStart = Math.min(a.length, b.length);
  while (start < maxStart && a[start] === b[start]) start += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  for (let i = 0; i < start; i += 1) out.push({ kind: "same", text: a[i]! });
  for (let i = start; i < endA; i += 1) out.push({ kind: "del", text: a[i]! });
  for (let i = start; i < endB; i += 1) out.push({ kind: "add", text: b[i]! });
  for (let i = endA; i < a.length; i += 1) out.push({ kind: "same", text: a[i]! });
  return out;
}
