// The renderer map that pairs with core's BUILTIN_CARDS.
//
// Kept adjacent to the definitions on purpose: adding a card kind means editing
// core's BUILTIN_CARDS and this map, and the test in cards.test.ts asserts the
// two stay in sync — which is the guardrail against a card that validates but
// has nowhere to render.

import type { ComponentType } from "react";
import type { BuiltinCard, BuiltinCardKind } from "@supersolutions/super-chat-core";
import type { CardRendererMap, CardRendererProps } from "../renderer-registry.js";
import {
  CodeCardView,
  DiffCardView,
  KeyValueCardView,
  MarkdownCardView,
  MediaCardView,
  ProgressCardView,
  StatsCardView,
  TableCardView,
  TimelineCardView,
} from "./Basic.js";
import { ChartCardView } from "./Chart.js";
import { DocumentCardView } from "./Document.js";
import { EditReviewCardView } from "./EditReview.js";
import { EmailCardView } from "./Email.js";
import {
  CalloutCardView,
  ChecklistCardView,
  CitationsCardView,
  ComparisonCardView,
  FunnelCardView,
  GaugeCardView,
  TreeCardView,
} from "./General.js";
import { ChoiceCardView, ConfirmCardView, FormCardView } from "./Interactive.js";
import { SurfaceCardView } from "../surfaces/AgentSurface.js";

// Each renderer is checked against its kind (passing ChartCardView for "table" is a type error,
// because it does not accept a TableCard), and a kind with no renderer is one too. The map is a
// plain object of identifiers on purpose: a call or a spread here would be a statement a bundler
// must run, which keeps every card view in a page that imported none of them.
type Renderers = {
  [K in BuiltinCardKind]: ComponentType<CardRendererProps<Extract<BuiltinCard, { kind: K }>>>;
} & {
  // Not a kind `visualize` can pick: surfaces arrive through their own tools.
  surface: ComponentType<CardRendererProps<never>>;
};

const RENDERERS: Renderers = {
  table: TableCardView,
  stats: StatsCardView,
  comparison: ComparisonCardView,
  keyvalue: KeyValueCardView,
  tree: TreeCardView,
  chart: ChartCardView,
  funnel: FunnelCardView,
  gauge: GaugeCardView,
  timeline: TimelineCardView,
  progress: ProgressCardView,
  checklist: ChecklistCardView,
  markdown: MarkdownCardView,
  document: DocumentCardView,
  callout: CalloutCardView,
  citations: CitationsCardView,
  code: CodeCardView,
  diff: DiffCardView,
  media: MediaCardView,
  choice: ChoiceCardView,
  form: FormCardView,
  confirm: ConfirmCardView,
  editreview: EditReviewCardView,
  email: EmailCardView,
  surface: SurfaceCardView as Renderers["surface"],
};

/** The map's own value type has to hold every card's renderer, so it cannot know any one of them. */
export const BUILTIN_RENDERERS = RENDERERS as unknown as CardRendererMap;
