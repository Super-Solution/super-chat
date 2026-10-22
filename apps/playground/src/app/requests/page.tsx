"use client";

import { useMemo, useState } from "react";
import {
  buildChatRequest,
  buildResponsesRequest,
  type Message,
  type NormalizedRequest,
} from "@super-solution/super-chat-core";
import { PanelHeader } from "@/components/Shell";

// Scenarios chosen to expose the places the two dialects actually disagree.
const SCENARIOS: Record<string, { note: string; build: () => NormalizedRequest }> = {
  "Text + tools": {
    note: "The baseline. Note the tool shape: Responses puts name/parameters at the top level, Chat Completions nests them under `function`. Sending one to the other is a guaranteed 400.",
    build: () => ({
      model: "gpt-5.2",
      system: "You are a research assistant.",
      messages: [msg("user", [{ type: "text", text: "Which vendor should we pick?" }])],
      tools: [
        { name: "compareCompetitors", description: "Positioning matrix.", parameters: { type: "object", properties: { against: { type: "array", items: { type: "string" } } } } },
      ],
      maxOutputTokens: 2000,
    }),
  },
  "Image attachment": {
    note: "Responses uses `input_image` with a data URL; Chat Completions uses `image_url` with a nested object. Same normalized part, two encodings.",
    build: () => ({
      model: "gpt-5.2",
      messages: [
        msg("user", [
          { type: "text", text: "What's wrong with this layout?" },
          { type: "image", source: { kind: "base64", data: "iVBORw0KGgoAAAANSUhEUg==" }, mediaType: "image/png", detail: "high" },
        ]),
      ],
    }),
  },
  "Tool call round-trip": {
    note: "Responses emits `function_call` / `function_call_output` as flat input items; Chat Completions uses assistant `tool_calls` plus a separate `role:\"tool\"` message. Both must stay paired or the request is rejected.",
    build: () => ({
      model: "gpt-5.2",
      messages: [
        msg("user", [{ type: "text", text: "Check GDPR readiness." }]),
        msg("assistant", [{ type: "tool-call", callId: "call_1", name: "checkCompliance", input: { framework: "gdpr" }, status: "done" }]),
        msg("tool", [{ type: "tool-result", callId: "call_1", name: "checkCompliance", output: { open: 3 } }]),
      ],
      tools: [{ name: "checkCompliance", description: "Framework readiness.", parameters: { type: "object", properties: { framework: { type: "string" } } } }],
    }),
  },
  "Orphaned tool call": {
    note: "A cancelled turn leaves a call with no result. Replaying it unfixed makes the provider reject the whole thread — permanently. Both builders drop the orphan instead, costing one lost step and keeping the conversation alive.",
    build: () => ({
      model: "gpt-5.2",
      messages: [
        msg("user", [{ type: "text", text: "Review the MSA." }]),
        msg("assistant", [
          { type: "text", text: "Checking…" },
          { type: "tool-call", callId: "orphan_1", name: "reviewContract", input: { document: "MSA" }, status: "pending" },
        ]),
      ],
      tools: [{ name: "reviewContract", description: "Review an agreement.", parameters: { type: "object" } }],
    }),
  },
  "Background job": {
    note: "Responses only. `store` is forced true even if the caller asked for false — a background response is polled by id, and without server-side storage the job could never be read back. Chat Completions has no equivalent at all.",
    build: () => ({
      model: "gpt-5.2",
      messages: [msg("user", [{ type: "text", text: "Do a deep research pass." }])],
      background: true,
      store: false,
    }),
  },
  "Reasoning + JSON schema": {
    note: "Responses nests the format under `text.format`; Chat Completions uses `response_format.json_schema` with an extra wrapper level. Reasoning effort is a top-level field in both but under different names.",
    build: () => ({
      model: "gpt-5.2",
      messages: [msg("user", [{ type: "text", text: "Extract the parties." }])],
      reasoning: { effort: "high", summary: "auto" },
      responseFormat: {
        type: "json_schema",
        name: "parties",
        schema: { type: "object", properties: { parties: { type: "array", items: { type: "string" } } }, required: ["parties"] },
        strict: true,
      },
    }),
  },
  "Server-side history": {
    note: "With `previousResponseId` the provider already holds everything up to that response, so only the new tail is sent — a large saving on long tool loops. Chat Completions ignores it and resends the lot, which is why the seam is a capability flag rather than an assumption.",
    build: () => ({
      model: "gpt-5.2",
      previousResponseId: "resp_abc123",
      messages: [
        msg("user", [{ type: "text", text: "First question" }]),
        msg("assistant", [{ type: "text", text: "First answer" }]),
        msg("user", [{ type: "text", text: "Follow-up question" }]),
      ],
    }),
  },
};

let n = 0;
function msg(role: Message["role"], parts: Message["parts"]): Message {
  n += 1;
  return { id: `${role}_${n}`, role, parts };
}

export default function RequestsPanel() {
  const [scenario, setScenario] = useState(Object.keys(SCENARIOS)[0]!);
  const [streaming, setStreaming] = useState(false);

  const { normalized, responses, chat, chatError } = useMemo(() => {
    const req = SCENARIOS[scenario]!.build();
    let chatBody: unknown = null;
    let err: string | null = null;
    try {
      chatBody = buildChatRequest(req, { stream: streaming });
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    return {
      normalized: req,
      responses: buildResponsesRequest(req, { stream: streaming }),
      chat: chatBody,
      chatError: err,
    };
  }, [scenario, streaming]);

  return (
    <div className="dev__page">
      <PanelHeader title="Wire requests">
        One normalized request, rendered into both OpenAI dialects. They are implemented as separate builders sharing no
        object literals, because conflating them is the single largest source of 400s — and because a framework that
        claims to &ldquo;craft requests correctly&rdquo; should let you check.
      </PanelHeader>

      <div className="dev__row">
        <select className="dev__select" value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {Object.keys(SCENARIOS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <label className="dev__toggle">
          <input type="checkbox" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} />
          streaming
        </label>
      </div>

      <p className="dev__section-note">{SCENARIOS[scenario]!.note}</p>

      <section className="dev__section" style={{ marginTop: 18 }}>
        <h2 className="dev__section-title">Input — NormalizedRequest</h2>
        <pre className="sc-pre dev__code" style={{ maxHeight: 300 }}>
          {JSON.stringify(normalized, null, 2)}
        </pre>
      </section>

      <div className="dev__split" style={{ marginTop: 22 }}>
        <div className="dev__spec">
          <div className="dev__spec-label">POST /v1/responses</div>
          <pre className="sc-pre dev__code" style={{ maxHeight: 560 }}>
            {JSON.stringify(responses, null, 2)}
          </pre>
        </div>
        <div className="dev__spec">
          <div className="dev__spec-label">POST /v1/chat/completions</div>
          {chatError ? (
            <div className="sc-card sc-card--error">
              <strong>Rejected:</strong> {chatError}
            </div>
          ) : (
            <pre className="sc-pre dev__code" style={{ maxHeight: 560 }}>
              {JSON.stringify(chat, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <section className="dev__section">
        <h2 className="dev__section-title">Where they disagree</h2>
        <div className="sc-table-wrap">
          <table className="sc-table">
            <thead>
              <tr>
                <th />
                <th>Responses</th>
                <th>Chat Completions</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["history field", "input[]", "messages[]"],
                ["system", "instructions (top level)", "a message with role system"],
                ["user text part", "input_text", "text"],
                ["image part", "input_image", "image_url"],
                ["file part", "input_file", "file"],
                ["assistant text", "output_text", "content: string"],
                ["tool declaration", "flat { type, name, parameters }", "nested { type, function: {…} }"],
                ["model tool call", "input item function_call", "assistant.tool_calls[]"],
                ["tool output", "input item function_call_output", 'message role:"tool" + tool_call_id'],
                ["output cap", "max_output_tokens", "max_completion_tokens"],
                ["JSON schema", "text.format", "response_format.json_schema"],
                ["reasoning", "reasoning.effort", "reasoning_effort"],
                ["streamed usage", "always included", "needs stream_options.include_usage"],
                ["async", "background: true + polling", "— none"],
                ["server history", "previous_response_id", "— none"],
              ].map(([k, a, b]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>
                    <code className="sc-mono">{a}</code>
                  </td>
                  <td>
                    <code className="sc-mono">{b}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
