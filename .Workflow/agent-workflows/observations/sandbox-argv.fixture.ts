import { expect } from "vitest";

/**
 * The argv every observation lens is spawned with, after the bare `-p`, in the order the sandbox
 * spec names: no tools, no session, no MCP servers, no slash commands, no setting sources. Two
 * lenses (VIOLATION and PROPOSED) share these flags unchanged, and each suite used to restate
 * the list — so a flag added to one lens's spawn could drift from the other's without either
 * suite noticing.
 */
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
