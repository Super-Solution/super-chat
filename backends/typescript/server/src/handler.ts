// The BFF half of ProxyTransport. Framework-agnostic: it takes a `Request` and
// returns a `Response`, so it drops into a Next.js route handler, a Hono route,
// a Cloudflare Worker, or Bun.serve unchanged.
//
// Security posture, stated plainly: this handler holds your provider key and
// forwards client-supplied paths. Without an allowlist that is an open relay —
// anyone who can reach your route can spend your key on any endpoint. So:
//   • providers must be registered explicitly, with their key and base URL;
//   • every path is matched against a per-provider allowlist of patterns;
//   • the client can never set Authorization (we drop inbound auth headers);
//   • `authorize` gets the raw Request so you can attach your own session check.

import { base64ToBytes, type ProxyEnvelope, type SerializedMultipartBody } from "@supersolutions/super-chat-core";

export type ProxyProviderConfig = {
  baseUrl: string;
  apiKey: string | (() => string | Promise<string>);
  /**
   * How the credential rides on the upstream request. "bearer" (default)
   * sends `Authorization: Bearer <key>`; "x-api-key" sends the `x-api-key`
   * header (Anthropic's Messages API); "cookie" sends it as the value of the
   * named cookie in `cookieName`.
   */
  authStyle?: "bearer" | "x-api-key" | "cookie";
  /** Required when authStyle is "cookie"; kept server-side with apiKey. */
  cookieName?: string;
  // Allowed provider paths. A single `*` matches one segment; a double `*`
  // matches the remaining path. An entry may carry a method prefix
  // ("POST /files") to allow only that method — without one, any method
  // matches. That distinction matters: "POST /files" is an upload, while a
  // bare "/files" would also open GET /files, which lists every file on the
  // account.
  // e.g. ["/responses", "/responses/*", "/responses/*/cancel", "POST /files"]
  allowPaths: string[];
  headers?: Record<string, string>;
};

export type ProxyHandlerConfig = {
  providers: Record<string, ProxyProviderConfig>;
  /**
   * Called before anything is forwarded. Return `false` or a Response to reject.
   * This is where your session/rate-limit/quota logic goes.
   */
  authorize?: (req: Request, envelope: ProxyEnvelope) => Promise<boolean | Response> | boolean | Response;
  /** Observe every forwarded call (metering, audit log). */
  onRequest?: (envelope: ProxyEnvelope, meta: { ok: boolean; status: number; ms: number }) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  /**
   * Largest accepted request body in bytes (default 64 MiB: room for base64 file parts). The envelope is
   * parsed before `authorize` runs, so without a bound anyone who can reach the route can make the server
   * buffer an arbitrarily large body.
   */
  maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

class BodyTooLarge extends Error {}

/** Read the body as text, stopping (and cancelling the stream) as soon as it passes `limit` bytes. */
async function readBounded(request: Request, limit: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > limit) throw new BodyTooLarge();
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Build the anchored regex a wildcard path pattern compiles to. */
function compilePathPattern(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((seg) => {
      if (seg === "**") return "@@REST@@";
      if (seg === "*") return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/")
    .replace("@@REST@@", ".*");
  return new RegExp(`^${source}$`);
}

// Compile a wildcard pattern into a matcher. Anchored at both ends, so no
// prefix tricks — "/responses" must not match "/responses-admin".
export function pathMatches(pattern: string, path: string): boolean {
  return compilePathPattern(pattern).test(path);
}

/** An allowlist entry, precompiled once rather than on every request it is checked against. */
type CompiledAllowEntry = { method?: string; regex: RegExp };

/** Split an allowlist entry into its optional method prefix and path pattern, and compile the pattern. */
function compileAllowEntry(entry: string): CompiledAllowEntry {
  const space = entry.indexOf(" ");
  if (space > 0 && !entry.startsWith("/")) {
    return { method: entry.slice(0, space).toUpperCase(), regex: compilePathPattern(entry.slice(space + 1).trim()) };
  }
  return { regex: compilePathPattern(entry) };
}

function compiledEntryMatches(entry: CompiledAllowEntry, method: string, path: string): boolean {
  return (!entry.method || entry.method === method.toUpperCase()) && entry.regex.test(path);
}

/**
 * Never forwarded from the client.
 *   • credentials: the credential comes from the operator, and a client must not be
 *     able to pick a different one (`api-key` is Azure's, `x-goog-api-key` Google's);
 *   • framing: `host`, `content-length`, `content-type` and the hop-by-hop headers
 *     belong to the connection this server opens, not to the browser's;
 *   • identity: `x-forwarded-for` and friends would let a browser tell the upstream
 *     (rate limiter, audit log) it is somebody else.
 */
const STRIPPED_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "x-auth-token",
  "x-access-token",
  "cookie",
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-connection",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

const isSerializedMultipart = (b: unknown): b is SerializedMultipartBody =>
  typeof b === "object" &&
  b !== null &&
  (b as { kind?: unknown }).kind === "multipart" &&
  Array.isArray((b as { files?: unknown }).files) &&
  (b as { files: { data?: unknown }[] }).files.every((f) => typeof f?.data === "string");

/**
 * Run an observer hook. It is awaited (a serverless host needs its write flushed before the
 * function is frozen) but it can never fail or change the request it observes.
 */
async function observe(hook: ProxyHandlerConfig["onRequest"], envelope: ProxyEnvelope, meta: { ok: boolean; status: number; ms: number }) {
  try {
    await hook?.(envelope, meta);
  } catch {
    // A broken audit log must not turn a successful call into a 500, nor leave
    // the upstream response unread.
  }
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createProxyHandler(config: ProxyHandlerConfig) {
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  // Precompiled once per provider, at construction time — not per allowPaths
  // entry per incoming request, which is how many requests a proxy handler is
  // built to serve.
  const compiledAllowPaths = new Map<string, CompiledAllowEntry[]>(
    Object.entries(config.providers).map(([providerId, provider]) => [providerId, provider.allowPaths.map(compileAllowEntry)]),
  );

  return async function handle(request: Request): Promise<Response> {
    const startedAt = Date.now();
    let envelope: ProxyEnvelope;
    try {
      const parsed: unknown = JSON.parse(await readBounded(request, maxBodyBytes));
      // A bare `null`, a number or an envelope without a string provider, path or method used to throw
      // further down and surface as an unhandled error instead of a 400.
      if (!isRecord(parsed) || typeof parsed.provider !== "string" || typeof parsed.path !== "string" || typeof parsed.method !== "string") {
        throw new Error("not an envelope");
      }
      envelope = parsed as unknown as ProxyEnvelope;
    } catch (e) {
      if (e instanceof BodyTooLarge) return json({ error: { message: `Request body exceeds ${maxBodyBytes} bytes.` } }, 413);
      return json({ error: { message: "Body must be a JSON proxy envelope." } }, 400);
    }

    const provider = config.providers[envelope.provider];
    if (!provider) {
      return json({ error: { message: `Unknown provider "${envelope.provider}".` } }, 404);
    }

    // Normalize before matching so "/responses/../files" can't slip past the
    // allowlist and reach an endpoint the operator never opened up.
    const path = normalizePath(envelope.path);
    const allowed = compiledAllowPaths.get(envelope.provider) ?? [];
    if (!path || !allowed.some((entry) => compiledEntryMatches(entry, envelope.method, path))) {
      return json({ error: { message: `Path "${envelope.path}" is not allowed for ${envelope.provider}.` } }, 403);
    }

    if (config.authorize) {
      let verdict: boolean | Response;
      try {
        verdict = await config.authorize(request, envelope);
      } catch {
        // Fail closed, and say nothing about why: the hook's exception (a session
        // store outage, a bad token library) is not for the browser to read.
        return json({ error: { message: "Authorization could not be completed." } }, 500);
      }
      if (verdict instanceof Response) return verdict;
      if (verdict === false) return json({ error: { message: "Not authorized." } }, 401);
    }

    const url = new URL(`${provider.baseUrl.replace(/\/$/, "")}${path}`);
    for (const [k, v] of Object.entries(envelope.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const apiKey = typeof provider.apiKey === "function" ? await provider.apiKey() : provider.apiKey;
    const headers: Record<string, string> = {};
    // Client-requested upstream headers (org ids, beta flags, an MCP session
    // id) go in first, minus anything credential-shaped — then the key and the
    // operator's own headers are applied ON TOP, so a client can request
    // headers but never substitute the credential.
    for (const [k, v] of Object.entries(envelope.headers ?? {})) {
      const key = k.toLowerCase();
      if (STRIPPED_HEADERS.has(key)) continue;
      headers[key] = v;
    }
    // An empty key means "this upstream has no bearer auth" (a local MCP
    // server) rather than `Bearer ` garbage.
    if (apiKey) {
      if (provider.authStyle === "x-api-key") headers["x-api-key"] = apiKey;
      else if (provider.authStyle === "cookie") {
        if (!provider.cookieName || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(provider.cookieName)) {
          return json({ error: { message: `Provider "${envelope.provider}" has an invalid cookie configuration.` } }, 500);
        }
        // The inbound Cookie header is stripped above. This is the operator's
        // session only, and CR/LF would otherwise turn it into header injection.
        if (/[\r\n]/.test(apiKey)) {
          return json({ error: { message: `Provider "${envelope.provider}" has an invalid credential.` } }, 500);
        }
        headers.cookie = `${provider.cookieName}=${apiKey}`;
      } else headers["authorization"] = `Bearer ${apiKey}`;
    }
    for (const [k, v] of Object.entries(provider.headers ?? {})) headers[k.toLowerCase()] = v;
    if (envelope.stream) headers["accept"] = "text/event-stream";

    let body: BodyInit | undefined;
    if (isSerializedMultipart(envelope.body)) {
      // Rebuild the FormData the client couldn't send through the JSON
      // envelope. No content-type — fetch supplies the multipart boundary.
      const form = new FormData();
      for (const [k, v] of Object.entries(envelope.body.fields ?? {})) form.set(k, v);
      for (const f of envelope.body.files) {
        let bytes: Uint8Array;
        try {
          bytes = base64ToBytes(f.data);
        } catch {
          return json({ error: { message: `File part "${f.field}" is not valid base64.` } }, 400);
        }
        form.set(f.field, new Blob([bytes as BlobPart], f.mediaType ? { type: f.mediaType } : {}), f.filename);
      }
      body = form;
    } else if (envelope.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(envelope.body);
    }

    let upstream: Response;
    try {
      upstream = await doFetch(url.toString(), {
        method: envelope.method,
        headers,
        body,
        signal: request.signal,
      });
    } catch (e) {
      await observe(config.onRequest, envelope, { ok: false, status: 502, ms: Date.now() - startedAt });
      return json({ error: { message: e instanceof Error ? e.message : "Upstream fetch failed." } }, 502);
    }

    await observe(config.onRequest, envelope, { ok: upstream.ok, status: upstream.status, ms: Date.now() - startedAt });

    // Stream straight through — buffering an SSE body here would defeat the
    // point of streaming and stall the first token behind the last one.
    const outHeaders = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) outHeaders.set("content-type", contentType);
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) outHeaders.set("retry-after", retryAfter);
    // MCP Streamable HTTP assigns the session on the initialize response; the
    // client must see it to send it back on every later call.
    const mcpSession = upstream.headers.get("mcp-session-id");
    if (mcpSession) outHeaders.set("mcp-session-id", mcpSession);
    if (envelope.stream) {
      outHeaders.set("cache-control", "no-cache, no-transform");
      outHeaders.set("connection", "keep-alive");
    }

    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  };
}

// The allowlist matches the path as written, but the upstream URL is then built with
// `new URL(base + path)`, which reads some paths differently. Anything it would
// reinterpret must be refused here, or the allowlist is checked against a path that is
// not the one that gets requested:
//   • `\` is a slash to a WHATWG URL parser (`/a/..\b` is `/a/../b`);
//   • `?` and `#` start a query or a fragment (`/responses/x?admin=1` injects a query);
//   • control characters are stripped (`/a\nb` is `/ab`);
//   • an encoded `/` or `\` may be decoded by the upstream into a separator.
const UNSAFE_PATH = /[\\?#\u0000-\u001f\u007f]|%(?:2f|5c)/i;
// `.` and `..` spelled with percent-encoding (`%2e%2e`): a URL parser resolves them
// (`/responses/%2e%2e` is `/`), a plain comparison with ".." does not.
const ENCODED_DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/** Resolve `.`/`..` segments; reject anything that escapes the root or that a URL parser would reinterpret. */
function normalizePath(input: string): string | null {
  if (typeof input !== "string" || !input.startsWith("/") || UNSAFE_PATH.test(input)) return null;
  const out: string[] = [];
  for (const seg of input.split("/")) {
    if (seg !== "." && seg !== ".." && ENCODED_DOT_SEGMENT.test(seg)) return null;
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}
