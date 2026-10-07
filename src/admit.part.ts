import { join } from "node:path";
import { BIN, execute, FIXED_TICKET, ghArgv, openedCases, type Parent, scratch, script } from "./scenarios.ts";
import { MACHINE, OWNER } from "./spelled.ts";
import { declareStage } from "./stages.ts";

interface Origin {
  repo: string;
  ticket: string;
  opener: string;
  parent: Parent;
}

export function admitting({ opener = OWNER, body = FIXED_TICKET, parent = undefined as Parent, unread = false, origin = undefined as Origin | undefined } = {}) {
  const root = scratch("admit-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  const elsewhere = origin === undefined ? [] : openedCases(join(root, "origin"), origin.opener, FIXED_TICKET, origin.parent, origin.ticket).map((line) => line.replace('*"issues/', `*"repos/${origin.repo}/issues/`));
  const cases = unread ? ["  *\"api\"*) printf 'gh: Server Error (HTTP 502)\\n' >&2; exit 1 ;;"] : [...elsewhere, ...openedCases(root, opener, body, parent)];
  script(join(root, "bin", "gh"), [setup, 'case "$*" in', ...cases, "  *\"issue comment\"*) printf 'https://github.com/collod873/claude-workflow/issues/811#issuecomment-1\\n' ;;", "esac", ""].join("\n"));
  return {
    calls,
    comments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map((args) => args[args.indexOf("--body") + 1]),
    run: (...args: string[]) => execute(join(BIN, "admit"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args.length === 0 ? ["811"] : args),
  };
}

declareStage({
  part: { name: "bin/admit", file: "bin/admit", stops: "https://github.com/collod873/claude-workflow/issues/1022" },
  scenarios: [
    { label: "admitting a ticket", run: () => admitting().run() },
    { label: "refusing a ticket the App opened under no spec", run: () => admitting({ opener: MACHINE }).run() },
    { label: "with the ticket unreadable", run: () => admitting({ unread: true }).run() },
  ],
});
