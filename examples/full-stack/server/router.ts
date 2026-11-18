import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { Service, type Principal } from "@supersolutions/super-router-contracts";
import { Router } from "@supersolutions/super-router-core";
import { createRouterHandler } from "@supersolutions/super-router-server";
import { MemoryStore } from "@supersolutions/super-router-storage-memory";
import { ScriptedModel } from "./model";

export const SERVICE_ID = "reference-agent";
export const CUSTOMER_ID = "customer_demo";

const price = { input: "1", cached: "1", cache_write: "1", output: "1", per: 1 };
const service = Service.parse({
  id: SERVICE_ID,
  version: 1,
  mode: "tier",
  tier: "demo",
  regions: ["local"],
  price: { ...price, asset: "credit:demo" },
  max_attempts: 1,
  max_provider_cost: "100000000",
  max_output_tokens: 8192,
  weights: { cost: 1, latency: 0, reliability: 0, quality: 0 },
  cost_scale: "100000000",
  latency_scale_ms: 1000,
  offerings: [
    {
      id: "scripted",
      provider: "scripted",
      model: "scripted-model",
      upstream_model: "scripted-model",
      region: "local",
      enabled: true,
      source: "byok",
      max_input_tokens: 128000,
      max_output_tokens: 8192,
      price: { ...price, asset: "USD" },
    },
  ],
});

/** A real Super Router in this process, with an in-memory ledger. The key never leaves the server. */
export async function createLocalRouter() {
  const principal: Principal = { workspace: "local", environment: "test", customer: CUSTOMER_ID, scopes: ["invoke", "service:write", "billing:write", "billing:read"] };
  const store = new MemoryStore();
  await store.publish(principal, service);
  await store.grant(principal, "customer_sale", "credit:demo", "1000000000", "example-grant");
  const key = randomBytes(32).toString("hex");
  const router = new Router(store, { scripted: new ScriptedModel() }, randomBytes(32).toString("hex"));
  const handler = createRouterHandler({ router, store, keys: [{ key, principal }] });

  return async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const idempotency = req.headers["idempotency-key"];
    const response = await handler(
      new Request("http://router.local" + path, {
        method: req.method ?? "GET",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(typeof idempotency === "string" ? { "idempotency-key": idempotency } : {}) },
        ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  };
}
