import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ALWAYS_OWN = new Set(["paths", "pathsBasePath", "configFilePath"]);

function parsed(file) {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  return ts.getParsedCommandLineOfConfigFile(file, {}, host);
}

function sharedParent(root, raw) {
  const parents = [raw.extends ?? []].flat().map((name) => resolve(root, name));
  return parents.find((file) => relative(join(root, "shared"), file).split("/")[0] !== "..");
}

export function tsconfigRefusals(root, { ownsFileList }) {
  const config = join(root, "tsconfig.json");
  const raw = ts.readConfigFile(config, ts.sys.readFile).config ?? {};
  const parent = sharedParent(root, raw);
  if (!parent) return ["tsconfig.json does not extend a config in shared/"];
  const theirs = parsed(config).options;
  const ours = parsed(parent).options;
  const changed = [...new Set([...Object.keys(theirs), ...Object.keys(ours)])].filter(
    (key) => !ALWAYS_OWN.has(key) && JSON.stringify(theirs[key]) !== JSON.stringify(ours[key]),
  );
  const fileList = ownsFileList ? [] : ["include", "exclude", "files"].filter((key) => key in raw);
  return [...changed, ...fileList].map(
    (key) => `tsconfig.json sets ${key}, which the shared layer owns`,
  );
}
