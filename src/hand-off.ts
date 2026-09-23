import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { rowsUnder } from "./machine-page.ts";

const PAGE = "docs/agents/layers/one-ticket.md";
const STOPPED_AT = /^\d+ refusals, stopped at: (.+)$/;
const FIXER = /^The fixer\b/;

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();

function stoppedAt(ticket: string, logs: string): string | undefined {
  if (!existsSync(logs)) return undefined;
  return readdirSync(logs)
    .filter((name) => name.endsWith(`-${ticket}.log`))
    .map((name) => join(logs, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .flatMap((log) => STOPPED_AT.exec(readFileSync(log, "utf8").split("\n")[0])?.slice(1) ?? [])[0];
}

function clearedBy(page: string, row: string): string | undefined {
  const cells = rowsUnder(page, "Runs").find(([stop]) => stop === row);
  return cells?.[cells.length - 1];
}

function mark(top: string, ticket: string, label: string): void {
  spawnSync(join(top, "bin", "mark"), [ticket, label], { stdio: "ignore" });
}

function handOff(ticket: string, named: string | undefined): number {
  const said = `hand-off: #${ticket}`;
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top === "") {
    console.error(`${said} is not in a repo, so nothing was handed on`);
    return 1;
  }
  const row = named ?? stoppedAt(ticket, join(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]), "machine-logs"));
  if (row === undefined) {
    mark(top, ticket, "failed");
    console.log(`${said} stopped at no row its logs name, so the fixer was not called`);
    return 0;
  }
  const clearer = clearedBy(readFileSync(join(top, PAGE), "utf8"), row);
  if (clearer === undefined || !FIXER.test(clearer)) {
    mark(top, ticket, "failed");
    console.log(`${said} stopped at a row the fixer does not clear, so it was left alone`);
    return 0;
  }
  console.log(`${said} stopped at a row the fixer clears, so it goes to the fixer`);
  mark(top, ticket, "fixing");
  const before = git(["rev-parse", "HEAD"]);
  const fixed = spawnSync(join(top, "bin", "fix"), [ticket], { stdio: "inherit" }).status ?? 1;
  if (git(["rev-parse", "HEAD"]) === before) {
    if (fixed !== 0) mark(top, ticket, "failed");
    return fixed;
  }
  const saved = spawnSync(join(top, "bin", "save"), [ticket], { stdio: "inherit" }).status ?? 1;
  const ended = fixed === 0 ? saved : fixed;
  mark(top, ticket, ended === 0 ? "3-checking" : "failed");
  return ended;
}

if (import.meta.main) {
  const [ticket, row] = process.argv.slice(2);
  if (!/^\d+$/.test(ticket ?? "")) {
    console.error("hand-off: usage: hand-off <ticket number> [row]");
    process.exit(2);
  }
  process.exit(handOff(ticket, row));
}
