import { describe, expect, it } from "vitest";
import { parseIssueNumber } from "./issue-url";

describe("parseIssueNumber", () => {
  it("reads the number off a create's URL", () => {
    expect(parseIssueNumber("https://github.com/owner/repo/issues/42\n")).toBe(42);
  });

  it("tolerates the trailing newline gh actually prints, and surrounding whitespace", () => {
    expect(parseIssueNumber("  https://github.com/owner/repo/issues/7  \n\n")).toBe(7);
  });

  it("reads the trailing segment, never digits earlier in the URL", () => {
    expect(parseIssueNumber("https://github.com/123/456/issues/9")).toBe(9);
  });

  it("throws on output that is not an issue URL, rather than yielding NaN", () => {
    expect(() => parseIssueNumber("HTTP 422: Validation Failed")).toThrow(
      /could not parse an issue number/,
    );
  });

  it("throws on empty output", () => {
    expect(() => parseIssueNumber("")).toThrow(/could not parse an issue number/);
  });

  it("throws on a pull request URL, which gh prints for a create in the wrong repo state", () => {
    expect(() => parseIssueNumber("https://github.com/owner/repo/pull/42")).toThrow(
      /could not parse an issue number/,
    );
  });

  it("names what was being filed, so a failure inside a 26-issue loop is actionable", () => {
    expect(() => parseIssueNumber("nope", "Add the collector")).toThrow(/"Add the collector"/);
  });
});
