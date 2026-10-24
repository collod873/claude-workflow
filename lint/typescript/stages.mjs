import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function packageBin(name, bin) {
  return join(dirname(require.resolve(`${name}/package.json`)), bin);
}

export function stage(title, command, args, root) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) console.error(`lint: ${title} failed`);
  return result.status === 0;
}

export function eslintStage(root, files) {
  const targets = files.length > 0 ? ["--no-warn-ignored", ...files] : ["."];
  return stage(
    "eslint",
    process.execPath,
    [packageBin("eslint", "bin/eslint.js"), "--max-warnings", "0", ...targets],
    root,
  );
}

export function refused(layer, refusals) {
  for (const refusal of refusals) console.error(`lint: refused, ${refusal}`);
  if (refusals.length > 0) {
    console.error(`lint: the ${layer} layer is shared; change it in agent-hooks, not here`);
  }
  return refusals.length > 0;
}
