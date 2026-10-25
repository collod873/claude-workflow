import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stage } from "./stages.mjs";

const INSTALLERS = [
  {
    lockfile: "pnpm-lock.yaml",
    install: ["pnpm", "install", "--frozen-lockfile"],
    codegen: ["pnpm", "codegen"],
  },
  { lockfile: "package-lock.json", install: ["npm", "ci"], codegen: ["npm", "run", "codegen"] },
];
const KEY = join("node_modules", ".shared-setup-key");

function ran(root, [tool, ...args]) {
  return stage(args[0], tool, args, root, {}, "setup");
}

function setup(root) {
  const installer = INSTALLERS.find(({ lockfile }) => existsSync(join(root, lockfile)));
  if (!installer) return 0;
  const manifest = readFileSync(join(root, "package.json"), "utf8");
  const wanted = createHash("sha256")
    .update(readFileSync(join(root, installer.lockfile)))
    .update(manifest)
    .digest("hex");
  const keyPath = join(root, KEY);
  if (existsSync(keyPath) && readFileSync(keyPath, "utf8") === wanted) return 0;
  if (!ran(root, installer.install)) return 1;
  if (JSON.parse(manifest).scripts?.codegen && !ran(root, installer.codegen)) return 1;
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(keyPath, wanted);
  return 0;
}

process.exit(setup(process.cwd()));
