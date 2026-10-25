import { globSync, readFileSync } from "node:fs";

export const testDefaults = Object.freeze({
  pool: "threads",
  mockReset: true,
  restoreMocks: true,
  unstubGlobals: true,
  unstubEnvs: true,
  testTimeout: 15_000,
  hookTimeout: 15_000,
  passWithNoTests: true,
  exclude: ["node_modules/**", ".next/**", ".claude/worktrees/**"],
});

const REGISTRY_TOUCHING = ["vi.mock(", "vi.resetModules("];

function touchingModuleRegistry(include, exclude) {
  return globSync(include, { exclude }).filter((file) => {
    const source = readFileSync(file, "utf8");
    return REGISTRY_TOUCHING.some((call) => source.includes(call));
  });
}

export function sharedAndIsolated(name, test, resolve = {}) {
  const isolated = touchingModuleRegistry(test.include, test.exclude);
  return [
    { resolve, test: { ...test, name, isolate: false, exclude: [...test.exclude, ...isolated] } },
    { resolve, test: { ...test, name: `${name}-isolated`, isolate: true, include: isolated } },
  ];
}
