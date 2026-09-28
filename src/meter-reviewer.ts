import { capped } from "./brief.ts";
import { gh } from "./post.ts";
import { answered, handedDiff, NO_EM_DASH, TICKET_CAP, ticketPr } from "./reviewer.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { doneWhen, why } from "./ticket-shape.ts";

export const METERS = [
  {
    name: "depth",
    asks: "each module the diff adds or widens that is shallow or a pass-through, each place it joins behaviours that change for different reasons, naming the module, and each place the diff writes or reads text that another stage or workflow reads or writes, such as a marker comment, a stop line, a commit subject, or a PR body line, where the writer and reader each spell it rather than share one message owner, naming both sides. Entry points that Actions call and one-line test fixture helpers are not findings; text carried through one module's own exports is not a finding.",
  },
  {
    name: "cramming",
    asks: "each `## Done when` sentence that asks for more than one behaviour, quoting the sentence and naming each behaviour it packs in.",
  },
  {
    name: "beyond the ask",
    asks: "each behaviour the diff adds or changes that neither the Why nor `## Done when` asks for, naming the file. A test, a registration or a rename that the asked change needs is not a finding.",
  },
  {
    name: "hollow test",
    asks: "each test the diff adds or changes that would still pass if the behaviour it names were broken or missing, naming the test and the break it would miss.",
  },
  {
    name: "lost limit",
    asks: "each limit the owner's own words in the Why set, something not to do or an edge of the scope, that the diff breaks or that no `## Done when` sentence holds it to, quoting those words.",
  },
];

const keyOf = (name: string) => name.replaceAll(" ", "_");

const FINDINGS = { type: "array", items: { type: "string", pattern: NO_EM_DASH } };

const ANSWERS = {
  type: "object",
  properties: Object.fromEntries(METERS.map(({ name }) => [keyOf(name), FINDINGS])),
  required: METERS.map(({ name }) => keyOf(name)),
  additionalProperties: false,
};

export function handedOn(body: string, diff: string): string {
  return [
    "Read this ticket PR for each meter below. Change nothing and rule on nothing else: another stage judges whether it builds the Why. Read the repo if the diff is unclear.",
    "## Why",
    capped(why(body), TICKET_CAP),
    "## Done when",
    capped(doneWhen(body), TICKET_CAP),
    "## Diff",
    handedDiff(diff),
    "## Meters",
    "Answer each meter as a list of what it would refuse, one sentence a builder could act on per finding. An empty list is valid, and a doubt is not a finding.",
    ...METERS.map(({ name, asks }) => `\`${keyOf(name)}\`: ${asks}`),
    "",
  ].join("\n\n");
}

const meterLine = (name: string, findings: string[]) => `${name} (meter): ${findings.length === 0 ? "would refuse nothing" : `would refuse, ${findings.join("; ")}`}`;

const lineOf = (name: string) => new RegExp(`^${name} \\(meter\\):.*$`, "m");

function withLines(body: string, lines: { name: string; line: string }[]): string {
  const missing = lines.filter(({ name }) => !lineOf(name).test(body)).map(({ line }) => line);
  const replaced = lines.reduce((text, { name, line }) => text.replace(lineOf(name), () => line), body);
  return missing.length === 0 ? replaced : `${replaced.trimEnd()}\n\n${missing.join("\n")}\n`;
}

function findingsIn(answer: unknown, name: string): string[] | undefined {
  const found = (answer as Record<string, unknown> | undefined)?.[keyOf(name)];
  return Array.isArray(found) && found.every((finding) => typeof finding === "string") ? found : undefined;
}

function metered(pr: string, print: boolean): Stop | undefined {
  const said = `meters: #${pr}`;
  const read = ticketPr(pr, said);
  if (typeof read !== "object") return read;
  const spent = answered({ name: "meter reviewer", bin: "meters", answers: ANSWERS }, handedOn(read.body, read.diff), pr);
  if (typeof spent === "string") return stoppedAt("modelRun", `${said} ended red, ${spent}`);
  const unanswered = METERS.filter(({ name }) => findingsIn(spent.answer, name) === undefined).map(({ name }) => name);
  if (unanswered.length > 0) return stoppedAt("modelRun", `${said} ended red, the meter reviewer answered no ${unanswered.join(", ")}`);
  const found = METERS.map(({ name }) => ({ name, findings: findingsIn(spent.answer, name) ?? [] }));
  const lines = found.map(({ name, findings }) => ({ name, line: meterLine(name, findings) }));
  if (print) {
    console.log(lines.map(({ line }) => line).join("\n"));
    return undefined;
  }
  const got = gh(["pr", "view", pr, "--json", "body", "--jq", ".body"]);
  if (got.status !== 0 || gh(["pr", "edit", pr, "--body", withLines(got.stdout, lines)]).status !== 0) {
    return stoppedAt("unread", `${said} ended red, its PR body could not be read or edited, so its ${lines.length} meter lines are not on it`);
  }
  const refusing = found.filter(({ findings }) => findings.length > 0).length;
  console.log(`${said} put ${lines.length} meter lines on its PR body, ${refusing} would refuse`);
  return undefined;
}

if (import.meta.main) {
  const [first, second] = process.argv.slice(2);
  const print = first === "--print";
  const pr = print ? second : first;
  if (pr === undefined) throw new Error("no PR number in the arguments");
  process.exit(exitFor(metered(pr, print)));
}
