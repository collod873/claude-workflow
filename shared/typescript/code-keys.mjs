import { readFileSync, realpathSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { installedPackageDir, sha } from "./files.mjs";

const IN_PACKAGE = /^(.*[\\/]node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;
const UNCAPTURED_SCOPE = /^(?:Module|Script|Global)\b/;
const COMMONJS_WRAPPER = ["exports", "require", "module", "__filename", "__dirname"];
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const PROBE = "__lintCodeProbe";
const GROUP = "lint-code";

const internal = (properties, name) => properties.find((entry) => entry.name === name)?.value;

export function enabledRules(config) {
  return Object.entries(config.rules ?? {}).flatMap(([id, setting]) => {
    const [severity, ...options] = Array.isArray(setting) ? setting : [setting];
    const slash = id.lastIndexOf("/");
    if (severity === 0 || severity === "off" || slash === -1) return [];
    const rule = config.plugins?.[id.slice(0, slash)]?.rules?.[id.slice(slash + 1)];
    if (rule === undefined)
      throw new Error(`lint: ${id} is on, but no plugin in its config defines it`);
    return [{ id, options, rule }];
  });
}

export async function codeKeys({ root, held, closureOf }) {
  const session = new Session();
  session.connect();
  const scripts = new Map();
  session.on("Debugger.scriptParsed", ({ params }) => scripts.set(params.scriptId, params.url));
  await session.post("Debugger.enable");
  const packageDirs = new Set();
  const functionKeys = new Map();
  let probes = 0;

  const remoteOf = async (value) => {
    const slot = `${PROBE}${probes++}`;
    globalThis[slot] = value;
    const { result } = await session.post("Runtime.evaluate", {
      expression: `globalThis.${slot}`,
      objectGroup: GROUP,
    });
    delete globalThis[slot];
    return result;
  };

  const localOf = async (remote) => {
    if (!remote?.objectId) return remote?.unserializableValue ?? remote?.value;
    const slot = `${PROBE}${probes++}`;
    await session.post("Runtime.callFunctionOn", {
      objectId: remote.objectId,
      functionDeclaration: `function () { "use strict"; globalThis.${slot} = this; }`,
      objectGroup: GROUP,
    });
    const value = globalThis[slot];
    delete globalThis[slot];
    return value;
  };

  const propertiesOf = async (objectId) =>
    session.post("Runtime.getProperties", { objectId, ownProperties: true, objectGroup: GROUP });

  async function capturedBy(scopes, chain, frame) {
    if (!scopes?.objectId) return [];
    const captured = [];
    for (const scope of (await propertiesOf(scopes.objectId)).result) {
      const description = scope.value?.description ?? "";
      if (scope.value?.subtype !== "internal#scope" || UNCAPTURED_SCOPE.test(description)) continue;
      const variables = (await propertiesOf(scope.value.objectId)).result;
      const names = variables.map((variable) => variable.name);
      if (COMMONJS_WRAPPER.every((name) => names.includes(name))) continue;
      for (const variable of variables)
        captured.push([
          variable.name,
          await keyed(await localOf(variable.value), chain, [], frame),
        ]);
    }
    return captured;
  }

  async function locationOf(fn) {
    const remote = await remoteOf(fn);
    const { internalProperties = [] } = await propertiesOf(remote.objectId);
    const location = internal(internalProperties, "[[FunctionLocation]]")?.value;
    const url = location && scripts.get(location.scriptId);
    const at = location && [location.lineNumber, location.columnNumber];
    const file = !url ? undefined : url.startsWith("file:") ? fileURLToPath(url) : url;
    const inPackage = file && IN_PACKAGE.exec(file);
    return { internalProperties, url, at, file, inPackage };
  }

  async function codeParts(fn, chain, frame) {
    const { internalProperties, url, at, file, inPackage } = await locationOf(fn);
    const target = internal(internalProperties, "[[TargetFunction]]");
    if (target)
      return [
        "bound",
        await keyed(await localOf(target), chain, [], frame),
        await keyed(await localOf(internal(internalProperties, "[[BoundArgs]]")), chain, [], frame),
      ];
    if (!url) return ["source", sha(Function.prototype.toString.call(fn))];
    if (!url.startsWith("file:") && !isAbsolute(url)) return ["runtime", url, at];
    if (inPackage) {
      const dir = `${inPackage[1]}${inPackage[2]}`;
      packageDirs.add(realpathSync(dir));
      return ["package", inPackage[2], relative(dir, file), at];
    }
    const named = relative(root, file);
    const inRepo = held.has(named);
    return [
      "file",
      inRepo ? named : file,
      (inRepo && closureOf(named)) || sha(readFileSync(file)),
      at,
      await capturedBy(internal(internalProperties, "[[Scopes]]"), chain, frame),
    ];
  }

  async function functionKey(fn, chain, frame) {
    if (functionKeys.has(fn)) return functionKeys.get(fn);
    if (chain.includes(fn)) {
      frame.cyclic = true;
      return "cycle";
    }
    const own = { cyclic: false };
    const key = sha(JSON.stringify(await codeParts(fn, [...chain, fn], own)));
    if (own.cyclic) frame.cyclic = true;
    else functionKeys.set(fn, key);
    return key;
  }

  async function keyedAll(values, chain, ancestors, frame) {
    const keyedValues = [];
    for (const value of values) keyedValues.push(await keyed(value, chain, ancestors, frame));
    return keyedValues;
  }

  async function keyed(value, chain, ancestors, frame) {
    if (typeof value === "function") return { code: await functionKey(value, chain, frame) };
    if (typeof value === "bigint" || typeof value === "symbol") return String(value);
    if (value === null || typeof value !== "object") return value;
    if (ancestors.includes(value)) return "cycle";
    const inner = [...ancestors, value];
    if (value instanceof RegExp) return { regexp: String(value) };
    if (value instanceof Map) return { map: await keyedAll([...value], chain, inner, frame) };
    if (value instanceof Set) return { set: await keyedAll([...value], chain, inner, frame) };
    if (typeof value.toJSON === "function") return keyed(value.toJSON(), chain, inner, frame);
    if (Array.isArray(value)) return keyedAll(value, chain, inner, frame);
    const entries = {};
    for (const [key, child] of Object.entries(value))
      entries[key] = await keyed(child, chain, inner, frame);
    return entries;
  }

  async function ruleCode(config) {
    const code = {};
    for (const { id, rule } of enabledRules(config)) code[id] = await keyed(rule, [], [], {});
    return code;
  }

  return {
    keyedValue: (value) => keyed(value, [], [], {}),
    async packageOf(rule) {
      const { inPackage } = await locationOf(typeof rule === "function" ? rule : rule.create);
      return inPackage?.[2].replaceAll("\\", "/");
    },
    async keyedConfig(config) {
      const withoutPlugins = { ...config, plugins: undefined };
      return { ...(await keyed(withoutPlugins, [], [], {})), ruleCode: await ruleCode(config) };
    },
    packagesFrom(dirs) {
      const versions = new Map();
      const pending = [...packageDirs, ...dirs];
      for (const dir of pending) {
        if (versions.has(dir)) continue;
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        versions.set(dir, `${manifest.name}@${manifest.version}`);
        for (const field of DEPENDENCY_FIELDS)
          for (const name of Object.keys(manifest[field] ?? {})) {
            const found = installedPackageDir(dir, name);
            if (found) pending.push(found);
          }
      }
      return [...new Set(versions.values())].sort();
    },
    async close() {
      await session.post("Runtime.releaseObjectGroup", { objectGroup: GROUP });
      await session.post("Debugger.disable");
      session.disconnect();
    },
  };
}
