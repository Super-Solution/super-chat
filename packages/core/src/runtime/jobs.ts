// Background job persistence.
//
// OpenAI background mode returns an id and runs server-side. That is only
// genuinely useful if the id OUTLIVES the page — otherwise it is a worse
// stream. So: persist the handle the moment it exists, resume polling on load,
// and reconcile.
//
// The subtle part is expiry. Background response data is retained for a limited
// window (on the order of minutes for polling purposes); a handle older than
// that will 404 rather than return a result. A store that never expires shows
// the user a job spinning forever, so `reap` prunes on read.

import { AgentError } from "../errors.js";
import type { JobHandle, JobSnapshot, JobStatus, Provider } from "../providers/types.js";

/**
 * Await a background job to a terminal state.
 *
 * Polling rather than streaming because polling survives a closed tab, a lost
 * network and a serverless function timeout — which is the entire reason to use
 * background mode. The interval backs off so a 20-minute job does not make 1200
 * requests.
 *
 * Provider-generic: it needs only `pollJob`, so it lives here rather than in any
 * one adapter.
 */
export async function awaitJob(
  provider: Provider,
  handle: JobHandle,
  opts: {
    signal?: AbortSignal;
    initialIntervalMs?: number;
    maxIntervalMs?: number;
    timeoutMs?: number;
    onStatus?: (snapshot: JobSnapshot) => void;
  } = {},
): Promise<JobSnapshot> {
  if (!provider.pollJob) {
    throw new AgentError("not-supported", `Provider "${provider.id}" cannot poll jobs.`, { provider: provider.id });
  }
  const start = Date.now();
  const maxInterval = opts.maxIntervalMs ?? 5_000;
  let interval = opts.initialIntervalMs ?? 1_000;

  for (;;) {
    if (opts.signal?.aborted) throw new AgentError("cancelled", "Job wait was cancelled.", { provider: provider.id });
    const snapshot = await provider.pollJob(handle, { signal: opts.signal });
    opts.onStatus?.(snapshot);
    if (snapshot.status !== "queued" && snapshot.status !== "in_progress") return snapshot;

    if (opts.timeoutMs && Date.now() - start > opts.timeoutMs) {
      throw new AgentError("timeout", `Background job ${handle.id} did not finish within ${opts.timeoutMs}ms.`, {
        provider: provider.id,
      });
    }
    await pollWait(interval, opts.signal);
    interval = Math.min(interval * 1.5, maxInterval);
  }
}

/**
 * Abort-aware wait for the poll interval. A plain `setTimeout` promise
 * ignores `signal`, which lets cancelling a background-job wait lag behind by
 * up to `maxIntervalMs` — this rejects the moment the signal aborts instead.
 */
function pollWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AgentError("cancelled", "Job wait was cancelled."));
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(new AgentError("cancelled", "Job wait was cancelled."));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type StoredJob = {
  handle: JobHandle;
  status: JobStatus;
  /** Thread this job belongs to, so a resumed result lands in the right place. */
  threadId?: string;
  createdAt: number;
  updatedAt: number;
  label?: string;
};

export type JobStore = {
  list(): Promise<StoredJob[]>;
  get(id: string): Promise<StoredJob | undefined>;
  put(job: StoredJob): Promise<void>;
  remove(id: string): Promise<void>;
};

export function createMemoryJobStore(): JobStore {
  const jobs = new Map<string, StoredJob>();
  return {
    async list() {
      return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    async get(id) {
      return jobs.get(id);
    },
    async put(job) {
      jobs.set(job.handle.id, job);
    },
    async remove(id) {
      jobs.delete(id);
    },
  };
}

/**
 * localStorage-backed store, key per job: `{prefix}:index` holds the list of
 * live job ids, `{prefix}:{id}` holds one job. `resumeJobs`/`reap` put or
 * remove one job at a time in a loop — a single-blob layout would mean
 * re-parsing and re-stringifying every OTHER job's data on each of those
 * calls, which turns an O(n) sweep into O(n²) localStorage churn.
 *
 * Every read is defensive: a corrupted or hand-edited entry must not throw on
 * app start.
 */
export function createLocalJobStore(prefix = "superchat:jobs"): JobStore {
  const indexKey = `${prefix}:index`;
  const jobKey = (id: string) => `${prefix}:${id}`;

  const readIndex = (): string[] => {
    try {
      const raw = globalThis.localStorage?.getItem(indexKey) ?? null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (ids: string[]): void => {
    try {
      globalThis.localStorage?.setItem(indexKey, JSON.stringify(ids));
    } catch {
      // Quota or private mode — a stale index degrades to a missed job, not a crash.
    }
  };
  const readJob = (id: string): StoredJob | undefined => {
    try {
      const raw = globalThis.localStorage?.getItem(jobKey(id)) ?? null;
      return raw ? (JSON.parse(raw) as StoredJob) : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async list() {
      const jobs = readIndex()
        .map((id) => readJob(id))
        .filter((j): j is StoredJob => j != null);
      return jobs.sort((a, b) => b.createdAt - a.createdAt);
    },
    async get(id) {
      return readJob(id);
    },
    async put(job) {
      const id = job.handle.id;
      try {
        globalThis.localStorage?.setItem(jobKey(id), JSON.stringify(job));
      } catch {
        // Quota or private mode — a lost handle degrades to "no resume", not a crash.
        return;
      }
      const index = readIndex();
      if (!index.includes(id)) writeIndex([...index, id]);
    },
    async remove(id) {
      try {
        globalThis.localStorage?.removeItem(jobKey(id));
      } catch {
        // removeItem does not throw for quota; being defensive costs nothing.
      }
      const index = readIndex();
      if (index.includes(id)) writeIndex(index.filter((x) => x !== id));
    },
  };
}

const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled", "incomplete"]);

export const isTerminal = (status: JobStatus): boolean => TERMINAL.has(status);

/** Drop terminal jobs and stale non-terminal ones. */
export async function reap(store: JobStore, opts: { maxAgeMs?: number } = {}): Promise<StoredJob[]> {
  const maxAge = opts.maxAgeMs ?? 30 * 60_000;
  const now = Date.now();
  const kept: StoredJob[] = [];
  for (const job of await store.list()) {
    if (isTerminal(job.status) || now - job.createdAt > maxAge) {
      await store.remove(job.handle.id);
      continue;
    }
    kept.push(job);
  }
  return kept;
}

export type ResumeResult = { job: StoredJob; snapshot: JobSnapshot };

/**
 * Re-poll every unfinished job in the store. Call this on app start.
 *
 * A 404/expired handle resolves as `failed` with an explanatory message rather
 * than throwing — the job is genuinely gone, and the user needs to be told that
 * rather than watching a spinner.
 */
export async function resumeJobs(
  store: JobStore,
  providers: Record<string, Provider>,
  opts: { signal?: AbortSignal } = {},
): Promise<ResumeResult[]> {
  const out: ResumeResult[] = [];
  for (const job of await reap(store)) {
    const provider = providers[job.handle.provider];
    if (!provider?.pollJob) {
      await store.remove(job.handle.id);
      continue;
    }
    try {
      const snapshot = await provider.pollJob(job.handle, { signal: opts.signal });
      const updated: StoredJob = { ...job, status: snapshot.status, updatedAt: Date.now() };
      if (isTerminal(snapshot.status)) await store.remove(job.handle.id);
      else await store.put(updated);
      out.push({ job: updated, snapshot });
    } catch (e) {
      const updated: StoredJob = { ...job, status: "failed", updatedAt: Date.now() };
      await store.remove(job.handle.id);
      out.push({
        job: updated,
        snapshot: {
          handle: job.handle,
          status: "failed",
          error: {
            message:
              e instanceof Error && /404|not found/i.test(e.message)
                ? "This background job expired before it could be read back."
                : e instanceof Error
                  ? e.message
                  : "Could not resume job.",
          },
        },
      });
    }
  }
  return out;
}
