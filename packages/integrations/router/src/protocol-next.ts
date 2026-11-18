import type { InferenceRequest, InferenceResult, StreamEvent as ProtocolStreamEvent, Usage } from "@supersolutions/super-protocol";

/**
 * The parts of `@supersolutions/super-protocol` 0.2.0 this package uses while it
 * still pins 0.1.0 from npm. The shapes match 0.2.0 exactly. Once 0.2.0 is
 * published, import them from the protocol and delete this file.
 */
export type InferenceContentPart = { type: "text"; text: string } | { type: "image"; url: string; detail?: "auto" | "low" | "high" };
export type InferenceToolCall = { id: string; name: string; arguments: string };
export type NextInferenceMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "user"; content: InferenceContentPart[] }
  | { role: "assistant"; content?: string; tool_calls: InferenceToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string; is_error?: boolean };
export type InferenceTool = { name: string; description?: string; input_schema: Record<string, unknown> };
export type InferenceToolChoice = "auto" | "none" | "required" | { name: string };
export type InferenceFinishReason = "stop" | "length" | "tool_calls";
export type InferenceUsage = { status: string; meters?: Usage };

export type NextInferenceRequest = Omit<InferenceRequest, "messages"> & {
  messages: NextInferenceMessage[];
  tools?: InferenceTool[];
  tool_choice?: InferenceToolChoice;
};

type Ids = { request_id: string; sequence: number };
export type NextStreamEvent =
  | Exclude<ProtocolStreamEvent, { type: "request.completed" | "request.failed" }>
  | (Extract<ProtocolStreamEvent, { type: "request.completed" }> & { finish_reason?: InferenceFinishReason; usage?: InferenceUsage })
  | (Extract<ProtocolStreamEvent, { type: "request.failed" }> & { finish_reason?: InferenceFinishReason; usage?: InferenceUsage })
  | ({ type: "output.tool_call.delta"; index: number; id?: string; name?: string; arguments_delta: string } & Ids)
  | ({ type: "output.tool_call.completed"; index: number; id: string; name: string; arguments: string } & Ids);

export type NextInferenceResult = Omit<InferenceResult, "output"> & {
  output?: { role: "assistant"; content: string; tool_calls?: InferenceToolCall[] };
  finish_reason?: InferenceFinishReason;
};
