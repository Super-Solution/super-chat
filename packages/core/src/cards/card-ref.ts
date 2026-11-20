// Card references: how text in a chat message points at something inside a card.
//
// The envelope (`ref:<target>?<name>=<value>&...`) is defined once by super-protocol
// (docs/CARD-REFS.md, `parseCardRef`), and what the params mean is up to the card kind.
// This is the host's copy of the parser: core has no dependencies, and the host must read links
// without a card kind's vocabulary anyway. It matches `parseCardRef` in super-protocol 0.3.0
// exactly, limits and messages included; the plugin package's `card-ref-agreement.test.ts`
// checks that against the published protocol, so a link one accepts the other accepts.

export const CARD_REF_SCHEME = "ref";

export const CARD_REF_LIMITS = Object.freeze({
  /** The whole link, in UTF-16 code units. */
  length: 512,
  /** The target (the card's id). */
  target: 128,
  /** Distinct param names. */
  names: 16,
  /** Values of one param name (`key=a&key=b`). */
  values: 32,
  /** One param name. */
  name: 32,
  /** One decoded value, in UTF-16 code units. */
  value: 256,
});

/** A parsed reference. A repeated param is a list in order; values are decoded once, never split on commas. */
export interface CardRef {
  /** The `id` of the card this points into. */
  target: string;
  params: Record<string, string[]>;
}

/** What the reader did with the link: pointed at it, left it, or chose it (click, Enter, tap). */
export type CardRefEvent = "enter" | "leave" | "activate";

/** What a card answers. `ok: false` lets the host show a stale reference as plain text, with the reason. */
export type CardRefResult = { ok: true; label?: string } | { ok: false; code: string; reason: string };

export type CardRefParse = { ok: true; ref: CardRef } | { ok: false; error: string };

/** A host's side of references: hands one on to the card it points into. `null` clears everything shown. */
export interface CardRefHost {
  ref(ref: CardRef | null, event: CardRefEvent): CardRefResult;
}

const TARGET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NAME = /^[a-z][A-Za-z0-9_-]{0,31}$/;
const RAW_VALUE = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function decodeValue(raw: string): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "%") {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(raw.charCodeAt(i));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

/** Reads a `ref:` link. */
export function parseCardRef(href: unknown): CardRefParse {
  const fail = (error: string): CardRefParse => ({ ok: false, error });
  if (typeof href !== "string") return fail("a ref must be a string.");
  if (href.length > CARD_REF_LIMITS.length) return fail(`a ref is at most ${CARD_REF_LIMITS.length} characters.`);
  if (!href.startsWith(`${CARD_REF_SCHEME}:`)) return fail(`a ref starts with "${CARD_REF_SCHEME}:".`);
  const rest = href.slice(CARD_REF_SCHEME.length + 1);
  if (rest.includes("#")) return fail("a ref has no fragment.");
  const q = rest.indexOf("?");
  const target = q < 0 ? rest : rest.slice(0, q);
  if (!TARGET.test(target)) return fail("a ref target is 1 to 128 letters, digits, dot, underscore, colon or dash, starting with a letter or digit.");
  const params: Record<string, string[]> = {};
  if (q >= 0) {
    const query = rest.slice(q + 1);
    if (query === "") return fail("a ref query is empty.");
    for (const part of query.split("&")) {
      const eq = part.indexOf("=");
      if (eq < 0) return fail("each ref param is name=value.");
      const name = part.slice(0, eq);
      const raw = part.slice(eq + 1);
      if (!NAME.test(name)) return fail("a ref param name is 1 to 32 letters, digits, dash or underscore, starting with a lowercase letter.");
      if (!RAW_VALUE.test(raw)) return fail("a ref param value is not empty and uses letters, digits, dot, dash, underscore, tilde or %XX only.");
      const value = decodeValue(raw);
      if (value === null) return fail("a ref param value must be valid UTF-8.");
      if (value.length > CARD_REF_LIMITS.value) return fail(`a ref param value is at most ${CARD_REF_LIMITS.value} characters.`);
      if (!hasOwn(params, name)) {
        if (Object.keys(params).length >= CARD_REF_LIMITS.names) return fail(`a ref has at most ${CARD_REF_LIMITS.names} param names.`);
        params[name] = [];
      }
      if (params[name]!.length >= CARD_REF_LIMITS.values) return fail(`a ref param has at most ${CARD_REF_LIMITS.values} values.`);
      params[name]!.push(value);
    }
  }
  return { ok: true, ref: { target, params } };
}
