// Token estimation without a tokenizer.
//
// Shipping tiktoken to the browser costs ~1MB of WASM plus a rank table, to
// answer a question we only need approximately: "will this fit in the budget".
// A byte-aware heuristic gets within roughly ±15% on ordinary prose and is
// deliberately biased to OVER-estimate, because the failure mode of
// over-estimating is dropping one extra history turn, while the failure mode of
// under-estimating is a 400 from the provider mid-conversation.
//
// Hosts that need exactness inject their own counter through `TokenCounter`.

export type TokenCounter = (text: string) => number;

const LATIN_CHARS_PER_TOKEN = 3.7; // GPT-family BPE on English prose
const CJK_CHARS_PER_TOKEN = 1.1; // CJK is close to one token per character

/**
 * Estimate tokens for a string. Splits CJK from Latin because a single ratio is
 * wrong by 3x on Chinese/Japanese text — which matters here, since this
 * framework is being built by someone who writes prompts in both.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const isCjk =
      (code >= 0x3040 && code <= 0x30ff) || // kana
      (code >= 0x3400 && code <= 0x4dbf) || // CJK ext A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK unified
      (code >= 0xac00 && code <= 0xd7af) || // hangul
      (code >= 0xf900 && code <= 0xfaff);
    if (isCjk) cjk += 1;
    else other += 1;
  }

  const base = cjk / CJK_CHARS_PER_TOKEN + other / LATIN_CHARS_PER_TOKEN;
  // Structural overhead: JSON punctuation and whitespace tokenize poorly and
  // are common in tool payloads, so add a small margin rather than under-count.
  return Math.ceil(base * 1.05);
}

/** JSON payloads (tool args/results) tokenize worse than prose — count the serialized form. */
export function estimateJsonTokens(value: unknown): number {
  if (value == null) return 1;
  if (typeof value === "string") return estimateTokens(value);
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return estimateTokens(String(value));
  }
}

/** Fixed per-message overhead the provider adds for role markers and separators. */
export const MESSAGE_OVERHEAD_TOKENS = 4;
