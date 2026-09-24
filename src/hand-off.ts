import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { commentOnTicket, openPr, type Gh } from "./post.ts";
import { clearerOf, rowStopped } from "./stops.ts";

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
const gh: Gh = (args) => spawnSync("gh", args, { encoding: "utf8" });

function mark(top: string, ticket: string, label: string): void {
  spawnSync(join(top, "bin", "mark"), [ticket, label], { stdio: "ignore" });
}

const withPr = (pr: string | undefined) => (pr === undefined ? "" : `; its open PR: ${pr}. To resume it, remove its \`failed\` label, and the next update from main re-runs its review.`);

function leftAlone(top: string, ticket: string, row: string): void {
  const note = `hand-off: #${ticket} was left alone, stopped at: ${row}${withPr(openPr(ticket, gh))}`;
  commentOnTicket(ticket, note, gh);
  mark(top, ticket, "failed");
}

function handOff(ticket: string, named: string | undefined): number {
  const said = `hand-off: #${ticket}`;
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top === "") {
    console.error(`${said} is not in a repo, so nothing was handed on`);
    return 1;
  }
  const row = named ?? rowStopped(ticket, join(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]), "machine-logs"));
  if (row === undefined) {
    const note = `hand-off: #${ticket} stopped at no row its logs name${withPr(openPr(ticket, gh))}`;
    commentOnTicket(ticket, note, gh);
    mark(top, ticket, "failed");
    console.log(`${said} stopped at no row its logs name, so the fixer was not called`);
    return 0;
  }
  if (clearerOf(row) !== "the fixer") {
    leftAlone(top, ticket, row);
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
