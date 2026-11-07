import { AgentError, kindFromStatus, toAgentError } from "../errors.js";
import { DEFAULT_RETRY, type RetryPolicy } from "./types.js";

/** Full-jitter exponential backoff. Full jitter (not equal) because synchronized
 *  clients retrying a rate limit in lockstep is how a 429 becomes a 429 storm. */
export function backoffDelay(attempt: number, policy: RetryPolicy, retryAfterSec?: number): number {
  if (retryAfterSec != null && Number.isFinite(retryAfterSec)) {
    return Math.min(retryAfterSec * 1000, policy.maxDelayMs);
  }
  const ceiling = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  return Math.random() * ceiling;
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(raw); // HTTP-date form
  if (Number.isFinite(date)) return Math.max(0, (date - Date.now()) / 1000);
  return undefined;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new AgentError("cancelled", "Request was cancelled."));
    };
    // `{once:true}` only detaches the listener once "abort" actually FIRES —
    // when the timer wins the race instead, it stays attached to the signal
    // for as long as the signal lives. A retry loop's signal is long-lived
    // (one AbortController for the whole call), so that leak accumulates one
    // stale listener per retry. Detach it explicitly on the timer-wins path too.
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Retry `run` while it fails transiently. Non-retryable failures (auth, bad
 * request, content filter) throw on the first attempt — retrying them just
 * burns quota and delays the real error reaching the user.
 */
export async function withRetry<T>(
  run: (attempt: number) => Promise<T>,
  opts: { policy?: RetryPolicy; signal?: AbortSignal; provider?: string; onRetry?: (attempt: number, err: AgentError, delayMs: number) => void } = {},
): Promise<T> {
  const policy = opts.policy ?? DEFAULT_RETRY;
  let lastError: AgentError | undefined;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    try {
      return await run(attempt);
    } catch (raw) {
      const err = toAgentError(raw, opts.provider);
      lastError = err;
      const isLast = attempt === policy.maxAttempts - 1;
      if (!err.retryable || isLast) throw err;
      const delay = backoffDelay(attempt, policy, err.retryAfter);
      opts.onRetry?.(attempt, err, delay);
      await sleep(delay, opts.signal);
    }
  }
  throw lastError ?? new AgentError("unknown", "Retry loop exited without a result.");
}

/**
 * Turn a non-OK `Response` into a typed `AgentError`, pulling the provider's own
 * message out of the body so the user sees "model X does not exist" rather than
 * "HTTP 404".
 */
export async function errorFromResponse(res: Response, provider: string): Promise<AgentError> {
  const retryAfter = parseRetryAfter(res.headers);
  let detail: unknown;
  let message = `${provider} request failed with ${res.status} ${res.statusText}`.trim();
  try {
    const bodyText = await res.text();
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as { error?: { message?: string; code?: string; type?: string } };
        detail = parsed;
        if (parsed?.error?.message) message = parsed.error.message;
      } catch {
        detail = bodyText;
        message = bodyText.slice(0, 500);
      }
    }
  } catch {
    /* body already consumed or unreadable — status alone is enough */
  }

  let kind = kindFromStatus(res.status);
  // Refine: a 400 whose body names the context window is recoverable by
  // compacting, which is a very different action from "your request is invalid".
  if (kind === "invalid-request" && /context.?length|maximum context|too many tokens|reduce the length/i.test(message)) {
    kind = "context-length";
  }
  if (/content.?filter|content_policy|safety/i.test(message)) kind = "content-filter";

  return new AgentError(kind, message, { status: res.status, provider, retryAfter, detail });
}
