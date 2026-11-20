// Config for a client whose turns run on a server.
//
// `AgentClientConfig` describes a loop that runs in this process: a provider, a
// context builder, tools. A host whose loop runs on its own server has none of
// those here — only a `runner` that follows the server's turn. This fills the
// rest with inert values so such a host does not have to invent them, and so a
// mistake (a surface tool action, a job resume) fails with a sentence instead of
// reaching for a model that is not there.

import { ContextBuilder, ToolRegistry, type Provider } from "@supersolutions/super-chat-core";
import type { AgentClientConfig, TurnRunner } from "./client.js";

const NO_PROVIDER = "This client's turns run on a server: there is no model provider in this process.";

const refuse = async (): Promise<never> => {
  throw new Error(NO_PROVIDER);
};

/** A provider that refuses every call. It only fills the slot; nothing in a server-run turn reaches it. */
const noProvider: Provider = {
  id: "server-run",
  label: "Server",
  capabilities: {
    streaming: false,
    backgroundJobs: false,
    resumableStreams: false,
    tools: false,
    parallelToolCalls: false,
    images: false,
    files: false,
    audio: false,
    reasoning: false,
    strictJsonSchema: false,
    serverSideHistory: false,
    fileUpload: false,
  },
  transport: { kind: "custom", credentialSafe: true, fetch: refuse },
  generate: refuse,
  // An async generator, so the refusal surfaces where the stream is read.
  async *stream() {
    throw new Error(NO_PROVIDER);
  },
};

export type ServerRunOptions = Omit<Partial<AgentClientConfig>, "runner" | "provider"> & {
  /** Starts or follows a turn on the server and yields its events. See `TurnRunner`. */
  runner: TurnRunner;
};

/**
 * An `AgentClientConfig` for turns that run on a server.
 *
 * ```ts
 * const client = new AgentClient(serverRunConfig({ runner, threadStore, cards }));
 * ```
 *
 * `model` is the label recorded on each committed turn (default `"server"`).
 * The tool registry is empty, so a surface's tool actions are refused; its
 * event actions still go to the runner as a turn of kind `"surface-event"`.
 */
export function serverRunConfig(options: ServerRunOptions): AgentClientConfig {
  return {
    provider: noProvider,
    model: "server",
    contextBuilder: new ContextBuilder(),
    tools: new ToolRegistry(),
    toolResolution: { presets: [] },
    ...options,
  };
}
