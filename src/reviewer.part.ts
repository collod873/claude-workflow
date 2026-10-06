import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DIFF_CAP, LIST_CAP, TICKET_CAP } from "./brief.ts";
import { handedOn, handedSince } from "./reviewer.ts";
import { authored, BIN, execute, ghArgv, git, gitRefusing, type Parent, parentSays, plant, type Said, scratch, script } from "./scenarios.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

export const REVIEWED_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a green build is read against what was meant before it merges".',
  "",
  "## Done when",
  "",
  "- A drift verdict posts every gap.",
  "",
].join("\n");

export const JUDGEMENT = "https://github.com/collod873/claude-workflow/pull/9810#issuecomment-1";

const FOLLOW_UP_FILED = "https://github.com/collod873/claude-workflow/issues/9811";

const LATER_POSTED = "https://github.com/collod873/claude-workflow/issues/810#issuecomment-2";

export function fileDiff(path: string, added: string): string {
  return `diff --git a/${path} b/${path}\nindex 0000000..1111111 100644\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${added}\n`;
}

export const JUDGED_GAP = "the builder is woken on finds that should have been follow-ups";

export const EARLY_REPAIR = "export const repairedBeforeJudgement = 1;";

export const BUILDER_LINE = "export const repairedAfterJudgement = 1;";

export const FROM_MAIN = "export const broughtInByMain = 1;";

export const RESOLVED = "line 3 as ticket A changed it, ticket B's intent kept";

const SHARED = `${Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

function judgedHistory(root: string, turn: "merged" | "ticket"): string {
  const commit = (message: string) => {
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", message);
  };
  plant(root, "src/shared.ts", SHARED);
  commit("Share lines with main");
  git(root, "branch", "main");
  plant(root, "src/shared.ts", SHARED.replace("line 3", "line 3 as ticket B changed it"));
  commit("Build #810 against its failing tests");
  plant(root, "src/early.ts", `${EARLY_REPAIR}\n`);
  commit("Repair #810 as its builder");
  const head = git(root, "rev-parse", "HEAD");
  if (turn === "merged") {
    git(root, "checkout", "--quiet", "main");
    plant(root, "src/shared.ts", SHARED.replace("line 3", "line 3 as ticket A changed it"));
    plant(root, "src/main.ts", `${FROM_MAIN}\n`);
    commit("Build #800");
    git(root, "checkout", "--quiet", "ticket/810");
    plant(root, "src/fixed.ts", `${BUILDER_LINE}\n`);
    commit("Repair #810 as its builder");
    try {
      git(root, "merge", "--quiet", "--no-edit", "main");
    } catch {
      plant(root, "src/shared.ts", SHARED.replace("line 3", RESOLVED));
      git(root, "add", ".");
      git(root, "commit", "--quiet", "--no-edit");
    }
  }
  git(root, "update-ref", "refs/remotes/origin/main", "main");
  return head;
}

const judgedAt = (head: string) =>
  `The reviewer read this PR against the Why of #810 and found drift.\n\n- ${JUDGED_GAP}\n\nFingerprint: \`judged-before\`\nHead: \`${head}\`\n`;

export function reviewing({
  bin = "review",
  branch = "ticket/810",
  verdict = { verdict: "match", gaps: [], readback: "It now reads a green build against what was meant before it merges." } as object,
  diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;"),
  turns = [] as Said[],
  onPr = [] as Said[] | ((main: { before: string; now: string }) => Said[]),
  repair = undefined as string | undefined,
  landed = undefined as string | undefined,
  body = REVIEWED_TICKET,
  prCommentFails = false,
  prBody = "Builds #810\n",
  prBodyUnreadable = false,
  prEditFails = false,
  diffAfter = undefined as string | undefined,
  bodyAfter = undefined as string | undefined,
  judged = undefined as "merged" | "ticket" | undefined,
  parent = undefined as { ticket: string; body?: string } | undefined,
  spec = undefined as Parent,
  unreadable = undefined as string | undefined,
  gitUnreadable = undefined as string | undefined,
}: {
  bin?: string;
  branch?: string;
  verdict?: object;
  diff?: string;
  turns?: Said[];
  onPr?: Said[] | ((main: { before: string; now: string }) => Said[]);
  repair?: string;
  landed?: string;
  body?: string;
  prCommentFails?: boolean;
  prBody?: string;
  prBodyUnreadable?: boolean;
  prEditFails?: boolean;
  diffAfter?: string;
  bodyAfter?: string;
  judged?: "merged" | "ticket";
  parent?: { ticket: string; body?: string };
  spec?: Parent;
  unreadable?: string;
  gitUnreadable?: string;
} = {}) {
  const root = scratch("review-");
  const argvDir = join(root, "gh-argv");
  const handed = join(root, "claude-stdin");
  const hired = join(root, "claude-argv");
  const judgedOnce = join(root, "model-answered");
  const { setup, calls } = ghArgv(argvDir);
  git(root, "init", "--quiet", "--initial-branch=ticket/810");
  git(root, "config", "user.email", "review@test");
  git(root, "config", "user.name", "review");
  git(root, "commit", "--quiet", "--allow-empty", "-m", "Build #810 against its failing tests");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (repair !== undefined) {
    plant(root, "src/repaired.ts", repair);
    git(root, "add", "src/repaired.ts");
    git(root, "commit", "--quiet", "-m", "Repair #810 as its builder");
    git(root, "commit", "--quiet", "--allow-empty", "-m", "Merge branch 'main' into ticket/810");
  }
  const mainBefore = git(root, "rev-parse", "HEAD");
  if (landed !== undefined) {
    git(root, "checkout", "--quiet", "-b", "main");
    plant(root, "src/landed.ts", `${landed}\n`);
    git(root, "add", "src/landed.ts");
    git(root, "commit", "--quiet", "-m", "Merge pull request #800 from collod873/ticket/800");
    git(root, "checkout", "--quiet", "ticket/810");
    git(root, "merge", "--quiet", "--no-edit", "--no-ff", "main");
    git(root, "update-ref", "refs/remotes/origin/main", "main");
  }
  const said = typeof onPr === "function" ? onPr({ before: mainBefore, now: git(root, "rev-parse", "main") }) : onPr;
  const judgedSaid = judged === undefined ? said : [...said, judgedAt(judgedHistory(root, judged))];
  plant(root, "pr.diff", diff);
  plant(root, "pr-after.diff", diffAfter ?? diff);
  plant(root, "ticket.md", body);
  plant(root, "ticket-after.md", bodyAfter ?? body);
  plant(root, "pr-body.md", prBody);
  plant(root, "parent.md", parent?.body ?? "");
  plant(root, "turns.json", authored(turns));
  plant(root, "on-pr.json", authored(judgedSaid));
  plant(root, "answer.json", `${JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: verdict })}\n`);
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      ...(unreadable === undefined ? [] : [`  ${unreadable}) printf 'gh: Server Error (HTTP 502)\\n' >&2; exit 1 ;;`]),
      `  *"api"*"issues/810/comments"*) cat "${join(root, "turns.json")}" ;;`,
      `  *"api"*"issues/810/parent"*) ${parentSays(root, spec)} ;;`,
      `  *"api"*"/comments"*) cat "${join(root, "on-pr.json")}" ;;`,
      `  *"pr view"*"--json body"*) ${prBodyUnreadable ? "printf 'the PR body could not be read\\n' >&2; exit 1" : `cat "${join(root, "pr-body.md")}"`} ;;`,
      `  *"pr edit"*) ${prEditFails ? "printf 'the PR body could not be edited\\n' >&2; exit 1" : "exit 0"} ;;`,
      `  *"pr view"*) printf '%s\\n' '${branch}' ;;`,
      ...(parent === undefined ? [] : [`  *"issue view ${parent.ticket} "*) ${parent.body === undefined ? "exit 1" : `cat "${join(root, "parent.md")}"`} ;;`]),
      `  *"issue view"*) [ -f "${judgedOnce}" ] && cat "${join(root, "ticket-after.md")}" || cat "${join(root, "ticket.md")}" ;;`,
      `  *"pr diff"*) [ -f "${judgedOnce}" ] && cat "${join(root, "pr-after.diff")}" || cat "${join(root, "pr.diff")}" ;;`,
      prCommentFails ? "  *\"pr comment\"*) printf 'the readback could not be posted\\n' >&2; exit 1 ;;" : `  *"pr comment"*) printf '%s\\n' '${JUDGEMENT}' ;;`,
      `  *"issue comment"*) printf '%s\\n' '${LATER_POSTED}' ;;`,
      `  *"issue create"*) printf '%s\\n' '${FOLLOW_UP_FILED}' ;;`,
      "  *) exit 22 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  if (gitUnreadable !== undefined) gitRefusing(root, gitUnreadable);
  script(join(root, "bin", "claude"), `touch "${judgedOnce}"\nprintf '%s\\0' "$@" >"${hired}"\ncat >"${handed}"\ncat "${join(root, "answer.json")}"\n`);
  const bodyOf = (args: string[]) => args[args.indexOf("--body") + 1];
  return {
    root,
    hired: () => (existsSync(hired) ? readFileSync(hired, "utf8").split("\0") : []),
    spent: () => existsSync(handed),
    handed: () => (existsSync(handed) ? readFileSync(handed, "utf8") : ""),
    ticketComments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map(bodyOf),
    filed: () => calls().filter((args) => args[0] === "issue" && args[1] === "create").map((args) => ({ title: args[args.indexOf("--title") + 1], body: bodyOf(args), labels: args.flatMap((arg, at) => (args[at - 1] === "--label" ? [arg] : [])) })),
    order: () => calls().map((args) => `${args[0]} ${args[1]}`),
    comments: () => calls().filter((args) => args[0] === "pr" && args[1] === "comment").map(bodyOf),
    edited: () => calls().filter((args) => args[0] === "pr" && args[1] === "edit").map(bodyOf),
    read: () => calls().some((args) => args[0] === "pr" && args[1] === "view"),
    run: (pr = "9810", extra: Record<string, string> = {}, flags: string[] = []) => execute(join(BIN, bin), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, ...extra }, [...flags, pr]),
  };
}

declareStage({
  part: { name: "bin/review", file: "bin/review", stops: "https://github.com/collod873/claude-workflow/issues/661" },
  prompts: [
    {
      name: "reviewer",
      file: "src/reviewer.ts",
      cap: 2 * TICKET_CAP + DIFF_CAP + 2 * LIST_CAP + HANDED_ON,
      slots: ["body", "diff", "prBody"],
      build: (filled) => handedOn(filled.body ?? "", filled.diff ?? "", { prBody: filled.prBody ?? "" }),
    },
    {
      name: "reviewer after the builder's repair",
      file: "src/reviewer.ts",
      cap: 2 * TICKET_CAP + 2 * DIFF_CAP + 3 * LIST_CAP + HANDED_ON,
      slots: ["body", "diff", "prBody", "earlier", "fix"],
      build: (filled) => handedOn(filled.body ?? "", filled.diff ?? "", { prBody: filled.prBody ?? "", after: { earlier: filled.earlier ?? "", fix: filled.fix ?? "" } }),
    },
    {
      name: "reviewer since main moved",
      file: "src/reviewer.ts",
      cap: TICKET_CAP + 2 * DIFF_CAP + 3 * LIST_CAP + HANDED_ON,
      slots: ["body", "diff", "merged", "landed"],
      build: (filled) => handedSince(filled.body ?? "", filled.diff ?? "", filled.merged ?? "", filled.landed ?? ""),
    },
  ],
  scenarios: [
    { label: "passing a match", run: () => reviewing().run() },
    { label: "with main unreadable", run: () => reviewing({ gitUnreadable: '"merge-base origin/main HEAD"' }).run() },
    { label: "posting a drift", run: () => reviewing({ verdict: { verdict: "drift", gaps: ["the Why asks for more than was built"] } }).run() },
  ],
});
