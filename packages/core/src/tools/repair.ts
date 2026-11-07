// Tool-call repair.
//
// Models emit malformed tool arguments often enough that treating it as an
// exception is the wrong design — a turn that dies on a stray newline inside a
// JSON string is worse than a turn that fixes it and continues. Every fix here
// is *syntactic and lossless*: we never invent argument values, so a repair can
// change whether the call parses but not what it means.
//
// Observed failure modes, in the order we handle them:
//   1. empty string / "null" for a no-argument tool         → {}
//   2. markdown fences around the JSON (```json … ```)      → strip
//   3. double-encoded JSON ("\"{\\\"a\\\":1}\"")            → parse twice
//   4. raw control characters inside string literals        → escape them
//   5. trailing commas before } or ]                        → drop
//   6. Python literals (True/False/None) from local models  → JSON literals
//   7. single-quoted keys/values                            → double quotes
//   8. prose wrapped around a JSON object                   → extract the object

export type RepairResult = { value: unknown; repaired: boolean; error?: string };

/** Provider prefixes some routers prepend to tool names. Stripped before dispatch. */
const NAME_PREFIXES = [/^functions\./, /^mcp_/, /^default_api[:.]/, /^tool[:.]/];

/**
 * Normalize a tool name. Some OpenAI-compatible routers namespace tool names on
 * the way out but not on the way in, so the model calls `functions.getPrice`
 * for a tool we registered as `getPrice`.
 */
export function normalizeToolName(name: string): string {
  let out = name.trim();
  for (const re of NAME_PREFIXES) out = out.replace(re, "");
  return out;
}

const CONTROL_ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
const BACKSLASH = 0x5c;
const QUOTE = 0x22;
const COMMA = 0x2c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;

// The scans below read character codes rather than one-character strings, and
// the two that rewrite copy the untouched stretches between their fixes with one
// slice each rather than building the output a character at a time, handing
// back the input itself when there was nothing to fix. On a megabyte of
// arguments the per-character version was most of a repair's cost.

/** Escape control characters that appear *inside* JSON string literals. */
function escapeControlCharsInStrings(input: string): string {
  const parts: string[] = [];
  let from = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (code === BACKSLASH) {
      escaped = true;
      continue;
    }
    if (code === QUOTE) {
      inString = !inString;
      continue;
    }
    if (inString && code < 0x20) {
      parts.push(input.slice(from, i), CONTROL_ESCAPES[input[i]!] ?? `\\u${code.toString(16).padStart(4, "0")}`);
      from = i + 1;
    }
  }
  if (!parts.length) return input;
  parts.push(input.slice(from));
  return parts.join("");
}

/** The first character that is not whitespace, as `\s` counts it. */
const NON_SPACE = /\S/g;

/** Remove trailing commas before a closing brace/bracket, outside of strings. */
function dropTrailingCommas(input: string): string {
  const parts: string[] = [];
  let from = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (code === BACKSLASH) {
      escaped = true;
      continue;
    }
    if (code === QUOTE) inString = !inString;
    if (!inString && code === COMMA) {
      NON_SPACE.lastIndex = i + 1;
      const nextNonSpace = NON_SPACE.exec(input)?.[0];
      if (nextNonSpace === "}" || nextNonSpace === "]") {
        parts.push(input.slice(from, i)); // drop it
        from = i + 1;
      }
    }
  }
  if (!parts.length) return input;
  parts.push(input.slice(from));
  return parts.join("");
}

/** Extract the outermost balanced {...} from prose, respecting string literals. */
function extractJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (code === BACKSLASH) {
      escaped = true;
      continue;
    }
    if (code === QUOTE) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (code === OPEN_BRACE) depth += 1;
    else if (code === CLOSE_BRACE) {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse tool arguments, repairing what can be repaired losslessly.
 * Returns `{}` rather than throwing when nothing is salvageable — an empty
 * argument object lets the tool's own validation produce a message the model can
 * act on, which beats a parse error the model never sees.
 */
export function repairToolArguments(raw: unknown): RepairResult {
  if (raw == null) return { value: {}, repaired: false };
  if (typeof raw === "object") return { value: raw, repaired: false };
  if (typeof raw !== "string") return { value: {}, repaired: true, error: `Unexpected argument type ${typeof raw}` };

  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "{}") {
    return { value: {}, repaired: trimmed !== "{}" };
  }

  // Fast path: already valid.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    // Double-encoded: valid JSON that yields a string which is itself JSON.
    if (typeof parsed === "string") {
      try {
        return { value: JSON.parse(parsed) as unknown, repaired: true };
      } catch {
        return { value: { value: parsed }, repaired: true };
      }
    }
    return { value: parsed, repaired: false };
  } catch {
    /* fall through to repairs */
  }

  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "");
  // The closing fence is cut by hand, and the whitespace before it goes with the
  // trim. As a regex, /\s*```$/ restarts at every offset of a whitespace run and
  // rescans the rest of it, which is quadratic: 40,000 spaces took 0.6 s.
  const defenced = (unfenced.endsWith("```") ? unfenced.slice(0, -3) : unfenced).trim();
  // Each candidate is built only once every one before it has failed to parse,
  // so a fenced object never pays for the scans and a trailing comma never pays
  // for the regex passes. Every candidate after this one builds on the same
  // `defenced` input, so the shared passes run once.
  function* candidates(): Generator<string> {
    yield defenced;
    const controlCharsEscaped = escapeControlCharsInStrings(defenced);
    yield controlCharsEscaped;
    const noTrailingCommas = dropTrailingCommas(controlCharsEscaped);
    yield noTrailingCommas;
    yield noTrailingCommas
      // Python literals, only as standalone tokens so "None of the above" survives.
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    // Single quotes last: it is the most destructive fix (an apostrophe inside a
    // value becomes a quote), so it only runs when everything else has failed.
    yield noTrailingCommas.replace(/'([^'\\]*)'(\s*[:,}\]])/g, '"$1"$2');
    const extracted = extractJsonObject(defenced);
    if (extracted) {
      yield extracted;
      // An object that is the whole input has been through these passes already.
      yield extracted === defenced ? noTrailingCommas : dropTrailingCommas(escapeControlCharsInStrings(extracted));
    }
  }

  // Most fixes change nothing on most inputs, and text that already failed will
  // fail again, so a candidate identical to one tried before — `trimmed`
  // included — is not parsed twice. Nor is one that cannot be an object or an
  // array because it does not start and end like one.
  const tried = [trimmed];
  for (const candidate of candidates()) {
    if (!bracketed(candidate) || tried.includes(candidate)) continue;
    tried.push(candidate);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") return { value: parsed, repaired: true };
    } catch {
      continue;
    }
  }

  return { value: {}, repaired: true, error: `Could not parse tool arguments: ${trimmed.slice(0, 200)}` };
}

const isJsonSpace = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/**
 * Whether `text` opens and closes like a JSON object or array, ignoring the
 * whitespace JSON allows around a value. JSON.parse can return an object only
 * when it does, so when it does not, a parse is known to be wasted.
 */
function bracketed(text: string): boolean {
  let start = 0;
  let end = text.length - 1;
  while (isJsonSpace(text[start])) start += 1;
  while (end > start && isJsonSpace(text[end])) end -= 1;
  const open = text[start];
  const close = text[end];
  return end > start && ((open === "{" && close === "}") || (open === "[" && close === "]"));
}
