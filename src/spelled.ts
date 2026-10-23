type LabelKind = "kind" | "state" | "parked" | "held" | "try";

interface Label {
  name: string;
  kind: LabelKind;
  colour: string;
  description: string;
}

const KIND_GREY = "c2c2c2";
const STATE_BLUE = "1d76db";

export const LABELS = [
  { name: "ticket", kind: "kind", colour: KIND_GREY, description: "A ticket the machine builds" },
  { name: "bug", kind: "kind", colour: KIND_GREY, description: "A fault proven by a log, test or Signal; the machine builds the fix" },
  { name: "spec", kind: "kind", colour: KIND_GREY, description: "A spec: the whole statement of a big job, cut into slices that land once from its integration branch" },
  { name: "note", kind: "kind", colour: KIND_GREY, description: "Filed to be kept, never built" },
  { name: "research", kind: "kind", colour: KIND_GREY, description: "A note the machine answers and closes when filed" },
  { name: "owner-step", kind: "kind", colour: KIND_GREY, description: "A note naming a step only the owner can take; nothing builds or researches it" },
  { name: "building", kind: "state", colour: STATE_BLUE, description: "The builder is writing the ticket's code, or a spec's slices are building" },
  { name: "checking", kind: "state", colour: STATE_BLUE, description: "The reviewer reads the green build and lands it, or the done check tries a spec's sentences" },
  { name: "slicing", kind: "state", colour: STATE_BLUE, description: "The slicer is cutting a spec's next slices" },
  { name: "researching", kind: "state", colour: STATE_BLUE, description: "The researcher is answering this note" },
  { name: "waiting", kind: "parked", colour: "fbca04", description: "Waits for other tickets before it builds" },
  { name: "paused", kind: "held", colour: "0e8a16", description: "The owner paused it; the machine never adds or removes it" },
  { name: "stuck", kind: "held", colour: "b60205", description: "The machine stopped and needs the owner; the machine never removes it" },
  { name: "try-", kind: "try", colour: "f66a0a", description: "A builder run after a failure, or a spec's fix pass" },
] as const satisfies readonly Label[];

export type LabelName = (typeof LABELS)[number]["name"];
export type MarkedLabel = Exclude<Extract<(typeof LABELS)[number], { kind: "state" | "parked" | "held" }>["name"], typeof PAUSED>;

export const TICKET = "ticket" as const satisfies LabelName;
export const BUG = "bug" as const satisfies LabelName;
export const SPEC = "spec" as const satisfies LabelName;
export const NOTE = "note" as const satisfies LabelName;
export const RESEARCH = "research" as const satisfies LabelName;
export const OWNER_STEP = "owner-step" as const satisfies LabelName;
export const BUILDING = "building" as const satisfies MarkedLabel;
export const CHECKING = "checking" as const satisfies MarkedLabel;
export const SLICING = "slicing" as const satisfies MarkedLabel;
export const RESEARCHING = "researching" as const satisfies MarkedLabel;
export const WAITING = "waiting" as const satisfies MarkedLabel;
export const PAUSED = "paused" as const satisfies LabelName;
export const STUCK = "stuck" as const satisfies MarkedLabel;
export const HELD = [PAUSED, STUCK] as const;
export const TICKET_PREFIX = "ticket/";
export const OWNER = "collod873";
export const MACHINE = "collod873-machine[bot]";
export const OWNER_CALL = "owner call";
type SpelledAs<Key extends string> = Lowercase<Key> extends `${infer Head}_${infer Tail}` ? `${Head}-${Tail}` : Lowercase<Key>;
const namedAsSpelled = <Keyed extends { [Key in keyof Keyed & string]: SpelledAs<Key> }>(keyed: Keyed): Keyed => keyed;
const LABEL_KEYS = namedAsSpelled({ TICKET, BUG, SPEC, NOTE, RESEARCH, OWNER_STEP, BUILDING, CHECKING, SLICING, RESEARCHING, WAITING, PAUSED, STUCK });
const KEYED: Record<string, string> = { ...LABEL_KEYS, TICKET_PREFIX, OWNER, MACHINE, OWNER_CALL };

export const SPELLINGS: [key: string, spelling: string][] = [
  ...Object.entries(KEYED),
  ...LABELS.filter(({ name }) => !Object.values(KEYED).includes(name)).map(({ name }): [string, string] => ["labels", name]),
];

const USAGE = `spelled: usage: spelled labels | <key>\nspelled: keys: ${Object.keys(KEYED).join("|")}\n`;

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
