// One error type with a discriminating `kind`. The reason this matters: the
// runtime's retry policy, the UI's message, and the host's alerting all key off
// "is this transient" and "is this the user's fault" — and a raw `Error` from
// `fetch` answers neither.

export type AgentErrorKind =
  | "auth" // bad/missing key — never retry
  | "rate-limit" // retry with backoff, honour Retry-After
  | "overloaded" // provider 5xx/529 — retry
  | "timeout" // retry
  | "network" // retry
  | "invalid-request" // our bug or the caller's — never retry
  | "content-filter" // provider refused — never retry
  | "context-length" // compact and retry once
  | "not-supported" // capability the adapter/model lacks
  | "cancelled"
  | "tool-error"
  | "unknown";

const RETRYABLE: ReadonlySet<AgentErrorKind> = new Set([
  "rate-limit",
  "overloaded",
  "timeout",
  "network",
]);

export class AgentError extends Error {
  readonly kind: AgentErrorKind;
  readonly status?: number;
  readonly provider?: string;
  /** Seconds to wait before retrying, from a Retry-After header when present. */
  readonly retryAfter?: number;
  override readonly cause?: unknown;
  readonly detail?: unknown;

  constructor(
    kind: AgentErrorKind,
    message: string,
    opts: { status?: number; provider?: string; retryAfter?: number; cause?: unknown; detail?: unknown } = {},
  ) {
    super(message);
    this.name = "AgentError";
    this.kind = kind;
    this.status = opts.status;
    this.provider = opts.provider;
    this.retryAfter = opts.retryAfter;
    this.cause = opts.cause;
    this.detail = opts.detail;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }

  /** Compact shape for logs and for handing an error back to the model as data. */
  toJSON() {
    return { kind: this.kind, message: this.message, status: this.status, provider: this.provider };
  }
}

export function isAgentError(e: unknown): e is AgentError {
  return e instanceof AgentError;
}

/**
 * Classify anything thrown. Used for errors that never went through an adapter
 * (a DNS failure, an aborted signal) and as the fallback in adapter mapping.
 */
export function toAgentError(e: unknown, provider?: string): AgentError {
  if (isAgentError(e)) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && e.name === "AbortError") {
    return new AgentError("cancelled", "Request was cancelled.", { provider, cause: e });
  }
  if (/timeout|etimedout|timed out/i.test(msg)) {
    return new AgentError("timeout", msg, { provider, cause: e });
  }
  if (/fetch failed|econnreset|enotfound|econnrefused|network|socket hang up/i.test(msg)) {
    return new AgentError("network", msg, { provider, cause: e });
  }
  return new AgentError("unknown", msg, { provider, cause: e });
}

/** HTTP status → kind. Shared by every adapter so classification can't drift. */
export function kindFromStatus(status: number): AgentErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status === 408) return "timeout";
  if (status === 400 || status === 404 || status === 422) return "invalid-request";
  if (status >= 500) return "overloaded";
  return "unknown";
}
