# Run the agent on your server

By default a turn runs where the client is: `AgentClient` calls `runAgent`, which calls the model
through a transport and runs the tools in this process. Some products cannot work that way. The
loop has to keep going when the tab closes, pick up after a deploy, reach tools that only exist on
the server, or wait a day for someone to approve a step.

For those, the loop lives on your server and the client only follows it. `AgentClient` takes a
`runner` for this: a function that starts a turn on the server and yields what the server reports as
`RunEvent`s. The store, the hooks and the card renderers do not change, because they only ever saw
events.

```
        in this process (default)                 on your server (runner)

AgentClient ── runAgent ── provider         AgentClient ── runner ══ your API ── your loop
     │                                           │
     └── RunEvents ── store ── UI                └── RunEvents ── store ── UI
```

## Give the client a runner

```ts
import { AgentClient, serverRunConfig, type TurnRunner } from "@supersolutions/super-chat-client";
import { parseSSE, type RunEvent } from "@supersolutions/super-chat-core";

const runner: TurnRunner = async function* (messages, config, turn) {
  const response = await fetch(`/api/threads/${turn.threadId}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: turn.kind, message: messages.at(-1) }),
    signal: config.signal,
  });
  if (!response.ok || !response.body) throw new Error(`The server refused the turn (${response.status}).`);

  for await (const frame of parseSSE(response.body)) {
    yield JSON.parse(frame.data) as RunEvent; // or map your own event names to RunEvents here
  }
};

const client = new AgentClient(serverRunConfig({ runner, cards, threadStore }));
```

`serverRunConfig` fills the parts of the config that describe a local loop (provider, context
builder, tools) with inert values. Nothing in a server-run turn reaches them, and the provider
refuses with a sentence if something tries.

The runner is called with:

| argument | what it is |
| --- | --- |
| `messages` | The active path of the thread, the new user message last. A server that keeps its own history needs only that last one. |
| `config.signal` | Aborts when the client stops reading this turn. Pass it to `fetch`. |
| `config.onUserDecision` | Resolves with the person's answer to a card. See [Cards that wait](#cards-that-wait-for-the-person). |
| `config.forceSkillIds` | Skills the person pinned for this turn, if your server has the same notion. |
| `turn.threadId` | The thread, as the client knows it. |
| `turn.kind` | What started the turn: `send`, `regenerate`, `edit`, `surface-event` or `resume`. |
| `turn.stopRequested` | Whether the person asked for the stop. See [Stop is not leave](#stop-is-not-leave). |

A throw becomes the turn's error. If your server cannot do something the client offers, such as
`regenerate` on a history it does not fork, throw from that kind and hide the control.

## What to yield

The same events `runAgent` yields, with the same ordering rules (they are at the top of
`packages/core/src/runtime/events.ts`). A minimal turn is:

```
run-start → text-delta … → run-finish
```

A tool the server ran is `tool-call` then `tool-result` with the same `callId`. A card is `card`.
Usage for the turn goes on `run-finish`, which is also what marks the turn done; a turn that failed
on the server is `error` (with `recoverable: false`) followed by `run-finish` with
`finishReason: "error"`.

When the generator returns, the client commits what it folded as one assistant message, exactly as
it does for a local turn.

## Cards that wait for the person

A step that needs approval, or a question with choices, suspends the turn on the server. The runner
shows the card, waits for the answer through the client, passes it on, and says so:

```ts
yield { type: "awaiting-user", callId, card };
const action = await config.onUserDecision!(callId, card);   // resolved by client.respond(action)
await fetch(`/api/turns/${turnId}/cards/${card.id}`, { method: "POST", body: JSON.stringify(action) });
yield { type: "user-responded", callId, action };
```

Await `onUserDecision` once for each `awaiting-user` you yield. Give the card a `callId`; it is how
the answer finds its way back.

## Stop is not leave

`config.signal` aborts in two different situations, and a server-run turn must treat them
differently:

| what happened | `turn.stopRequested` | a pending `onUserDecision` | what the server should do |
| --- | --- | --- | --- |
| The person pressed stop, or cleared the thread | `true` | resolves as a `cancel` answer | cancel the turn |
| The person opened another thread | `false` | rejects with an `AbortError` | nothing: the turn keeps running |

```ts
try {
  for await (const frame of parseSSE(response.body)) yield JSON.parse(frame.data) as RunEvent;
} finally {
  if (turn.stopRequested) void fetch(`/api/turns/${turnId}/cancel`, { method: "POST" });
}
```

Closing the tab aborts nothing. The turn carries on, and the next page load can follow it.

## Follow a turn that is already running

After a reload, or when the server started a turn by itself, call `resume()`:

```ts
if (thread.hasLiveTurn) await client.resume();
```

The runner is called with `kind: "resume"`. It connects to the live turn and yields its events. The
client was not there for the beginning, so the first thing to yield is usually a `run-snapshot`:

```ts
yield { type: "run-snapshot", parts, cards, usage, steps };
```

A snapshot **replaces** what the client holds for the turn: the content parts so far, the cards so
far, and optionally the usage and step count. Tool calls it shows as `running` are pending again;
argument previews are dropped. The same event recovers a stream that dropped mid-turn when your
server cannot replay every event the client missed: reconnect, yield a snapshot, carry on.

If a card was waiting when the snapshot was taken, yield `awaiting-user` for it again after the
snapshot, and await `onUserDecision` again.

Yielding nothing means there was nothing to follow, and the thread is left as it was. The thread
reads as running until the runner returns, so call `resume()` when you have reason to think a turn
is live rather than on every mount. On a client without a `runner` it does nothing.

## History

The server owns the conversation, so load threads from it. Pass a `threadStore` whose `load` reads
your API (`createRestThreadStore` covers the common shape), and make `save` a no-op if the server
already records each turn. `client.openThread(id)` then shows a stored thread, and `resume()`
follows its live turn if it has one.

## Limits

- A surface's **tool** actions run tools in this process, and a server-run client has none, so they
  are refused. Its **event** actions reach the runner as a turn of kind `surface-event`.
- Background jobs (`jobStore`, `resumeBackgroundJobs`) are the provider-side mechanism for a local
  loop. A server-run turn does not need them: the turn itself outlives the page.
- The context trace and the tool list in the inspector hooks are empty unless your server sends
  `context-built`.
