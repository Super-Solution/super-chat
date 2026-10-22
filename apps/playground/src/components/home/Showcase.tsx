"use client";

import { useState } from "react";
import type { CardAction, CardSpec } from "@zzyzxlabs/super-chat-core";
import { CardRenderer } from "@zzyzxlabs/super-chat-ui";
import { CARD_SAMPLES } from "@/agent/card-samples";
import styles from "./home.module.css";
import { BUDGET_GAUGE, SIGNUP_CHART, SIGNUP_FUNNEL, SIGNUP_STATS } from "./specs";

type Slot = { id: string; spec: CardSpec; wide?: boolean };

const sample = (kind: string): CardSpec => CARD_SAMPLES[kind] as CardSpec;

const TABS: { label: string; slots: Slot[] }[] = [
  { label: "Dashboards", slots: [{ id: "stats", spec: SIGNUP_STATS, wide: true }, { id: "chart", spec: SIGNUP_CHART }, { id: "funnel", spec: SIGNUP_FUNNEL }] },
  { label: "Charts", slots: [{ id: "series", spec: sample("chart"), wide: true }, { id: "gauge", spec: BUDGET_GAUGE }, { id: "risk", spec: sample("gauge") }] },
  { label: "Tables", slots: [{ id: "comparison", spec: sample("comparison"), wide: true }, { id: "table", spec: sample("table") }, { id: "keyvalue", spec: sample("keyvalue") }] },
  { label: "Decisions", slots: [{ id: "confirm", spec: sample("confirm") }, { id: "choice", spec: sample("choice") }, { id: "form", spec: sample("form") }] },
  { label: "Documents", slots: [{ id: "document", spec: sample("document") }, { id: "editreview", spec: sample("editreview") }] },
  { label: "Evidence", slots: [{ id: "citations", spec: sample("citations") }, { id: "checklist", spec: sample("checklist") }, { id: "timeline", spec: sample("timeline") }] },
];

// Every card here is the kit's own renderer. Interactive ones answer locally:
// on the site there is no run to resume, so an answer just locks the card the
// way a real answer would.
export function Showcase() {
  const [tab, setTab] = useState(0);
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const active = TABS[tab]!;

  const respond = (id: string) => (_action: Omit<CardAction, "at">) =>
    setAnswered((prev) => new Set(prev).add(id));

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Card showcase">
        {TABS.map((t, i) => (
          <button key={t.label} type="button" role="tab" aria-selected={i === tab} onClick={() => setTab(i)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.stage} role="tabpanel" aria-label={active.label}>
        {/* Keyed by tab: switching remounts the cards so they arrive in
            order, the way a streamed turn delivers them. */}
        <div key={active.label} className={styles.stageGrid}>
          {active.slots.map((s) => (
            <div key={`${active.label}_${s.id}`} className={s.wide ? styles.wide : undefined}>
              <CardRenderer
                card={{ id: `show_${s.id}`, spec: s.spec }}
                respond={respond(s.id)}
                answered={answered.has(s.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
