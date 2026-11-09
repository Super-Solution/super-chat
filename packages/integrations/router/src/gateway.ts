import {
  GatewayError,
  parseSSE,
  type InferenceGateway,
  type InferenceRequest,
  type InferenceResult,
  type StreamEvent,
} from "@supersolutions/super-protocol";

export type SuperRouterGatewayConfig = {
  /** Origin of the Super Router server, e.g. "https://router.example.com". */
  baseUrl: string;
  /** A Super Router API key. Keep it server-side; the browser should use a proxy. */
  apiKey: string;
  fetch?: typeof fetch;
};

const body = (request: InferenceRequest, stream: boolean) =>
  JSON.stringify({
    service: request.service,
    ...(request.service_version ? { service_version: request.service_version } : {}),
    customer_id: request.customer_id,
    input: { messages: request.messages },
    limits: {
      max_output_tokens: request.max_output_tokens ?? 1024,
      ...(request.timeout_ms ? { timeout_ms: request.timeout_ms } : {}),
    },
    stream,
  });

/** An `InferenceGateway` over the Super Router HTTP API (`POST /v1/inferences`). */
export function createSuperRouterGateway(config: SuperRouterGatewayConfig): InferenceGateway {
  const base = config.baseUrl.replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;

  async function send(path: string, init: RequestInit, idempotencyKey?: string): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(base + path, {
        ...init,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
      });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw error;
      throw new GatewayError("network_error");
    }
    // A repeated idempotency key answers 303 with the original request's location.
    if (response.status === 303 || (response.status >= 300 && response.status < 400)) return response;
    if (!response.ok) {
      let code = "http_error";
      let requestId: string | undefined;
      try {
        const parsed = (await response.json()) as { error?: { code?: string; request_id?: string } };
        code = parsed.error?.code ?? code;
        requestId = parsed.error?.request_id;
      } catch {
        /* non-JSON error body */
      }
      throw new GatewayError(code, response.status, requestId);
    }
    return response;
  }

  const requestIdFrom = (response: Response) => (response.headers.get("location") ?? "").split("/").pop() ?? "";

  return {
    async infer(request, idempotencyKey, signal) {
      const abort = signal ? { signal } : {};
      const response = await send("/v1/inferences", { method: "POST", body: body(request, false), ...abort }, idempotencyKey);
      if (response.status >= 300 && response.status < 400) {
        const id = requestIdFrom(response);
        if (!id) throw new GatewayError("bad_redirect", response.status);
        return (await (await send("/v1/requests/" + encodeURIComponent(id), { method: "GET", ...abort })).json()) as InferenceResult;
      }
      return (await response.json()) as InferenceResult;
    },

    async *stream(request, idempotencyKey, signal) {
      const response = await send("/v1/inferences", { method: "POST", body: body(request, true), ...(signal ? { signal } : {}) }, idempotencyKey);
      if (response.status >= 300 && response.status < 400) {
        yield { type: "request.replayed", request_id: requestIdFrom(response), sequence: 0 } satisfies StreamEvent;
        return;
      }
      if (!response.body) throw new GatewayError("empty_stream");
      for await (const frame of parseSSE(response.body)) {
        yield { type: frame.event, ...(JSON.parse(frame.data) as object) } as StreamEvent;
      }
    },
  };
}
