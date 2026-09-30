import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authored, BIN, commitAt, execute, git, MACHINE, plant, type Said, scratch, script } from "./scenarios.ts";
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

const FAST_TIMING = {
  filed: "2026-01-01T00:00:00Z",
  firstCommit: "2026-01-01T00:00:01Z",
  prOpened: "2026-01-01T00:00:02Z",
  checksGreen: "2026-01-01T00:00:03Z",
  merged: "2026-01-01T00:00:04Z",
};

export interface WaitingFollowUp {
  ticket: string;
  parent: string;
  parentPr: "OPEN" | "MERGED" | "CLOSED";
  split?: boolean;
}

const followUpBody = ({ ticket, parent }: WaitingFollowUp) =>
  ["## Why", "", `Follow-up of #${parent}: its review found this after its builder's repair, outside the earlier gaps and the fix's own lines.`, "", `> #${ticket} is still to build.`, "", "## Done when", "", "- It lands.", ""].join("\n");

export interface QueuedPr {
  number: string;
  ticket: string;
  branch?: string;
  refused?: string;
  upToDate?: boolean;
  checks?: "green" | "pending" | "red";
  autoMerge?: boolean;
  refusedBefore?: boolean;
  conflicts?: boolean;
}

const RUNS = { green: ["COMPLETED", "SUCCESS"], pending: ["IN_PROGRESS", ""], red: ["COMPLETED", "FAILURE"] } as const;

function listed(pr: QueuedPr, head: string) {
  const [status, conclusion] = RUNS[pr.checks ?? "green"];
  return {
    number: Number(pr.number),
    headRefName: pr.branch ?? `ticket/${pr.ticket}`,
    headRefOid: head,
    autoMergeRequest: pr.autoMerge === false ? null : { mergeMethod: "MERGE" },
    statusCheckRollup: [
      { __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "meters", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "review", status, conclusion },
    ],
  };
}

const CLOSE_RUN_ID = "36740874094";

export const CLOSE_RUN = `https://github.com/collod873/claude-workflow/actions/runs/${CLOSE_RUN_ID}`;

export function closing({
  ticket = "812",
  ticketBody = CLOSER_TICKET,
  readable = true,
  timing = FAST_TIMING,
  closedAs,
  openPrs = [] as QueuedPr[],
  splitFrom,
  afterCheck = false,
  prComments = [] as Said[],
  prCommentsUnreadable = false,
  followUps = [] as WaitingFollowUp[],
}: {
  ticket?: string;
  ticketBody?: string;
  readable?: boolean;
  timing?: { filed: string; firstCommit: string; rebased?: string; prOpened: string; checksGreen: string; merged: string };
  closedAs?: "COMPLETED" | "NOT_PLANNED";
  openPrs?: QueuedPr[];
  splitFrom?: { parent: string; labels: string; said: string; siblings: Record<string, string> };
  afterCheck?: boolean;
  prComments?: Said[];
  prCommentsUnreadable?: boolean;
  followUps?: WaitingFollowUp[];
} = {}) {
  const root = scratch("closer-");
  const session = join(root, "session");
  const callsDir = join(root, "gh-calls");
  const tokensDir = join(root, "gh-tokens");
  mkdirSync(callsDir, { recursive: true });
  mkdirSync(tokensDir, { recursive: true });
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", "closer@test");
  git(session, "config", "user.name", "closer");
  plant(session, "src/built.ts", "export const built = 1;\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "base");
  git(session, "checkout", "--quiet", "-b", `ticket/${ticket}`);
  if (openPrs.some((pr) => pr.conflicts === true)) plant(session, "src/clash.ts", "export const clash = \"main\";\n");
  git(session, "add", "-A");
  commitAt(session, timing.firstCommit, ["commit", "--quiet", "--allow-empty", "-m", `Build #${ticket} against its failing tests`], timing.rebased);
  git(session, "checkout", "--quiet", "main");
  commitAt(session, timing.merged, ["merge", "--quiet", "--no-ff", "-m", `Merge pull request #900 from collod873/ticket/${ticket}`, `ticket/${ticket}`]);
  const origin = join(root, "origin.git");
  git(root, "init", "--quiet", "--bare", origin);
  git(session, "remote", "add", "origin", origin);
  git(session, "push", "--quiet", "origin", "main");
  const heads = openPrs.map((pr) => {
    git(session, "checkout", "--quiet", "-b", `queued/${pr.number}`, pr.upToDate === true ? "main" : "main^1");
    if (pr.conflicts === true) plant(session, "src/clash.ts", `export const clash = "${pr.number}";\n`);
    git(session, "add", "-A");
    git(session, "commit", "--quiet", "--allow-empty", "-m", `Build PR #${pr.number}`);
    git(session, "push", "--quiet", "origin", `HEAD:refs/heads/${pr.branch ?? `ticket/${pr.ticket}`}`);
    git(session, "checkout", "--quiet", "main");
    return git(session, "rev-parse", `queued/${pr.number}`);
  });
  openPrs.forEach((pr, at) => {
    if (pr.refusedBefore === true) plant(root, `pr-${pr.number}-comments.json`, authored([`PR #${pr.number} could not be brought up to date with main: ${pr.refused ?? ""}\n\nHead: \`${heads[at] ?? ""}\``]));
  });
  plant(root, "pr-comments.json", authored(prComments));
  script(
    join(root, "bin", "gh"),
    [
      `n=$(( $(ls "${callsDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\n' "$@" >"${callsDir}/$n"`,
      `printf '%s' "$GH_TOKEN" >"${tokensDir}/$n"`,
      'case "$*" in',
      `  *"issue list"*"${WAITING}"*) cat <<'LISTED'\n${JSON.stringify(followUps.map((waiting) => ({ number: Number(waiting.ticket), body: followUpBody(waiting) })))}\nLISTED\n    ;;`,
      ...followUps.map(({ parent, parentPr }) => `  *"pr view ticket/${parent} "*"state"*) printf '%s\\n' '${parentPr}' ;;`),
      ...followUps.map(({ ticket, split }) => `  *"api"*"issues/${ticket}/comments"*) ${split === true ? `printf '%s\\n' '${JSON.stringify({ author: MACHINE, type: "Bot", body: `@collod873 the builder split #${ticket} into #990, which build themselves.` })}'` : "exit 0"} ;;`),
      ...(splitFrom === undefined
        ? []
        : [
            `  *"issue view ${splitFrom.parent} "*"labels"*) printf '${splitFrom.labels}' ;;`,
            `  *"api"*"issues/${splitFrom.parent}/comments"*) cat <<'SAID'\n${JSON.stringify({ author: MACHINE, type: "Bot", body: splitFrom.said })}\nSAID\n    ;;`,
            ...Object.entries(splitFrom.siblings).map(([sibling, state]) => `  *"issue view ${sibling} "*"state"*) printf '%s\\n' '${state}' ;;`),
          ]),
      `  *"issue view"*"createdAt"*) printf '%s\\n' '${timing.filed}' ;;`,
      `  *"issue view"*"state"*) printf '%s\\n' '${closedAs === undefined ? "OPEN REOPENED" : `CLOSED ${closedAs}`}' ;;`,
      "  *\"issue view\"*)",
      ...(readable ? [] : ["    printf 'GraphQL: Could not resolve to an issue\\n' >&2", "    exit 1"]),
      "    cat <<'BODY'",
      ticketBody,
      "BODY",
      "    ;;",
      `  *"pr list"*) printf '%s\\n' '${JSON.stringify(openPrs.map((pr, at) => listed(pr, heads[at] ?? "")))}' ;;`,
      ...openPrs.filter((pr) => pr.refusedBefore === true).map((pr) => `  *"issues/${pr.number}/comments"*) cat "${join(root, `pr-${pr.number}-comments.json`)}" ;;`),
      ...openPrs.map((pr) => `  *"pr update-branch ${pr.number}"*) ${pr.refused === undefined ? "exit 0" : `printf '%s\\n' '${pr.refused}' >&2; exit 1`} ;;`),
      `  *"pr view"*) printf '%s\\n' '${timing.prOpened}' ;;`,
      `  *"pr checks"*) printf '%s\\n' '${timing.checksGreen}' ;;`,
      `  *"issues/900/comments"*) ${prCommentsUnreadable ? "printf 'GraphQL: comments could not be read\\n' >&2; exit 1" : `cat "${join(root, "pr-comments.json")}"`} ;;`,
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  return {
    session,
    calls: () => readdirSync(callsDir).sort((a, b) => Number(a) - Number(b)).map((file) => readFileSync(join(callsDir, file), "utf8")),
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
          GITHUB_REPOSITORY: "collod873/claude-workflow",
          GITHUB_RUN_ID: CLOSE_RUN_ID,
        },
        afterCheck ? ["queue"] : [],
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
