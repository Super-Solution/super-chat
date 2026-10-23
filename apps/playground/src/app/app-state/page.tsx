"use client";

// The app-state panel: an agent operating the PRODUCT, not just the transcript.
//
// The board below is ordinary React state with ordinary buttons — a user can
// drive it entirely without the agent. The seam adds two things: the agent
// READS the board every turn (createAppStateSource) and can ACT on it
// (createAppActionTools). Both go through machinery that already exists, so
// state is budgeted and traced like any context layer, and actions are gated
// by presets like any tool.

import { useMemo, useState } from "react";
import {
  AgentClient,
  AgentProvider,
  useAppState,
  useContextTrace,
  useThread,
} from "@super-solution/super-chat-react";
import { BUILTIN_RENDERERS, CardRendererProvider, Composer, Thread } from "@super-solution/super-chat-ui";
import {
  ContextBuilder,
  ToolRegistry,
  createAppActionTools,
  createAppStateSource,
  createBuiltinTools,
  type AppStateBinding,
} from "@super-solution/super-chat-core";
import { PanelHeader } from "@/components/Shell";
import { buildProvider, buildTransport, cards, skills } from "@/agent/setup";

type Card = { id: string; title: string; column: "todo" | "doing" | "done"; assignee: string | null };

const INITIAL: Card[] = [
  { id: "c1", title: "Draft the launch note", column: "todo", assignee: null },
  { id: "c2", title: "Fix the login redirect", column: "doing", assignee: "dana" },
  { id: "c3", title: "Archive Q1 reports", column: "todo", assignee: "sam" },
  { id: "c4", title: "Update the pricing page", column: "done", assignee: "dana" },
];

const COLUMNS: Card["column"][] = ["todo", "doing", "done"];

export default function AppStatePanel() {
  const [board, setBoard] = useState<Card[]>(INITIAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // READ half. `useAppState` keeps a ref current, so the source always reads
  // the LATEST render's value — not the value captured when the binding was
  // made, which is the stale-closure bug this seam would otherwise hit.
  const boardBinding = useAppState<Card[]>(
    "board",
    board,
    "the kanban board the user is looking at",
    { serialize: (cardsOnBoard) => cardsOnBoard.map((c) => `- ${c.id} "${c.title}" [${c.column}] ${c.assignee ?? "unassigned"}`).join("\n") },
  );
  const selectionBinding = useAppState<string | null>(
    "selection",
    selectedId,
    "the card the user has selected, if any",
    { when: (v) => v !== null, serialize: (v) => `Selected card: ${v}` },
  );

  // WRITE half. Actions mutate React state via the setter — the UI re-renders
  // normally and stays the source of truth; nothing here is a parallel store.
  const client = useMemo(() => {
    const actions = createAppActionTools([
      {
        name: "moveCard",
        description: "Move a card on the board to a different column. Use the card id from the board state.",
        inputSchema: {
          type: "object",
          required: ["id", "column"],
          properties: {
            id: { type: "string", description: "The card id, e.g. c1." },
            column: { type: "string", enum: COLUMNS, description: "Destination column." },
          },
          additionalProperties: false,
        },
        run: (input) => {
          const { id, column } = input as { id: string; column: Card["column"] };
          let moved: Card | undefined;
          setBoard((prev) =>
            prev.map((c) => {
              if (c.id !== id) return c;
              moved = { ...c, column };
              return moved;
            }),
          );
          // Return the OUTCOME — an action the model can't observe is one it repeats.
          return moved ? { moved: { id, title: moved.title, column } } : { error: `No card "${id}".` };
        },
      },
      {
        name: "assignCard",
        description: "Assign a card to someone, or pass null to unassign it.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            assignee: { type: ["string", "null"], description: "Who to assign it to, or null." },
          },
          additionalProperties: false,
        },
        run: (input) => {
          const { id, assignee } = input as { id: string; assignee?: string | null };
          setBoard((prev) => prev.map((c) => (c.id === id ? { ...c, assignee: assignee ?? null } : c)));
          return { assigned: { id, assignee: assignee ?? null } };
        },
      },
      {
        name: "selectCard",
        description: "Highlight a card in the UI so the user can see which one you mean.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
          additionalProperties: false,
        },
        run: (input) => {
          const { id } = input as { id: string };
          setSelectedId(id);
          return { selected: id };
        },
      },
    ]);

    const registry = new ToolRegistry();
    registry.registerAll(createBuiltinTools({ cards, skills }), ["observer"]);
    // Actions mutate the user's board, so they get `executor` — the same tier
    // `createAlert` needs. Toggle the preset below to watch them disappear.
    registry.registerAll(actions, ["executor"]);

    const bindings: (AppStateBinding<Card[]> | AppStateBinding<string | null>)[] = [boardBinding, selectionBinding];
    return new AgentClient({
    provider: buildProvider(buildTransport("demo"), "demo"),
      model: "gpt-5.2",
      tools: registry,
      toolResolution: { presets: ["observer", "executor"] },
      mode: "sync",
      maxSteps: 6,
      contextBuilder: new ContextBuilder({
        skills,
        contextWindow: 128_000,
        maxOutputTokens: 2_000,
        sources: [createAppStateSource(bindings)],
        identity: [
          "You operate a kanban board on behalf of the user.",
          "The board's live state is in your context — read it instead of asking what is on screen.",
          "When the user asks you to change something, use the board tools rather than describing what they should click.",
        ].join("\n"),
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dev__page">
      <PanelHeader title="App state">
        The agent reads and operates the board below. State enters context through a{" "}
        <code className="sc-mono">ContextSource</code> — budgeted and traced like every other layer, re-read every turn
        so it can never contradict the screen — and actions are ordinary{" "}
        <code className="sc-mono">ToolDefinition</code>s, so they inherit presets, confirm-suspension and deny-last for
        free. The board is plain React state: drive it by hand, then ask the agent to, and watch the same state change.
      </PanelHeader>

      <AgentProvider client={client}>
        <CardRendererProvider renderers={BUILTIN_RENDERERS}>
          <div className="dev__run">
            <div className="dev__runmain">
              <Board board={board} selectedId={selectedId} onSelect={setSelectedId} />
              <p className="dev__banner">
                Demo transport — replies are scripted, so use the buttons to change the board and read the state layer
                in the trace below. Point this panel at a real provider and the agent drives the board itself.
              </p>
              <Thread empty={<Prompts />} />
              <Composer placeholder="Move c1 to doing, assign it to sam…" />
            </div>
            <aside className="dev__runside">
              <StateLayer />
            </aside>
          </div>
        </CardRendererProvider>
      </AgentProvider>
    </div>
  );
}

function Board({
  board,
  selectedId,
  onSelect,
}: {
  board: Card[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="dev__split" style={{ gap: 12, marginBottom: 12 }}>
      {COLUMNS.map((column) => (
        <div key={column} className="sc-panel" style={{ flex: 1, padding: 10 }}>
          <div className="sc-panel__title">{column}</div>
          {board
            .filter((c) => c.column === column)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                className="dev__prompt"
                style={{ width: "100%", textAlign: "left", ...(c.id === selectedId ? { outline: "2px solid var(--sc-accent, #58a6ff)" } : {}) }}
                onClick={() => onSelect(c.id)}
              >
                <strong>{c.title}</strong>
                <span>
                  <code className="sc-mono">{c.id}</code> · {c.assignee ?? "unassigned"}
                </span>
              </button>
            ))}
          {board.filter((c) => c.column === column).length === 0 ? (
            <p className="sc-muted" style={{ fontSize: 12 }}>
              empty
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Prompts() {
  const { send } = useThread();
  const examples = [
    "What's on the board right now?",
    "Move the login redirect card to done.",
    "Assign everything in todo to dana.",
  ];
  return (
    <div className="dev__prompts">
      <p className="sc-muted" style={{ fontSize: 13, marginTop: 0 }}>
        The agent already knows the board — it is in the context layer, not the conversation.
      </p>
      {examples.map((e) => (
        <button key={e} type="button" className="dev__prompt" onClick={() => void send(e)}>
          <span>{e}</span>
        </button>
      ))}
    </div>
  );
}

/** The state layer as the model received it, straight from the trace. */
function StateLayer() {
  const trace = useContextTrace();
  const entry = trace?.entries.find((e) => e.id === "app-state");
  return (
    <div className="dev__events">
      <div className="sc-panel__title">App state in context</div>
      {entry ? (
        <div className="dev__event">
          <span className="dev__event-body">
            {entry.status}
            <div className="dev__event-detail">
              {entry.tokens} tokens · re-read every turn{entry.detail ? ` · ${entry.detail}` : ""}
            </div>
          </span>
        </div>
      ) : (
        <p className="sc-muted" style={{ fontSize: 12 }}>
          Send a message to see the board enter the context budget.
        </p>
      )}
    </div>
  );
}
