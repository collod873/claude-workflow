import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, git, plant, scratch, script } from "./scenarios.ts";
import { MACHINE } from "./spelled.ts";
import { WAITING } from "./post.ts";
import { declareStage } from "./stages.ts";

const CLOSER_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a ticket waits until what it depends on closes".',
  "",
  "## Done when",
  "",
  "- The fix lands.",
  "",
].join("\n");

export interface FaultOrigin {
  repo: string;
  ticket: string;
  labels: string[];
  said: string[];
  filed: Record<string, string>;
}

interface ParkedOn {
  parent: string;
  labels: string;
  said: string | string[];
  siblings: Record<string, string>;
  body?: string;
}

const waitingListed = (parkedOn: ParkedOn | undefined) => (parkedOn !== undefined && parkedOn.labels.split("\n").includes(WAITING) ? [{ number: Number(parkedOn.parent), body: parkedOn.body ?? CLOSER_TICKET }] : []);

const CLOSE_RUN_ID = "36740874094";

export function closing({
  ticketBody = CLOSER_TICKET,
  listable = true,
  parkedOn,
  faultOrigin,
  closedIssue,
  closedIn = "collod873/claude-workflow",
}: {
  ticketBody?: string;
  listable?: boolean;
  parkedOn?: ParkedOn;
  faultOrigin?: FaultOrigin;
  closedIssue?: string;
  closedIn?: string;
} = {}) {
  const root = scratch("closer-");
  const session = join(root, "session");
  const callsDir = join(root, "gh-calls");
  const tokensDir = join(root, "gh-tokens");
  const reposDir = join(root, "gh-repos");
  mkdirSync(reposDir, { recursive: true });
  mkdirSync(callsDir, { recursive: true });
  mkdirSync(tokensDir, { recursive: true });
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", "closer@test");
  git(session, "config", "user.name", "closer");
  plant(session, "src/built.ts", "export const built = 1;\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "base");
  const origin = join(root, "origin.git");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  git(session, "remote", "add", "origin", origin);
  git(session, "push", "--quiet", "origin", "main");
  script(
    join(root, "bin", "gh"),
    [
      `n=$(( $(ls "${callsDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\n' "$@" >"${callsDir}/$n"`,
      `printf '%s' "$GH_TOKEN" >"${tokensDir}/$n"`,
      `printf '%s' "$GH_REPO" >"${reposDir}/$n"`,
      'case "$*" in',
      ...(faultOrigin === undefined
        ? []
        : [
            `  *"repos/${faultOrigin.repo}/issues/${faultOrigin.ticket}"*) printf '%s\\n' '${JSON.stringify({ number: Number(faultOrigin.ticket), state: "open", labels: faultOrigin.labels.map((name) => ({ name })) })}' ;;`,
            `  *"issues/${faultOrigin.ticket}/comments"*) [ "$GH_REPO" = "${faultOrigin.repo}" ] || exit 1; cat <<'SAID'\n${faultOrigin.said.map((body) => JSON.stringify({ author: MACHINE, type: "Bot", body })).join("\n")}\nSAID\n    ;;`,
            ...Object.entries(faultOrigin.filed).map(([filed, state]) => `  *"issue view ${filed} "*"state"*) printf '%s\\n' '${state}' ;;`),
          ]),
      listable ? `  *"issue list"*"${WAITING}"*) cat <<'LISTED'\n${JSON.stringify(waitingListed(parkedOn))}\nLISTED\n    ;;` : `  *"issue list"*) printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1 ;;`,
      ...(parkedOn === undefined
        ? []
        : [
            `  *"api"*"issues/${parkedOn.parent}/comments"*) cat <<'SAID'\n${[parkedOn.said].flat().map((body) => JSON.stringify({ author: MACHINE, type: "Bot", body })).join("\n")}\nSAID\n    ;;`,
            ...Object.entries(parkedOn.siblings).map(([sibling, state]) => `  *"issue view ${sibling} "*"state"*) printf '%s\\n' '${state}' ;;`),
          ]),
      `  *"issue view"*"state"*) printf '%s\\n' 'OPEN REOPENED' ;;`,
      "  *\"issue view\"*)",
      "    cat <<'BODY'",
      ticketBody,
      "BODY",
      "    ;;",
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  return {
    session,
    calls: () => readdirSync(callsDir).sort((a, b) => Number(a) - Number(b)).map((file) => readFileSync(join(callsDir, file), "utf8")),
    repos: () => readdirSync(reposDir).sort((a, b) => Number(a) - Number(b)).map((file) => readFileSync(join(reposDir, file), "utf8")),
    tokens: () => readdirSync(tokensDir).sort((a, b) => Number(a) - Number(b)).map((file) => readFileSync(join(tokensDir, file), "utf8")),
    run: () =>
      execute(
        join(BIN, "close"),
        session,
        {
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          GH_TOKEN: "app",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: closedIn,
          GH_REPO: closedIn,
          GITHUB_RUN_ID: CLOSE_RUN_ID,
          GH_RETRY_SECONDS: "0",
        },
        closedIssue !== undefined ? [closedIssue] : [],
      ),
  };
}

declareStage({
  part: { name: "bin/close", file: "bin/close", stops: "https://github.com/collod873/claude-workflow/issues/808" },
  scenarios: [
    { label: "waking the tickets that waited on an issue that closed", run: () => closing({ closedIssue: "814" }).run() },
    { label: "with the waiting tickets unlisted", run: () => closing({ closedIssue: "815", listable: false }).run() },
  ],
});
