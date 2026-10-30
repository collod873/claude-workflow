import { commentOnTicket, ENROLLED_CALLER, git, type Gh, MISSING } from "./post.ts";
import { waitsOn } from "./ticket-shape.ts";
import { PAUSED, STUCK, WAITING } from "./spelled.ts";

const MOST_MATCHES = 5;
const SHARED_WORDS = 2;
const COMMON = new Set(["with", "from", "that", "this", "when", "what", "into", "does", "have", "them", "then", "each", "only", "once", "their", "there", "than", "should", "would", "could", "every", "never"]);
const BUILDING_KINDS = new Set(["build", "bug", "spec"]);
const HELD_SHOWN = new Set<string>([STUCK, WAITING, PAUSED]);

export const NEW = "--new";

const repoName = (): string => /([^/:]+?)(?:\.git)?$/.exec(git(["remote", "get-url", "origin"]).stdout.trim())?.[1] ?? "this repo";

function enrolled(gh: Gh): boolean | undefined {
  const got = gh(["--missing-answers", "api", `repos/{owner}/{repo}/contents/.github/workflows/${ENROLLED_CALLER}`, "--jq", ".name"]);
  if (got.status === 0) return true;
  return MISSING.test(got.stderr) ? false : undefined;
}

export function enrolmentLine(gh: Gh): string {
  const here = repoName();
  const is = enrolled(gh);
  if (is === undefined) return `${here}: whether it is enrolled could not be read, so a build may wait for a session to take it.`;
  return is ? `${here} is enrolled: a build, bug or spec starts the moment it is filed.` : `${here} is not enrolled: a build, bug or spec waits for a session to take it.`;
}

export const filedLine = (kind: string, gh: Gh, waiting: boolean): string | undefined => {
  if (!BUILDING_KINDS.has(kind)) return undefined;
  const line = enrolmentLine(gh);
  return waiting ? `${line} It is labelled ${WAITING} until every issue under its ## Waits on closes.` : line;
};

const words = (title: string): Set<string> => new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !COMMON.has(word)));

interface Listed {
  number: number;
  title: string;
  labels: { name: string }[];
}

export function likelyMatches(title: string, gh: Gh): string[] | undefined {
  const got = gh(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title,labels"]);
  if (got.status !== 0) return undefined;
  let listed: Listed[];
  try {
    listed = JSON.parse(got.stdout) as Listed[];
  } catch {
    return undefined;
  }
  const asked = words(title);
  return listed
    .map((issue) => ({ issue, shared: [...words(issue.title)].filter((word) => asked.has(word)).length }))
    .filter(({ shared }) => shared >= SHARED_WORDS)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, MOST_MATCHES)
    .map(({ issue }) => {
      const names = issue.labels.map(({ name }) => name);
      const held = names.filter((name) => HELD_SHOWN.has(name)).map((name) => ` [${name}]`).join("");
      return `  #${issue.number} ${names.filter((name) => !HELD_SHOWN.has(name)).join(",") || "unlabelled"}${held} "${issue.title}"`;
    });
}

export const matchRefusals = (matches: string[]): string[] => [
  `file-issue: nothing filed; open issues in ${repoName()} that may be the same job:`,
  ...matches,
  `Read each. Same job: file-issue add <number> --body-file <path> puts your evidence on it as a comment. Different job: rerun with ${NEW}.`,
];

export const unlisted = `file-issue: nothing filed; the open issues could not be read to check for the same job. Rerun with ${NEW} to file without the check.`;

export function openWaitedOn(text: string, gh: Gh): string[] {
  return waitsOn(text).filter((number) => {
    const got = gh(["issue", "view", number, "--json", "state", "--jq", ".state"]);
    return got.status === 0 && got.stdout.trim() === "OPEN";
  });
}

export function added(issue: string, text: string, gh: Gh): { refusals: string[]; said: string } {
  const got = gh(["issue", "view", issue, "--json", "state", "--jq", ".state"]);
  if (got.status !== 0) return { refusals: [`#${issue} could not be read, so nothing was added`], said: "" };
  if (got.stdout.trim() !== "OPEN") return { refusals: [`#${issue} is closed, so nothing was added; file the new evidence as its own issue`], said: "" };
  return commentOnTicket(issue, text, gh);
}
