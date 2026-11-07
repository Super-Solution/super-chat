// DirectTransport — browser (or server) talks straight to the provider with a
// key you supply.
//
// In a browser this puts the key in client memory and in the network tab. That
// is fine for a local playground or a desktop app with the user's own key, and
// wrong for anything multi-tenant. `credentialSafe` is false so the runtime can
// warn, and `assertBrowserUseAcknowledged` makes the footgun explicit rather
// than silent.

import { isMultipartBody, type Transport, type TransportRequest } from "./types.js";

export type DirectTransportConfig = {
  /** Provider API root, no trailing slash. e.g. "https://api.openai.com/v1". */
  baseUrl: string;
  /** Static key, or a getter for keys that rotate / come from a keychain. */
  apiKey: string | (() => string | Promise<string>);
  /**
   * How the key rides on the wire. "bearer" (default) sends
   * `Authorization: Bearer <key>`; "x-api-key" sends the `x-api-key` header —
   * what Anthropic's Messages API expects.
   */
  authStyle?: "bearer" | "x-api-key";
  /** Sent on every request; merged under per-request headers. */
  headers?: Record<string, string>;
  /**
   * Required to use this transport in a browser. Naming it forces the caller to
   * state the risk out loud instead of discovering it in production.
   */
  dangerouslyAllowBrowser?: boolean;
  fetchImpl?: typeof fetch;
};

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

export function buildUrl(baseUrl: string, path: string, query?: TransportRequest["query"]): string {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export function createDirectTransport(config: DirectTransportConfig): Transport {
  if (isBrowser() && !config.dangerouslyAllowBrowser) {
    throw new Error(
      "DirectTransport sends your API key from the browser. Pass `dangerouslyAllowBrowser: true` to accept that, " +
        "or use createProxyTransport() so the key stays on your server.",
    );
  }
  const doFetch = config.fetchImpl ?? globalThis.fetch;

  return {
    kind: "direct",
    credentialSafe: !isBrowser(),
    async fetch(req: TransportRequest): Promise<Response> {
      const apiKey = typeof config.apiKey === "function" ? await config.apiKey() : config.apiKey;
      const headers: Record<string, string> = {
        ...(config.authStyle === "x-api-key" ? { "x-api-key": apiKey } : { authorization: `Bearer ${apiKey}` }),
        ...config.headers,
        ...req.headers,
      };
      if (req.stream) headers["accept"] = "text/event-stream";

      let body: BodyInit | undefined;
      if (isMultipartBody(req.body)) {
        // No content-type here — fetch sets multipart/form-data with the boundary.
        const form = new FormData();
        for (const [k, v] of Object.entries(req.body.fields)) form.set(k, v);
        for (const f of req.body.files) {
          form.set(f.field, new Blob([f.data as BlobPart], f.mediaType ? { type: f.mediaType } : {}), f.filename);
        }
        body = form;
      } else if (req.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(req.body);
      }

      return doFetch(buildUrl(config.baseUrl, req.path, req.query), {
        method: req.method,
        headers,
        body,
        signal: req.signal,
      });
    },
  };
}
