import { isAbsolute } from "node:path";

export function repoScoped(paths: readonly string[]): string[] {
  return paths.filter((path) => !isAbsolute(path) && !path.split(/[\\/]/).includes(".."));
}
