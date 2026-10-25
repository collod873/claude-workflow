import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listedFiles } from "./files.mjs";
import { knipBase } from "./knip.base.mjs";
import { refused, stage } from "./stages.mjs";
import { pinnedTools } from "./tools.mjs";

const ROOT_CONFIG = "knip.config.ts";
const OTHER_CONFIG = /(?:^|\/)\.?knip\.(?:jsonc?|[cm]?[jt]s)$/;
const PINNED = pinnedTools.knip;

function otherConfigRefusals(root, files) {
  const others = files
    .filter(
      (file) => file !== ROOT_CONFIG && !file.startsWith("shared/") && OTHER_CONFIG.test(file),
    )
    .map(
      (file) =>
        `${file} is a knip config of its own; only ${ROOT_CONFIG} at the root may configure knip`,
    );
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if ("knip" in manifest) others.push(`package.json configures knip; only ${ROOT_CONFIG} may`);
  return others;
}

function dropsBase(config) {
  return Object.entries(knipBase).some(([key, shared]) => {
    const own = config[key];
    if (Array.isArray(shared))
      return !Array.isArray(own) || shared.some((item) => !own.includes(item));
    return Object.entries(shared).some(
      ([file, kinds]) => !kinds.every((kind) => own?.[file]?.includes(kind)),
    );
  });
}

async function configRefusals(root, files) {
  const refusals = otherConfigRefusals(root, files);
  const configFile = join(root, ROOT_CONFIG);
  if (!existsSync(configFile)) {
    return [...refusals, `there is no root ${ROOT_CONFIG} extending the shared base from shared/`];
  }
  const loaded = await import(pathToFileURL(configFile).href);
  if (dropsBase(await loaded.default)) {
    refusals.push(
      `${ROOT_CONFIG} drops part of the shared base from shared/typescript/knip.base.mjs`,
    );
  }
  return refusals;
}

function installedKnip(root) {
  const manifest = join(root, "node_modules", "knip", "package.json");
  if (!existsSync(manifest)) return [`knip is not installed; install knip ${PINNED} from shared/`];
  const { version } = JSON.parse(readFileSync(manifest, "utf8"));
  return version === PINNED ? [] : [`knip ${version} is installed, not the shared pin ${PINNED}`];
}

function runCache(root) {
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(homedir(), ".cache", "agent-hooks", "knip-runs", key);
}

const root = process.cwd();
const refusals = [...(await configRefusals(root, listedFiles(root))), ...installedKnip(root)];
if (refused("typescript", refusals, "unused")) process.exit(1);
const knipArgs = [
  "--no-progress",
  "--cache",
  "--cache-location",
  runCache(root),
  ...process.argv.slice(2),
];
const knipScript = join(root, "node_modules", "knip", "bin", "knip.js");
process.exit(
  stage("knip", process.execPath, [knipScript, ...knipArgs], root, {}, "unused") ? 0 : 1,
);
