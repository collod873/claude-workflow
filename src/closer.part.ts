import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { BIN, execute, git, plant, refusedMark, scratch, script } from "./scenarios.ts";
import { MACHINE } from "./spelled.ts";
import { WAITING } from "./post.ts";
import { declareStage } from "./stages.ts";

const CLOSER_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a ticket closes once its PR merges".',
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

interface SplitFrom {
  parent: string;
  labels: string;
  said: string | string[];
  siblings: Record<string, string>;
  body?: string;
}

const waitingListed = (splitFrom: SplitFrom | undefined) => (splitFrom !== undefined && splitFrom.labels.split("\n").includes(WAITING) ? [{ number: Number(splitFrom.parent), body: splitFrom.body ?? CLOSER_TICKET }] : []);

const CLOSE_RUN_ID = "36740874094";

export function closing({
  ticket = "812",
  ticketBody = CLOSER_TICKET,
  readable = true,
  closedAs,
  splitFrom,
  waking = false,
  markRefusal,
  calledFrom,
  foreign = false,
  faultOrigin,
  closedIssue,
  closedIn = "collod873/claude-workflow",
}: {
  ticket?: string;
  ticketBody?: string;
  readable?: boolean;
  closedAs?: "COMPLETED" | "NOT_PLANNED";
  splitFrom?: SplitFrom;
  waking?: boolean;
  markRefusal?: string;
  calledFrom?: string;
  foreign?: boolean;
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
  script(join(root, "bin", "check"), "printf 'check: ok, 2 steps in 0.3s\\n'\n");
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
      `  "api repos/{owner}/{repo}/issues/${ticket} --jq"*) printf 'ticket\\nbuilding\\ntry-2\\nwayfinder:map\\n' ;;`,
      `  *"issue list"*"${WAITING}"*) cat <<'LISTED'\n${JSON.stringify(waitingListed(splitFrom))}\nLISTED\n    ;;`,
      ...(splitFrom === undefined
        ? []
        : [
            `  *"api"*"issues/${splitFrom.parent}/comments"*) cat <<'SAID'\n${[splitFrom.said].flat().map((body) => JSON.stringify({ author: MACHINE, type: "Bot", body })).join("\n")}\nSAID\n    ;;`,
            ...Object.entries(splitFrom.siblings).map(([sibling, state]) => `  *"issue view ${sibling} "*"state"*) printf '%s\\n' '${state}' ;;`),
          ]),
      `  *"issue view"*"state"*) printf '%s\\n' '${closedAs === undefined ? "OPEN REOPENED" : `CLOSED ${closedAs}`}' ;;`,
      "  *\"issue view\"*)",
      ...(readable ? [] : ["    printf 'gh: Bad credentials (HTTP 401)\\n' >&2", "    exit 1"]),
      "    cat <<'BODY'",
      ticketBody,
      "BODY",
      "    ;;",
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  if (!foreign) {
    mkdirSync(join(session, "bin"));
    if (markRefusal === undefined) symlinkSync(join(BIN, "mark"), join(session, "bin", "mark"));
    else script(join(session, "bin", "mark"), refusedMark(markRefusal));
  }
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : []);
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
          QUIET_GH_TOKEN: "quiet",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: closedIn,
          GH_REPO: closedIn,
          GITHUB_RUN_ID: CLOSE_RUN_ID,
          GH_RETRY_SECONDS: "0",
          ...(calledFrom === undefined ? {} : { CALLED_FROM: calledFrom }),
          ...(foreign ? { MACHINE_BIN: BIN } : {}),
        },
        closedIssue !== undefined ? [closedIssue] : waking ? [] : [ticket, "900"],
      ),
  };
}

declareStage({
  part: { name: "bin/close", file: "bin/close", stops: "https://github.com/collod873/claude-workflow/issues/808" },
  scenarios: [
    { label: "closing a ticket whose PR merged", run: () => closing({ ticket: "814" }).run() },
    { label: "with the ticket unreadable", run: () => closing({ ticket: "815", readable: false }).run() },
  ],
});
