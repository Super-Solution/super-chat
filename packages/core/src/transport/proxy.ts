// ProxyTransport — the browser calls your own backend, which injects the key and
// forwards to the provider. This is the default, and the only shape that is
// honest in a multi-user app.
//
// The wire format between client and BFF is intentionally trivial: the client
// declares which provider, path, method and body it wants; the server decides
// whether to allow it. `createProxyHandler` (server.ts) is the matching half,
// and it allowlists paths — a proxy that forwards any path is an open relay for
// your API key.

import { bytesToBase64 } from "./binary.js";
import { isMultipartBody, type Transport, type TransportRequest } from "./types.js";

export type ProxyTransportConfig = {
  /** Base path of your proxy route, e.g. "/api/agent". */
  url: string;
  /** Extra headers (session cookie is automatic; use this for CSRF tokens). */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
};

/** The envelope a ProxyTransport POSTs to the BFF. Exported so the server half can type it. */
export type ProxyEnvelope = {
  provider: string;
  path: string;
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  stream?: boolean;
  /**
   * Per-request headers for the UPSTREAM call (org ids, beta flags, an MCP
   * session id). The server half forwards them after stripping credential
   * headers and then applies its own key on top — a client can request
   * headers, never substitute the credential.
   */
  headers?: Record<string, string>;
};

/**
 * A `MultipartBody` as it travels inside the JSON envelope: bytes become
 * base64 strings so the client→BFF wire stays one method, one body shape.
 * Base64 costs +33%, so treat ~20 MB per upload as the practical ceiling —
 * beyond that, use a direct transport or your own upload route.
 */
export type SerializedMultipartBody = {
  kind: "multipart";
  fields: Record<string, string>;
  files: { field: string; filename: string; mediaType?: string; data: string }[];
};

export function createProxyTransport(config: ProxyTransportConfig): Transport {
  const doFetch = config.fetchImpl ?? globalThis.fetch;

  return {
    kind: "proxy",
    credentialSafe: true,
    async fetch(req: TransportRequest): Promise<Response> {
      const extra = typeof config.headers === "function" ? await config.headers() : config.headers;
      const body: unknown = isMultipartBody(req.body)
        ? ({
            kind: "multipart",
            fields: req.body.fields,
            files: req.body.files.map((f) => ({
              field: f.field,
              filename: f.filename,
              ...(f.mediaType ? { mediaType: f.mediaType } : {}),
              data: bytesToBase64(f.data),
            })),
          } satisfies SerializedMultipartBody)
        : req.body;

      const envelope: ProxyEnvelope = {
        provider: req.provider,
        path: req.path,
        method: req.method,
        body,
        query: req.query,
        stream: req.stream,
        // Inside the envelope, not on the outer request — the BFF builds the
        // upstream headers itself, and anything on the outer request is
        // between the browser and the BFF (cookies, CSRF), not for upstream.
        ...(req.headers ? { headers: req.headers } : {}),
      };

      // Always POST the envelope, even for provider-side GETs (job polling):
      // one method and one body shape keeps the server handler and any CSRF
      // middleware simple, and provider GETs carry no cacheable semantics for us.
      return doFetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(req.stream ? { accept: "text/event-stream" } : {}),
          ...extra,
        },
        body: JSON.stringify(envelope),
        credentials: config.credentials ?? "same-origin",
        signal: req.signal,
      });
    },
  };
}
