import { type Admission, commentOnTicket, FAULT_FROM, gh, heldOf, type Opened, opened, OWNER, readOrStop, RESEARCH, RESEARCH_FROM, REVIEW_FROM, SPLIT_FROM, unread } from "./post.ts";
import { exitFor } from "./stops.ts";
import { why } from "./ticket-shape.ts";

export const doesNotBuild = (ticket: string, refused: string) =>
  `#${ticket} does not build, since its checks would run as shell with the App's token and ${refused}. A ticket the App opens builds only as the builder's follow-up, as research's follow-up from a research note the owner opened, as what a reviewer let through on a ticket that builds, or as a machine fault its builder filed from a ticket that builds in its own repo.`;
const NO_FOLLOW_UP = "as no follow-up the machine builds";

const ownersOrFollowUp = ({ user, body }: Opened): boolean => {
  const said = why(body ?? "");
  return user?.login === OWNER || SPLIT_FROM.test(said);
};

function researchFollowUp({ body }: Opened, line: string): boolean {
  const [, note] = RESEARCH_FROM.exec(why(body ?? "")) ?? [];
  if (note === undefined) return false;
  const asked = opened(note, line, gh);
  return asked !== "missing" && asked.user?.login === OWNER && heldOf(asked.labels).has(RESEARCH);
}

export function admission(ticket: string, so: string): Admission {
  const line = `#${ticket} could not be read, ${so}`;
  const asked = opened(ticket, line, gh);
  if (asked === "missing") return unread(line);
  if (ownersOrFollowUp(asked) || researchFollowUp(asked, `the research note of #${ticket} could not be read, ${so}`)) return undefined;
  const [, reviewed] = REVIEW_FROM.exec(why(asked.body ?? "")) ?? [];
  if (reviewed !== undefined && Number(reviewed) < Number(ticket)) {
    const refused = admission(reviewed, so);
    return refused === undefined ? undefined : `the App filed it as what the reviewer of #${reviewed} let through, where ${refused}`;
  }
  const [, repo, origin] = FAULT_FROM.exec(why(asked.body ?? "")) ?? [];
  if (repo === undefined || origin === undefined) return `the App opened it ${NO_FOLLOW_UP}`;
  return faultAdmission(repo, origin, so);
}

function faultAdmission(repo: string, origin: string, so: string): Admission {
  const at = `${repo}#${origin}`;
  const asked = opened(origin, `${at} could not be read, ${so}`, gh, repo);
  if (asked === "missing") return `the App filed it as the machine's fault from ${at}, which does not exist`;
  return ownersOrFollowUp(asked) ? undefined : `the App filed it as the machine's fault from ${at}, which the App opened ${NO_FOLLOW_UP}`;
}

function admit(ticket: string): undefined {
  const refused = admission(ticket, "so nothing was admitted");
  if (refused !== undefined) {
    const [unsaid] = commentOnTicket(ticket, doesNotBuild(ticket, refused), gh).refusals;
    if (unsaid !== undefined) console.error(`admit: #${ticket} was refused and not told why: ${unsaid}`);
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
