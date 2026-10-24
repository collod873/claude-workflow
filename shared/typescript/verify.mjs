import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { LINTABLE, listedFiles } from "./files.mjs";
import { SHARED_BLOCKS } from "./index.mjs";

const PARSER_KEYS = ["project", "projectService", "tsconfigRootDir", "program"];
const ROOT_CONFIG = "eslint.config.mjs";
const OTHER_CONFIG = /(?:^|\/)(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.[a-z]+)?)$/;

export function otherConfigRefusals(files) {
  return files
    .filter((file) => file !== ROOT_CONFIG && OTHER_CONFIG.test(file))
    .map(
      (file) =>
        `${file} is an ESLint config of its own, which ESLint would use instead of ${ROOT_CONFIG}`,
    );
}

export async function loadRootConfig(root) {
  const configFile = join(root, ROOT_CONFIG);
  const loaded = await import(pathToFileURL(configFile).href);
  const blocks = [await loaded.default].flat(Number.POSITIVE_INFINITY);
  return { configFile, blocks, rootModule: loaded };
}

function blockLabel(block, index) {
  return block.name ? `block ${index} (${block.name})` : `block ${index}`;
}

function changesParser(block) {
  const options = block.languageOptions ?? {};
  const parserOptions = options.parserOptions ?? {};
  return "parser" in options || PARSER_KEYS.some((key) => key in parserOptions);
}

export function structuralRefusals(blocks) {
  const sharedBlocks = blocks.filter((block) => SHARED_BLOCKS.has(block));
  if (sharedBlocks.length === 0) {
    return ["eslint.config.mjs does not spread the shared layer from shared/"];
  }
  const firstOwn = blocks.findIndex((block) => !SHARED_BLOCKS.has(block));
  const own = firstOwn === -1 ? [] : blocks.slice(firstOwn);
  const refusals = [];
  if (own.some((block) => SHARED_BLOCKS.has(block))) {
    refusals.push(
      "the shared layer's blocks must come first in eslint.config.mjs, before the repo's own",
    );
  }
  const sharedRules = new Set(sharedBlocks.flatMap((block) => Object.keys(block.rules ?? {})));
  const sharedPlugins = new Map(
    sharedBlocks.flatMap((block) => Object.entries(block.plugins ?? {})),
  );
  own.forEach((block, offset) => {
    if (SHARED_BLOCKS.has(block)) return;
    const label = blockLabel(block, firstOwn + offset);
    if (block.linterOptions)
      refusals.push(`${label} sets linterOptions, which the shared layer owns`);
    if (changesParser(block)) refusals.push(`${label} changes the parser the shared layer sets`);
    for (const rule of Object.keys(block.rules ?? {})) {
      if (sharedRules.has(rule))
        refusals.push(`${label} re-sets ${rule}, which the shared layer sets`);
    }
    for (const [name, registered] of Object.entries(block.plugins ?? {})) {
      if (sharedPlugins.has(name) && sharedPlugins.get(name) !== registered) {
        refusals.push(`${label} registers its own ${name} plugin over the shared one`);
      }
    }
  });
  return refusals;
}

function differences(alone, whole) {
  const found = [];
  if (JSON.stringify(alone.linterOptions) !== JSON.stringify(whole.linterOptions)) {
    found.push("linterOptions");
  }
  for (const [rule, entry] of Object.entries(alone.rules ?? {})) {
    if (JSON.stringify(entry) !== JSON.stringify(whole.rules?.[rule])) found.push(rule);
  }
  return found;
}

function remember(seen, key, file) {
  const files = seen.get(key) ?? [];
  files.push(file);
  seen.set(key, files);
}

function summarized(seen, say) {
  return [...seen].map(([key, files]) => {
    const more = files.length > 1 ? ` and ${files.length - 1} more` : "";
    return say(key, `${files[0]}${more}`);
  });
}

export function sharedEngine(root, blocks) {
  const overrideConfig = blocks.filter((block) => SHARED_BLOCKS.has(block));
  return new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig });
}

export async function effectiveRefusals(root, configFile, blocks, files) {
  const whole = new ESLint({ cwd: root, overrideConfigFile: configFile });
  const alone = sharedEngine(root, blocks);
  const ignored = new Map();
  const changed = new Map();
  const compared = new Map();
  for (const file of files.filter((name) => LINTABLE.test(name))) {
    const path = join(root, file);
    if (await alone.isPathIgnored(path)) continue;
    if (await whole.isPathIgnored(path)) {
      remember(ignored, "ignored", file);
      continue;
    }
    const shared = await alone.calculateConfigForFile(path);
    const effective = await whole.calculateConfigForFile(path);
    const byEffective = compared.get(shared) ?? new Map();
    compared.set(shared, byEffective);
    if (!byEffective.has(effective)) byEffective.set(effective, differences(shared, effective));
    for (const rule of byEffective.get(effective)) remember(changed, rule, file);
  }
  return [
    ...summarized(
      ignored,
      (_, where) => `the repo layer ignores files the shared layer lints: ${where}`,
    ),
    ...summarized(
      changed,
      (rule, where) => `the repo layer changes ${rule} from the shared layer at ${where}`,
    ),
  ];
}

export async function eslintRefusals(root, files = listedFiles(root)) {
  const { configFile, blocks } = await loadRootConfig(root);
  const structural = [...otherConfigRefusals(files), ...structuralRefusals(blocks)];
  if (!blocks.some((block) => SHARED_BLOCKS.has(block))) return structural;
  return [...structural, ...(await effectiveRefusals(root, configFile, blocks, files))];
}
