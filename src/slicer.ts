import { capped, LIST_CAP, NO_EM_DASH, TICKET_CAP } from "./brief.ts";
import { lastDoneCheck, missesOf } from "./done-checker.ts";
import { commentOnTicket, gh, gitRead, mark, OWNER, readOrStop, STUCK } from "./post.ts";
import { briefOf, MOST_BUILDERS, type Progress, progressOn, specBranch } from "./scheduler.ts";
import { SLICING, SPEC } from "./spelled.ts";
import { opened, type Spent } from "./stage.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { DONE_SENTENCES, quoted, SPEC_CAP, ticketRefusals } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Slice refused: the issue is not labelled `spec`",
  unsliced: "Slice: the slices are still refused after two rounds back, so the spec is marked `stuck`",
  uncut: "Slice: the first cut carried no slice, so the spec is marked `stuck`",
});

const ROUNDS_BACK = 2;
export const BUILT_CAP = 8 * 1024;
export const SLICES_CAP = 16 * 1024;
export const FINDINGS_CAP = SPEC_CAP;
export const SLICE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface Slice {
  id: string;
  title: string;
  why: string;
  decisions: string[];
  done: string[];
  blockedBy: string[];
  leftOf: string[];
}

const SLICE = {
  type: "object",
  properties: {
    id: { type: "string", pattern: SLICE_ID.source },
    title: { type: "string", pattern: NO_EM_DASH },
    why: { type: "string", pattern: NO_EM_DASH },
    decisions: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
    done: { type: "array", items: { type: "string", pattern: NO_EM_DASH }, minItems: 1 },
    blockedBy: { type: "array", items: { type: "string" } },
    leftOf: { type: "array", items: { type: "string" } },
  },
  required: ["id", "title", "why", "decisions", "done", "blockedBy", "leftOf"],
  additionalProperties: false,
};

const ANSWERS = {
  type: "object",
  properties: { slices: { type: "array", items: SLICE } },
  required: ["slices"],
  additionalProperties: false,
};

type Cut = "first" | "fix" | "replan";

export interface Handed {
  cut: Cut;
  slices: string;
  built: string;
  findings?: string;
}

const WATCHED = "Read the repo as you need. No one is watching and no one will answer a question: where the spec is silent, choose, and say what you chose in the slice's `why`.";

const SLICING_IS = `Each slice after the seams is one tracer bullet through the spec. A fresh builder builds each slice in its own worktree off the spec's integration branch, up to ${MOST_BUILDERS} at once, and it is merged by fast-forward once its fast check is green. Builders never read the spec, so each slice carries what its builder needs.`;

const NOT_CUT_AGAIN = "Not cut again yet";

const FIXING = "The spec landed and these sentences did not hold; the slices marked `fix pass` are cut to make them hold.";

const CUTS: Record<Cut, { lead: string; findings: string[]; end: string }> = {
  first: {
    lead: "Cut this filed spec's first slices. Cut the seams first: the shared code other slices plug into, named in the words of the repo's `CONTEXT.md` where it has one. Then cut each other slice you can already plan without guessing at a name or a file a seam will settle; leave the rest for a later slicer, who reads them off the branch as built.",
    findings: [],
    end: "Cut at least one. Answer no slice only when main already does the whole spec: the spec then stops for its owner.",
  },
  replan: {
    lead: `The spec has slices already. Read the integration branch as built, in the repo you are in, and the slices still in flight, then cut each slice now at its last responsible moment: every name and file it needs is on the branch or settled by a slice in flight. A slice already cut stands, so cut none twice. What a partial slice left, marked \`${NOT_CUT_AGAIN}\`, is yours to cut now, as one slice or more naming it in \`leftOf\`. An \`out\` slice's builder stopped twice, so the spec waits on its owner: block no new slice on it.`,
    findings: [FIXING],
    end: "Answer no slice when nothing is left to cut: once every slice has merged, the spec runs its full check, two reviewers, `bin/land` and its done check.",
  },
  fix: {
    lead: "The spec landed and its done check found sentences that did not hold. This is the spec's one fix pass, on a fresh integration branch off main. Each finding below says what the done check saw fail: find its cause in the code and confirm it before you look for another, then cut the fewest slices that make those sentences hold.",
    findings: [],
    end: "Cut at least one.",
  },
};

const fields = [
  "`id`: kebab-case and unique within the spec, never one used before.",
  '`why`: what the slice is for in the spec, quoting in straight "..." quotes or a `> ` line the spec\'s words it serves.',
  "`decisions`: each of the spec's Implementation or Testing Decisions this slice must follow, in the spec's words.",
  `\`done\`: ${DONE_SENTENCES}, each one its builder can show on the branch; at least one.`,
  "`blockedBy`: the ids of the slices it needs merged first, from this answer or the slices so far.",
  `\`leftOf\`: the ids of the slices marked \`${NOT_CUT_AGAIN}\` whose leftover this slice cuts again, and empty for every other slice.`,
];

export function handedOn(title: string, body: string, handed: Handed): string {
  const cut = CUTS[handed.cut];
  return [
    `${cut.lead} ${SLICING_IS} ${WATCHED}`,
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## The integration branch as built",
    "Its commits past main, each naming the slice that built it, then the files they changed. Read the code itself in the repo you are in.",
    capped(handed.built, BUILT_CAP) || "(nothing built yet)",
    "## The slices so far",
    capped(handed.slices, SLICES_CAP) || "(none)",
    ...(handed.findings === undefined ? [] : ["## The done check's findings", ...cut.findings, capped(handed.findings, FINDINGS_CAP)]),
    "## Your answer",
    `\`slices\`: each new slice. Code checks each one as the brief its builder gets, \`why\` under \`## Why\` and \`done\` under \`## Done when\`, with the spec's Out of Scope added; that brief must fit the builder's brief cap of ${TICKET_CAP} bytes, so split a slice that does not.`,
    fields.map((field) => `- ${field}`).join("\n"),
    cut.end,
    "",
  ].join("\n\n");
}

export const sentBack = (refusals: string[]): string =>
  ["Code refused your slices, so none is cut yet:", capped(refusals.map((refusal) => `- ${refusal}`).join("\n"), LIST_CAP), "Answer again in full: every slice of this cut.", ""].join("\n\n");

const ticked = (id: string) => `\`${id}\``;

const cutAgainAs = (progress: Progress, id: string) => progress.slices.filter(({ leftOf }) => leftOf.includes(id)).map((other) => other.id);

function slicesSoFar(progress: Progress): string {
  return progress.slices
    .map(({ id, title, state, fix, blockedBy, done, left }) => {
      const after = blockedBy.length === 0 ? "" : ` Blocked by ${blockedBy.map(ticked).join(", ")}.`;
      const again = cutAgainAs(progress, id);
      const leftover = left === undefined ? "" : ` It left: ${left} ${again.length === 0 ? `${NOT_CUT_AGAIN}.` : `Cut again as ${again.map(ticked).join(", ")}.`}`;
      const doing = state === "merged" ? "" : `\n  Done when: ${done.join(" ")}`;
      return `- \`${id}\` (${state}${fix ? ", fix pass" : ""}): ${title}.${after}${leftover}${doing}`;
    })
    .join("\n");
}

function builtSoFar(spec: string): string {
  const unread = `${specBranch(spec)} could not be read against origin/main, so no model was spent`;
  const commits = gitRead(["log", "--reverse", "--format=- %s (%(trailers:key=Slice,valueonly,separator=%x2C))", "origin/main..HEAD"], unread);
  const files = gitRead(["diff", "--stat", "origin/main...HEAD"], unread);
  return [capped(commits, LIST_CAP), capped(files, LIST_CAP)].filter((part) => part !== "").join("\n\n");
}

function blockedCycle(slices: Slice[]): string[] {
  const named = new Map(slices.map((slice) => [slice.id, slice]));
  const cycled = new Set<string>();
  const walk = (id: string, path: string[]): void => {
    if (path.includes(id)) {
      cycled.add(path.slice(path.indexOf(id)).concat(id).map(ticked).join(" -> "));
      return;
    }
    for (const next of named.get(id)?.blockedBy ?? []) walk(next, [...path, id]);
  };
  for (const slice of slices) walk(slice.id, []);
  return [...cycled].slice(0, 1).map((cycle) => `the slices block each other in a cycle, ${cycle}, so none could ever build`);
}

function leftRefusals(answer: Slice[], progress: Progress): string[] {
  const uncut = new Set(progress.slices.filter(({ id, left }) => left !== undefined && cutAgainAs(progress, id).length === 0).map(({ id }) => id));
  const cuts = new Set(answer.flatMap(({ leftOf }) => leftOf));
  const left = [...uncut].filter((id) => !cuts.has(id)).map((id) => `\`${id}\` left work no slice of this answer cuts again: cut it, naming \`${id}\` in that slice's \`leftOf\``);
  const twice = answer.flatMap((slice, at) =>
    slice.leftOf
      .filter((id) => !uncut.has(id))
      .map((id) => {
        const again = cutAgainAs(progress, id);
        return `slice ${at + 1}, \`${slice.id}\`, cuts again what \`${id}\` left, ${again.length === 0 ? "but no slice so far left anything there" : `which ${again.map(ticked).join(", ")} already cuts again`}`;
      }),
  );
  return [...left, ...twice];
}

function sliceRefusals(answer: Slice[], progress: Progress, body: string, cut: Cut): string[] {
  const known = new Set(progress.slices.map(({ id }) => id));
  const given = answer.map(({ id }) => id);
  const empty = cut === "fix" && answer.length === 0 ? ["the fix pass carries no slice, so nothing would make the missed sentences hold"] : [];
  const each = answer.flatMap((slice, at) => {
    const named = `slice ${at + 1}, \`${slice.id}\`,`;
    const id = !SLICE_ID.test(slice.id) ? [`${named} has an id that is not kebab-case`] : known.has(slice.id) ? [`${named} reuses the id of a slice already cut`] : given.indexOf(slice.id) !== at ? [`${named} has the id of an earlier slice in this answer`] : [];
    const blocked = slice.blockedBy.filter((other) => other === slice.id || !(known.has(other) || given.includes(other))).map((other) => (other === slice.id ? `${named} is blocked by itself` : `${named} is blocked by \`${other}\`, which no slice is`));
    const brief = briefOf(slice, body);
    const bytes = Buffer.byteLength(brief);
    const over = bytes > TICKET_CAP ? [`${named} would brief its builder in ${bytes} bytes, over the brief cap of ${TICKET_CAP}: split it`] : [];
    return [...id, ...blocked, ...over, ...ticketRefusals(brief).map((refusal) => `${named} ${refusal}`)];
  });
  return [...empty, ...each, ...leftRefusals(answer, progress), ...blockedCycle(answer)];
}

function isAnswer(answer: unknown): answer is { slices: Slice[] } {
  const slices = (answer as { slices?: unknown } | undefined)?.slices;
  return Array.isArray(slices) && slices.every((slice: Partial<Slice>) => typeof slice.id === "string" && typeof slice.title === "string" && typeof slice.why === "string" && Array.isArray(slice.decisions) && Array.isArray(slice.done) && Array.isArray(slice.blockedBy) && Array.isArray(slice.leftOf));
}

function calledOwner(spec: string, stop: "unsliced" | "uncut", why: string) {
  mark(spec, STUCK);
  commentOnTicket(spec, `@${OWNER} the slicer of #${spec} cut nothing and needs you: ${why}`, gh);
  return stoppedAt(stop, `slice: #${spec} marked ${STUCK}, ${why}`);
}

function sliced(spec: string) {
  const said = `slice: #${spec}`;
  const opening = opened({
    stage: "slice",
    issue: spec,
    state: SLICING,
    stoppedAt,
    hire: { name: "slicer", model: "opus", answers: ANSWERS },
    ready: (asked) => {
      if (!asked.labels.has(SPEC)) return stoppedAt("notSpec", `${said} is not a spec, so nothing sliced it`);
      const { progress } = progressOn(spec);
      const cut: Cut = progress.fixPass && !progress.slices.some(({ fix }) => fix) ? "fix" : progress.slices.length === 0 ? "first" : "replan";
      const findings = progress.fixPass ? missesOf(lastDoneCheck(spec, `the comments on #${spec} could not be read, so no model was spent`) ?? "") : undefined;
      return { carrying: { progress, handed: { cut, slices: slicesSoFar(progress), built: builtSoFar(spec), findings } }, tried: progress.fixPass };
    },
  });
  if (typeof opening !== "object") return opening;
  const { asked, spend, carried: { progress, handed } } = opening;
  let spent: Spent = spend(handedOn(asked.title, asked.body, handed));
  for (let round = 0; ; round++) {
    if (spent.refusal !== undefined) return stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
    if (!isAnswer(spent.answer)) return stoppedAt("modelRun", `${said} ended red, the slicer gave no slices`);
    const { slices } = spent.answer;
    if (handed.cut === "first" && slices.length === 0) return calledOwner(spec, "uncut", "its first cut carried no slice, so nothing of the spec would be built: main may already do all of it, or the spec may say too little to cut");
    const refusals = sliceRefusals(slices, progress, asked.body, handed.cut);
    if (refusals.length === 0) {
      console.error(`${said} cut ${slices.length} ${slices.length === 1 ? "slice" : "slices"}${slices.length === 0 ? "" : `: ${slices.map(({ id }) => id).join(", ")}`}`);
      console.log(JSON.stringify({ slices }));
      return undefined;
    }
    if (round === ROUNDS_BACK) return calledOwner(spec, "unsliced", `its slices were still refused after ${ROUNDS_BACK} rounds back: ${quoted(refusals[0] ?? "")}`);
    spent = spend(sentBack(refusals), spent.session);
  }
}

if (import.meta.main) {
  const [spec] = process.argv.slice(2);
  if (spec === undefined) throw new Error("no spec number in the arguments");
  process.exit(exitFor(readOrStop("slice", () => sliced(spec))));
}
