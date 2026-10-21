// Demo mode — a scripted transport, so the playground runs with no API key.
//
// The important property: this fakes the NETWORK, not the framework. It plugs in
// at the `Transport` seam, so the real OpenAI adapter still builds the request,
// parses the response, and maps tool calls; the real runtime still runs the tool
// loop, suspends on interactive cards, and assembles context. Only the bytes on
// the wire are canned.
//
// That makes it a genuine demonstration rather than a mockup — and it doubles as
// a check that the request we build is one a real endpoint would accept, since
// the script reads the request to decide what to answer.

import type { Transport, TransportRequest } from "@zzyzxlabs/super-chat-core";

type ResponsesItem = {
  type: string;
  role?: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
};

type Step =
  | { kind: "tool"; name: string; args: unknown }
  | { kind: "text"; text: string };

/** Scripts are keyed by a matcher over the user's message. First match wins. */
const SCRIPTS: { match: RegExp; steps: Step[] }[] = [
  // ── streaming card ───────────────────────────────────────────────────────
  // Big enough that its arguments take a few seconds to arrive, so the table
  // visibly fills row by row instead of appearing whole at the end.
  {
    match: /shortlist|table of|表格/i,
    steps: [
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "table",
          spec: {
            kind: "table",
            title: "Vendor shortlist",
            caption: "Annual cost at the quoted seat count. Score is the weighted rubric out of 100.",
            columns: [
              { key: "vendor", label: "Vendor" },
              { key: "region", label: "Data region" },
              { key: "sso", label: "SSO", pill: true },
              { key: "cost", label: "Annual cost", format: "currency", align: "right" },
              { key: "score", label: "Score", format: "number", align: "right" },
            ],
            rows: [
              { vendor: "Halcyon Systems", region: "EU (Frankfurt)", sso: "All plans", cost: 48200, score: 91 },
              { vendor: "Brightline", region: "EU (Dublin)", sso: "All plans", cost: 52900, score: 88 },
              { vendor: "Tessellate", region: "US + EU", sso: "Enterprise", cost: 39800, score: 84 },
              { vendor: "Quarry and Vale", region: "EU (Paris)", sso: "All plans", cost: 61500, score: 82 },
              { vendor: "Lumen Works", region: "US (Oregon)", sso: "Add-on", cost: 33100, score: 77 },
              { vendor: "Ostrander", region: "EU (Stockholm)", sso: "Enterprise", cost: 45750, score: 74 },
              { vendor: "Pinecrest Labs", region: "UK (London)", sso: "All plans", cost: 57300, score: 71 },
              { vendor: "Meridian Nine", region: "US + EU", sso: "Add-on", cost: 29900, score: 66 },
              { vendor: "Corvid", region: "APAC (Singapore)", sso: "Enterprise", cost: 41200, score: 62 },
              { vendor: "Saltmarsh", region: "US (Virginia)", sso: "None", cost: 24600, score: 48 },
            ],
          },
        },
      },
      {
        kind: "text",
        text:
          "Halcyon and Brightline are the two to take forward: both keep data in the EU and include SSO on every plan. " +
          "Tessellate is the value pick, but only if you were going to buy Enterprise anyway — SSO is gated there.",
      },
    ],
  },
  // ── legal ────────────────────────────────────────────────────────────────
  {
    match: /msa|contract|clause|liability exposure|review the|合約/i,
    steps: [
      { kind: "tool", name: "reviewContract", args: { document: "Vertex MSA" } },
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "callout",
          spec: {
            kind: "callout",
            tone: "note",
            title: "Not legal advice",
            body: "This flags commercial risk in the drafting. It is not legal advice and does not replace review by a qualified lawyer in the governing jurisdiction.",
          },
        },
      },
      {
        kind: "text",
        text:
          "Three blockers, and clause 8.2 is the one to fight: it caps the customer's liability but leaves the supplier's unlimited. " +
          "The 90-day auto-renewal on a 24-month term is the second — that is unusually long and easy to miss.\n\n" +
          "The breach-notification wording says only “promptly”, which does not meet the 72-hour expectation you are almost certainly subject to.",
      },
    ],
  },
  {
    match: /exclude liability|can we exclude|enforceable|precedent|authority/i,
    steps: [
      { kind: "tool", name: "findPrecedent", args: { question: "excluding liability entirely in standard terms" } },
      {
        kind: "text",
        text:
          "Not entirely, no — not on your own standard terms. A clearly drafted exclusion can survive even a fundamental breach, but where you are contracting on written standard terms it still has to pass a reasonableness test, and a total exclusion rarely does.\n\n" +
          "A mutual cap at 12 months' fees, with carve-outs for death, personal injury and fraud, is the shape that normally holds.",
      },
    ],
  },
  // ── marketing ────────────────────────────────────────────────────────────
  {
    match: /funnel|losing people|drop.?off|conversion|轉換/i,
    steps: [
      { kind: "tool", name: "getFunnel", args: { period: "last 30 days" } },
      {
        kind: "text",
        text:
          "Activation is where it goes wrong: only 39% of people who sign up finish setup, and every stage after that is healthy by comparison. " +
          "Fixing signup→activated is worth more than doubling traffic — the same visitors would produce roughly 60% more paying users.",
      },
    ],
  },
  {
    match: /competitor|northwind|acme|positioning|compare against|vs\b/i,
    steps: [
      { kind: "tool", name: "compareCompetitors", args: { against: ["Northwind", "Acme"] } },
      {
        kind: "text",
        text:
          "Your wedge is SSO on every plan and an eight-minute time-to-value — Northwind gates SSO behind Enterprise and takes two days to onboard.\n\n" +
          "SOC 2 is the one place you are genuinely behind, and it is the thing that will cost you enterprise deals until it lands.",
      },
    ],
  },
  {
    match: /channel|campaign|ctr|cac|traffic/i,
    steps: [
      { kind: "tool", name: "getCampaign", args: { period: "last 30 days" } },
      {
        kind: "text",
        text:
          "Email converts at 22.8% — five times paid search — but it is only 4,300 visits. The volume is in organic; the efficiency is in email. " +
          "Paid social is the one to cut: lowest conversion and the highest cost per acquisition.",
      },
    ],
  },
  // ── document edit ────────────────────────────────────────────────────────
  // An interactive card SUSPENDS the run, which is the whole point: nothing is
  // written until the answer comes back. So this script ends at the review —
  // there is no "and then" until the user has decided.
  {
    match: /tighten|redline|revise|edit the|rewrite|修改|改一下/i,
    steps: [
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "editreview",
          spec: {
            kind: "editreview",
            docId: "doc_demo_1",
            title: "Vendor review",
            revision: 1,
            summary: "Name the supplier, and caveat the recommendation on the audit.",
            hunks: [
              {
                index: 0,
                block: 3,
                removed: ["The **cheaper** option fails the SSO requirement outright. Closing that"],
                added: ["Supplier A fails the SSO requirement outright. Closing that"],
              },
              {
                index: 1,
                block: 7,
                removed: ["Proceed with the second supplier and hold 10% of year one against the"],
                added: ["Proceed with Supplier B, subject to the audit, and hold 10% of year one against the"],
              },
            ],
          },
        },
      },
    ],
  },

  // ── outbound ─────────────────────────────────────────────────────────────
  {
    match: /email|mail|寄給|寄一封|covering note|send it to/i,
    steps: [
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "email",
          spec: {
            kind: "email",
            to: ["counsel@example.com"],
            subject: "Vendor review — redline for your read",
            body: "Hi,\n\nThe vendor review is attached, with the SSO gap called out and the recommendation caveated on the audit.\n\nThanks",
          },
        },
      },
      {
        kind: "text",
        text: "Drafted the covering note. Nothing is sent until you send it — download the .eml or open it in your mail client.",
      },
    ],
  },

  // ── document artifact ────────────────────────────────────────────────────
  // The P0 loop in one script: the agent produces something the user keeps,
  // reads in a previewer, and can point at to ask the next question.
  {
    match: /draft|write up|document|artifact|寫一份|草稿|文件/i,
    steps: [
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "document",
          spec: {
            kind: "document",
            docId: "doc_demo_1",
            title: "Vendor review",
            revision: 1,
            markdown: [
              "# Vendor review",
              "",
              "Two shortlisted suppliers, scored against the criteria agreed in March.",
              "",
              "## Findings",
              "",
              "The **cheaper** option fails the SSO requirement outright. Closing that",
              "gap later costs more than the difference in list price, so it is not a",
              "saving.",
              "",
              "- Coverage: 18 of 22 requirements met",
              "- Blocking gap: no SSO on non-admin seats",
              "- Exit clause: 90 days, uncapped",
              "",
              "## Recommendation",
              "",
              "Proceed with the second supplier and hold 10% of year one against the",
              "outstanding audit.",
            ].join("\n"),
          },
        },
      },
      {
        kind: "text",
        text: "Drafted it as a document rather than a reply — it is something you will come back to. Select any part of it to ask about that section specifically.",
      },
    ],
  },
  {
    match: /gdpr|compliance|soc ?2|readiness|合規/i,
    steps: [
      { kind: "tool", name: "checkCompliance", args: { framework: "gdpr" } },
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "callout",
          spec: {
            kind: "callout",
            tone: "warning",
            title: "Two blockers before you can claim readiness",
            body: "Missing DPAs and an outdated transfer mechanism are both hard failures, not documentation gaps. Neither can be closed retroactively.",
          },
        },
      },
      { kind: "text", text: "Five of seven are in place. The two vendor items are the blockers — everything else is process documentation." },
    ],
  },
  {
    match: /price action|candle|60 days|chart of|走勢|K ?線/i,
    steps: [
      { kind: "tool", name: "getHistory", args: { symbol: "SUI", days: 60 } },
      {
        kind: "text",
        text:
          "SUI ran from about $2.81 to $3.71 over the 60 days — roughly +32%, but not in a straight line. " +
          "The band between $3.10 and $3.30 got tested repeatedly on the way up, which is usually where a pullback finds support.\n\n" +
          "Worth saying plainly: this is the demo feed, not real market data.",
      },
    ],
  },
  {
    match: /compare|comparison|vs\.?\s|比較/i,
    steps: [
      { kind: "tool", name: "compareInstruments", args: { symbols: ["SUI", "SOL", "NVDA"], days: 90 } },
      {
        kind: "text",
        text:
          "Over 90 days SUI leads, SOL is close behind, and NVDA lags — but note the three are not comparable risk. " +
          "The normalised chart above is the honest view; the raw prices in the table are not.",
      },
    ],
  },
  {
    match: /starts with s|which one|ambiguous|哪一個/i,
    steps: [
      { kind: "tool", name: "listInstruments", args: { query: "S" } },
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "choice",
          spec: {
            kind: "choice",
            title: "Which one did you mean?",
            prompt: "Three instruments start with S.",
            options: [
              { id: "SUI", label: "Sui (SUI)", description: "Layer 1 · crypto" },
              { id: "SOL", label: "Solana (SOL)", description: "Layer 1 · crypto" },
              { id: "SNAP", label: "Snap Inc. (SNAP)", description: "Equity — not in this demo feed", disabled: true, disabledReason: "Not in the demo dataset" },
            ],
          },
        },
      },
      { kind: "tool", name: "getQuote", args: { symbol: "SOL" } },
      { kind: "text", text: "Solana it is — $178.20, down 0.8% on the day." },
    ],
  },
  {
    match: /alert|notify|提醒|通知/i,
    steps: [
      { kind: "tool", name: "createAlert", args: { symbol: "SUI", price: 5, direction: "above" } },
      { kind: "text", text: "Done — the alert is live and will fire once, then expire in 30 days." },
    ],
  },
  {
    match: /deep research|research pass|深入研究/i,
    steps: [
      { kind: "tool", name: "loadSkill", args: { id: "deep-research" } },
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "progress",
          spec: {
            kind: "progress",
            title: "Crypto market structure — research plan",
            steps: [
              { label: "Where does liquidity actually sit?", status: "done", detail: "CEX vs DEX split" },
              { label: "Who are the marginal buyers?", status: "active" },
              { label: "What breaks the current regime?", status: "pending" },
            ],
          },
        },
      },
      {
        kind: "text",
        text:
          "I pulled the deep-research skill and decomposed the question into three parts. " +
          "Step one is done; the card above updates in place as the rest complete.",
      },
    ],
  },
  {
    match: /timeline|visuali[sz]e|show me|畫|視覺化/i,
    steps: [
      {
        kind: "tool",
        name: "visualize",
        args: {
          kind: "timeline",
          spec: {
            kind: "timeline",
            title: "How I'd research a new token",
            events: [
              { at: "Hour 0", label: "Read the contract", detail: "Mint authority, upgrade keys, fee hooks", tone: "info" },
              { at: "Hour 1", label: "Map the holders", detail: "Concentration, unlock schedule", tone: "warning" },
              { at: "Hour 2", label: "Trace the liquidity", detail: "Depth, who owns the LP, lock status" },
              { at: "Day 1", label: "Watch it trade", detail: "Real volume vs wash", tone: "neutral" },
              { at: "Day 3", label: "Decide", detail: "Size to the worst case, not the pitch", tone: "positive" },
            ],
          },
        },
      },
      { kind: "text", text: "That's the order I'd work in — contract first, price last. Price is the least informative signal early on." },
    ],
  },
];

const FALLBACK: Step[] = [
  {
    kind: "tool",
    name: "visualize",
    args: {
      kind: "stats",
      spec: {
        kind: "stats",
        title: "Demo mode",
        items: [
          { label: "Provider", value: "scripted" },
          { label: "Runtime", value: "real" },
          { label: "Cards", value: 13, format: "number" },
        ],
      },
    },
  },
  {
    kind: "text",
    text:
      "You're in demo mode — responses are scripted, but everything below the provider is real: " +
      "request building, the tool loop, card suspension, and context assembly.\n\n" +
      "Try one of the example prompts for a fuller script, or add an `OPENAI_API_KEY` " +
      "(or switch the transport to BYOK) for a live model.",
  },
];

/** Index of the newest user message in the Responses `input` array. */
function lastUserIndex(input: ResponsesItem[]): number {
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (item?.type === "message" && item.role === "user") return i;
  }
  return -1;
}

function lastUserText(input: ResponsesItem[]): string {
  const i = lastUserIndex(input);
  return i === -1 ? "" : (input[i]?.content ?? []).map((c) => c.text ?? "").join(" ");
}

/**
 * How far into the current script we are: tool results produced SINCE the last
 * user message.
 *
 * Counting them across the whole history is wrong — on turn two the previous
 * turn's tool outputs are still in `input`, and the script jumps straight to its
 * last step. (That is exactly what happened the first time.)
 */
function stepIndex(input: ResponsesItem[]): number {
  const from = lastUserIndex(input);
  return input.slice(from + 1).filter((i) => i.type === "function_call_output").length;
}

let seq = 0;

/**
 * Resolve after `ms`, but reject early if `signal` aborts — a canned delay
 * must not outlast the user hitting Stop.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A transport that answers from a script instead of the network.
 *
 * `latencyMs` is deliberate: an instant reply hides every loading state, and the
 * point of a demo is to show what the UI does while it waits.
 */
export function createDemoTransport(opts: { latencyMs?: number } = {}): Transport {
  const latency = opts.latencyMs ?? 420;

  return {
    kind: "custom",
    credentialSafe: true,
    async fetch(req: TransportRequest): Promise<Response> {
      await delay(latency, req.signal);

      // Uploads get a fake file id, so the attach flow works keyless too.
      if (req.path === "/files" && req.method === "POST") {
        seq += 1;
        const upload = req.body as { files?: { filename?: string; data?: Uint8Array }[] } | undefined;
        const file = upload?.files?.[0];
        return new Response(
          JSON.stringify({
            id: `file_demo_${seq}`,
            object: "file",
            bytes: file?.data?.length ?? 0,
            created_at: Date.now() / 1000,
            filename: file?.filename ?? "demo",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const body = (req.body ?? {}) as { model?: string; input?: ResponsesItem[]; stream?: boolean };
      const input = body.input ?? [];
      const text = lastUserText(input);
      const script = SCRIPTS.find((s) => s.match.test(text))?.steps ?? FALLBACK;
      const step = script[Math.min(stepIndex(input), script.length - 1)] ?? script[script.length - 1]!;

      seq += 1;
      const id = `resp_demo_${seq}`;
      const usage = { input_tokens: 850 + seq * 120, output_tokens: 64, total_tokens: 914 + seq * 120 };

      const payload =
        step.kind === "tool"
          ? {
              id,
              object: "response",
              created_at: Date.now() / 1000,
              model: body.model ?? "demo",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  call_id: `call_demo_${seq}`,
                  name: step.name,
                  arguments: JSON.stringify(step.args),
                },
              ],
              usage,
            }
          : {
              id,
              object: "response",
              created_at: Date.now() / 1000,
              model: body.model ?? "demo",
              status: "completed",
              output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: step.text }] }],
              usage,
            };

      // Streaming mode asks for SSE; emit the same content as a minimal event
      // sequence so the adapter's stream path is exercised too, not bypassed.
      // Tool arguments stream in fragments, as a real model's do, so a card
      // can be drawn while its spec is still arriving.
      if (req.stream) {
        const argChunks = step.kind === "tool" ? chunkArgs(JSON.stringify(step.args)) : [];
        const events =
          step.kind === "tool"
            ? [
                { type: "response.created", sequence_number: 1, response: { ...payload, output: [] } },
                {
                  type: "response.output_item.added",
                  sequence_number: 2,
                  item: { type: "function_call", id: `item_${seq}`, call_id: `call_demo_${seq}`, name: step.name, arguments: "" },
                },
                ...argChunks.map((delta, i) => ({
                  type: "response.function_call_arguments.delta",
                  sequence_number: 3 + i,
                  item_id: `item_${seq}`,
                  delta,
                })),
                {
                  type: "response.function_call_arguments.done",
                  sequence_number: 3 + argChunks.length,
                  item_id: `item_${seq}`,
                  arguments: JSON.stringify(step.args),
                },
                { type: "response.completed", sequence_number: 4 + argChunks.length, response: payload },
              ]
            : [
                { type: "response.created", sequence_number: 1, response: { ...payload, output: [] } },
                ...chunk(step.text).map((delta, i) => ({ type: "response.output_text.delta", sequence_number: 2 + i, delta })),
                { type: "response.completed", sequence_number: 99, response: payload },
              ];

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const e of events) {
              if (req.signal?.aborted) {
                controller.error(new DOMException("Aborted", "AbortError"));
                return;
              }
              controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
              // Pace the deltas so streaming is visibly streaming — but a
              // Stop mid-pace should cut the wait short, not run it to the end.
              const pace =
                e.type === "response.output_text.delta" ? 18 : e.type === "response.function_call_arguments.delta" ? 24 : 0;
              if (pace) {
                try {
                  await delay(pace, req.signal);
                } catch {
                  controller.error(new DOMException("Aborted", "AbortError"));
                  return;
                }
              }
            }
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }

      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

/**
 * Split serialized arguments into token-sized fragments. By code point, not
 * UTF-16 unit: a fragment ending in half a surrogate pair would be encoded on
 * the wire as U+FFFD and corrupt the arguments for real.
 */
function chunkArgs(json: string, size = 12): string[] {
  const chars = Array.from(json);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

/** Split text into word-ish chunks so the stream looks like a model, not a paste. */
function chunk(text: string): string[] {
  const parts = text.match(/\S+\s*/g) ?? [text];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) out.push(parts.slice(i, i + 2).join(""));
  return out;
}
