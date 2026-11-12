import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";

const KNIP_PLUGIN_CACHE = /^plugins-/;

function readableEntries(fileCache) {
  try {
    return deserialize(readFileSync(fileCache));
  } catch {
    rmSync(fileCache);
    return new Map();
  }
}

function withoutUnresolvedImports(fileCache) {
  const entries = readableEntries(fileCache);
  const unresolving = [...entries]
    .filter(([, entry]) => entry.data?.imports?.unresolved?.size)
    .map(([file]) => file);
  if (unresolving.length === 0) return;
  for (const file of unresolving) entries.delete(file);
  writeFileSync(fileCache, serialize(entries));
}

export function withoutStaleVerdicts(cache) {
  if (!existsSync(cache)) return cache;
  for (const entry of readdirSync(cache)) {
    if (KNIP_PLUGIN_CACHE.test(entry)) rmSync(join(cache, entry));
    else withoutUnresolvedImports(join(cache, entry));
  }
  return cache;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) withoutStaleVerdicts(process.argv[2]);
