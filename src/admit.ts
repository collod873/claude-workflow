import { type Admission, commentOnTicket, commentsRead, type From, fromOf, gh, type Gh, ghAs, heldOf, type Opened, opened, OWNER, readOrStop, RESEARCH, stoodDown, unread } from "./post.ts";
import { dedashed } from "./em-dash.ts";
import { parentOf } from "./issue-links.ts";
import { WAITING } from "./spelled.ts";
import { exitFor } from "./stops.ts";

export const doesNotBuild = (ticket: string, refused: string) =>
  `#${ticket} does not build, since its checks would run as shell with the App's token and ${refused}. A ticket the App opens builds only as research's follow-up from a research note the owner opened, as what a reviewer let through on a ticket that builds, as what a done check found on a spec that builds, or as a first step or machine fault its builder filed from a ticket that builds in its own repo.`;
const NO_FOLLOW_UP = "as no follow-up the machine builds";
const HERE = "{owner}/{repo}";
const MOST_READS = 8;

const named = (repo: string, ticket: string) => (repo === HERE ? `#${ticket}` : `${repo}#${ticket}`);
const handedAs = (kind: string | undefined) => (kind === "first-step" ? "its first step" : "the machine's fault its builder filed");

const FILED_AS: Record<From["kind"] | "parent", (at: string) => string> = {
  researched: (at) => `research's follow-up from ${at}`,
  review: (at) => `what the reviewer of ${at} let through`,
  "done-check": (at) => `what the done check of ${at} found`,
  fault: (at) => `the machine's fault from ${at}`,
  "first-step": (at) => `the first step of ${at}`,
  parent: (at) => `a sub-issue of ${at}`,
};

const ownersOwn = ({ user }: Opened): boolean => user?.login === OWNER;

function researchNoted(repo: string, note: string, so: string): Admission {
  const at = named(repo, note);
  const asked = opened(note, `the research note of ${at} could not be read, ${so}`, gh, repo);
  return asked !== "missing" && ownersOwn(asked) && heldOf(asked.labels).has(RESEARCH) ? undefined : `the App opened it ${NO_FOLLOW_UP}`;
}

const within = (filed: string, refused: Admission): Admission => (refused === undefined ? undefined : `the App filed it as ${filed}, where ${refused}`);

interface Admitted {
  refused: Admission;
  from: From | undefined;
}

interface Origin {
  repo: string;
  number: string;
  kind: From["kind"] | "parent";
}

function originOf(repo: string, ticket: string, from: From | undefined): Origin | undefined {
  const parent = parentOf(repo, Number(ticket));
  if (parent !== undefined) return { repo: parent.repo, number: String(parent.number), kind: from?.kind ?? "parent" };
  if (from === undefined) return undefined;
  if (from.repo === undefined && (from.kind === "review" || from.kind === "done-check") && Number(from.number) >= Number(ticket)) return undefined;
  return { repo: from.repo ?? repo, number: from.number, kind: from.kind };
}

function admitted(repo: string, ticket: string, so: string, reads: number, missing: (line: string) => Admission, read?: Opened | "missing"): Admitted {
  const at = named(repo, ticket);
  if (reads === 0) return { refused: `its chain reads ${MOST_READS} tickets before ${at} without reaching one the owner opened`, from: undefined };
  const line = `${at} could not be read, ${so}`;
  const asked = read ?? opened(ticket, line, gh, repo);
  if (asked === "missing") return { refused: missing(line), from: undefined };
  const from = fromOf(asked.body ?? "");
  if (ownersOwn(asked)) return { refused: undefined, from };
  const origin = originOf(repo, ticket, from);
  if (origin === undefined) return { refused: `the App opened it ${NO_FOLLOW_UP}`, from };
  const filedFrom = named(origin.repo, origin.number);
  if (origin.kind === "researched") return { refused: within(FILED_AS.researched(filedFrom), researchNoted(origin.repo, origin.number, so)), from };
  const notThere = origin.repo === repo ? unread : () => `${filedFrom} does not exist`;
  return { refused: within(FILED_AS[origin.kind](filedFrom), admitted(origin.repo, origin.number, so, reads - 1, notThere).refused), from };
}

export const admission = (ticket: string, so: string, repo = HERE): Admission => admitted(repo, ticket, so, MOST_READS, unread).refused;

function toldOnce(ticket: string, text: string, inRepo: Gh, at: string): void {
  const said = commentsRead(ticket, `the comments on ${at} could not be read, so nothing was admitted`, inRepo);
  if (said.includes(dedashed(text))) return;
  const [unsaid] = commentOnTicket(ticket, text, inRepo).refusals;
  if (unsaid !== undefined) console.error(`admit: the refusal was not posted on ${at}: ${unsaid}`);
}

function waitingTold(ticket: string, from: From | undefined, refused: string): void {
  if (from?.repo === undefined || (from.kind !== "fault" && from.kind !== "first-step")) return;
  const { repo, number: origin, kind } = from;
  const step = `${process.env.GH_REPO ?? ""}#${ticket}`;
  const text = `@${OWNER} #${origin} waits on ${step}, ${handedAs(kind)}, which does not build, since ${refused}. Build or close ${step} by hand, or #${origin} waits for good.`;
  toldOnce(origin, text, ghAs({ ...process.env, GH_REPO: repo }), `${repo}#${origin}`);
}

function stoodDownBy(asked: Opened | "missing"): string | undefined {
  if (asked === "missing") return undefined;
  const labels = heldOf(asked.labels);
  return stoodDown({ labels, closed: asked.state === "closed" }) ?? (labels.has(WAITING) ? `is marked ${WAITING}` : undefined);
}

function admit(ticket: string): undefined {
  const so = "so nothing was admitted";
  const asked = opened(ticket, `#${ticket} could not be read, ${so}`, gh);
  const stood = stoodDownBy(asked);
  if (stood !== undefined) {
    console.error(`admit: #${ticket} ${stood}, so its build stands down`);
    console.log("admitted=false");
    return undefined;
  }
  const { refused, from } = admitted(HERE, ticket, so, MOST_READS, unread, asked);
  if (refused !== undefined) {
    toldOnce(ticket, doesNotBuild(ticket, refused), gh, `#${ticket}`);
    waitingTold(ticket, from, refused);
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
