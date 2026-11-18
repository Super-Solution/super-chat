// What a spec may never carry, whichever component it is attached to.
//
// Rendering is already safe by construction (props are enumerated, text is
// escaped, nothing reaches innerHTML). This is the second wall, and it exists so
// the refusal happens where the model can read it: a spec carrying a script URL
// is corrected at the tool call instead of being quietly neutralised later.

import { isForbiddenKey } from "./pointer.js";

const DANGEROUS_KEYS = new Set(["dangerouslysetinnerhtml", "innerhtml", "outerhtml", "srcdoc"]);
const SCRIPT_SCHEMES = /^(javascript|vbscript|livescript|data:text\/html|data:application\/xhtml|data:image\/svg)/;
const MARKUP = /<\s*\/?\s*[a-z][a-z0-9-]*(\s[^<>]*)?\/?>|<\s*(script|iframe|object|embed|style|svg|math)\b/i;

/** Browsers ignore whitespace and control characters inside a scheme, so `java\tscript:` is one too. */
const compact = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, "").toLowerCase();

export const isScriptUrl = (s: string): boolean => {
  const c = compact(s.slice(0, 256));
  return SCRIPT_SCHEMES.test(c) && (c.startsWith("data:") || /^[a-z]+:/.test(c));
};

export type UnsafeFinding = { path: string; reason: string };

/**
 * First unsafe thing in `value`. `markup` also refuses HTML in strings: right for
 * a primitive's props, wrong for a code card, whose whole job is to show source.
 */
export function findUnsafe(value: unknown, opts: { markup?: boolean; path?: string } = {}): UnsafeFinding | undefined {
  const markup = opts.markup === true;
  let visited = 0;

  const walk = (node: unknown, path: string, depth: number): UnsafeFinding | undefined => {
    visited += 1;
    if (visited > 50_000 || depth > 32) return { path, reason: "is nested too deeply to inspect" };
    if (typeof node === "string") {
      if (isScriptUrl(node)) return { path, reason: "is a URL that runs script" };
      if (markup && MARKUP.test(node)) return { path, reason: "contains HTML" };
      return undefined;
    }
    if (typeof node === "function") return { path, reason: "is executable" };
    if (typeof node !== "object" || node === null) return undefined;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const found = walk(node[i], `${path}/${i}`, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    for (const key of Object.keys(node)) {
      if (isForbiddenKey(key) || DANGEROUS_KEYS.has(key.toLowerCase())) {
        return { path: `${path}/${key}`, reason: "is not an allowed key" };
      }
      const found = walk((node as Record<string, unknown>)[key], `${path}/${key}`, depth + 1);
      if (found) return found;
    }
    return undefined;
  };

  return walk(value, opts.path ?? "", 0);
}

/** A URL a surface may load or link to: http(s), plus inline raster images for `image`. */
export function safeSurfaceUrl(url: unknown, use: "link" | "image"): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return trimmed;
  if (use === "image" && /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(trimmed)) return trimmed;
  return undefined;
}
