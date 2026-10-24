import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function packageBin(name, bin) {
  return join(dirname(require.resolve(`${name}/package.json`)), bin);
}

export function stage(title, command, args, root, env = {}, verb = "lint") {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) console.error(`${verb}: ${title} failed`);
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

export function refused(layer, refusals, verb = "lint") {
  for (const refusal of refusals) console.error(`${verb}: refused, ${refusal}`);
  if (refusals.length > 0) {
    console.error(`${verb}: the ${layer} layer is shared; change it in agent-hooks, not here`);
  }
  return refusals.length > 0;
}

export function tscStage(root, config) {
  const tsc = packageBin("typescript-native", "bin/tsc");
  return stage("tsc", process.execPath, [tsc, "-p", config], root, {}, "typecheck");
}
