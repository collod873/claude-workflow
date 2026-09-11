import immutableSetJson from "./immutable-set.json";

export const IMMUTABLE_SET: readonly string[] = immutableSetJson;

export const IMPLEMENTATION_PR_DISPATCH_ACTION = "implementation-opened";

export const BY_HAND_LABEL = "by-hand";

const WORKSTATION_PREFIXES = ["~/", ".claude/settings"];

export function touchesImmutableSet(paths: string[]): boolean {
  return paths.some((path) => IMMUTABLE_SET.some((entry) => path === entry || path.startsWith(entry)));
}

export function touchesWorkstation(paths: string[]): boolean {
  return paths.some((path) => WORKSTATION_PREFIXES.some((prefix) => path.startsWith(prefix)));
}
