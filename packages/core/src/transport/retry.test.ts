import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "../errors.js";
import { backoffDelay, errorFromResponse, parseRetryAfter, withRetry } from "./retry.js";

const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseRetryAfter", () => {
  const h = (v: string) => new Headers({ "retry-after": v });
  it("reads delta-seconds", () => expect(parseRetryAfter(h("7"))).toBe(7));
  it("reads an HTTP-date relative to now, never negative", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(parseRetryAfter(h("Thu, 01 Jan 2026 00:00:30 GMT"))).toBe(30);
    expect(parseRetryAfter(h("Wed, 31 Dec 2025 23:00:00 GMT"))).toBe(0);
  });
  it("rejects what is not delta-seconds or a date (no negative / exponent / hex waits)", () => {
    expect(parseRetryAfter(h("-5"))).toBeGreaterThanOrEqual(0); // read as a past date, never a negative wait
    expect(parseRetryAfter(h("1e3"))).toBeUndefined();
    expect(parseRetryAfter(h("0x10"))).toBeUndefined();
    expect(parseRetryAfter(h("soon"))).toBeUndefined();
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });
});

describe("backoffDelay", () => {
  it("honours Retry-After but never beyond maxDelayMs", () => {
    expect(backoffDelay(0, policy, 0.5)).toBe(500);
    expect(backoffDelay(0, policy, 60)).toBe(1000);
  });
  it("uses full jitter under an exponential ceiling", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(backoffDelay(0, policy)).toBe(100);
    expect(backoffDelay(2, policy)).toBe(400);
    expect(backoffDelay(10, policy)).toBe(1000);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(backoffDelay(3, policy)).toBe(0);
  });
});

describe("withRetry", () => {
  const transient = () => new AgentError("overloaded", "busy");

  it("returns the first success without sleeping", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(run, { policy })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure with backoff and reports it", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const run = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue("ok");
    const onRetry = vi.fn();
    const p = withRetry(run, { policy, onRetry });
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(0, expect.any(AgentError), 100);
  });

  it("throws a non-retryable error on the first attempt", async () => {
    const run = vi.fn().mockRejectedValue(new AgentError("auth", "nope"));
    await expect(withRetry(run, { policy })).rejects.toMatchObject({ kind: "auth" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const run = vi.fn().mockRejectedValue(transient());
    const p = withRetry(run, { policy });
    const settled = expect(p).rejects.toMatchObject({ kind: "overloaded" });
    await vi.runAllTimersAsync();
    await settled;
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops sleeping the moment the signal aborts", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const run = vi.fn().mockRejectedValue(transient());
    const p = withRetry(run, { policy, signal: ctl.signal });
    const settled = expect(p).rejects.toMatchObject({ kind: "cancelled" });
    await vi.advanceTimersByTimeAsync(0);
    ctl.abort();
    await settled;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not sleep at all when the signal is already aborted (onRetry cancelled the call)", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const run = vi.fn().mockRejectedValue(transient());
    const p = withRetry(run, { policy, signal: ctl.signal, onRetry: () => ctl.abort() });
    // No timer is advanced: it must settle without waiting out the backoff.
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("detaches its abort listener when the timer wins", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const ctl = new AbortController();
    const remove = vi.spyOn(ctl.signal, "removeEventListener");
    const run = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue("ok");
    const p = withRetry(run, { policy, signal: ctl.signal });
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("errorFromResponse", () => {
  const res = (status: number, body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status, statusText: "S", headers });

  it("surfaces the provider's own message and Retry-After", async () => {
    const e = await errorFromResponse(
      res(429, JSON.stringify({ error: { message: "slow down" } }), { "retry-after": "3" }),
      "openai",
    );
    expect(e).toMatchObject({ kind: "rate-limit", message: "slow down", status: 429, retryAfter: 3, provider: "openai" });
    expect(e.retryable).toBe(true);
  });

  it("recognises a context-window 400 as recoverable by compaction", async () => {
    const e = await errorFromResponse(
      res(400, JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens" } })),
      "openai",
    );
    expect(e.kind).toBe("context-length");
    expect(e.retryable).toBe(false);
  });

  it("keeps a non-JSON body as the (truncated) message", async () => {
    const e = await errorFromResponse(res(502, "x".repeat(900)), "p");
    expect(e.kind).toBe("overloaded");
    expect(e.message).toHaveLength(500);
  });

  it("falls back to the status line when the body is empty", async () => {
    const e = await errorFromResponse(res(401, ""), "p");
    expect(e).toMatchObject({ kind: "auth", message: "p request failed with 401 S" });
  });
});
