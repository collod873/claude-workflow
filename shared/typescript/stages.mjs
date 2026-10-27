import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configShaped, LINTABLE, listedFiles } from "./files.mjs";

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

function eslintRun(root, files) {
  const targets = files.length > 0 ? ["--no-warn-ignored", ...files] : ["."];
  return stageAsync(
    "eslint",
    process.execPath,
    [
      packageBin("eslint", "bin/eslint.js"),
      "--max-warnings",
      "0",
      "--cache",
      "--cache-strategy",
      "content",
      "--cache-location",
      "node_modules/.cache/eslint/",
      ...targets,
    ],
    root,
  );
}

const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"];

async function lintDigests(root, engine, listed, candidates) {
  const ruleCode = createHash("sha256");
  for (const file of listed.filter((name) => configShaped(name) || LOCKFILES.includes(name)))
    ruleCode.update(`${file}\0`).update(readFileSync(join(root, file)));
  const shared = ruleCode.digest("hex");
  const configDigests = new Map();
  const digested = await Promise.all(
    candidates.map(async (file) => {
      const path = join(root, file);
      if (await engine.isPathIgnored(path)) return undefined;
      const config = await engine.calculateConfigForFile(path);
      if (!configDigests.has(config)) {
        const text = JSON.stringify(config).replaceAll(root, "<root>");
        configDigests.set(config, createHash("sha256").update(text).digest("hex"));
      }
      const content = createHash("sha256").update(readFileSync(path)).digest("hex");
      const key = JSON.stringify([shared, configDigests.get(config), file, content]);
      return [file, createHash("sha256").update(key).digest("hex")];
    }),
  );
  const digests = new Map(digested.filter(Boolean));
  return digests;
}

export async function eslintStage(root, files, eslint) {
  const handed = process.env.CHECK_FILE_RECEIPTS;
  if (!handed) return eslintRun(root, files);
  const engine = eslint ?? new (await import("eslint")).ESLint({ cwd: root });
  const listed = listedFiles(root);
  const candidates = (files.length > 0 ? files : listed).filter((file) => LINTABLE.test(file));
  const digests = await lintDigests(root, engine, listed, candidates);
  const held = new Set(readFileSync(join(handed, "held"), "utf8").split("\n"));
  const due = [...digests].filter(([, digest]) => !held.has(digest));
  if (due.length === 0) return true;
  const clean = await eslintRun(
    root,
    due.map(([file]) => file),
  );
  if (clean)
    appendFileSync(join(handed, "passed"), due.map(([, digest]) => `${digest}\n`).join(""));
  return clean;
}

const OXLINT_CONFIG = join(dirname(fileURLToPath(import.meta.url)), "oxlint.json");

export async function oxlintStage(root, files, eslint) {
  const candidates = (files.length > 0 ? files : listedFiles(root)).filter((file) =>
    /\.[cm]?tsx?$/.test(file),
  );
  const engine = eslint ?? new (await import("eslint")).ESLint({ cwd: root });
  const ignored = await Promise.all(
    candidates.map((file) => engine.isPathIgnored(join(root, file))),
  );
  const typed = candidates.filter((_, index) => !ignored[index]);
  if (typed.length === 0) return true;
  return stageAsync(
    "oxlint",
    packageBin("oxlint", "bin/oxlint"),
    ["--type-aware", "--deny-warnings", "-c", OXLINT_CONFIG, ...typed],
    root,
    { OXLINT_TSGOLINT_PATH: packageBin("oxlint-tsgolint", "bin/tsgolint.js") },
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

export function stageAsync(title, command, args, root, env = {}, verb = "lint") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env } });
    const out = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => out.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      process.stderr.write(Buffer.concat(out));
      if (status !== 0) console.error(`${verb}: ${title} failed`);
      resolve(status === 0);
    });
  });
}
