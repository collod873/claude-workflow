import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LINTABLE, listedFiles, sha } from "./files.mjs";

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
const TSCONFIG = /(?:^|\/)[jt]sconfig[^/]*\.json$/;
const ESLINT_CONFIG = /^eslint\.config\.[cm]?[jt]s$/;

const trees = new Map();

async function treeFacts(root) {
  const { importClosures } = await import("./closure.mjs");
  const listed = listedFiles(root);
  const toolchain = createHash("sha256");
  for (const file of listed.filter((name) => LOCKFILES.includes(name) || TSCONFIG.test(name)))
    toolchain.update(`${file}\0`).update(readFileSync(join(root, file)));
  return {
    listed,
    toolchainDigest: toolchain.digest("hex"),
    ...importClosures(
      root,
      listed.filter((file) => LINTABLE.test(file)),
      new Set(listed),
    ),
  };
}

function receiptTree(root) {
  if (!trees.has(root)) trees.set(root, treeFacts(root));
  return trees.get(root);
}

function unfollowed(_key, value) {
  return value !== null && typeof value === "object" && value.followsImports === true
    ? undefined
    : value;
}

async function lintDigests(root, engine, candidates) {
  const { listed, toolchainDigest, closureOf, contentOf } = await receiptTree(root);
  const configs = listed.filter((file) => ESLINT_CONFIG.test(file));
  const shared = sha(
    JSON.stringify([toolchainDigest, configs.map((file) => [file, closureOf(file)])]),
  );
  const configDigests = new Map();
  const digested = await Promise.all(
    candidates.map(async (file) => {
      const path = join(root, file);
      if (await engine.isPathIgnored(path)) return undefined;
      const config = await engine.calculateConfigForFile(path);
      if (!configDigests.has(config))
        configDigests.set(
          config,
          sha(JSON.stringify(config, unfollowed).replaceAll(root, "<root>")),
        );
      const content = closureOf(file) ?? contentOf.get(file) ?? sha(readFileSync(path, "utf8"));
      return [file, sha(JSON.stringify([shared, configDigests.get(config), file, content]))];
    }),
  );
  return new Map(digested.filter(Boolean));
}

async function receiptedRun(handed, digests, run) {
  const held = new Set(readFileSync(join(handed, "held"), "utf8").split("\n"));
  const due = [...digests].filter(([, digest]) => !held.has(digest));
  if (due.length === 0) return true;
  const clean = await run(due.map(([file]) => file));
  if (clean)
    appendFileSync(join(handed, "passed"), due.map(([, digest]) => `${digest}\n`).join(""));
  return clean;
}

export async function eslintStage(root, files, eslint) {
  const handed = process.env.CHECK_FILE_RECEIPTS;
  if (!handed) return eslintRun(root, files);
  const engine = eslint ?? new (await import("eslint")).ESLint({ cwd: root });
  const candidates = (files.length > 0 ? files : (await receiptTree(root)).listed).filter((file) =>
    LINTABLE.test(file),
  );
  const digests = await lintDigests(root, engine, candidates);
  return receiptedRun(handed, digests, (due) => eslintRun(root, due));
}

const OXLINT_CONFIG = join(dirname(fileURLToPath(import.meta.url)), "oxlint.json");

function oxlintRun(root, typed) {
  if (typed.length === 0) return true;
  return stageAsync(
    "oxlint",
    packageBin("oxlint", "bin/oxlint"),
    ["--type-aware", "--deny-warnings", "-c", OXLINT_CONFIG, ...typed],
    root,
    { OXLINT_TSGOLINT_PATH: packageBin("oxlint-tsgolint", "bin/tsgolint.js") },
  );
}

async function typeAwareDigests(root, typed) {
  const { toolchainDigest, closureOf, ambientDigest } = await receiptTree(root);
  const shared = sha(
    JSON.stringify(["oxlint", sha(readFileSync(OXLINT_CONFIG)), toolchainDigest, ambientDigest]),
  );
  return new Map(typed.map((file) => [file, sha(JSON.stringify([shared, file, closureOf(file)]))]));
}

export async function oxlintStage(root, files, eslint) {
  const handed = process.env.CHECK_FILE_RECEIPTS;
  const pool =
    files.length > 0 ? files : handed ? (await receiptTree(root)).listed : listedFiles(root);
  const candidates = pool.filter((file) => /\.[cm]?tsx?$/.test(file));
  const engine = eslint ?? new (await import("eslint")).ESLint({ cwd: root });
  const ignored = await Promise.all(
    candidates.map((file) => engine.isPathIgnored(join(root, file))),
  );
  const typed = candidates.filter((_, index) => !ignored[index]);
  if (!handed) return oxlintRun(root, typed);
  return receiptedRun(handed, await typeAwareDigests(root, typed), (due) => oxlintRun(root, due));
}

export function refused(layer, refusals, verb = "lint") {
  for (const refusal of refusals) console.error(`${verb}: refused, ${refusal}`);
  if (refusals.length > 0) {
    console.error(`${verb}: the ${layer} layer is shared; change it in agent-hooks, not here`);
  }
  return refusals.length > 0;
}

function buildInfoOf(root, tsc, config) {
  const shown = spawnSync(process.execPath, [tsc, "-p", config, "--showConfig"], {
    cwd: root,
    encoding: "utf8",
  });
  try {
    const file = JSON.parse(shown.stdout).compilerOptions?.tsBuildInfoFile;
    return file ? resolve(root, dirname(config), file) : null;
  } catch {
    return null;
  }
}

export function tscStage(root, config) {
  const tsc = packageBin("typescript-native", "bin/tsc");
  const incremental = spawnSync(process.execPath, [tsc, "-p", config], {
    cwd: root,
    env: process.env,
  });
  if (incremental.error) throw incremental.error;
  if (incremental.status === 0) {
    process.stdout.write(incremental.stdout);
    process.stderr.write(incremental.stderr);
    return true;
  }
  const buildInfo = buildInfoOf(root, tsc, config);
  if (buildInfo && existsSync(buildInfo)) rmSync(buildInfo);
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
