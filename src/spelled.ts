type LabelKind = "kind" | "state" | "parked" | "owner" | "try";

interface Label {
  name: string;
  kind: LabelKind;
  colour: string;
  description: string;
}

const KIND_GREY = "c2c2c2";
const STATE_BLUE = "1d76db";

const LABELS = [
  { name: "ticket", kind: "kind", colour: KIND_GREY, description: "A ticket the machine builds" },
  { name: "spec", kind: "kind", colour: KIND_GREY, description: "A spec: the whole statement of a big job, sliced into tickets, never built itself" },
  { name: "note", kind: "kind", colour: KIND_GREY, description: "Filed to be kept, never built" },
  { name: "research", kind: "kind", colour: KIND_GREY, description: "A note the machine answers and closes when filed" },
  { name: "building", kind: "state", colour: STATE_BLUE, description: "The builder is writing the ticket's code, or a spec's wave is building" },
  { name: "checking", kind: "state", colour: STATE_BLUE, description: "The check and the reviewer judge the head, or the done check tries a spec's sentences" },
  { name: "queued", kind: "state", colour: STATE_BLUE, description: "Check and the review passed; it waits in the closer's queue" },
  { name: "resolving", kind: "state", colour: STATE_BLUE, description: "The builder is resolving a merge conflict" },
  { name: "landing", kind: "state", colour: STATE_BLUE, description: "Up to date with main and next to merge; auto-merge fires once its checks pass" },
  { name: "slicing", kind: "state", colour: STATE_BLUE, description: "The slicer is writing the next wave" },
  { name: "researching", kind: "state", colour: STATE_BLUE, description: "The researcher is answering this note" },
  { name: "waiting", kind: "parked", colour: "fbca04", description: "Waits for other tickets before it builds" },
  { name: "asked", kind: "owner", colour: "5319e7", description: "The machine put the owner a question and resumes on the owner's reply" },
  { name: "needs-human", kind: "owner", colour: "b60205", description: "The machine stopped and needs the owner" },
  { name: "try-", kind: "try", colour: "f66a0a", description: "A builder run after a failure, or a spec's fix wave" },
] as const satisfies readonly Label[];

export type LabelName = (typeof LABELS)[number]["name"];
export type MarkedLabel = Extract<(typeof LABELS)[number], { kind: "state" | "parked" | "owner" }>["name"];

export const TICKET = "ticket" as const satisfies LabelName;
export const SPEC = "spec" as const satisfies LabelName;
export const NOTE = "note" as const satisfies LabelName;
export const RESEARCH = "research" as const satisfies LabelName;
export const BUILDING = "building" as const satisfies MarkedLabel;
export const CHECKING = "checking" as const satisfies MarkedLabel;
export const QUEUED = "queued" as const satisfies MarkedLabel;
export const RESOLVING = "resolving" as const satisfies MarkedLabel;
export const LANDING = "landing" as const satisfies MarkedLabel;
export const SLICING = "slicing" as const satisfies MarkedLabel;
export const RESEARCHING = "researching" as const satisfies MarkedLabel;
export const WAITING = "waiting" as const satisfies MarkedLabel;
export const ASKED = "asked" as const satisfies MarkedLabel;
export const NEEDS_HUMAN = "needs-human" as const satisfies MarkedLabel;
export const TICKET_PREFIX = "ticket/";
export const OWNER = "collod873";
export const MACHINE = "collod873-machine[bot]";
const KEYED: Record<string, string> = { TICKET, SPEC, NOTE, RESEARCH, BUILDING, CHECKING, QUEUED, RESOLVING, LANDING, SLICING, RESEARCHING, WAITING, ASKED, NEEDS_HUMAN, TICKET_PREFIX, OWNER, MACHINE };

export const SPELLINGS: [key: string, spelling: string][] = [
  ...Object.entries(KEYED),
  ...LABELS.filter(({ name }) => !Object.values(KEYED).includes(name)).map(({ name }): [string, string] => ["labels", name]),
];

const USAGE = `spelled: usage: spelled labels | spelled <${Object.keys(KEYED).join("|")}>\n`;

if (import.meta.main) {
  const asked = process.argv.slice(2);
  const [key = ""] = asked;
  if (asked.length !== 1 || (key !== "labels" && !Object.hasOwn(KEYED, key))) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  process.stdout.write(
    key === "labels" ? LABELS.map(({ name, kind, colour, description }: Label) => `${[name, kind, colour, description].join("\t")}\n`).join("") : `${KEYED[key] ?? ""}\n`,
  );
}
