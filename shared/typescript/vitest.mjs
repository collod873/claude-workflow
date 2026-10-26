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

function needingIsolation(include, exclude, isolateImporting) {
  const markers = [...REGISTRY_TOUCHING, ...isolateImporting.map((module) => `"${module}"`)];
  return globSync(include, { exclude }).filter((file) => {
    const source = readFileSync(file, "utf8");
    return markers.some((marker) => source.includes(marker));
  });
}

export function sharedAndIsolated(name, test, resolve = {}, isolateImporting = []) {
  const isolated = needingIsolation(test.include, test.exclude, isolateImporting);
  return [
    { resolve, test: { ...test, name, isolate: false, exclude: [...test.exclude, ...isolated] } },
    {
      resolve,
      test: {
        ...test,
        name: `${name}-isolated`,
        pool: "vmThreads",
        isolate: true,
        include: isolated,
      },
    },
  ];
}
