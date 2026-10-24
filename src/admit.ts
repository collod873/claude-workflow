import { type Admission, commentOnTicket, FAULT_FROM, gh, type Gh, heldOf, type Opened, opened, OWNER, readOrStop, RESEARCH, RESEARCH_FROM, REVIEW_FROM, SPLIT_FROM, STEP_WAITS, unread } from "./post.ts";
import { exitFor } from "./stops.ts";
import { why } from "./ticket-shape.ts";

export const doesNotBuild = (ticket: string, refused: string) =>
  `#${ticket} does not build, since its checks would run as shell with the App's token and ${refused}. A ticket the App opens builds only as the builder's follow-up, as research's follow-up from a research note the owner opened, as what a reviewer let through on a ticket that builds, or as a first step or machine fault its builder filed from a ticket that builds in its own repo.`;
const NO_FOLLOW_UP = "as no follow-up the machine builds";
const HERE = "{owner}/{repo}";
const MOST_READS = 8;

const named = (repo: string, ticket: string) => (repo === HERE ? `#${ticket}` : `${repo}#${ticket}`);
const filedAs = (kind: string | undefined, origin: string) => (kind === STEP_WAITS ? `the first step of ${origin}` : `the machine's fault from ${origin}`);
const handedAs = (kind: string | undefined) => (kind === STEP_WAITS ? "its first step" : "the machine's fault its builder filed");

const ownersOrFollowUp = ({ user, body }: Opened): boolean => {
  const said = why(body ?? "");
  return user?.login === OWNER || SPLIT_FROM.test(said);
};

function researchFollowUp({ body }: Opened, repo: string, line: string): boolean {
  const [, note] = RESEARCH_FROM.exec(why(body ?? "")) ?? [];
  if (note === undefined) return false;
  const asked = opened(note, line, gh, repo);
  return asked !== "missing" && asked.user?.login === OWNER && heldOf(asked.labels).has(RESEARCH);
}

const within = (filed: string, refused: Admission): Admission => (refused === undefined ? undefined : `the App filed it as ${filed}, where ${refused}`);

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
  if (ownersOrFollowUp(asked) || researchFollowUp(asked, repo, `the research note of ${at} could not be read, ${so}`)) return { refused: undefined, said };
  const [, reviewed] = REVIEW_FROM.exec(said) ?? [];
  if (reviewed !== undefined && Number(reviewed) < Number(ticket)) return { refused: within(`what the reviewer of ${named(repo, reviewed)} let through`, admitted(repo, reviewed, so, reads - 1, unread).refused), said };
  const [, from, origin, kind] = FAULT_FROM.exec(said) ?? [];
  if (from === undefined || origin === undefined) return { refused: `the App opened it ${NO_FOLLOW_UP}`, said };
  const filedFrom = `${from}#${origin}`;
  return { refused: within(filedAs(kind, filedFrom), admitted(from, origin, so, reads - 1, () => `${filedFrom} does not exist`).refused), said };
}

export const admission = (ticket: string, so: string): Admission => admitted(HERE, ticket, so, MOST_READS, unread).refused;

function waitingTold(ticket: string, said: string, refused: string): void {
  const [, repo, origin, kind] = FAULT_FROM.exec(said) ?? [];
  if (repo === undefined || origin === undefined) return;
  const step = `${process.env.GH_REPO ?? ""}#${ticket}`;
  const inOrigin: Gh = (args) => gh([...args, "--repo", repo]);
  const [unsaid] = commentOnTicket(origin, `@${OWNER} #${origin} waits on ${step}, ${handedAs(kind)}, which does not build, since ${refused}. Build or close ${step} by hand, or #${origin} waits for good.`, inOrigin).refusals;
  if (unsaid !== undefined) console.error(`admit: ${repo}#${origin} waits on refused #${ticket} and was not told: ${unsaid}`);
}

function admit(ticket: string): undefined {
  const { refused, said } = admitted(HERE, ticket, "so nothing was admitted", MOST_READS, unread);
  if (refused !== undefined) {
    const [unsaid] = commentOnTicket(ticket, doesNotBuild(ticket, refused), gh).refusals;
    if (unsaid !== undefined) console.error(`admit: #${ticket} was refused and not told why: ${unsaid}`);
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
