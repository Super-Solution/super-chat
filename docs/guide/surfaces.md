# Surfaces

A card is one presentation the agent picks. A surface is an interface the agent
assembles: filters beside the chart they filter, totals that follow both, and a
button that asks the agent to look again. Cards remain, as blocks inside it.

Try it with no API key: `pnpm dev`, then open `/surfaces`.

## Enable it

Surfaces are opt-in. A host that does nothing sees no new tools.

```ts
import { AgentClient } from "@supersolutions/super-chat-client";
import {
  BUILTIN_CARDS, CardRegistry, ContextBuilder, SkillRegistry, SurfaceCatalogue, ToolRegistry,
  createLoadSkillTool, createSurfaceContextSource, createSurfaceSkill, createSurfaceTools,
} from "@supersolutions/super-chat-core";

const cards = new CardRegistry(BUILTIN_CARDS);
const catalogue = new SurfaceCatalogue({ cards });
const skills = new SkillRegistry([createSurfaceSkill(catalogue)]);

const tools = new ToolRegistry();
tools.registerAll([...createSurfaceTools({ catalogue }), createLoadSkillTool(skills)], ["observer"]);

const contextBuilder = new ContextBuilder({ skills, sources: [createSurfaceContextSource()] });
const client = new AgentClient({ /* provider, model */ contextBuilder, tools, toolResolution: { presets: ["observer"] }, cards, surfaceCatalogue: catalogue });
```

`BUILTIN_RENDERERS` already includes the renderer, so surfaces appear in `<Thread>`.

## The format

A flat list of components that reference each other by id.

```json
{
  "surfaceId": "overview",
  "title": "Overview",
  "data": { "region": "all", "rows": [{ "region": "emea", "amount": 120 }, { "region": "apac", "amount": 80 }] },
  "root": "main",
  "components": [
    { "id": "main", "component": "Stack", "children": ["region", "total", "ask"] },
    {
      "id": "region", "component": "Select", "label": "Region", "value": { "$path": "/region" },
      "options": [{ "value": "all", "label": "All" }, { "value": "emea", "label": "EMEA" }, { "value": "apac", "label": "APAC" }]
    },
    {
      "id": "total", "component": "Metric", "label": "Total", "format": "number",
      "value": { "$query": {
        "from": "/rows",
        "where": [{ "field": "region", "value": { "$path": "/region" }, "ignore": "all" }],
        "aggregate": { "op": "sum", "field": "amount" }
      } }
    },
    { "id": "ask", "component": "Button", "label": "Review this", "action": { "type": "event", "name": "review", "context": { "region": { "$path": "/region" } } } }
  ]
}
```

Choosing a region changes the total in the browser. No model is called.

### Components

| Group | Components |
|-------|------------|
| Layout | `Stack`, `Grid`, `Section`, `Tabs`, `List`, `Divider` |
| Display | `Text`, `Metric`, `Badge`, `Image`, `Link` |
| Input | `Field`, `Select`, `Toggle`, `Slider` |
| Action | `Button` |
| Cards | `Card` with any registered `kind`, plugin kinds included |
| Host | Anything passed to `catalogue.register()` |

### Bindings

| Form | Reads |
|------|-------|
| `{ "$path": "/a/b" }` | A value in the data model (JSON Pointer) |
| `{ "$template": "Spend in {/region}" }` | A string with values interpolated. `{.field}` reads the current row |
| `{ "$query": { "from": "/rows", "where": [], "groupBy": "month", "aggregate": { "op": "sum", "field": "n" } } }` | Filtered, grouped or aggregated rows |
| `{ "$item": "field" }` | A field of the current row, inside a `List` template |

`visibleWhen` shows a component conditionally. Controls write to their `value` path.

### Actions

Only `Button`, and an interactive `Card` once answered, can start one. Nothing fires on load.

| Type | Effect |
|------|--------|
| `set` | Updates local state |
| `tool` | Calls a tool the enabled presets allow. Same executor, approval cards and metering as a model's call |
| `event` | Sends the agent a new turn with the bound context |

## Agent tools

| Tool | Purpose |
|------|---------|
| `describeSurfaceComponents` | The guide, the index, or specific schemas within a token budget |
| `createSurface` | Build a surface. Streams as it is written |
| `updateSurface` | Patch: `upsertComponents`, `removeComponents`, `setRoot`, `setTitle`, `setData`, `removeData` |
| `readSurface` | Current state, including what the person changed |
| `deleteSurface` | Remove it |

Invalid parts do not sink the surface. The valid parts render, the person sees a
fallback where a part was refused, and the tool result tells the model what to fix.

## Placing a surface yourself

```tsx
<SurfaceHostProvider placement={() => "elsewhere"} catalogue={catalogue}>
  <Thread />
  <aside><AgentSurface surfaceId="overview" /></aside>
</SurfaceHostProvider>
```

The thread then shows a pointer in place of the surface. `useSurfaces()` lists what is
open, and `SurfaceView` renders a spec with no client at all.

Host components need a renderer under the same name:

```tsx
<SurfaceHostProvider catalogue={catalogue} components={{ Ticker: ({ props }) => <b>{String(props.symbol)}</b> }}>
```

## Safety

- The model sends data from a closed vocabulary: no code, HTML, CSS or script URLs.
- Props are enumerated, so `style`, `className` and `onClick` are refused as unknown.
- Specs are validated when written and again when rendered from storage.
- `tool` actions are authorised at the press, from presets and `deny`. A skill's
  `allow` does not extend to buttons, and the surface tools cannot be called by one.
- A value read from data is never evaluated as a binding.

## Limits

200 components, 16 levels deep, 64,000 characters of data, 200 rendered list rows,
24 surfaces per thread. `$query` reads the first 2,000 rows.

`toA2uiMessages(spec)` exports a surface as A2UI v0.9.1 messages. The export is
one-way. `$query`, `set` and `tool` have no A2UI equivalent and travel as namespaced
calls that a receiving client would have to implement.
