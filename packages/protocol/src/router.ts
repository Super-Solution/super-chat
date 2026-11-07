/**
 * The inference-gateway abstraction. super-chat talks to this interface, not to
 * a vendor; the default implementation binds to Super Router, and any other
 * gateway can implement it. Wire shapes match the Super Router HTTP API.
 */

export interface InferenceMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Usage {
  input: number;
  cached: number;
  cache_write: number;
  output: number;
  images?: number;
  video_ms?: number;
  audio_ms?: number;
  tasks?: number;
}

export interface InferenceRequest {
  /** The service (the thing being sold), not a raw model name. */
  service: string;
  service_version?: number;
  customer_id: string;
  messages: InferenceMessage[];
  max_output_tokens?: number;
  timeout_ms?: number;
}

export type ExecutionStatus = "succeeded" | "failed" | "cancelled" | "unknown";

export type StreamEvent =
  | { type: "request.started"; request_id: string; sequence: number; service_version: number }
  | { type: "output.delta"; request_id: string; sequence: number; text: string }
  | { type: "request.completed"; request_id: string; sequence: number; execution_status: ExecutionStatus; billing_status: string }
  | { type: "request.failed"; request_id: string; sequence: number; execution_status?: ExecutionStatus; billing_status?: string; error?: { code: string } }
  | { type: "request.replayed"; request_id: string; sequence: number };

export interface InferenceResult {
  id: string;
  execution_status: ExecutionStatus;
  billing_status: string;
  /** Absent when the request is read back later: the router does not store completions. */
  output?: { role: "assistant"; content: string };
  usage: { status: string; meters?: Usage };
}

export interface InferenceGateway {
  /** `idempotencyKey` makes a retry safe: the same key never bills twice. */
  infer(request: InferenceRequest, idempotencyKey: string): Promise<InferenceResult>;
  stream(request: InferenceRequest, idempotencyKey: string, signal?: AbortSignal): AsyncIterable<StreamEvent>;
}

export class GatewayError extends Error {
  constructor(
    public code: string,
    public status?: number,
    public requestId?: string,
  ) {
    super(code);
    this.name = "GatewayError";
  }
}

export function isTerminalEvent(event: Pick<StreamEvent, "type">): boolean {
  return event.type === "request.completed" || event.type === "request.failed" || event.type === "request.replayed";
}

/** Concatenates the text of a stream; throws when the stream ends without a terminal event. */
export async function collectText(events: AsyncIterable<StreamEvent>): Promise<string> {
  let text = "";
  let terminal = false;
  for await (const event of events) {
    if (event.type === "output.delta") text += event.text;
    if (isTerminalEvent(event)) terminal = true;
  }
  if (!terminal) throw new GatewayError("stream_interrupted");
  return text;
}

/** Parses SSE across arbitrary chunk and CRLF boundaries. Never logs content. */
export async function* parseSSE(body: ReadableStream<Uint8Array>, maxFrameBytes = 2_000_000): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > maxFrameBytes) throw new GatewayError("stream_frame_too_large");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        let event = "message";
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length) yield { event, data: data.join("\n") };
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
