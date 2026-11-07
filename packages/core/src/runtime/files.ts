// Uploaded-file persistence.
//
// A providerFile id is only worth minting if it OUTLIVES the page — the whole
// point of uploading once is not re-encoding the same bytes as base64 on every
// turn. Messages that reference a file persist through the ThreadStore; this
// store is the cross-thread registry that answers "what have I already
// uploaded", so a host can offer re-attach instead of re-upload.
//
// Mirrors JobStore deliberately: same shape, same defensiveness. A corrupted
// entry degrades to "upload again", never a crash.

import type { ProviderFileRef } from "../providers/types.js";

export type StoredFile = {
  ref: ProviderFileRef;
  filename: string;
  mediaType?: string;
  sizeBytes?: number;
  /** Thread the file was first attached in, if any. */
  threadId?: string;
  createdAt: number;
};

export type FileStore = {
  list(): Promise<StoredFile[]>;
  /** Keyed by `ref.id`. */
  get(id: string): Promise<StoredFile | undefined>;
  put(file: StoredFile): Promise<void>;
  remove(id: string): Promise<void>;
};

export function createMemoryFileStore(): FileStore {
  const files = new Map<string, StoredFile>();
  return {
    async list() {
      return [...files.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    async get(id) {
      return files.get(id);
    },
    async put(file) {
      files.set(file.ref.id, file);
    },
    async remove(id) {
      files.delete(id);
    },
  };
}

/** localStorage-backed store. Every read is defensive — see JobStore. */
export function createLocalFileStore(key = "superchat:files"): FileStore {
  const read = (): Record<string, StoredFile> => {
    try {
      const raw = globalThis.localStorage?.getItem(key) ?? null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, StoredFile>) : {};
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, StoredFile>) => {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(all));
    } catch {
      // Quota or private mode — a lost ref degrades to "upload again", not a crash.
    }
  };

  return {
    async list() {
      return Object.values(read()).sort((a, b) => b.createdAt - a.createdAt);
    },
    async get(id) {
      return read()[id];
    },
    async put(file) {
      const all = read();
      all[file.ref.id] = file;
      write(all);
    },
    async remove(id) {
      const all = read();
      delete all[id];
      write(all);
    },
  };
}
