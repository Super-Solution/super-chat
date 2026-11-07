// Base64 for the proxy envelope, where a 20 MB upload is the sizing case.
// `Buffer` is Node-only (core is isomorphic), so each direction takes the
// fastest codec the runtime has: `Uint8Array.prototype.toBase64` /
// `Uint8Array.fromBase64` where they exist, else `btoa` / `atob` over a binary
// string built in bounded chunks (`String.fromCharCode(...bytes)` in one call
// blows the call stack on anything bigger than a small image), and the
// hand-rolled table below only for a runtime with neither, or for input that
// is not a Uint8Array.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const REVERSE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

// Bytes per `String.fromCharCode.apply` call, far below every engine's argument limit.
const APPLY_CHUNK = 0x2000;

type NativeBase64 = {
  toBase64?: (this: Uint8Array) => string;
  fromBase64?: (s: string) => Uint8Array;
};

export function bytesToBase64(bytes: Uint8Array): string {
  // An untyped caller's array or other typed array keeps the old answer: the
  // platform encoders reject it or read it differently.
  if (!(bytes instanceof Uint8Array)) return encodeWithTable(bytes);
  // Also keeps a detached buffer at "" — the native encoder throws on one.
  if (bytes.length === 0) return "";
  const { toBase64 } = Uint8Array.prototype as NativeBase64;
  if (typeof toBase64 === "function") return toBase64.call(bytes);
  if (typeof btoa === "function") {
    const binary: string[] = [];
    for (let i = 0; i < bytes.length; i += APPLY_CHUNK) {
      binary.push(String.fromCharCode.apply(null, bytes.subarray(i, i + APPLY_CHUNK) as unknown as number[]));
    }
    return btoa(binary.join(""));
  }
  return encodeWithTable(bytes);
}

function encodeWithTable(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out +=
      ALPHABET[b0 >> 2]! +
      ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]! +
      (i + 1 < bytes.length ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : "=") +
      (i + 2 < bytes.length ? ALPHABET[b2 & 0x3f]! : "=");
    // Flush periodically so the accumulator never becomes one enormous rope.
    if (out.length >= 0x8000) {
      chunks.push(out);
      out = "";
    }
  }
  chunks.push(out);
  return chunks.join("");
}

export function base64ToBytes(s: string): Uint8Array {
  // Tolerate whitespace/newlines (some serializers wrap long values).
  const clean = s.replace(/[\s=]+/g, "");
  // The platform decoders reject a lone trailing character, which the table
  // silently drops; leave that input to the table so the answer stays the same.
  if (clean.length % 4 !== 1) {
    try {
      const native = Uint8Array as NativeBase64;
      if (typeof native.fromBase64 === "function") return native.fromBase64(clean);
      if (typeof atob === "function") {
        const binary = atob(clean);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
        return out;
      }
    } catch {
      // A character outside the alphabet. Find the first one, to report which
      // and where exactly as the table does, without decoding the input again.
      for (let i = 0; i < clean.length; i += 1) {
        const code = clean.charCodeAt(i);
        if (code >= 128 || REVERSE[code]! < 0) {
          throw new Error(`Invalid base64 character "${clean[i]}" at position ${i}.`);
        }
      }
    }
  }
  return decodeWithTable(clean);
}

function decodeWithTable(clean: string): Uint8Array {
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outPos = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? REVERSE[code]! : -1;
    if (value < 0) throw new Error(`Invalid base64 character "${clean[i]}" at position ${i}.`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outPos] = (buffer >> bits) & 0xff;
      outPos += 1;
    }
  }
  return out.subarray(0, outPos);
}
