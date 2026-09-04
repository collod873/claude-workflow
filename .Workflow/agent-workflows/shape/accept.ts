import { withReversal } from "../shared/adr-frontmatter";
import { dispatchSpecAuthor } from "../shared/spec-author-dispatch";
import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { acceptedMarker } from "../shared/marker";
import type { Decision, Sheet, Term } from "../shared/sheet-schema";
import { roundFor } from "./rounds";

const SECTION_HEADING = (section: Term["section"]): string => `### ${section}`;

export interface AcceptDeps {
  gh: GhExec;
  git: GitExec;
  newAdr: (title: string) => string;
  landAdr: (draftPath: string) => string;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
}

export type Verb = "approved" | "parked" | "killed";

export type AcceptOutcome =
  | { kind: "approved"; adrs: string[]; terms: string[]; route: "short" | "long" }
  | { kind: "parked" }
  | { kind: "killed" }
  | { kind: "no-sheet"; verb: Verb }
  | { kind: "already-accepted" };

export function accept(deps: AcceptDeps, issueNumber: number, verb: Verb): AcceptOutcome {
  if (verb === "parked") {
    dropIdea(deps.gh, issueNumber);
    return { kind: "parked" };
  }

  if (verb === "killed") {
    dropIdea(deps.gh, issueNumber);
    deps.gh(["issue", "close", String(issueNumber), "--reason", "not planned"]);
    return { kind: "killed" };
  }

  return approve(deps, issueNumber);
}

function approve(deps: AcceptDeps, issueNumber: number): AcceptOutcome {
  const round = roundFor(deps.gh, issueNumber);

  if (round.accepted) {
    return { kind: "already-accepted" };
  }

  const sheet = round.latestSheet;
  if (!sheet) {
    deps.gh([
      "issue",
      "comment",
      String(issueNumber),
      "--body",
      "**Approved, but there is no sheet on this issue.** Nothing was filed and no route was recorded: an accept files the rulings a sheet decided, and this one has none to read.\n\nRemove and re-add `idea` to shape it first.",
    ]);
    return { kind: "no-sheet", verb: "approved" };
  }

  const route = routeFor(deps.gh, issueNumber, sheet);
  const adrs = fileAdrs(deps, sheet, issueNumber);
  const terms = coinTerms(deps, sheet);

  if (adrs.length > 0 || terms.length > 0) {
    commitAndPush(deps, issueNumber, adrs, terms);
  }

  dropIdea(deps.gh, issueNumber);
  deps.gh([
    "issue",
    "comment",
    String(issueNumber),
    "--body",
    acceptComment(adrs, terms, route, sheet),
  ]);

  handOffToSpec(deps.gh, issueNumber);

  dispatchSpecAuthor(deps.gh, issueNumber);

  return { kind: "approved", adrs, terms: terms.map((term) => term.term), route };
}

function routeFor(gh: GhExec, issueNumber: number, sheet: Sheet): "short" | "long" {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "labels"]);
  const parsed = JSON.parse(raw) as { labels?: Array<{ name?: string }> };
  const names = new Set((parsed.labels ?? []).map((each) => each.name));

  if (names.has("go-long")) return "long";
  if (names.has("go-short")) return "short";
  return sheet.route;
}

function fileAdrs(deps: AcceptDeps, sheet: Sheet, issueNumber: number): string[] {
  const written: string[] = [];
  for (const decision of sheet.decisions) {
    if (decision.adrTitle === "" || decision.mark === "" || decision.adrReversal === "") continue;

    const draft = deps.newAdr(decision.adrTitle).trim();
    const drafted = withReversal(deps.readFile(draft), decision.adrReversal);
    deps.writeFile(draft, `${drafted.trimEnd()}\n\n${adrBody(decision, issueNumber)}`);
    written.push(deps.landAdr(draft).trim());
  }
  return written;
}

function adrBody(decision: Decision, issueNumber: number): string {
  return `${decision.recommendation}

Decided on the decision sheet for #${issueNumber}, and filed by the \`approved\` label on it
([ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md)).

## Considered options

- ${decision.rejected}

## Consequences

**${decision.mark}** moves if this answer flips, and that pointer is the assumption mark the sheet
carried, and it is why this decision was written down rather than left on the sheet
([ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)).
`;
}

function coinTerms(deps: AcceptDeps, sheet: Sheet): Term[] {
  if (sheet.newTerms.length === 0) return [];

  let contents = deps.readFile("CONTEXT.md");
  const landed: Term[] = [];

  for (const term of sheet.newTerms) {
    if (contents.includes(`**${term.term}**:`)) continue;

    const inserted = insertTerm(contents, term);
    if (inserted === undefined) continue;
    contents = inserted;
    landed.push(term);
  }

  if (landed.length > 0) deps.writeFile("CONTEXT.md", contents);
  return landed;
}

export function insertTerm(contents: string, term: Term): string | undefined {
  const heading = SECTION_HEADING(term.section);
  const start = contents.indexOf(heading);
  if (start === -1) return undefined;

  const after = contents.indexOf("\n#", start + heading.length);
  const end = after === -1 ? contents.length : after + 1;

  const avoid = term.avoid.length > 0 ? `\n_Avoid_: ${term.avoid.join(", ")}` : "";
  const entry = `**${term.term}**:\n${term.definition}${avoid}\n\n`;

  return contents.slice(0, end) + entry + contents.slice(end);
}

function commitAndPush(deps: AcceptDeps, issueNumber: number, adrs: string[], terms: Term[]): void {
  const paths = [...adrs, ...(terms.length > 0 ? ["CONTEXT.md"] : [])];

  deps.git(["add", ...paths]);
  deps.git(["commit", "-m", commitMessage(issueNumber, adrs, terms)]);
  deps.git(["fetch", "origin", "main"]);
  deps.git(["rebase", "origin/main"]);
  deps.git(["push", "origin", "HEAD:main"]);
}

function commitMessage(issueNumber: number, adrs: string[], terms: Term[]): string {
  const what =
    terms.length === 0
      ? "the rulings"
      : adrs.length === 0
        ? "the vocabulary"
        : "the rulings and vocabulary";

  return `Land ${what} #${issueNumber}'s sheet decided, before a spec can re-decide them

The accept is the signature (ADR-0006), and ADR-0005 files at accept precisely so lane 02
cites these rather than restating them. Written from the decision sheet on #${issueNumber}.`;
}

function acceptComment(
  adrs: string[],
  terms: Term[],
  route: "short" | "long",
  sheet: Sheet,
): string {
  const filed =
    adrs.length === 0
      ? "**No rulings met the bar.** Every decision on the sheet was either unmarked or judged reversible enough to leave unwritten."
      : `**Filed:**\n${adrs.map((path) => `- \`${path}\``).join("\n")}`;

  const coined =
    terms.length === 0 ? "" : `\n\n**Coined:** ${terms.map((t) => `\`${t.term}\``).join(", ")}`;

  const overridden = route === sheet.route ? "" : ` (overriding the sheet's \`${sheet.route}\`)`;

  return `## Accepted

${filed}${coined}

**Route:** \`${route}\`${overridden}

${acceptedMarker({ adrPaths: adrs, coinedTerms: terms.map((term) => term.term), route })}

**Dispatched to lane 02.** This click filed what the sheet decided, so the spec cites the rulings rather than re-deciding them, and then started the spec author on them. The spec arrives as its own \`PRD:\` issue, carrying numbered open questions if it had to guess at anything, and nothing further from you if it did not.`;
}

function dropIdea(gh: GhExec, issueNumber: number): void {
  gh(["issue", "edit", String(issueNumber), "--remove-label", "idea"]);
}

function handOffToSpec(gh: GhExec, issueNumber: number): void {
  gh([
    "issue",
    "edit",
    String(issueNumber),
    "--add-label",
    "to-spec",
    "--remove-label",
    "approved",
  ]);
}
