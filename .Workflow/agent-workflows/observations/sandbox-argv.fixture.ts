import { expect } from "vitest";

export const SANDBOXED_LENS_ARGV = [
  "--model",
  "sonnet",
  "--output-format",
  "text",
  "--no-session-persistence",
  "--tools",
  "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--setting-sources",
  "",
];

/**
 * Asserts `argv` is a bare `-p` followed by exactly `SANDBOXED_LENS_ARGV` — the whole sandbox,
 * in order, and nothing else.
 *
 * @fixture Reached only from the suites, by design.
 */
export function expectSandboxedLensArgv(argv: string[]): void {
  expect(argv[0]).toBe("-p");
  expect(argv.slice(1)).toEqual(SANDBOXED_LENS_ARGV);
}
