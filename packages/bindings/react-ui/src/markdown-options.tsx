"use client";

// How Markdown is rendered for everything below: the host's choices, in one place.
//
// The renderer (super-chat-ui-core) takes plain options; this carries them to every spot in the
// kit that draws Markdown (messages, the live answer, a markdown card) without each of them
// growing the same three props. The kit's own default turns the code and table buttons on,
// since `ProseHtml` is what answers them.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MarkdownOptions } from "@supersolutions/super-chat-ui-core";

const DEFAULT: MarkdownOptions = { actions: true };
const Context = /* @__PURE__ */ createContext<MarkdownOptions>(DEFAULT);

/** The options in force: the nearest provider's, or the kit's default. Stable between renders. */
export function useMarkdownOptions(): MarkdownOptions {
  return useContext(Context);
}

export type MarkdownProviderProps = Omit<MarkdownOptions, "actions"> & { children: ReactNode };

/**
 * Sets how Markdown is drawn below it: `highlight` (a code highlighter), `math` (a typesetter
 * for `$…$`) and `images` (`"embed"` to load pictures; links by default). Pass functions
 * that do not change between renders (define them outside the component), because a new one
 * starts the streamed answer over.
 *
 * ```tsx
 * import { codeToHtml } from "shiki"; // or highlight.js: anything that returns HTML
 * <MarkdownProvider highlight={(code, lang) => highlighter.highlight(code, lang)} math={katexToString}>
 *   <Thread />
 * </MarkdownProvider>
 * ```
 */
export function MarkdownProvider({ highlight, math, images, children }: MarkdownProviderProps) {
  const options = useMemo<MarkdownOptions>(
    () => ({
      actions: true,
      ...(highlight !== undefined ? { highlight } : {}),
      ...(math ? { math } : {}),
      ...(images ? { images } : {}),
    }),
    [highlight, math, images],
  );
  return <Context.Provider value={options}>{children}</Context.Provider>;
}
