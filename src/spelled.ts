type LabelKind = "kind" | "state" | "parked" | "owner" | "try";

interface Label {
  name: string;
  kind: LabelKind;
  colour: string;
  description: string;
}

const KIND_GREY = "c2c2c2";
const STATE_BLUE = "1d76db";

const LABELS: readonly Label[] = [
  { name: "ticket", kind: "kind", colour: KIND_GREY, description: "A ticket the machine builds" },
  { name: "spec", kind: "kind", colour: KIND_GREY, description: "A spec: the whole statement of a big job, sliced into tickets, never built itself" },
  { name: "note", kind: "kind", colour: KIND_GREY, description: "Filed to be kept, never built" },
  { name: "research", kind: "kind", colour: KIND_GREY, description: "A note the machine answers and closes when filed" },
  { name: "building", kind: "state", colour: STATE_BLUE, description: "The builder is writing the ticket's code, or a spec's wave is building" },
  { name: "checking", kind: "state", colour: STATE_BLUE, description: "bin/check and the reviewer judge the head, or the done check tries a spec's sentences" },
  { name: "queued", kind: "state", colour: STATE_BLUE, description: "Check and the review passed; it waits in the closer's queue" },
  { name: "resolving", kind: "state", colour: STATE_BLUE, description: "The builder is resolving a merge conflict" },
  { name: "landing", kind: "state", colour: STATE_BLUE, description: "Up to date with main and next to merge; auto-merge fires once its checks pass" },
  { name: "slicing", kind: "state", colour: STATE_BLUE, description: "The slicer is writing the next wave" },
  { name: "researching", kind: "state", colour: STATE_BLUE, description: "The researcher is answering this note" },
  { name: "waiting", kind: "parked", colour: "fbca04", description: "Waits for other tickets before it builds" },
  { name: "asked", kind: "owner", colour: "5319e7", description: "The machine put the owner a question and resumes on the owner's reply" },
  { name: "needs-human", kind: "owner", colour: "b60205", description: "The machine stopped and needs the owner" },
  { name: "try-", kind: "try", colour: "f66a0a", description: "A builder run after a failure, or a spec's fix wave" },
];

const USAGE = "spelled: usage: spelled labels\n";

if (import.meta.main) {
  const asked = process.argv.slice(2);
  if (asked.length !== 1 || asked[0] !== "labels") {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  process.stdout.write(LABELS.map(({ name, kind, colour, description }) => `${[name, kind, colour, description].join("\t")}\n`).join(""));
}
