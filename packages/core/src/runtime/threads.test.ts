import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "../content/types.js";
import {
  THREAD_SCHEMA_VERSION,
  createLocalThreadStore,
  createMemoryThreadStore,
  createRestThreadStore,
  threadSnapshot,
  type StoredThread,
  type ThreadStore,
} from "./threads.js";

/** An in-memory HTTP server implementing the REST store's four-call contract. */
function fakeRestBackend(opts: { failOn?: "list" | "load" | "save" | "remove" } = {}) {
  const rows = new Map<string, StoredThread>();
  const seen: { method: string; url: string; auth?: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const auth = (init.headers as Record<string, string> | undefined)?.["authorization"];
    seen.push({ method, url, ...(auth ? { auth } : {}) });
    const id = url.split("/").pop()!;
    const isCollection = url.endsWith("/threads");

    if (method === "GET" && isCollection) {
      if (opts.failOn === "list") return new Response("boom", { status: 500 });
      return new Response(JSON.stringify([...rows.values()].map((t) => t.meta)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "GET") {
      if (opts.failOn === "load") return new Response("boom", { status: 500 });
      const row = rows.get(decodeURIComponent(id));
      return row
        ? new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 });
    }
    if (method === "PUT") {
      if (opts.failOn === "save") return new Response("boom", { status: 500 });
      rows.set(decodeURIComponent(id), JSON.parse(init.body as string) as StoredThread);
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      rows.delete(decodeURIComponent(id));
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }) as unknown as typeof fetch;
  return { fetchImpl, rows, seen };
}

const msg = (role: Message["role"], text: string, id = `${role}-${text}`): Message => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

/** A localStorage stand-in with an optional per-write quota. */
function fakeLocalStorage(opts: { quotaBytes?: number } = {}) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.quotaBytes != null && v.length > opts.quotaBytes) throw new DOMException("quota", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  return data;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function storeContract(name: string, make: () => ThreadStore) {
  describe(`${name} (contract)`, () => {
    it("saves, lists by updatedAt desc, loads, removes", async () => {
      const store = make();
      const a = threadSnapshot("t_a", [msg("user", "first question")]);
      const b = threadSnapshot("t_b", [msg("user", "second question")]);
      b.meta.updatedAt = a.meta.updatedAt + 1000;
      await store.save(a);
      await store.save(b);

      const metas = await store.list();
      expect(metas.map((m) => m.id)).toEqual(["t_b", "t_a"]);
      expect(metas[1]?.title).toBe("first question");

      const loaded = await store.load("t_a");
      expect(loaded?.messages).toEqual(a.messages);

      await store.remove("t_a");
      expect(await store.load("t_a")).toBeUndefined();
      expect((await store.list()).map((m) => m.id)).toEqual(["t_b"]);
    });

    it("migrates a v1 (linear, no parentId) record on load", async () => {
      const store = make();
      const v1 = {
        version: 1,
        meta: { id: "t_old", createdAt: 1, updatedAt: 2, messageCount: 2 },
        messages: [msg("user", "hi", "u1"), msg("assistant", "hello", "a1")],
      };
      await store.save(v1 as never);
      const loaded = await store.load("t_old");
      expect(loaded?.version).toBe(THREAD_SCHEMA_VERSION);
      expect(loaded?.messages.map((m) => m.parentId)).toEqual([null, "u1"]);
      expect(loaded?.headId).toBe("a1");
    });

    it("treats an unknown version as absent, never a throw", async () => {
      const store = make();
      const snap = threadSnapshot("t_v", [msg("user", "hi")]);
      await store.save({ ...snap, version: 999 as unknown as typeof THREAD_SCHEMA_VERSION });
      expect(await store.load("t_v")).toBeUndefined();
    });
  });
}

storeContract("memory", () => createMemoryThreadStore());
storeContract("localStorage", () => {
  fakeLocalStorage();
  return createLocalThreadStore("test:threads");
});
// The REST impl passes the SAME contract as the two local ones — which is the
// point of running it through this suite rather than testing it in isolation.
storeContract("rest", () => createRestThreadStore({ url: "http://api.local/threads", fetchImpl: fakeRestBackend().fetchImpl }));

describe("createRestThreadStore", () => {
  it("uses the documented four calls and url-encodes ids", async () => {
    const backend = fakeRestBackend();
    const store = createRestThreadStore({ url: "http://api.local/threads", fetchImpl: backend.fetchImpl });

    await store.save(threadSnapshot("t 1", [msg("user", "hello")]));
    expect(await store.list()).toHaveLength(1);
    expect((await store.load("t 1"))?.messages).toHaveLength(1);
    await store.remove("t 1");
    expect(await store.load("t 1")).toBeUndefined();

    expect(backend.seen.map((r) => `${r.method} ${r.url.replace("http://api.local", "")}`)).toEqual([
      "PUT /threads/t%201",
      "GET /threads",
      "GET /threads/t%201",
      "DELETE /threads/t%201",
      "GET /threads/t%201",
    ]);
  });

  it("sends host headers, including a per-request function", async () => {
    const backend = fakeRestBackend();
    let calls = 0;
    const store = createRestThreadStore({
      url: "http://api.local/threads",
      fetchImpl: backend.fetchImpl,
      headers: () => {
        calls += 1;
        return { authorization: `Bearer token-${calls}` };
      },
    });
    await store.list();
    await store.list();
    expect(backend.seen.map((r) => r.auth)).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("degrades to empty/undefined on transport failure instead of throwing", async () => {
    const errors: string[] = [];
    const store = createRestThreadStore({
      url: "http://api.local/threads",
      fetchImpl: fakeRestBackend({ failOn: "list" }).fetchImpl,
      onError: (_e, op) => errors.push(op),
    });
    // A failing store must not take down the render that called list().
    expect(await store.list()).toEqual([]);
    expect(errors).toEqual(["list"]);
  });

  it("treats 404 as absent — not an error the host hears about", async () => {
    const errors: string[] = [];
    const store = createRestThreadStore({
      url: "http://api.local/threads",
      fetchImpl: fakeRestBackend().fetchImpl,
      onError: (_e, op) => errors.push(op),
    });
    expect(await store.load("missing")).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("migrates a v1 payload served by the backend", async () => {
    const backend = fakeRestBackend();
    backend.rows.set("t_old", {
      version: 1,
      meta: { id: "t_old", createdAt: 1, updatedAt: 2, messageCount: 2 },
      messages: [msg("user", "hi", "u1"), msg("assistant", "hello", "a1")],
    } as unknown as StoredThread);
    const store = createRestThreadStore({ url: "http://api.local/threads", fetchImpl: backend.fetchImpl });

    const loaded = await store.load("t_old");
    expect(loaded?.version).toBe(THREAD_SCHEMA_VERSION);
    expect(loaded?.headId).toBe("a1");
  });
});

describe("createLocalThreadStore", () => {
  it("uses one key per thread so a growing thread rewrites only itself", async () => {
    const data = fakeLocalStorage();
    const store = createLocalThreadStore("test:threads");
    await store.save(threadSnapshot("t_1", [msg("user", "a")]));
    await store.save(threadSnapshot("t_2", [msg("user", "b")]));

    expect(data.has("test:threads:t_1")).toBe(true);
    expect(data.has("test:threads:t_2")).toBe(true);
    expect(data.has("test:threads:index")).toBe(true);
  });

  it("skips a corrupted entry instead of throwing on load", async () => {
    const data = fakeLocalStorage();
    const store = createLocalThreadStore("test:threads");
    data.set("test:threads:t_bad", "{not json");
    data.set("test:threads:index", "also {not json");
    expect(await store.load("t_bad")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("sheds artifact payloads (marked expired) when the write hits quota", async () => {
    // Quota sized so the full snapshot (with the fat card spec) fails but the
    // trimmed retry fits.
    const data = fakeLocalStorage({ quotaBytes: 2_000 });
    const store = createLocalThreadStore("test:threads");
    const fat: Message = {
      id: "a-1",
      role: "assistant",
      parts: [
        { type: "text", text: "here is your chart" },
        { type: "artifact", id: "card_1", kind: "card:chart", data: { kind: "chart", points: "x".repeat(5_000) } },
      ],
    };
    await store.save(threadSnapshot("t_fat", [msg("user", "chart please"), fat]));

    const loaded = await store.load("t_fat");
    expect(loaded).toBeDefined();
    const artifact = loaded!.messages[1]?.parts.find((p) => p.type === "artifact") as { data: unknown };
    expect(artifact.data).toEqual({ kind: "chart", expired: true });
    // The prose survives; only the payload was shed.
    expect(loaded!.messages[1]?.parts[0]).toMatchObject({ type: "text", text: "here is your chart" });
    expect(data.has("test:threads:t_fat")).toBe(true);
  });
});

describe("threadSnapshot", () => {
  it("derives the title from the first user message and keeps a prior title when messages no longer have one", () => {
    const snap = threadSnapshot("t", [msg("user", "What is our churn?\nDetails follow.")]);
    expect(snap.meta.title).toBe("What is our churn?");
    const later = threadSnapshot("t", [], snap.meta);
    expect(later.meta.title).toBe("What is our churn?");
    expect(later.meta.createdAt).toBe(snap.meta.createdAt);
  });

  it("normalizes non-JSON values instead of failing the save", () => {
    const withDate: Message = {
      id: "u-1",
      role: "user",
      parts: [{ type: "tool-result", callId: "c1", name: "t", output: { when: new Date(0), gone: undefined } }],
    };
    const snap = threadSnapshot("t", [withDate]);
    const output = (snap.messages[0]?.parts[0] as { output: Record<string, unknown> }).output;
    expect(output["when"]).toBe("1970-01-01T00:00:00.000Z");
    expect("gone" in output).toBe(false);
  });

  it("replaces an unserializable (circular) message rather than throwing", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const bad: Message = {
      id: "u-1",
      role: "user",
      parts: [{ type: "tool-result", callId: "c1", name: "t", output: circular }],
    };
    const snap = threadSnapshot("t", [msg("user", "fine"), bad]);
    expect(snap.messages[0]?.parts[0]).toMatchObject({ type: "text", text: "fine" });
    expect(snap.messages[1]?.parts[0]).toMatchObject({ type: "text", text: "[unserializable message dropped]" });
    expect(snap.meta.messageCount).toBe(2);
  });

  it("round-trips a providerFile part and a card artifact through JSON intact", () => {
    const rich: Message[] = [
      {
        id: "u-1",
        role: "user",
        parts: [
          { type: "text", text: "summarize this" },
          {
            type: "file",
            source: { kind: "providerFile", id: "file_abc", provider: "openai" },
            mediaType: "application/pdf",
            filename: "report.pdf",
          },
        ],
      },
      {
        id: "a-1",
        role: "assistant",
        parts: [{ type: "artifact", id: "card_1", kind: "card:table", data: { kind: "table", rows: [[1, 2]] } }],
      },
    ];
    const snap = threadSnapshot("t", rich);
    expect(JSON.parse(JSON.stringify(snap)).messages).toEqual(rich);
  });
});
