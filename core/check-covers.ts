import { matchesGlob, relative } from "node:path";
import vitest from "./vitest.config.ts";

export function coveredByCheck(check: string): (file: string) => boolean {
  const fedToTools = new Set([...check.matchAll(/^run .*$/gm)].flatMap(([line]) => line.match(/core\/\S+/g) ?? []));
  const collects = vitest.test?.include ?? [];
  return (file) => fedToTools.has(file) || collects.some((glob) => matchesGlob(relative("core", file), glob));
}
