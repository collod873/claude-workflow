import { builderOf, dependsOn, waitsOnStep } from "./builder.ts";
import { addBlocker, addParent, blockersOf, parentOf } from "./issue-links.ts";
import { fromLine, fromOf, type FromKind, ghRead, heardIn, MACHINE_REPO, OWNER, Stopped } from "./post.ts";
import { waitsOn } from "./ticket-shape.ts";
import { WAITING } from "./spelled.ts";

interface Listed {
  number: number;
  body: string;
}

interface Linking {
  repo: string;
  number: number;
  filed: boolean;
}

const FOLLOW_UPS: [RegExp, FromKind][] = [
  [/^Follow-up of #(\d+): its research found this\./m, "researched"],
  [/^Follow-up of #(\d+): its reviewer let this through\./m, "review"],
  [/^Follow-up of #(\d+): its done check found this did not hold\./m, "done-check"],
];
const FILED_BY = new RegExp(`^Filed by the builder of (${OWNER}/[\\w.-]+)#(\\d+), which waits on it, as (its|the) `, "m");
const HOLE = "\u0000";
const shaped = (said: string, ...holes: string[]) => new RegExp(`^${said.split(HOLE).map((piece, at) => `${piece.replaceAll(".", "\\.")}${holes[at] ?? ""}`).join("")}`);
const TICKET = "\\d+";
const NAMED = "(\\S+(?:, \\S+)*)";
const DEPENDS_ON = shaped(`${dependsOn(HOLE)} ${HOLE}, still open.`, TICKET, "((?:#\\d+(?:, )?)+)");
const FAULT_FILED = shaped(`${builderOf(HOLE)} found the machine at fault and filed ${HOLE}.`, TICKET, NAMED);
const STEP_FILED = shaped(`${waitsOnStep(HOLE, HOLE, [HOLE]).split(". ")[0] ?? ""}.`, TICKET, "[\\w.-]+/[\\w.-]+", NAMED);
const ISSUE_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/;

function provenanceOf(repo: string, body: string): string | undefined {
  if (fromOf(body) !== undefined) return undefined;
  for (const [sentence, kind] of FOLLOW_UPS) {
    const [, number] = sentence.exec(body) ?? [];
    if (number !== undefined) return fromLine(`${repo}#${number}`, kind);
  }
  const [, from, number, as] = FILED_BY.exec(body) ?? [];
  return from === undefined ? undefined : fromLine(`${from}#${number}`, as === "its" ? "first-step" : "fault");
}

function parkedOn(repo: string, comment: string): Linking[] {
  const [, here] = DEPENDS_ON.exec(comment) ?? [];
  if (here !== undefined) return here.split(", ").map((at) => ({ repo, number: Number(at.slice(1)), filed: false }));
  const [, urls] = FAULT_FILED.exec(comment) ?? STEP_FILED.exec(comment) ?? [];
  return (urls ?? "").split(", ").flatMap((url) => {
    const [, filedIn, number] = ISSUE_URL.exec(url) ?? [];
    return filedIn === undefined ? [] : [{ repo: filedIn, number: Number(number), filed: true }];
  });
}

function migrated(repo: string, { number, body }: Listed): void {
  const comments = (JSON.parse(ghRead(["api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--slurp"], `the comments of ${repo}#${number} could not be read, so it is not migrated`)) as { body: string }[][]).flat();
  const named = [...comments.flatMap((comment) => parkedOn(repo, comment.body)), ...waitsOn(body).map((at) => ({ repo, number: Number(at), filed: false }))];
  const linked = blockersOf(repo, number);
  const seen = new Set<string>();
  for (const blocker of named) {
    const at = `${blocker.repo}#${blocker.number}`;
    if (seen.has(at)) continue;
    seen.add(at);
    if (!linked.some((one) => one.repo === blocker.repo && one.number === blocker.number)) addBlocker(repo, number, blocker.repo, blocker.number);
    if (blocker.filed && parentOf(blocker.repo, blocker.number) === undefined) addParent(blocker.repo, blocker.number, repo, number);
    console.log(`migrate-waiting: ${repo}#${number} blocked by ${at}`);
  }
  const marker = provenanceOf(repo, body);
  if (marker === undefined) return;
  ghRead(["issue", "edit", String(number), "--repo", repo, "--body", `${body}\n${marker}\n`], `the marker line of ${repo}#${number} could not be written`);
  console.log(`migrate-waiting: ${repo}#${number} marked ${marker}`);
}

function migrateRepo(repo: string): void {
  const listed = JSON.parse(ghRead(["issue", "list", "--repo", repo, "--label", WAITING, "--state", "open", "--limit", "1000", "--json", "number,body"], `the waiting tickets of ${repo} could not be read, so nothing is migrated`)) as Listed[];
  for (const ticket of listed) migrated(repo, ticket);
}

const enrolledRepos = (): string[] =>
  ghRead(["api", "installation/repositories", "--paginate", "--jq", ".repositories[].full_name"], "the App's repos could not be read, so nothing is migrated").split("\n").filter((repo) => repo !== "" && (repo === MACHINE_REPO || heardIn(repo)));

if (import.meta.main) {
  try {
    for (const repo of process.argv[2] === undefined ? enrolledRepos() : [process.argv[2]]) migrateRepo(repo);
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    console.error(`migrate-waiting: ${error.message}`);
    process.exit(1);
  }
}
