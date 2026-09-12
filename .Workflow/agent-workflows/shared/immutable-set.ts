import immutableSetJson from "./immutable-set.json";
import { BY_HAND_LABEL } from "./labels";

export { BY_HAND_LABEL };

export const IMMUTABLE_SET: readonly string[] = immutableSetJson;

export const IMPLEMENTATION_PR_DISPATCH_ACTION = "implementation-opened";

const WORKSTATION_PREFIXES = ["~/", ".claude/settings"];

export function touchesImmutableSet(paths: string[]): boolean {
  return paths.some((path) => IMMUTABLE_SET.some((entry) => path === entry || path.startsWith(entry)));
}

export function touchesWorkstation(paths: string[]): boolean {
  return paths.some((path) => WORKSTATION_PREFIXES.some((prefix) => path.startsWith(prefix)));
}
