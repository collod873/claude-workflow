import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extractOutput } from "./output-block";

const schema = z.object({ greeting: z.string() });

/**
 * A real seam-sweep response, captured 2026-08-23 from `claude -p` against
 * `seam-sweep/prompt.md` for #36 — the shape that killed run 32677530530
 * (#42). Its single `<output>` block is well-formed; two of its manifest
 * entries name this repo's own `<output>` block contract as a shared shape,
 * so the literal tag appears twice *inside* the JSON payload. Read from
 * disk rather than inlined because the point of it is that no one wrote it.
 */
const PAYLOAD_TAGS_RESPONSE = readFileSync(
  new URL("./seam-sweep-payload-tags.evidence.txt", import.meta.url),
  "utf8",
);

const seamManifest = z.array(z.string());

describe("extractOutput", () => {
  it("returns the parsed, validated object for a response ending in a single <output> block", () => {
    const raw = `Some reasoning prose.\n\nHere is the plan.\n<output>${JSON.stringify({ greeting: "hi" })}</output>`;

    expect(extractOutput(raw, schema)).toEqual({ greeting: "hi" });
  });

  it("throws naming the reason when the block is missing entirely", () => {
    const raw = "Just prose, no output block at all.";

    expect(() => extractOutput(raw, schema)).toThrow(/no <output> block/);
  });

  it("throws naming the reason when content follows the </output> tag", () => {
    const raw = `<output>${JSON.stringify({ greeting: "hi" })}</output>\ntrailing prose the model kept writing`;

    expect(() => extractOutput(raw, schema)).toThrow(/does not end in its <output> block/);
  });

  it("throws naming the reason when the block is not valid JSON", () => {
    const raw = "<output>{not json</output>";

    expect(() => extractOutput(raw, schema)).toThrow(/not valid JSON/);
  });

  it("throws naming the reason when the parsed JSON fails the supplied schema", () => {
    const raw = `<output>${JSON.stringify({ greeting: 42 })}</output>`;

    expect(() => extractOutput(raw, schema)).toThrow(/failed schema validation/);
  });

  it("throws naming the reason when a </output> closes before any <output> opens", () => {
    const raw = `</output>${JSON.stringify({ greeting: "hi" })}<output>`;

    expect(() => extractOutput(raw, schema)).toThrow(/no <output> block/);
  });

  // The #42 behaviour. A payload that mentions the tag is content, not
  // structure: the span is first <output> to last </output>, and JSON.parse
  // is what proves that span was the right one.
  describe("when the payload itself contains the literal tag", () => {
    it("extracts the block from a real captured response that names the <output> contract as a seam", () => {
      const manifest = extractOutput(PAYLOAD_TAGS_RESPONSE, seamManifest, () => {});

      expect(manifest.some((entry) => entry.includes("<output>"))).toBe(true);
      expect(manifest.every((entry) => !entry.includes("\n"))).toBe(true);
    });

    it("extracts a payload whose string value mentions <output>", () => {
      const raw = `prose\n<output>${JSON.stringify({ greeting: "the <output> block contract" })}</output>`;

      expect(extractOutput(raw, schema, () => {})).toEqual({
        greeting: "the <output> block contract",
      });
    });

    it("reports the extra tags rather than dropping them in silence", () => {
      const report = vi.fn();
      const raw = `prose\n<output>${JSON.stringify({ greeting: "a <output> mention" })}</output>`;

      extractOutput(raw, schema, report);

      expect(report).toHaveBeenCalledOnce();
      expect(report.mock.calls[0][0]).toMatch(/1 extra <output> tag/);
    });

    it("stays silent when the payload contains no extra tags", () => {
      const report = vi.fn();
      const raw = `<output>${JSON.stringify({ greeting: "hi" })}</output>`;

      extractOutput(raw, schema, report);

      expect(report).not.toHaveBeenCalled();
    });
  });

  // A genuine second block is still a failure — but it fails on the JSON,
  // and the message has to say the tags are why, or the next reader repeats
  // #42's investigation from scratch.
  it("throws naming the interior tags when two genuine blocks make the span unparseable", () => {
    const raw = `<output>${JSON.stringify({ greeting: "one" })}</output>\nmore text\n<output>${JSON.stringify({ greeting: "two" })}</output>`;

    expect(() => extractOutput(raw, schema, () => {})).toThrow(/not valid JSON/);
    expect(() => extractOutput(raw, schema, () => {})).toThrow(/2 extra <output> tags/);
  });
});
