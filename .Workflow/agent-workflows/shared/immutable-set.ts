export const IMMUTABLE_SET = ["vitest.config.ts", ".github/"] as const;

export const IMPLEMENTATION_PR_DISPATCH_ACTION = "implementation-opened";

export function touchesImmutableSet(paths: string[]): boolean {
  return paths.some((path) => IMMUTABLE_SET.some((entry) => path === entry || path.startsWith(entry)));
}
