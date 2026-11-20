import { describe, expect, it } from "vitest";
import { parseCardRef } from "./card-ref.js";

// The same cases the protocol's conformance data carries for `card_ref_parse`: the host's copy
// of the parser must say what the reference says, message for message.
describe("parseCardRef", () => {
  it("reads a bare target and a target with params", () => {
    expect(parseCardRef("ref:btc")).toEqual({ ok: true, ref: { target: "btc", params: {} } });
    expect(parseCardRef("ref:btc?key=support&from=1&to=2")).toEqual({
      ok: true,
      ref: { target: "btc", params: { key: ["support"], from: ["1"], to: ["2"] } },
    });
  });

  it("keeps a repeated param as a list, and decodes once without splitting on commas", () => {
    expect(parseCardRef("ref:c?key=a&key=b%2Cc")).toEqual({ ok: true, ref: { target: "c", params: { key: ["a", "b,c"] } } });
    expect(parseCardRef("ref:c?key=%E6%94%AF%E6%92%90")).toEqual({ ok: true, ref: { target: "c", params: { key: ["支撐"] } } });
  });

  it.each([
    [42, "a ref must be a string."],
    ["https://x.example", 'a ref starts with "ref:".'],
    ["ref:c#frag", "a ref has no fragment."],
    ["ref:", "a ref target is 1 to 128 letters, digits, dot, underscore, colon or dash, starting with a letter or digit."],
    ["ref:-x", "a ref target is 1 to 128 letters, digits, dot, underscore, colon or dash, starting with a letter or digit."],
    ["ref:c?", "a ref query is empty."],
    ["ref:c?key", "each ref param is name=value."],
    ["ref:c?Key=a", "a ref param name is 1 to 32 letters, digits, dash or underscore, starting with a lowercase letter."],
    ["ref:c?key=", "a ref param value is not empty and uses letters, digits, dot, dash, underscore, tilde or %XX only."],
    ["ref:c?key=a b", "a ref param value is not empty and uses letters, digits, dot, dash, underscore, tilde or %XX only."],
    ["ref:c?key=%FF", "a ref param value must be valid UTF-8."],
    [`ref:c?key=${"a".repeat(257)}`, "a ref param value is at most 256 characters."],
    [`ref:${"a".repeat(513)}`, "a ref is at most 512 characters."],
  ])("refuses %j", (href, error) => {
    expect(parseCardRef(href)).toEqual({ ok: false, error });
  });

  it("caps names and values per name", () => {
    const names = Array.from({ length: 17 }, (_, i) => `n${i}=1`).join("&");
    expect(parseCardRef(`ref:c?${names}`)).toEqual({ ok: false, error: "a ref has at most 16 param names." });
    const values = Array.from({ length: 33 }, () => "key=1").join("&");
    expect(parseCardRef(`ref:c?${values}`)).toEqual({ ok: false, error: "a ref param has at most 32 values." });
  });
});
