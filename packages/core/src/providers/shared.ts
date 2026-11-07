// Logic shared by more than one adapter. Anything that is genuinely one
// provider's wire quirk belongs in that provider's own map-in.ts — this file
// is only for the pieces that are identical in shape across adapters, where
// duplicating them risks the copies drifting apart.

/**
 * Collect the ids of "answer" markers from a flat list, via a callback that
 * returns the id when an item IS an answer, or undefined otherwise.
 *
 * Every wire format's orphan-call prune (OpenAI Responses' function_call /
 * function_call_output, Chat's tool_calls / role:"tool", Anthropic's
 * tool_use / tool_result) starts by building this same Set; only the
 * extractor differs; see `dropUnanswered` for the other half.
 */
export function collectAnsweredIds<T>(items: readonly T[], answerId: (item: T) => string | undefined): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = answerId(item);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * Drop items whose call id is not in `answered`. `callId` returns undefined
 * for items that are not gated on an answer at all, which always pass.
 *
 * Used directly on the top-level list for a flat wire shape (Responses'
 * input items), and on the nested list inside a container for a wire shape
 * that groups calls under a message (Chat's tool_calls[], Anthropic's
 * content[]).
 */
export function dropUnanswered<T>(
  items: readonly T[],
  answered: ReadonlySet<string>,
  callId: (item: T) => string | undefined,
): T[] {
  return items.filter((item) => {
    const id = callId(item);
    return id === undefined || answered.has(id);
  });
}

/**
 * A foreign file ref DEGRADES to text instead of throwing. Throwing would be
 * correct for the turn that attached it — but the ref lives in persisted
 * history, so a throw poisons every subsequent turn of the thread (the exact
 * failure mode the orphan-call prune exists to prevent for tool calls). The
 * model reading "[attachment unavailable]" can say so; a permanently 400ing
 * thread can't say anything.
 */
export function foreignFileText(
  kind: "image" | "file",
  filename: string | undefined,
  source: { id: string; provider: string },
): string {
  return `[${kind} "${filename ?? source.id}" unavailable — it was uploaded to "${source.provider}" and cannot be read here. Ask the user to re-attach it.]`;
}

/**
 * Provider-hosted tool declarations ride the wire verbatim — we don't own
 * their shape, and the vendor versions it on their own cadence — but an
 * entry that isn't even an object with a `type` string would still get
 * spread into the request as-is, producing a wire object the provider
 * rejects with an error far from where the bad entry came from. This is
 * deliberately not a schema validator; it only catches "not tool-shaped".
 */
export function isNativeToolShape(value: unknown): value is Record<string, unknown> & { type: string } {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** `providerTools[id]`, narrowed to entries that at least look like a tool declaration. */
export function filterNativeTools(value: unknown): (Record<string, unknown> & { type: string })[] {
  return Array.isArray(value) ? value.filter(isNativeToolShape) : [];
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Combine a caller's signal with a default timeout, so a stalled connection
 * cannot hang forever when the caller never passes (or never aborts) its own
 * signal. Whichever fires first wins — a caller's shorter deadline is never
 * overridden by the default.
 */
export function withDefaultTimeout(signal: AbortSignal | undefined, ms: number = DEFAULT_TIMEOUT_MS): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(ms);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeoutSignal]);

  // Manual combine for a runtime without AbortSignal.any.
  const controller = new AbortController();
  const relay = (from: AbortSignal) => () => controller.abort(from.reason);
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener("abort", relay(signal), { once: true });
  if (timeoutSignal.aborted) controller.abort(timeoutSignal.reason);
  else timeoutSignal.addEventListener("abort", relay(timeoutSignal), { once: true });
  return controller.signal;
}
