// Getting a draft out of the conversation and into a mail client.
//
// Two exits, and the ordering between them is the design.
//
// `.eml` is the primary one. It is a real RFC 5322 message: every mail client
// opens it, it carries recipients, headers and (later) attachments, it survives
// being saved, and it does not care how long the body is.
//
// `mailto:` is the convenience shortcut, and its limits are hard enough to be
// worth stating rather than discovering:
//   - practical URL ceiling around 2000 characters, past which clients TRUNCATE
//     silently — the user sends a letter with the end missing and no warning
//   - no attachments, at all
//   - plain text only
//   - newline encoding varies between clients
//   - on a desktop with no mail client registered, clicking it does nothing,
//     and reports nothing
//
// So the composer offers both and says which is which, rather than shipping the
// shortcut and calling the feature done.
//
// Neither path sends anything. Sending needs a credential, and the framework
// holding one would break the rule Transport already keeps.

import type { EmailCard } from "../cards/types.js";

/** Roughly where mail clients start truncating a mailto: URL. */
export const MAILTO_SAFE_LENGTH = 2000;

const encode = (s: string) =>
  // encodeURIComponent leaves these legal-in-a-query characters alone, and
  // some clients read them as delimiters. Percent-encoding them costs nothing.
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type MailtoLink = {
  href: string;
  /** True when the href is long enough that a client may cut it short. */
  mayTruncate: boolean;
  length: number;
};

export function buildMailto(email: EmailCard): MailtoLink {
  const params: string[] = [];
  if (email.cc?.length) params.push(`cc=${encode(email.cc.join(","))}`);
  if (email.bcc?.length) params.push(`bcc=${encode(email.bcc.join(","))}`);
  if (email.subject) params.push(`subject=${encode(email.subject)}`);
  // CRLF rather than LF: clients disagree about a bare %0A, and every one of
  // them understands %0D%0A.
  if (email.body) params.push(`body=${encode(email.body.replace(/\r?\n/g, "\r\n"))}`);

  const href = `mailto:${encode(email.to.join(","))}${params.length ? `?${params.join("&")}` : ""}`;
  return { href, length: href.length, mayTruncate: href.length > MAILTO_SAFE_LENGTH };
}

// ── Line limits ──────────────────────────────────────────────────────────────
//
// RFC 5322 §2.1.1 sets two of them, and the difference between them is the
// difference between untidy and rejected:
//
//   998 octets   a hard MUST. Past it a strict MTA or parser is entitled to
//                refuse the message, and several do.
//    78 octets   a SHOULD, for humans reading raw source.
//
// A drafted letter reaches the ceiling more easily than it looks: one long
// unwrapped paragraph is a single line, and "one long unwrapped paragraph" is
// what a model writes unless told otherwise. So the body is measured, and if
// any line would break the MUST the encoding changes to carry it losslessly
// rather than the text being folded — folding prose would silently insert line
// breaks the user did not write into a letter they are about to send.

/** Hard ceiling, excluding the CRLF. */
const MAX_LINE_OCTETS = 998;
/** What folding aims at. */
const FOLD_WIDTH = 78;
/** An RFC 2047 encoded-word may not exceed this, including its delimiters. */
const MAX_ENCODED_WORD = 75;

const octetsOf = (s: string) => new TextEncoder().encode(s).length;

const base64 = (bytes: Uint8Array): string =>
  typeof btoa === "function"
    ? btoa(String.fromCharCode(...bytes))
    : Buffer.from(bytes).toString("base64");

/**
 * RFC 2047 encoded-words, split so none exceeds 75 characters.
 *
 * One word for the whole subject is the tempting version and it breaks on a
 * long non-ASCII subject: over the limit, clients variously truncate the header
 * or show the raw `=?UTF-8?B?…` to the user. The split has to fall on a UTF-8
 * character boundary — cut mid-sequence and the decoder emits a replacement
 * character in the middle of a word, which looks like the sender's mistake.
 */
function encodedWords(value: string): string[] {
  const bytes = new TextEncoder().encode(value);
  // "=?UTF-8?B?" + "?=" is 12 characters; base64 costs 4 per 3 bytes. 45 bytes
  // is the largest multiple of 3 that still fits inside the limit.
  const perWord = Math.min(45, Math.floor(((MAX_ENCODED_WORD - 12) / 4) * 3));
  const words: string[] = [];

  for (let i = 0; i < bytes.length; ) {
    let take = Math.min(perWord, bytes.length - i);
    while (take > 1 && i + take < bytes.length && (bytes[i + take]! & 0xc0) === 0x80) take -= 1;
    words.push(`=?UTF-8?B?${base64(bytes.slice(i, i + take))}?=`);
    i += take;
  }
  return words.length ? words : [""];
}

/**
 * Fold a header, or leave it exactly as it was.
 *
 * Only long headers are touched. Folding is reversible in principle, but
 * unfolding collapses the inserted whitespace, so a header that already fits
 * should come out byte-identical rather than round-tripped for no reason.
 */
function fold(name: string, pieces: string[], separator: string): string {
  const flat = `${name}: ${pieces.join(`${separator} `)}`;
  if (octetsOf(flat) <= FOLD_WIDTH) return flat;

  const lines: string[] = [];
  let line = `${name}:`;
  pieces.forEach((piece, i) => {
    const token = i < pieces.length - 1 ? `${piece}${separator}` : piece;
    // A continuation line starts with whitespace; that is what makes it one.
    if (line !== `${name}:` && octetsOf(`${line} ${token}`) > FOLD_WIDTH) {
      lines.push(line);
      line = ` ${token}`;
    } else {
      line += ` ${token}`;
    }
  });
  lines.push(line);
  return lines.join("\r\n");
}

/** Address lists fold at the commas — the only place a break is legal. */
const addressHeader = (name: string, addresses: string[]) => fold(name, addresses, ",");

function subjectHeader(subject: string): string {
  if (/[^\x20-\x7e]/.test(subject)) return fold("Subject", encodedWords(subject), "");
  // An ASCII subject that already fits goes through untouched. Folding splits
  // on spaces and rejoins with one, so a subject with a deliberate double space
  // would come back altered for no gain.
  const flat = `Subject: ${subject}`;
  if (octetsOf(flat) <= FOLD_WIDTH) return flat;
  return fold("Subject", subject.split(/ +/).filter(Boolean), "");
}

// ── Body ─────────────────────────────────────────────────────────────────────

const needsQuotedPrintable = (body: string) =>
  body.split(/\r?\n/).some((line) => octetsOf(line) > MAX_LINE_OCTETS);

/**
 * Quoted-printable with soft line breaks.
 *
 * Lossless, unlike folding: a trailing `=` tells the receiver the line
 * continues, so the text the user wrote is the text that arrives. Chosen over
 * base64 because the .eml stays readable in a text editor, which is worth
 * keeping for something the user is meant to inspect before sending.
 */
function quotedPrintable(body: string): string {
  const out: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    const bytes = new TextEncoder().encode(line);
    let current = "";
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i]!;
      const printable = b >= 32 && b <= 126 && b !== 61;
      // Trailing whitespace must be encoded or a transport is allowed to strip
      // it, which silently rewrites the line.
      const trailing = (b === 32 || b === 9) && i === bytes.length - 1;
      const token = printable && !trailing ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
      // 76 including the soft-break `=`, so a token never straddles the break.
      if (current.length + token.length > 75) {
        out.push(`${current}=`);
        current = "";
      }
      current += token;
    }
    out.push(current);
  }

  return out.join("\r\n");
}

/**
 * An RFC 5322 message.
 *
 * Deliberately without a Date or Message-ID: this is a DRAFT, and stamping it
 * with a send time it did not have would be a small lie that some clients then
 * display as fact. The user's own client fills both in when they send.
 */
export function buildEml(email: EmailCard): string {
  const encoded = needsQuotedPrintable(email.body);
  const lines = [
    addressHeader("To", email.to),
    ...(email.cc?.length ? [addressHeader("Cc", email.cc)] : []),
    ...(email.bcc?.length ? [addressHeader("Bcc", email.bcc)] : []),
    subjectHeader(email.subject),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    `Content-Transfer-Encoding: ${encoded ? "quoted-printable" : "8bit"}`,
    "",
    encoded ? quotedPrintable(email.body) : email.body,
  ];
  // CRLF throughout — the spec's line ending, and the one strict parsers want.
  return lines.join("\r\n").replace(/(?<!\r)\n/g, "\r\n");
}

/** A filename that will not upset a filesystem. */
export function emlFilename(email: EmailCard): string {
  const stem = (email.subject || "draft").replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
  return `${stem || "draft"}.eml`;
}
