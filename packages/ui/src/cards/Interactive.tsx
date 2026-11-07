"use client";

// Interactive cards — the agent asking rather than assuming.
//
// Each of these blocks a suspended tool call. Two consequences the markup has to
// respect:
//   • they must never be rendered inside a collapsed group. A hidden confirm
//     dialog is an unanswerable question, and the run just looks hung.
//   • once answered they stay visible but disabled, so the transcript records
//     what the user actually chose.

import { useState } from "react";
import type { ChoiceCard, ConfirmCard, FormCard, FormField } from "@super-solution/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";
import { formatValue, toneClass } from "../format.js";

export function ChoiceCardView({ spec, card, respond, answered }: CardRendererProps<ChoiceCard>) {
  // `card.action` is the durable record; local state only covers the gap between
  // answering and the turn committing.
  const recorded = card.action?.type === "select" ? ((card.action.value as { selected?: string[] })?.selected ?? []) : null;
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string[] | null>(null);
  const done = answered || submitted !== null || card.action != null;

  const toggle = (id: string) => {
    if (done) return;
    setSelected((prev) => (spec.multiple ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]));
  };

  const submit = (ids: string[]) => {
    if (done || !ids.length) return;
    setSubmitted(ids);
    respond?.({ cardId: card.id, callId: card.callId, kind: "choice", type: "select", value: { selected: ids } });
  };

  return (
    <div className="sc-card sc-card--interactive">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      {spec.prompt ? <p className="sc-card__prompt">{spec.prompt}</p> : null}

      <div className="sc-choices" role={spec.multiple ? "group" : "radiogroup"}>
        {spec.options.map((opt) => {
          const isSelected = (recorded ?? submitted ?? selected).includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={`sc-choice${isSelected ? " sc-choice--selected" : ""}`}
              disabled={done || opt.disabled}
              title={opt.disabled ? opt.disabledReason : undefined}
              aria-pressed={isSelected}
              onClick={() => (spec.multiple ? toggle(opt.id) : submit([opt.id]))}
            >
              {opt.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sc-choice__img" src={opt.imageUrl} alt="" loading="lazy" />
              ) : null}
              <span className="sc-choice__body">
                <span className="sc-choice__label">{opt.label}</span>
                {opt.description ? <span className="sc-muted sc-choice__desc">{opt.description}</span> : null}
                {opt.disabled && opt.disabledReason ? (
                  <span className="sc-choice__desc sc-tone--warning">{opt.disabledReason}</span>
                ) : null}
              </span>
              {opt.meta?.length ? (
                <span className="sc-choice__meta">
                  {opt.meta.map((m, i) => (
                    <span key={i} className="sc-choice__metaitem">
                      <span className="sc-muted">{m.label}</span>
                      <strong>{formatValue(m.value, m.format)}</strong>
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {spec.multiple && !done ? (
        <div className="sc-card__actions">
          <button type="button" className="sc-btn sc-btn--primary" disabled={!selected.length} onClick={() => submit(selected)}>
            Confirm selection ({selected.length})
          </button>
          <button
            type="button"
            className="sc-btn sc-btn--ghost"
            onClick={() => {
              setSubmitted([]);
              respond?.({ cardId: card.id, callId: card.callId, kind: "choice", type: "cancel" });
            }}
          >
            Skip
          </button>
        </div>
      ) : null}

      {done ? (
        <div className="sc-muted sc-card__footnote">
          {card.action?.type === "cancel" || card.action?.type === "dismiss" ? "Skipped." : "Answered."}
        </div>
      ) : null}
    </div>
  );
}

function initialValues(fields: FormField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "boolean") out[f.name] = f.value ?? false;
    else if (f.type === "number") out[f.name] = f.value ?? "";
    else if (f.type === "select") out[f.name] = f.value ?? f.options[0]?.value ?? "";
    else out[f.name] = f.value ?? "";
  }
  return out;
}

export function FormCardView({ spec, card, respond, answered }: CardRendererProps<FormCard>) {
  // Submitted values come from the card once recorded — rendering the spec's
  // defaults after the fact would show values the user never entered.
  const recorded = card.action?.type === "submit" ? (card.action.value as Record<string, unknown> | undefined) : undefined;
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(spec.fields));
  const [submitted, setSubmitted] = useState(false);
  const done = answered || submitted || card.action != null;
  const shown = recorded ?? values;

  const missing = spec.fields.filter(
    (f) => "required" in f && f.required && (values[f.name] === "" || values[f.name] == null),
  );

  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  return (
    <form
      className="sc-card sc-card--interactive"
      onSubmit={(e) => {
        e.preventDefault();
        if (done || missing.length) return;
        setSubmitted(true);
        // Coerce number fields before handing them back — the model asked for a
        // number and an input always yields a string.
        const coerced: Record<string, unknown> = { ...values };
        for (const f of spec.fields) if (f.type === "number" && coerced[f.name] !== "") coerced[f.name] = Number(coerced[f.name]);
        respond?.({ cardId: card.id, callId: card.callId, kind: "form", type: "submit", value: coerced });
      }}
    >
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      {spec.description ? <p className="sc-card__prompt">{spec.description}</p> : null}

      <div className="sc-form">
        {spec.fields.map((f) => (
          <label key={f.name} className="sc-field">
            <span className="sc-field__label">
              {f.label}
              {"required" in f && f.required ? <span className="sc-tone--negative"> *</span> : null}
            </span>
            {f.type === "textarea" ? (
              <textarea
                className="sc-input"
                rows={3}
                disabled={done}
                placeholder={f.placeholder}
                value={String(shown[f.name] ?? "")}
                onChange={(e) => set(f.name, e.target.value)}
              />
            ) : f.type === "select" ? (
              <select className="sc-input" disabled={done} value={String(shown[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "boolean" ? (
              <input type="checkbox" disabled={done} checked={Boolean(shown[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
            ) : (
              <span className="sc-input-group">
                <input
                  className="sc-input"
                  type={f.type === "number" ? "number" : "text"}
                  disabled={done}
                  placeholder={"placeholder" in f ? f.placeholder : undefined}
                  min={f.type === "number" ? f.min : undefined}
                  max={f.type === "number" ? f.max : undefined}
                  step={f.type === "number" ? f.step : undefined}
                  value={String(shown[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                />
                {f.type === "number" && f.suffix ? <span className="sc-input-group__suffix">{f.suffix}</span> : null}
              </span>
            )}
          </label>
        ))}
      </div>

      {!done ? (
        <div className="sc-card__actions">
          <button type="submit" className="sc-btn sc-btn--primary" disabled={missing.length > 0}>
            {spec.submitLabel ?? "Submit"}
          </button>
          <button
            type="button"
            className="sc-btn sc-btn--ghost"
            onClick={() => {
              setSubmitted(true);
              respond?.({ cardId: card.id, callId: card.callId, kind: "form", type: "cancel" });
            }}
          >
            Cancel
          </button>
          {missing.length ? <span className="sc-muted">{missing.length} required field(s) left.</span> : null}
        </div>
      ) : (
        <div className="sc-muted sc-card__footnote">{card.action?.type === "cancel" ? "Cancelled." : "Submitted."}</div>
      )}
    </form>
  );
}

export function ConfirmCardView({ spec, card, respond, answered }: CardRendererProps<ConfirmCard>) {
  const [local, setLocal] = useState<"confirm" | "cancel" | null>(null);
  // The recorded action wins: after the turn commits this card re-mounts with no
  // local state, and guessing there once made a confirmed action read "Declined."
  const recorded = card.action?.type === "confirm" ? "confirm" : card.action ? "cancel" : null;
  const decision = recorded ?? local;
  const done = answered || decision !== null;

  const decide = (type: "confirm" | "cancel") => {
    if (done) return;
    setLocal(type);
    respond?.({ cardId: card.id, callId: card.callId, kind: "confirm", type, value: type === "confirm" ? { confirmed: true } : undefined });
  };

  return (
    <div className={`sc-card sc-card--interactive${spec.danger ? " sc-card--danger" : ""}`}>
      <div className="sc-card__title">{spec.title}</div>
      {spec.description ? <p className="sc-card__prompt">{spec.description}</p> : null}

      <dl className="sc-kv">
        {spec.summary.map((row, i) => (
          <div key={i} className="sc-kv__row">
            <dt>{row.label}</dt>
            <dd className={`${row.mono ? "sc-mono" : ""}${toneClass(row.tone)}`}>{formatValue(row.value)}</dd>
          </div>
        ))}
      </dl>

      {!done ? (
        <div className="sc-card__actions">
          <button type="button" className={`sc-btn ${spec.danger ? "sc-btn--danger" : "sc-btn--primary"}`} onClick={() => decide("confirm")}>
            {spec.confirmLabel ?? "Confirm"}
          </button>
          <button type="button" className="sc-btn sc-btn--ghost" onClick={() => decide("cancel")}>
            {spec.cancelLabel ?? "Cancel"}
          </button>
        </div>
      ) : (
        <div
          className={`sc-card__footnote ${decision === "confirm" ? "sc-tone--positive" : decision === "cancel" ? "sc-tone--warning" : "sc-muted"}`}
        >
          {/* No recorded decision means we genuinely do not know — say so rather
              than asserting one of the two outcomes. */}
          {decision === "confirm" ? "Confirmed." : decision === "cancel" ? "Declined." : "Answered."}
        </div>
      )}
    </div>
  );
}