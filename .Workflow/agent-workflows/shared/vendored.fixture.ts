/**
 * @fixture Reached only from the prose gate and the copy test, by design: no lane reads it.
 */

export const AGENT_SKILLS_PIN = "collod873/agent-skills@b4beb1a71a8e780e317b197781c455bd859bb0b7";

export const VENDORED_COPIES = [
  {
    relative: ".claude/hooks/lib/_hook.mjs",
    source: "hooks/_hook.mjs",
    sha256: "de9790b8e4c625c0bcd243084f49c733c43e6ceb9a6de41b5f1791cc60e88c7d",
  },
  {
    relative: ".claude/hooks/lib/_hook.sh",
    source: "hooks/_hook.sh",
    sha256: "fd0d60afab7296f84b5a1e556bdc0b982b4faff2192f2c5c8911c489fe024a81",
  },
] as const;

const VENDORED_PATHS = new Set<string>(VENDORED_COPIES.map((copy) => copy.relative));

export function isVendored(relative: string): boolean {
  return VENDORED_PATHS.has(relative);
}
