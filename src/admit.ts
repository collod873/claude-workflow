import { commentOnTicket, gh, OWNER } from "./post.ts";
import { REVIEWED_FROM, SPLIT_FROM } from "./reviewer.ts";
import { why } from "./ticket-shape.ts";

export interface Opened {
  number?: number;
  state?: string;
  user?: { login?: string };
  labels?: { name?: string }[];
  body?: string | null;
}

interface Admission {
  refused?: string;
  unread?: string;
}

export function opened(path: string): Opened | "missing" | "unread" {
  const got = gh(["api", `repos/{owner}/{repo}/issues/${path}`]);
  if (got.status !== 0) return /HTTP 404/.test(got.stderr) ? "missing" : "unread";
  try {
    return JSON.parse(got.stdout) as Opened;
  } catch {
    return "unread";
  }
}

export const doesNotBuild = (ticket: string, refused: string) =>
  `#${ticket} does not build, since its checks would run as shell with the App's token and ${refused}. A ticket the App opens builds only as the reviewer's or the builder's follow-up, or under an open spec the owner opened.`;

export function admission(ticket: string): Admission {
  const asked = opened(ticket);
  if (typeof asked === "string") return { unread: `#${ticket} could not be read` };
  const said = why(asked.body ?? "");
  if (asked.user?.login === OWNER || REVIEWED_FROM.test(said) || SPLIT_FROM.test(said)) return {};
  const spec = opened(`${ticket}/parent`);
  if (spec === "unread") return { unread: `the parent of #${ticket} could not be read` };
  if (spec === "missing") return { refused: "the App opened it under no spec" };
  if (!(spec.labels ?? []).some(({ name }) => name === "spec")) return { refused: "the App opened it under an issue not labelled `spec`" };
  if (spec.user?.login !== OWNER) return { refused: "the App opened it under a spec the owner did not open" };
  if (spec.state !== "open") return { refused: "the App opened it under a spec that is not open" };
  return {};
}

function admit(ticket: string): number {
  const { refused, unread } = admission(ticket);
  if (unread !== undefined) {
    console.error(`admit: ${unread}, so nothing was admitted`);
    return 1;
  }
  if (refused !== undefined) {
    const [unsaid] = commentOnTicket(ticket, doesNotBuild(ticket, refused), gh).refusals;
    if (unsaid !== undefined) console.error(`admit: #${ticket} was refused and not told why: ${unsaid}`);
    console.log("admitted=false");
    return 0;
  }
  console.log("admitted=true");
  return 0;
}

if (import.meta.main) {
  const [ticket] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  process.exit(admit(ticket));
}
