"use client";

// The agent composer: a rich prompt input with skill pills, a slash palette,
// attachments, a model picker and an optional "improve this prompt" step.
//
// The editor is a contenteditable rather than a textarea because skill pills
// have to sit inline with the text and delete as a unit. `value` mirrors the
// editor's plain text so the empty/send logic never has to walk the DOM.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

/* ── icons ────────────────────────────────────────────────────────────────── */

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <path d="M12 5v14M5 12h14" {...s} />
  </svg>
);
const IconArrowUp = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" {...s} strokeWidth={2} />
  </svg>
);
const IconStop = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);
const IconPaperclip = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" {...s} />
  </svg>
);
const IconImage = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" {...s} />
    <circle cx="8.5" cy="8.5" r="1.5" {...s} />
    <path d="m21 15-5-5L5 21" {...s} />
  </svg>
);
const IconBook = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" {...s} />
  </svg>
);
const IconChevronRight = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="m9 18 6-6-6-6" {...s} />
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="m4.5 12.75 6 6 9-13.5" {...s} strokeWidth={2} />
  </svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" {...s} strokeWidth={1.5} />
  </svg>
);
const IconSparkle = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" {...s} />
  </svg>
);

/* ── types ────────────────────────────────────────────────────────────────── */

export interface AgentModel {
  id: string;
  name: string;
  desc?: string;
  context?: string;
  icon?: ReactNode;
}

export interface AgentSkill {
  id: string;
  name: string;
  desc?: string;
}

export interface AgentAttachment {
  id: string;
  name: string;
  kind: "image" | "file";
}

export interface AgentInputProps {
  placeholder?: string;
  disabled?: boolean;
  /** True while a turn is running — the send button becomes a stop button. */
  running?: boolean;
  onSubmit: (text: string, meta: { skills: string[]; model?: string }) => void;
  onStop?: () => void;

  models?: AgentModel[];
  model?: string;
  onModelChange?: (id: string) => void;

  /** Offered by the "+" menu and the "/" palette. */
  skills?: AgentSkill[];

  attachments?: AgentAttachment[];
  onAttach?: (file: File, kind: "image" | "file") => void | Promise<void>;
  onRemoveAttachment?: (id: string) => void;

  /**
   * Rewrite the draft into a better prompt. The integration seam: resolve to
   * the improved text and honour the AbortSignal so an in-flight call can be
   * cancelled. Without it the enhance affordance is not rendered.
   */
  onEnhance?: (prompt: string, signal?: AbortSignal) => Promise<string>;
}

const SKILL_ATTR = "data-skill";

const escapeHtml = (str: string) =>
  str.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/* ── component ────────────────────────────────────────────────────────────── */

export function AgentInput({
  placeholder = "Ask anything…",
  disabled = false,
  running = false,
  onSubmit,
  onStop,
  models,
  model,
  onModelChange,
  skills = [],
  attachments = [],
  onAttach,
  onRemoveAttachment,
  onEnhance,
}: AgentInputProps) {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<"idle" | "enhancing" | "enhanced">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

  // Slash palette state.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const editorRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachKind = useRef<"image" | "file">("file");
  const savedRange = useRef<Range | null>(null);
  const preEnhance = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const slashToken = useRef<{ node: Text; start: number; end: number } | null>(null);

  const hasText = value.trim().length > 0;
  const enhancing = phase === "enhancing";
  const canSend = (hasText || attachments.length > 0) && !enhancing && !disabled;
  const slashResults = skills.filter((sk) => sk.name.toLowerCase().includes(slashQuery.toLowerCase()));
  const activeModel = models?.find((m) => m.id === model) ?? models?.[0];

  // One outside-click listener for every popover, so opening one closes the rest.
  useEffect(() => {
    if (!menuOpen && !modelOpen && !slashOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setSkillsOpen(false);
      setModelOpen(false);
      closeSlash();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen, modelOpen, slashOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ── editor plumbing ───────────────────────────────────────────────────── */

  const syncFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    setValue(editor.textContent ?? "");
    // Mark pills with nothing but whitespace before them so CSS can drop their
    // left margin — :first-child cannot see text nodes.
    editor.querySelectorAll<HTMLElement>(".sc-ai__pill").forEach((pill) => {
      let atStart = true;
      for (let n = pill.previousSibling; n; n = n.previousSibling) {
        if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() === "") continue;
        atStart = false;
        break;
      }
      pill.toggleAttribute("data-start", atStart);
    });
  };

  const saveSelection = () => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor && editor.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const focusEnd = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRange.current = range.cloneRange();
  };

  const setEditorText = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.textContent = text;
    syncFromEditor();
    focusEnd();
  };

  const closeSlash = () => {
    setSlashOpen(false);
    setSlashQuery("");
    setSlashIndex(0);
    slashToken.current = null;
  };

  /** contenteditable=false so the pill deletes as one unit, not glyph by glyph. */
  const buildPill = (skill: AgentSkill) => {
    const el = document.createElement("span");
    el.className = "sc-ai__pill";
    el.setAttribute("contenteditable", "false");
    el.setAttribute(SKILL_ATTR, skill.id);
    el.innerHTML =
      '<span class="sc-ai__pill-label">/' +
      escapeHtml(skill.name) +
      "</span>" +
      '<button type="button" class="sc-ai__pill-x" data-remove="1" aria-label="Remove ' +
      escapeHtml(skill.name) +
      '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
    return el;
  };

  const insertPillOverRange = (range: Range, skill: AgentSkill) => {
    const editor = editorRef.current;
    if (!editor) return;
    range.deleteContents();
    const pill = buildPill(skill);
    range.insertNode(pill);
    const space = document.createTextNode(" ");
    pill.after(space);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    editor.focus();
    savedRange.current = after.cloneRange();
    syncFromEditor();
  };

  /** From the "+" menu: use the live caret, else the last one, else append. */
  const addSkillFromMenu = (skill: AgentSkill) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    let range: Range | null = null;
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0).cloneRange();
    } else if (savedRange.current && editor.contains(savedRange.current.startContainer)) {
      range = savedRange.current.cloneRange();
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    insertPillOverRange(range, skill);
    setMenuOpen(false);
    setSkillsOpen(false);
  };

  /** From a "/" command: swallow the typed "/query", then drop the pill in. */
  const applySlash = (skill: AgentSkill) => {
    const editor = editorRef.current;
    if (!editor) return closeSlash();
    let range: Range | null = null;
    const token = slashToken.current;
    if (token && token.node.isConnected && editor.contains(token.node) && token.end <= (token.node.textContent?.length ?? 0)) {
      range = document.createRange();
      range.setStart(token.node, token.start);
      range.setEnd(token.node, token.end);
    }
    if (!range) return closeSlash();
    insertPillOverRange(range, skill);
    closeSlash();
  };

  /** Open the palette when the caret sits right after a "/" token. */
  const detectSlash = () => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!skills.length) return;
    if (!editor || !sel || !sel.rangeCount || !sel.isCollapsed) return closeSlash();
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return closeSlash();
    const before = (node.textContent ?? "").slice(0, range.startOffset);
    const m = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!m) return closeSlash();
    const query = m[1] ?? "";
    slashToken.current = { node: node as Text, start: before.length - query.length - 1, end: range.startOffset };
    // A changed query re-ranks the list, so the highlight goes back to the top.
    if (query !== slashQuery) setSlashIndex(0);
    setSlashQuery(query);
    setSlashOpen(true);
  };

  const collectSkills = (): string[] => {
    const editor = editorRef.current;
    if (!editor) return [];
    return Array.from(editor.querySelectorAll<HTMLElement>("[" + SKILL_ATTR + "]")).map(
      (el) => el.getAttribute(SKILL_ATTR) ?? "",
    );
  };

  /* ── actions ───────────────────────────────────────────────────────────── */

  const submit = () => {
    if (!canSend) return;
    const picked = collectSkills();
    const text = (editorRef.current?.textContent ?? "").trim();
    if (editorRef.current) editorRef.current.innerHTML = "";
    setValue("");
    setPhase("idle");
    onSubmit(text, { skills: picked, model });
  };

  const runEnhance = () => {
    if (!onEnhance || !hasText) return;
    if (phase === "enhanced") {
      // Second click reverts — an improved prompt the user dislikes must be
      // one click away from the words they actually wrote.
      setEditorText(preEnhance.current);
      setPhase("idle");
      return;
    }
    preEnhance.current = editorRef.current?.textContent ?? "";
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("enhancing");
    void onEnhance(preEnhance.current, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setEditorText(next);
        setPhase("enhanced");
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase("idle");
      });
  };

  const cancelEnhance = () => {
    abortRef.current?.abort();
    setPhase("idle");
  };

  const pickFile = (kind: "image" | "file") => {
    attachKind.current = kind;
    if (fileRef.current) {
      fileRef.current.accept = kind === "image" ? "image/*" : "";
      fileRef.current.click();
    }
    setMenuOpen(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (slashOpen && slashResults.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashResults.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashResults.length) % slashResults.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = slashResults[slashIndex];
        if (picked) applySlash(picked);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlash();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Clicking a pill's × removes the pill, not the character next to it.
  const onEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest?.("[data-remove]");
    if (!btn) return;
    e.preventDefault();
    btn.closest(".sc-ai__pill")?.remove();
    syncFromEditor();
  };

  /* ── render ────────────────────────────────────────────────────────────── */

  return (
    <div className="sc-ai" ref={rootRef} data-disabled={disabled ? "" : undefined}>
      {attachments.length ? (
        <div className="sc-ai__attachments">
          {attachments.map((a) => (
            <span key={a.id} className="sc-ai__chip">
              <span className="sc-ai__chip-icon">{a.kind === "image" ? <IconImage /> : <IconPaperclip />}</span>
              <span className="sc-ai__chip-name">{a.name}</span>
              {onRemoveAttachment ? (
                <button
                  type="button"
                  className="sc-ai__chip-x"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                >
                  <IconX />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="sc-ai__frame">
        <div
          ref={editorRef}
          className="sc-ai__editor"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          data-placeholder={placeholder}
          data-empty={value.length === 0 ? "" : undefined}
          onInput={() => {
            syncFromEditor();
            if (phase === "enhanced") setPhase("idle");
            detectSlash();
          }}
          onKeyUp={() => {
            saveSelection();
            detectSlash();
          }}
          onMouseUp={saveSelection}
          onBlur={saveSelection}
          onKeyDown={onKeyDown}
          onClick={onEditorClick}
        />

        {slashOpen && slashResults.length ? (
          <div className="sc-ai__palette" role="listbox" aria-label="Skills">
            {slashResults.map((sk, i) => (
              <button
                type="button"
                key={sk.id}
                role="option"
                aria-selected={i === slashIndex}
                className={"sc-ai__paletteitem" + (i === slashIndex ? " sc-ai__paletteitem--on" : "")}
                onMouseEnter={() => setSlashIndex(i)}
                // mousedown, not click: the editor must not lose its selection
                // before we can replace the "/query" token.
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySlash(sk);
                }}
              >
                <span className="sc-ai__palettename">/{sk.name}</span>
                {sk.desc ? <span className="sc-ai__palettedesc">{sk.desc}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="sc-ai__bar">
          <div className="sc-ai__left">
            <div className="sc-ai__menuwrap">
              <button
                type="button"
                className="sc-ai__icon"
                aria-label="Add"
                aria-expanded={menuOpen}
                disabled={disabled}
                onClick={() => {
                  setMenuOpen((o) => !o);
                  setSkillsOpen(false);
                  setModelOpen(false);
                }}
              >
                <IconPlus />
              </button>
              {menuOpen ? (
                <div className="sc-ai__menu" role="menu">
                  {onAttach ? (
                    <>
                      <button type="button" className="sc-ai__menuitem" role="menuitem" onClick={() => pickFile("file")}>
                        <IconPaperclip />
                        <span>Attach a file</span>
                      </button>
                      <button type="button" className="sc-ai__menuitem" role="menuitem" onClick={() => pickFile("image")}>
                        <IconImage />
                        <span>Attach an image</span>
                      </button>
                    </>
                  ) : null}
                  {skills.length ? (
                    <div
                      className="sc-ai__submenuwrap"
                      onMouseEnter={() => setSkillsOpen(true)}
                      onMouseLeave={() => setSkillsOpen(false)}
                    >
                      <button
                        type="button"
                        className="sc-ai__menuitem"
                        role="menuitem"
                        aria-expanded={skillsOpen}
                        onClick={() => setSkillsOpen((o) => !o)}
                      >
                        <IconBook />
                        <span>Skills</span>
                        <span className="sc-ai__menuchevron">
                          <IconChevronRight />
                        </span>
                      </button>
                      {skillsOpen ? (
                        <div className="sc-ai__submenu" role="menu">
                          {skills.map((sk) => (
                            <button
                              type="button"
                              key={sk.id}
                              className="sc-ai__menuitem"
                              role="menuitem"
                              onClick={() => addSkillFromMenu(sk)}
                            >
                              <span>{sk.name}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {models && models.length > 1 ? (
              <div className="sc-ai__menuwrap">
                <button
                  type="button"
                  className="sc-ai__model"
                  aria-expanded={modelOpen}
                  disabled={disabled}
                  onClick={() => {
                    setModelOpen((o) => !o);
                    setMenuOpen(false);
                  }}
                >
                  {activeModel?.icon}
                  <span>{activeModel?.name ?? "Model"}</span>
                </button>
                {modelOpen ? (
                  <div className="sc-ai__menu sc-ai__menu--wide" role="menu">
                    {models.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        className="sc-ai__modelitem"
                        role="menuitemradio"
                        aria-checked={m.id === activeModel?.id}
                        onClick={() => {
                          onModelChange?.(m.id);
                          setModelOpen(false);
                        }}
                      >
                        <span className="sc-ai__modelhead">
                          {m.icon}
                          <span className="sc-ai__modelname">{m.name}</span>
                          {m.id === activeModel?.id ? (
                            <span className="sc-ai__modelcheck">
                              <IconCheck />
                            </span>
                          ) : null}
                        </span>
                        {m.desc ? <span className="sc-ai__modeldesc">{m.desc}</span> : null}
                        {m.context ? <span className="sc-ai__modelctx">{m.context}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="sc-ai__right">
            {onEnhance && (hasText || enhancing) ? (
              enhancing ? (
                <button type="button" className="sc-ai__enhance sc-ai__enhance--busy" onClick={cancelEnhance}>
                  <span className="sc-spinner" aria-hidden />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  type="button"
                  className={"sc-ai__enhance" + (phase === "enhanced" ? " sc-ai__enhance--on" : "")}
                  onClick={runEnhance}
                  title={phase === "enhanced" ? "Revert to your original prompt" : "Improve this prompt"}
                >
                  <IconSparkle />
                  <span>{phase === "enhanced" ? "Revert" : "Improve"}</span>
                </button>
              )
            ) : null}

            {running ? (
              <button type="button" className="sc-ai__send sc-ai__send--stop" onClick={onStop} aria-label="Stop">
                <IconStop />
              </button>
            ) : (
              <button
                type="button"
                className="sc-ai__send"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send"
              >
                <IconArrowUp />
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onAttach?.(file, attachKind.current);
        }}
      />
    </div>
  );
}
