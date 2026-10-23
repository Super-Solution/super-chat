// The renderer map that pairs with core's BUILTIN_CARDS.
//
// Kept adjacent to the definitions on purpose: adding a card kind means editing
// core's BUILTIN_CARDS and this map, and the test in cards.test.ts asserts the
// two stay in sync — which is the guardrail against a card that validates but
// has nowhere to render.

import type { ComponentType } from "react";
import type { BuiltinCard, BuiltinCardKind } from "@super-solution/super-chat-core";
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

// One cast lives here instead of once per entry below: `register` still needs
// to widen a `ComponentType<CardRendererProps<SpecificCard>>` into the map's
// `ComponentType<CardRendererProps<never>>` value type (the map has to hold
// every card's renderer, so it cannot know any one of them specifically), but
// the call site stays checked — passing e.g. ChartCardView for "table" is a
// type error because ChartCardView doesn't accept a TableCard spec.
function register<K extends BuiltinCardKind>(
  kind: K,
  Renderer: ComponentType<CardRendererProps<Extract<BuiltinCard, { kind: K }>>>,
): CardRendererMap {
  return { [kind]: Renderer as CardRendererMap[string] };
}

export const BUILTIN_RENDERERS: CardRendererMap = {
  ...register("table", TableCardView),
  ...register("stats", StatsCardView),
  ...register("comparison", ComparisonCardView),
  ...register("keyvalue", KeyValueCardView),
  ...register("tree", TreeCardView),
  ...register("chart", ChartCardView),
  ...register("funnel", FunnelCardView),
  ...register("gauge", GaugeCardView),
  ...register("timeline", TimelineCardView),
  ...register("progress", ProgressCardView),
  ...register("checklist", ChecklistCardView),
  ...register("markdown", MarkdownCardView),
  ...register("document", DocumentCardView),
  ...register("callout", CalloutCardView),
  ...register("citations", CitationsCardView),
  ...register("code", CodeCardView),
  ...register("diff", DiffCardView),
  ...register("media", MediaCardView),
  ...register("choice", ChoiceCardView),
  ...register("form", FormCardView),
  ...register("confirm", ConfirmCardView),
  ...register("editreview", EditReviewCardView),
  ...register("email", EmailCardView),
};
