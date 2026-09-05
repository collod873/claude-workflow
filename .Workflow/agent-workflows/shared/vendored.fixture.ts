/**
 * @fixture Reached only from the prose gate and the copy test, by design: no lane reads it.
 */

export const AGENT_SKILLS_PIN = "collod873/agent-skills@56d661e086806ddf0f5c850a17dc0f98ef42a207";

export const VENDORED_COPIES = [
  {
    relative: ".claude/hooks/lib/_hook.mjs",
    source: "hooks/_hook.mjs",
    sha256: "de9790b8e4c625c0bcd243084f49c733c43e6ceb9a6de41b5f1791cc60e88c7d",
  },
  {
    relative: ".claude/hooks/lib/_hook.sh",
    source: "hooks/_hook.sh",
    sha256: "359fca25dd0bc2e91f46b66fde3f2494ec13bc3076853164bd45e0c0f05e5720",
  },
] as const;

const VENDORED_PATHS = new Set<string>(VENDORED_COPIES.map((copy) => copy.relative));

export function isVendored(relative: string): boolean {
  return VENDORED_PATHS.has(relative);
}
