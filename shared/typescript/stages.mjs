import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codeKeys, enabledRules } from "./code-keys.mjs";
import { installedPackageDir, LINTABLE, listedFiles, sha } from "./files.mjs";

const require = createRequire(import.meta.url);

function packageDir(name) {
  return realpathSync(dirname(require.resolve(`${name}/package.json`)));
}

export function packageBin(name, bin) {
  return join(packageDir(name), bin);
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

const CODE_KEYED_CACHES = "node_modules/.cache/eslint-code";

function cacheForCode(root, codeDigest) {
  const caches = join(root, CODE_KEYED_CACHES);
  for (const entry of existsSync(caches) ? readdirSync(caches) : [])
    if (entry !== codeDigest) rmSync(join(caches, entry), { recursive: true, force: true });
  return `${CODE_KEYED_CACHES}/${codeDigest}/`;
}

function eslintRun(root, files, cacheLocation) {
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
      cacheLocation,
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
  const held = new Set(listed);
  const toolchain = createHash("sha256");
  for (const file of listed.filter((name) => LOCKFILES.includes(name) || TSCONFIG.test(name)))
    toolchain.update(`${file}\0`).update(readFileSync(join(root, file)));
  return {
    listed,
    held,
    toolchainDigest: toolchain.digest("hex"),
    ...importClosures(
      root,
      listed.filter((file) => LINTABLE.test(file)),
      held,
    ),
  };
}

function receiptTree(root) {
  if (!trees.has(root)) trees.set(root, treeFacts(root));
  return trees.get(root);
}

function sharedPart(_key, value) {
  if (value === null || typeof value !== "object") return value;
  if (value.followsImports === true) return undefined;
  if (value.namesInFile === true) return { ...value, names: undefined };
  return value;
}

function sharedConfig(config) {
  const plain = JSON.parse(JSON.stringify(config));
  if (plain.settings === undefined) return plain;
  return { ...plain, settings: JSON.parse(JSON.stringify(plain.settings, sharedPart)) };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const IDENTIFIER_WORD = /[A-Za-z_$][\w$]*/g;

function checkedNames(path, names) {
  const pairs = Array.isArray(names)
    ? names.map((name) => [name, null])
    : names !== null && typeof names === "object"
      ? Object.entries(names)
      : undefined;
  if (
    pairs === undefined ||
    pairs.some(([name]) => typeof name !== "string" || !IDENTIFIER.test(name))
  )
    throw new Error(
      `${path}.names must be a list of identifiers or a map of identifiers to values`,
    );
  return new Map(pairs);
}

function namesHeldIn(named, text) {
  const words = new Set(text.match(IDENTIFIER_WORD));
  return named.map(([path, names]) => [
    path,
    [...names].filter(([name]) => words.has(name)).sort(([a], [b]) => (a < b ? -1 : 1)),
  ]);
}

const FULL_CLOSURE = Symbol("full closure");

function markedSettings(value, path, found) {
  if (value === null || typeof value !== "object") return found;
  if (value.followsImports === true || value.namesInFile === true) return [...found, [path, value]];
  return Object.entries(value).reduce(
    (inner, [key, child]) => markedSettings(child, `${path}.${key}`, inner),
    found,
  );
}

function checkedReads(path, reads) {
  if (reads === null || typeof reads !== "object" || Array.isArray(reads))
    throw new Error(`${path}.reads must be an object naming clientBoundary or content`);
  const { clientBoundary = false, content = [], ...unknown } = reads;
  const misnamed = Object.keys(unknown);
  if (misnamed.length > 0)
    throw new Error(
      `${path}.reads names ${misnamed.join(", ")}; a followsImports setting reads clientBoundary or content`,
    );
  if (typeof clientBoundary !== "boolean")
    throw new Error(`${path}.reads.clientBoundary must be true or false`);
  if (!Array.isArray(content) || content.some((pattern) => typeof pattern !== "string"))
    throw new Error(`${path}.reads.content must be a list of file patterns`);
  return { clientBoundary, content };
}

function importedReads(marked) {
  const followed = marked.filter(([, setting]) => setting.followsImports === true);
  if (followed.length === 0) return undefined;
  if (followed.some(([, setting]) => setting.reads === undefined)) return FULL_CLOSURE;
  const each = followed.map(([path, setting]) => checkedReads(path, setting.reads));
  return {
    clientBoundary: each.some((reads) => reads.clientBoundary),
    content: [...new Set(each.flatMap((reads) => reads.content))].sort(),
  };
}

function settingFacts(marked) {
  return {
    reads: importedReads(marked),
    named: marked
      .filter(([, setting]) => setting.followsImports !== true)
      .map(([path, setting]) => [path, checkedNames(path, setting.names)]),
  };
}

const TAILWIND_PACKAGE = "eslint-plugin-better-tailwindcss";
const TAILWIND_SETTINGS = "better-tailwindcss";
const TAILWIND_ENTRIES = ["entryPoint", "tailwindConfig"];
const CSS_REFERENCE = /@(import|plugin|config|reference|source)\s+(?:url\(\s*)?["']([^"']+)["']/g;
const REMOTE = /^[a-z][\w+.-]*:/i;
const PACKAGE_NAME = /^((?:@[^/@.][^/]*\/)?[^/@.][^/]*)/;

function cssClosure(root, entry, { held, closureOf }) {
  const reached = new Map();
  const pending = [[resolve(root, entry), `entry point "${entry}"`, "the lint config"]];
  for (const [file, reference, from] of pending) {
    if (reached.has(file)) continue;
    if (!existsSync(file)) throw new Error(`lint: cannot resolve ${reference} in ${from}`);
    const name = relative(root, file);
    const text = readFileSync(file, "utf8");
    reached.set(name, (held.has(name) && closureOf(name)) || sha(text));
    if (!file.endsWith(".css")) continue;
    for (const [, kind, target] of text.matchAll(CSS_REFERENCE)) {
      if (kind === "source" || REMOTE.test(target)) continue;
      const label = `@${kind} "${target}"`;
      if (target.startsWith(".")) {
        pending.push([resolve(dirname(file), target), label, name]);
        continue;
      }
      const packageName = PACKAGE_NAME.exec(target)?.[1];
      const dir = packageName && installedPackageDir(dirname(file), packageName);
      if (!dir) throw new Error(`lint: cannot resolve ${label} in ${name}`);
      const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      reached.set(label, `${packageName}@${version}`);
    }
  }
  return [...reached].sort();
}

async function tailwindReads(root, config, code, tree) {
  const entries = new Set();
  for (const { id, options, rule } of enabledRules(config)) {
    if ((await code.packageOf(rule)) !== TAILWIND_PACKAGE) continue;
    const named = [options[0] ?? {}, config.settings?.[TAILWIND_SETTINGS] ?? {}].flatMap((source) =>
      TAILWIND_ENTRIES.map((key) => source[key]),
    );
    const entry = named.find((value) => typeof value === "string");
    if (entry === undefined)
      throw new Error(
        `lint: ${id} reads Tailwind's CSS, but neither its options nor settings["${TAILWIND_SETTINGS}"] name an ${TAILWIND_ENTRIES.join(" or ")}, so no receipt can key that CSS`,
      );
    entries.add(entry);
  }
  return [...entries].sort().map((entry) => cssClosure(root, entry, tree));
}

const DEPENDENCY_LISTS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function dependencyNames(root, listed) {
  return listed
    .filter((file) => basename(file) === "package.json")
    .map((file) => {
      const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
      return [file, DEPENDENCY_LISTS.flatMap((list) => Object.keys(manifest[list] ?? {})).sort()];
    });
}

function eslintToolchain(root, listed, packages) {
  return {
    tsconfigs: listed
      .filter((file) => TSCONFIG.test(file))
      .map((file) => [file, sha(readFileSync(join(root, file)))]),
    dependencies: dependencyNames(root, listed),
    packages,
  };
}

function eslintShared(root, tree, code) {
  const imported = tree.listed
    .filter((file) => ESLINT_CONFIG.test(file))
    .flatMap(tree.packagesImportedBy)
    .map(([importer, name]) => installedPackageDir(dirname(join(root, importer)), name))
    .filter(Boolean);
  return sha(
    JSON.stringify(
      eslintToolchain(root, tree.listed, code.packagesFrom([...imported, packageDir("eslint")])),
    ),
  );
}

function ruleBearing(block) {
  if (block.plugins === undefined) return block;
  const plugins = Object.fromEntries(
    Object.entries(block.plugins).map(([name, plugin]) => [
      name,
      { rules: plugin.rules, processors: plugin.processors },
    ]),
  );
  return { ...block, plugins };
}

async function codeDigestOf(root, code, tree) {
  const { loadRootConfig } = await import("./verify.mjs");
  const { blocks } = await loadRootConfig(root);
  const keyedBlocks = await code.keyedValue(blocks.map(ruleBearing));
  const entries = blocks.flatMap((block) => [
    ...TAILWIND_ENTRIES.map((key) => block.settings?.[TAILWIND_SETTINGS]?.[key]),
    ...Object.values(block.rules ?? {}).flatMap((setting) =>
      Array.isArray(setting) ? TAILWIND_ENTRIES.map((key) => setting[1]?.[key]) : [],
    ),
  ]);
  const css = [...new Set(entries.filter((entry) => typeof entry === "string"))]
    .sort()
    .map((entry) => cssClosure(root, entry, tree));
  const resolutions = tree.listed
    .filter((file) => LINTABLE.test(file))
    .map((file) => [file, tree.resolutionsOf(file)]);
  return sha(
    JSON.stringify([
      eslintShared(root, tree, code),
      JSON.parse(JSON.stringify(keyedBlocks, sharedPart)),
      css,
      resolutions,
    ]).replaceAll(root, "<root>"),
  );
}

async function lintDigests(root, engine, candidates, code, tree) {
  const { closureOf, contentOf, readsClosureOf, resolutionsOf } = tree;
  const configFacts = new Map();
  const factsOf = async (config) => ({
    digest: sha(
      JSON.stringify([
        sharedConfig(await code.keyedConfig(config)),
        await tailwindReads(root, config, code, tree),
      ]).replaceAll(root, "<root>"),
    ),
    ...settingFacts(markedSettings(config.settings, "settings", [])),
  });
  const keyed = await Promise.all(
    candidates.map(async (file) => {
      const path = join(root, file);
      if (await engine.isPathIgnored(path)) return undefined;
      const config = await engine.calculateConfigForFile(path);
      if (!configFacts.has(config)) configFacts.set(config, factsOf(config));
      const { digest, reads, named } = await configFacts.get(config);
      const text =
        contentOf.has(file) && named.length === 0 ? undefined : readFileSync(path, "utf8");
      const own = contentOf.get(file) ?? sha(text);
      const imported =
        reads === undefined
          ? null
          : reads === FULL_CLOSURE
            ? closureOf(file)
            : readsClosureOf(reads)(file);
      const parts = [digest, file, own, imported ?? null, resolutionsOf(file)];
      if (named.length > 0) parts.push(namesHeldIn(named, text));
      return [file, parts];
    }),
  );
  const shared = eslintShared(root, tree, code);
  return new Map(
    keyed.filter(Boolean).map(([file, parts]) => [file, sha(JSON.stringify([shared, ...parts]))]),
  );
}

async function receiptedRun(handed, stage, digests, run) {
  const held = new Set(readFileSync(join(handed, "held"), "utf8").split("\n"));
  const due = [...digests].filter(([, digest]) => !held.has(digest));
  const tally = { stage, ran: due.length, covered: digests.size - due.length };
  appendFileSync(join(handed, "linted"), `${JSON.stringify(tally)}\n`);
  if (due.length === 0) return true;
  const clean = await run(due.map(([file]) => file));
  if (clean)
    appendFileSync(join(handed, "passed"), due.map(([, digest]) => `${digest}\n`).join(""));
  return clean;
}

export async function eslintStage(root, files, eslint) {
  const handed = process.env.CHECK_FILE_RECEIPTS;
  const tree = await receiptTree(root);
  const code = await codeKeys({ root, held: tree.held, closureOf: tree.closureOf });
  let digests;
  let cache;
  try {
    cache = cacheForCode(root, await codeDigestOf(root, code, tree));
    if (handed) {
      const engine = eslint ?? new (await import("eslint")).ESLint({ cwd: root });
      const candidates = (files.length > 0 ? files : tree.listed).filter((file) =>
        LINTABLE.test(file),
      );
      digests = await lintDigests(root, engine, candidates, code, tree);
    }
  } finally {
    await code.close();
  }
  if (!handed) return eslintRun(root, files, cache);
  return receiptedRun(handed, "eslint", digests, (due) => eslintRun(root, due, cache));
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
  return receiptedRun(handed, "oxlint", await typeAwareDigests(root, typed), (due) =>
    oxlintRun(root, due),
  );
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
