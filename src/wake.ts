import { appendFileSync, readFileSync } from "node:fs";
import { heldOf, stoodDown, stoodDownOrWaiting, type Held, type Standing } from "./post.ts";
import { HELD, MACHINE, NOTE, OWNER, RESEARCH, SPEC, STUCK, TICKET, WAITING, type LabelName } from "./spelled.ts";

export interface IssuePayload {
  action?: string;
  label?: { name?: string };
  sender?: { login?: string };
  issue?: { state?: string; labels?: { name?: string }[] };
}

interface Kind {
  startedBy: LabelName;
  is: (labels: Held) => boolean;
  standsDown: (standing: Standing) => string | undefined;
  freedBy: readonly string[];
}

const KINDS = {
  build: { startedBy: TICKET, is: (labels) => labels.has(TICKET) && !labels.has(NOTE) && !labels.has(SPEC), standsDown: stoodDownOrWaiting, freedBy: [WAITING] },
  spec: { startedBy: SPEC, is: (labels) => labels.has(SPEC), standsDown: stoodDownOrWaiting, freedBy: [WAITING] },
  research: { startedBy: RESEARCH, is: (labels) => labels.has(RESEARCH), standsDown: stoodDown, freedBy: [] },
} as const satisfies Record<string, Kind>;

export type Stage = keyof typeof KINDS;

const freedByOwner: readonly string[] = HELD;
const freedByRepair: readonly string[] = [STUCK];

function starts({ startedBy, is, standsDown, freedBy }: Kind, { action, label, sender, issue }: IssuePayload): boolean {
  const labels = heldOf(issue?.labels);
  const changed = label?.name ?? "";
  const by = sender?.login;
  if ((by !== OWNER && by !== MACHINE) || !is(labels) || standsDown({ labels, closed: issue?.state === "closed" }) !== undefined) return false;
  if (action === "labeled") return changed === startedBy;
  if (action === "unlabeled") return freedBy.includes(changed) || (by === OWNER && freedByOwner.includes(changed)) || (by === MACHINE && freedByRepair.includes(changed));
  return false;
}

export const woken = (event: IssuePayload): Record<Stage, boolean> => ({
  build: starts(KINDS.build, event),
  spec: starts(KINDS.spec, event),
  research: starts(KINDS.research, event),
});

if (import.meta.main) {
  const { GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath } = process.env;
  if (eventPath === undefined || outputPath === undefined) {
    process.stderr.write("wake: usage: GITHUB_EVENT_PATH=<event.json> GITHUB_OUTPUT=<file> wake\n");
    process.exit(2);
  }
  let event: IssuePayload;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8")) as IssuePayload;
  } catch (error) {
    process.stderr.write(`wake: the event could not be read, so nothing starts: ${((error as Error).message.split("\n")[0] ?? "").slice(0, 120)}\n`);
    process.exit(1);
  }
  const answer = Object.entries(woken(event)).map(([stage, starting]) => `${stage}=${String(starting)}\n`).join("");
  appendFileSync(outputPath, answer);
  process.stdout.write(answer);
}
