// @zzyzxlabs/super-chat-core — public surface.

// content
export * from "./content/types.js";
export * from "./content/parts.js";
export { pathTo, childrenOf, siblingsOf, latestLeaf, linkLinear } from "./content/branching.js";
export { splitBlocks, type MarkdownBlock, type MarkdownBlockKind } from "./content/blocks.js";
export {
  formatQuotes,
  withQuotes,
  quotesOf,
  QUOTES_METADATA_KEY,
  type DocumentQuoteRef,
} from "./content/quotes.js";

// errors
export { AgentError, isAgentError, toAgentError, kindFromStatus, type AgentErrorKind } from "./errors.js";

// transport
export type { Transport, TransportRequest, RetryPolicy, MultipartBody } from "./transport/types.js";
export { DEFAULT_RETRY, isMultipartBody } from "./transport/types.js";
export { bytesToBase64, base64ToBytes } from "./transport/binary.js";
export { createDirectTransport, buildUrl, type DirectTransportConfig } from "./transport/direct.js";
export { createProxyTransport, type ProxyTransportConfig, type ProxyEnvelope, type SerializedMultipartBody } from "./transport/proxy.js";
export { createProxyHandler, pathMatches, type ProxyHandlerConfig, type ProxyProviderConfig } from "./transport/server.js";
export { withRetry, backoffDelay, errorFromResponse, parseRetryAfter } from "./transport/retry.js";
export { parseSSE, parseSSEJson, SSEDecoder, type SSEMessage } from "./transport/sse.js";

// providers
export type {
  Provider,
  ProviderCapabilities,
  NormalizedRequest,
  GenerateResult,
  StreamEvent,
  JobHandle,
  JobSnapshot,
  JobStatus,
  ToolSpec,
  ToolChoice,
  ModelInfo,
  JSONSchema,
  ResponseFormat,
  ReasoningOptions,
  CallOptions,
  FileUploadRequest,
  ProviderFileRef,
} from "./providers/types.js";
export {
  OPENAI_OFFICIAL_PROFILE,
  ANTHROPIC_OFFICIAL_PROFILE,
  createOpenAICompatibleProfile,
  normalizeProviderProfile,
  createProviderFromProfile,
  createDirectTransportForProfile,
  type ProviderProtocol,
  type ProviderProfile,
  type ProfileDirectTransportConfig,
} from "./providers/profile.js";

// media generation — parallel to chat providers because the wire APIs, job
// lifecycle and persisted outputs are materially different from a chat turn.
export * from "./media/index.js";

// tokens
export { estimateTokens, estimateJsonTokens, MESSAGE_OVERHEAD_TOKENS, type TokenCounter } from "./tokens/estimate.js";
export { createBudget, packByPriority, countMessageTokens, countMessagesTokens, totalAllocated, type TokenBudget, type BudgetShares } from "./tokens/budget.js";

// skills
export * from "./skills/types.js";
export { SkillRegistry, renderSkill, type SkillRegistryOptions, type SkillMatcher } from "./skills/registry.js";
export { matchSkills, scoreSkill, tokenize } from "./skills/match.js";

// context
export * from "./context/types.js";
export { ContextBuilder, type ContextBuilderOptions } from "./context/builder.js";
export { compactHistory, trimHistory, safeCutIndex, buildSummaryPrompt, type CompactionResult, type Summarizer } from "./context/compaction.js";

// documents
export * from "./documents/index.js";

// cards
export * from "./cards/types.js";
export { stripCardPayload } from "./cards/types.js";
export { CardRegistry, makeCard, check, type CardKindDefinition, type CardValidation } from "./cards/registry.js";
export {
  BUILTIN_CARDS,
  tableCard,
  statsCard,
  chartCard,
  timelineCard,
  keyValueCard,
  progressCard,
  mediaCard,
  markdownCard,
  documentCard,
  editReviewCard,
  emailCard,
  codeCard,
  diffCard,
  comparisonCard,
  checklistCard,
  calloutCard,
  citationsCard,
  funnelCard,
  gaugeCard,
  treeCard,
  choiceCard,
  formCard,
  confirmCard,
} from "./cards/builtin.js";

// tools
export * from "./tools/types.js";
export { ToolRegistry } from "./tools/registry.js";
export { repairToolArguments, normalizeToolName, type RepairResult } from "./tools/repair.js";
export { PartialJsonParser, parsePartialJson } from "./tools/partial-json.js";
export { createVisualizeTool, createLoadSkillTool, createUpdateCardTool, createBuiltinTools } from "./tools/builtin.js";

// runtime
export * from "./runtime/events.js";
export * from "./runtime/metering.js";
export { runAgent, type RunConfig } from "./runtime/run.js";
export { executeToolCall, executeToolCalls, compactError, type ToolCallRequest, type ToolCallOutcome, type ExecuteToolOptions } from "./runtime/execute-tools.js";
export * from "./runtime/stop.js";
export { createMemoryJobStore, createLocalJobStore, resumeJobs, reap, isTerminal, awaitJob, type JobStore, type StoredJob, type ResumeResult } from "./runtime/jobs.js";
export { createMemoryFileStore, createLocalFileStore, type FileStore, type StoredFile } from "./runtime/files.js";
export {
  createMemoryThreadStore,
  createLocalThreadStore,
  createRestThreadStore,
  threadSnapshot,
  THREAD_SCHEMA_VERSION,
  type ThreadStore,
  type StoredThread,
  type ThreadMeta,
  type RestThreadStoreConfig,
} from "./runtime/threads.js";

// memory, retrieval & app-state seams
export * from "./memory/index.js";
export * from "./retrieval/index.js";
export * from "./app-state/index.js";

// mcp
export * from "./mcp/index.js";

// providers — the OpenAI adapter is also available at "@zzyzxlabs/super-chat-core/openai"
// for hosts that want to keep it out of a bundle that never calls OpenAI.
export { createOpenAIProvider, type OpenAIProviderConfig, type OpenAIDialect } from "./providers/openai/adapter.js";
export { createAnthropicProvider, type AnthropicProviderConfig } from "./providers/anthropic/adapter.js";
// The request builders are exported deliberately: they are pure functions, and
// being able to assert on the exact bytes a dialect produces is the difference
// between "we craft requests correctly" as a claim and as something you can test.
export { buildResponsesRequest, buildChatRequest } from "./providers/openai/map-in.js";
export { buildAnthropicRequest } from "./providers/anthropic/map-in.js";
