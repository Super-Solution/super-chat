# Cards beside the chat

A card is content: a `{ kind, spec }` the agent made. Where it is shown is a separate choice. Most
cards belong in the conversation, but a chart someone will pan and draw on, or a long document, needs
more room than a message. The side panel gives it that room without leaving the chat.

```
┌──────────────── chat ────────────────┐ ┌──────────── panel ────────────┐
│ user: how did BTC do this week?      │ │ BTC weekly                  ✕ │
│ agent: up 4%, mostly on Tuesday.     │ │                               │
│ ┌──────────────────────────────────┐ │ │   (the full chart, with its   │
│ │ ▣ BTC weekly                     │ │ │    toolbar and drawing tools) │
│ │   Opened beside the chat  [Open] │ │ │                               │
│ └──────────────────────────────────┘ │ │                               │
└──────────────────────────────────────┘ └───────────────────────────────┘
```

The placement values come from super-protocol (`CardPlacement`, see its `docs/CARD-PLACEMENT.md`):
`inline` in the conversation, `panel` beside it, `document` inside an editor document. A chat uses
the first two.

## Let the agent choose

`visualize` takes a `placement` only when the host says it has a panel:

```ts
import { createBuiltinTools } from "@supersolutions/super-chat-core";

const tools = createBuiltinTools({ cards, placements: ["inline", "panel"] });
```

The tool's description then tells the model when to use the panel (a chart to work with, a long
document) and when not to (a few figures, a short table). Without `placements` the tool, its schema
and its description are exactly as before.

Rules the tool enforces, whatever the model sends:

- An interactive card (`choice`, `form`, `confirm`, or a plugin kind marked interactive) always stays
  in the chat, because it waits for an answer there. `canPlaceCard` in super-protocol is the same rule.
- A `placement` the host did not enable is refused with a message the model can act on.
- A panel card is not previewed while it streams. It opens once it is whole.

Any other tool can open its card in the panel too, by returning `placement: "panel"` next to its
`card`:

```ts
return { output: { ok: true }, card: { kind: "super-chart.chart", feed: { id: "BTC" } }, placement: "panel" };
```

The placement is stored on the card (`Card.placement`) and in the tool output's `$card`, so a reload
shows the same layout. A card revised with `updateCard` keeps its placement.

## Put the panel in your layout

The panel is state and one component. Where it sits (a column, a drawer, a bottom sheet) is your
layout:

```tsx
import { ChatPanel, ChatPanelProvider, Thread } from "@supersolutions/super-chat-ui";

<AgentProvider client={client}>
  <ChatPanelProvider labels={{ opened: "已在側邊開啟", open: "打開" }}>
    <div className="layout">
      <Thread />
      <aside className="layout__side">
        <ChatPanel />
      </aside>
    </div>
  </ChatPanelProvider>
</AgentProvider>
```

- Inside a `ChatPanelProvider`, a panel card leaves a short line in the thread with its title and an
  **Open** button. The card itself is drawn in `ChatPanel`.
- A panel card that arrives during a running turn opens by itself (`autoOpen`, default true). Cards
  already in a thread when it is shown do not, so opening an old thread never jumps the layout.
- `ChatPanel` fills its container: give the column its height. It draws the card's title and a close
  button. `header={false}` drops them, and a render function replaces the drawing:
  `<ChatPanel>{(card) => <MyChrome card={card} />}</ChatPanel>`.
- `onChange(card | null)` fires when the panel opens or closes, for a layout that resizes around it.
  `initialCard` starts it open, for a layout you restore.
- `useChatPanel()` gives `{ card, open, close }`, for your own buttons.

Without a provider nothing changes: a panel card is drawn in the conversation like any other.

## What the card sees

The same renderer draws the card in both places. It is told where it is drawn: built-in renderers get
a `placement` prop, and a plugin card's mount gets `placement` in its `CardMountContext` (and on
`update` when it moves). A chart can show a compact card in the chat and its full toolbar in the
panel. A mount that ignores it keeps working.

A plugin says which of its card kinds are made for the panel with a `panel` capability that names
the kind:

```ts
capabilities: [
  { id: "chart.card", surface: "card", cardKind: "super-chart.chart" },
  { id: "chart.panel", surface: "panel", cardKind: "super-chart.chart" },
];
```

`installChatPlugin` lists those kinds in its report as `panelKinds`. A `panel` capability that names
no kind is still reported in `unsupportedSurfaces`.
