import { type Admission, commentOnTicket, commentsRead, DONE_CHECK_FROM, FAULT_FROM, gh, type Gh, ghAs, heldOf, type Opened, opened, OWNER, readOrStop, RESEARCH, RESEARCH_FROM, REVIEW_FROM, STEP_WAITS, unread } from "./post.ts";
import { dedashed } from "./em-dash.ts";
import { exitFor } from "./stops.ts";
import { why } from "./ticket-shape.ts";

export const doesNotBuild = (ticket: string, refused: string) =>
  `#${ticket} does not build, since its checks would run as shell with the App's token and ${refused}. A ticket the App opens builds only as research's follow-up from a research note the owner opened, as what a reviewer let through on a ticket that builds, as what a done check found on a spec that builds, or as a first step or machine fault its builder filed from a ticket that builds in its own repo.`;
const NO_FOLLOW_UP = "as no follow-up the machine builds";
const HERE = "{owner}/{repo}";
const MOST_READS = 8;

const named = (repo: string, ticket: string) => (repo === HERE ? `#${ticket}` : `${repo}#${ticket}`);
const filedAs = (kind: string | undefined, origin: string) => (kind === STEP_WAITS ? `the first step of ${origin}` : `the machine's fault from ${origin}`);
const handedAs = (kind: string | undefined) => (kind === STEP_WAITS ? "its first step" : "the machine's fault its builder filed");

const ownersOwn = ({ user }: Opened): boolean => user?.login === OWNER;

function researchFollowUp({ body }: Opened, repo: string, line: string): boolean {
  const [, note] = RESEARCH_FROM.exec(why(body ?? "")) ?? [];
  if (note === undefined) return false;
  const asked = opened(note, line, gh, repo);
  return asked !== "missing" && asked.user?.login === OWNER && heldOf(asked.labels).has(RESEARCH);
}

const within = (filed: string, refused: Admission): Admission => (refused === undefined ? undefined : `the App filed it as ${filed}, where ${refused}`);

const CHAINED: [RegExp, (at: string) => string][] = [
  [REVIEW_FROM, (at) => `what the reviewer of ${at} let through`],
  [DONE_CHECK_FROM, (at) => `what the done check of ${at} found`],
];

interface Admitted {
  refused: Admission;
  said: string;
}

function admitted(repo: string, ticket: string, so: string, reads: number, missing: (line: string) => Admission): Admitted {
  const at = named(repo, ticket);
  if (reads === 0) return { refused: `its chain reads ${MOST_READS} tickets before ${at} without reaching one the owner opened`, said: "" };
  const line = `${at} could not be read, ${so}`;
  const asked = opened(ticket, line, gh, repo);
  if (asked === "missing") return { refused: missing(line), said: "" };
  const said = why(asked.body ?? "");
  if (ownersOwn(asked) || researchFollowUp(asked, repo, `the research note of ${at} could not be read, ${so}`)) return { refused: undefined, said };
  for (const [from, filed] of CHAINED) {
    const [, earlier] = from.exec(said) ?? [];
    if (earlier !== undefined && Number(earlier) < Number(ticket)) return { refused: within(filed(named(repo, earlier)), admitted(repo, earlier, so, reads - 1, unread).refused), said };
  }
  const [, from, origin, kind] = FAULT_FROM.exec(said) ?? [];
  if (from === undefined || origin === undefined) return { refused: `the App opened it ${NO_FOLLOW_UP}`, said };
  const filedFrom = `${from}#${origin}`;
  return { refused: within(filedAs(kind, filedFrom), admitted(from, origin, so, reads - 1, () => `${filedFrom} does not exist`).refused), said };
}

export const admission = (ticket: string, so: string): Admission => admitted(HERE, ticket, so, MOST_READS, unread).refused;

function toldOnce(ticket: string, text: string, inRepo: Gh, at: string): void {
  const said = commentsRead(ticket, `the comments on ${at} could not be read, so nothing was admitted`, inRepo);
  if (said.includes(dedashed(text))) return;
  const [unsaid] = commentOnTicket(ticket, text, inRepo).refusals;
  if (unsaid !== undefined) console.error(`admit: the refusal was not posted on ${at}: ${unsaid}`);
}

function waitingTold(ticket: string, said: string, refused: string): void {
  const [, repo, origin, kind] = FAULT_FROM.exec(said) ?? [];
  if (repo === undefined || origin === undefined) return;
  const step = `${process.env.GH_REPO ?? ""}#${ticket}`;
  const text = `@${OWNER} #${origin} waits on ${step}, ${handedAs(kind)}, which does not build, since ${refused}. Build or close ${step} by hand, or #${origin} waits for good.`;
  toldOnce(origin, text, ghAs({ ...process.env, GH_REPO: repo }), `${repo}#${origin}`);
}

function admit(ticket: string): undefined {
  const { refused, said } = admitted(HERE, ticket, "so nothing was admitted", MOST_READS, unread);
  if (refused !== undefined) {
    toldOnce(ticket, doesNotBuild(ticket, refused), gh, `#${ticket}`);
    waitingTold(ticket, said, refused);
    console.log("admitted=false");
    return undefined;
  }
  console.log("admitted=true");
  return undefined;
}

if (import.meta.main) {
  const [ticket] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  process.exit(exitFor(readOrStop("admit", () => admit(ticket))));
}
