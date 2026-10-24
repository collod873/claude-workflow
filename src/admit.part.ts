import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, FIXED_TICKET, ghArgv, openedCases, type Parent, plant, scratch, script } from "./scenarios.ts";
import { MACHINE, OWNER } from "./spelled.ts";
import { declareStage } from "./stages.ts";

interface Origin {
  repo: string;
  ticket: string;
  opener: string;
  parent: Parent;
  body?: string | undefined;
}

interface Note {
  number: string;
  opener: string;
  labels: string[];
  state: string;
  repo?: string;
  body?: string | undefined;
}

const HERE = "collod873/design-kit";
const NOTHING_TOLD: Readonly<Record<string, string[]>> = {};

function noteCases(root: string, { number, opener, labels, state, repo, body }: Note): string[] {
  const issue = repo === undefined ? "issues/" : `repos/${repo}/issues/`;
  plant(root, "note.json", JSON.stringify({ number: Number(number), user: { login: opener }, state, labels: labels.map((name) => ({ name })), body }));
  return [`  *"api"*"${issue}${number}/parent") printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1 ;;`, `  *"api"*"${issue}${number}") cat "${join(root, "note.json")}" ;;`];
}

export function admitting({ opener = OWNER, body = FIXED_TICKET, parent = undefined as Parent, unread = false, origin = undefined as Origin | undefined, note = undefined as Note | undefined, told = NOTHING_TOLD } = {}) {
  const root = scratch("admit-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  const elsewhere = origin === undefined ? [] : openedCases(join(root, "origin"), origin.opener, origin.body ?? FIXED_TICKET, origin.parent, origin.ticket).map((line) => line.replace('*"issues/', `*"repos/${origin.repo}/issues/`));
  const research = note === undefined ? [] : noteCases(join(root, "note"), note);
  const toldCases = Object.entries(told).map(([ticket, bodies]) => {
    plant(root, `told-${ticket}`, bodies.map((said) => `${JSON.stringify({ author: MACHINE, type: "Bot", body: said })}\n`).join(""));
    return `  *"api"*"issues/${ticket}/comments"*) cat "${join(root, `told-${ticket}`)}" ;;`;
  });
  const cases = unread ? ["  *\"api\"*) printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1 ;;"] : [...toldCases, ...elsewhere, ...research, ...openedCases(root, opener, body, parent)];
  script(join(root, "bin", "gh"), [setup, `mkdir -p "${join(root, "gh-repo")}" && printf '%s' "\${GH_REPO:-}" >"${join(root, "gh-repo")}/$n"`, 'case "$*" in', ...cases, "  *\"issue comment\"*) printf 'https://github.com/collod873/claude-workflow/issues/811#issuecomment-1\\n' ;;", "esac", ""].join("\n"));
  return {
    calls,
    comments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map((args) => args[args.indexOf("--body") + 1]),
    commentsOn: (repo: string, ticket: string) =>
      calls()
        .map((args, at) => ({ args, repo: readFileSync(join(root, "gh-repo", String(at + 1)), "utf8") }))
        .filter(({ args, repo: aimed }) => aimed === repo && args[0] === "issue" && args[1] === "comment" && args[2] === ticket)
        .map(({ args }) => args[args.indexOf("--body") + 1] ?? ""),
    run: (...args: string[]) => execute(join(BIN, "admit"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_REPO: HERE }, args.length === 0 ? ["811"] : args),
  };
}

declareStage({
  part: { name: "bin/admit", file: "bin/admit", stops: "https://github.com/collod873/claude-workflow/issues/1022" },
  scenarios: [
    { label: "admitting a ticket", run: () => admitting().run() },
    { label: "refusing a ticket the App opened as no follow-up", run: () => admitting({ opener: MACHINE }).run() },
    { label: "with the ticket unreadable", run: () => admitting({ unread: true }).run() },
  ],
});
