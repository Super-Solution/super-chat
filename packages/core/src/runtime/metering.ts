import type { FinishReason, Usage } from "../content/types.js";
import type { AgentErrorKind } from "../errors.js";
import type { RunMode } from "./events.js";

/**
 * Where the numbers in a metering record came from.
 *
 * Core currently only emits `provider` or `unavailable`. `estimated` and
 * `mixed` are reserved so hosts can enrich records without replacing this
 * contract when a provider omits usage.
 */
export type MeteringSource = "provider" | "estimated" | "mixed" | "unavailable";

/** Terminal outcome of a provider step or the containing run. */
export type MeteringStatus = "completed" | "failed" | "cancelled";

export type MeteringError = {
  kind: AgentErrorKind;
  message: string;
};

type MeteringBase = {
  /** Stable within a run; suitable as an idempotency key in a host ledger. */
  id: string;
  runId: string;
  provider: string;
  requestedModel: string;
  mode: RunMode;
  status: MeteringStatus;
  usage: Usage;
  source: MeteringSource;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** Host-owned dimensions. Core never interprets or sends these upstream. */
  metadata?: Readonly<Record<string, string>>;
  error?: MeteringError;
};

/** Exactly one terminal record is emitted for every attempted provider call. */
export type StepMeteringRecord = MeteringBase & {
  scope: "step";
  step: number;
  /** The provider's actual model, when it reports one. */
  reportedModel?: string;
  responseId?: string;
  finishReason?: FinishReason;
};

/** Exactly one summary record is emitted when a run terminates. */
export type RunMeteringRecord = MeteringBase & {
  scope: "run";
  steps: number;
  finishReason: FinishReason;
  /** Unique actual model ids observed across completed steps. */
  reportedModels?: string[];
};

export type MeteringRecord = StepMeteringRecord | RunMeteringRecord;

/**
 * Optional delivery target in addition to the public `metering` RunEvent.
 *
 * Delivery is awaited to preserve ordering. A sink failure is fail-open: it
 * is reported to `onError`, when supplied, but never changes the agent run.
 * Durable storage, retries and pricing remain host responsibilities.
 */
export type MeterSink = {
  record(record: MeteringRecord): void | Promise<void>;
  onError?(error: unknown, record: MeteringRecord): void | Promise<void>;
};

export function usageSource(usage: Usage): MeteringSource {
  return Object.values(usage).some((value) => typeof value === "number") ? "provider" : "unavailable";
}

export function combineMeteringSources(sources: readonly MeteringSource[]): MeteringSource {
  if (!sources.length) return "unavailable";
  const unique = new Set(sources);
  return unique.size === 1 ? sources[0]! : "mixed";
}

export async function deliverMetering(sink: MeterSink | undefined, record: MeteringRecord): Promise<void> {
  if (!sink) return;
  try {
    await sink.record(record);
  } catch (error) {
    try {
      await sink.onError?.(error, record);
    } catch {
      // Observability must not change the run it observes.
    }
  }
}
