import { withReversal } from "../shared/adr-frontmatter";
import { CORPUS_RELATIVE_PATH } from "../shared/generate-corpus-fixture";
import { dispatchSpecAuthor } from "../spec/publish";
import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { acceptedMarker } from "./marker";
import type { Decision, Sheet, Term } from "./sheet-schema";
import { roundFor } from "./rounds";

/**
 * The owner's four verbs, as the thing each one triggers.
 *
 * §01: **all four are labels**, never comment prose — a label is something a
 * gate can fire on. This is the other half of lane 01, and the half that
 * makes the sheet more than a document: `approved` is
 * [ADR-0005](../../../docs/adr/0005-accepting-a-shaped-idea-is-what-files-its-adrs.md)'s
 * mechanism — *accepting a shaped idea is what files its ADRs* — and
 * [ADR-0006](../../../docs/adr/0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md)'s
 * W5 restated as something that happens rather than something asserted:
 * agents draft, the owner signs, and the signature is a label.
 *
 * **The dispatch is here**, and §01's `approved` row is met in full: *dispatches on the route; the
 * same click starts the work*. This files the rulings, coins the terms, records the route, swaps
 * the label to `to-spec` so the tracker shows where the work sits, and sends the `sheet-accepted`
 * dispatch that `spec.yml` listens for.
 *
 * That last part was true, then briefly was not. This comment used to say lane 02 did not exist
 * yet and would fire on this same `approved` label; ADR-0083 replaced that with the dispatch,
 * because a lane 02 firing on `approved` races the accept's own push. #263 then deleted `spec.yml`'s
 * listener while leaving the send here, and for three days an accepted idea dispatched into nothing
 * and stopped dead. The listener is back. Keep the two ends of this in the same change.
 */

/** Where a coined term is inserted, per `CONTEXT.md`'s own headings. */
const SECTION_HEADING = (section: Term["section"]): string => `### ${section}`;

export interface AcceptDeps {
  gh: GhExec;
  git: GitExec;
  /**
   * Creates the ADR as an unnumbered draft and returns its path —
   * `bin/new-adr`, shelled out to rather than reimplemented, because the
   * numbering rule is the kind of thing that is wrong in exactly one of two
   * copies.
   */
  newAdr: (title: string) => string;
  /**
   * Claims the draft's number and returns the landed path — `bin/new-adr
   * --land`, the second half of the same tool.
   *
   * It is a second call rather than one because of *when* the number is
   * claimed (ADR-0080). This lane runs on a runner against a checkout of
   * `origin/main`, and the owner's tree may hold uncommitted work the runner
   * cannot see; a number taken at draft time is taken against a corpus the
   * other author is already past. Landing fetches `origin/main` first, so the
   * number is claimed as late as this lane can claim it — immediately before
   * the commit that pushes it.
   */
  landAdr: (draftPath: string) => string;
  /**
   * Regenerates `adr-corpus.evidence.json` from `docs/adr` and `docs/research`
   * — `writeCorpusFixture`, held at arm's length the way `newAdr` is so a test
   * can watch when it runs without a corpus on disk to run it against.
   *
   * It is here because an accept is one of the few things in this estate that
   * *grows the corpus*. The fixture is a captured snapshot of the directory
   * this lane files into, so a lane that writes an ADR and not the snapshot
   * leaves the repository describing a corpus it no longer has.
   */
  regenerateCorpus: () => void;
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

/** Runs whichever verb the label carried. */
export function accept(deps: AcceptDeps, issueNumber: number, verb: Verb): AcceptOutcome {
  if (verb === "parked") {
    // No dispatch, no comment. The sheet stays as the record and nothing ever
    // re-raises it — anything that did would be a nag, and C4 says a nag dies
    // by month three. Dropping `idea` is what stops this lane re-firing.
    dropIdea(deps.gh, issueNumber);
    return { kind: "parked" };
  }

  if (verb === "killed") {
    dropIdea(deps.gh, issueNumber);
    // Closed as `not planned`: a killed idea is not delivered work, and §6's
    // fourth counter reads `not_planned` closes only on issues carrying
    // `## Acceptance criteria` — which an idea, filed through §00's one-field
    // door, never has. So this cannot pollute that count.
    deps.gh(["issue", "close", String(issueNumber), "--reason", "not planned"]);
    return { kind: "killed" };
  }

  return approve(deps, issueNumber);
}

function approve(deps: AcceptDeps, issueNumber: number): AcceptOutcome {
  const round = roundFor(deps.gh, issueNumber);

  // Silently, and deliberately. Re-applying `approved` is something an owner
  // does by accident — removing a label to re-read the sheet, then putting it
  // back — and the honest response to *this is already done* is to do nothing
  // rather than to comment about it. Filing again would mean a second copy of
  // every ruling under new numbers, pushed to `main`.
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
      "**Approved, but there is no sheet on this issue.** Nothing was filed and no route was recorded — an accept files the rulings a sheet decided, and this one has none to read.\n\nRemove and re-add `idea` to shape it first.",
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

  // Last, and only after the comment above has landed (ADR-0083). Lane 02's sheet collector reads
  // the accept payload out of that comment and throws without it, so a lane 02 that fired on the
  // `approved` label would race the write it depends on — and lose, since this lane files, commits
  // and pushes ADRs before it ever comments.
  dispatchSpecAuthor(deps.gh, issueNumber);

  return { kind: "approved", adrs, terms: terms.map((term) => term.term), route };
}

/**
 * The route the accept records: the sheet's, unless the owner applied
 * ADR-0007's one-word override alongside `approved`.
 *
 * The override is read off the labels rather than off a comment because §01
 * is explicit that a verb has to be something a gate can fire on. `go-long`
 * wins over `go-short` if both are somehow present — the asymmetry is
 * ADR-0007's: a wrong short route is visible and recoverable, a wrong long
 * route only costs overhead, so the ambiguous case takes the survivable one.
 *
 * **On applying the two labels in either order.** GitHub fires one
 * `issues.labeled` event per label, so `approved` can arrive before the
 * override does. This reads the labels *live* rather than from the event
 * payload, and it reads them after a checkout and an `npm ci` — tens of
 * seconds after the picker closed. An override applied in the same gesture is
 * therefore always there by the time this runs, and one applied minutes later
 * is a second decision the owner can see was not taken, because the accept
 * comment says which route it recorded.
 */
function routeFor(gh: GhExec, issueNumber: number, sheet: Sheet): "short" | "long" {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "labels"]);
  const parsed = JSON.parse(raw) as { labels?: Array<{ name?: string }> };
  const names = new Set((parsed.labels ?? []).map((each) => each.name));

  if (names.has("go-long")) return "long";
  if (names.has("go-short")) return "short";
  return sheet.route;
}

/**
 * Writes an ADR for every decision that passes the bar, and returns the paths.
 *
 * **The bar is checked here, mechanically, and it is a mark, a title and a
 * reversal sentence.** ADR-0028 makes the mark the first of
 * `docs/adr/README.md`'s three tests (*hard to reverse*), and the shaper
 * writes a title only where it judges all three met. A title without a mark is
 * a shaper claiming a bar it did not show its work for, so it files nothing —
 * which keeps the mark load-bearing rather than decorative, and keeps the gate
 * free of any judgement at the moment it runs.
 *
 * The reversal sentence joined that list because `adr_shape.validate` refuses
 * an ADR whose `reversal:` is empty, and this lane cannot type one at the
 * push it fails. Filing without it produced a file the push venue rejects —
 * which is not a stricter bar, just a later one, paid by whoever next ran
 * `bin/gauntlet push` on a corpus they had not written.
 */
function fileAdrs(deps: AcceptDeps, sheet: Sheet, issueNumber: number): string[] {
  const written: string[] = [];
  for (const decision of sheet.decisions) {
    if (decision.adrTitle === "" || decision.mark === "" || decision.adrReversal === "") continue;

    // Draft, fill, then land. The body is appended to the draft rather than to the landed file so
    // that the number is claimed against the freshest `origin/main` this lane can see — after all
    // the writing is done, immediately before `commitAndPush` (ADR-0080). Everything downstream
    // reads the landed path, so the two-step stops here.
    //
    // `reversal:` is written into the frontmatter rather than appended with the body: it is a
    // declared key the corpus is read by, not prose, and `bin/new-adr` leaves it empty precisely
    // so that whoever fills it has to mean it.
    const draft = deps.newAdr(decision.adrTitle).trim();
    const drafted = withReversal(deps.readFile(draft), decision.adrReversal);
    deps.writeFile(draft, `${drafted.trimEnd()}\n\n${adrBody(decision, issueNumber)}`);
    written.push(deps.landAdr(draft).trim());
  }
  return written;
}

/**
 * The body appended under the title and date `bin/new-adr` already wrote.
 *
 * `docs/adr/README.md`: *a title and one to three sentences — that's the whole
 * requirement*, with Considered options only when the rejected alternatives
 * are worth remembering. They always are here, because the sheet had one and
 * the whole reason ADR-0005 files at accept is so a later ticket does not
 * re-propose it in six months.
 */
function adrBody(decision: Decision, issueNumber: number): string {
  return `${decision.recommendation}

Decided on the decision sheet for #${issueNumber}, and filed by the \`approved\` label on it
([ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md)).

## Considered options

- ${decision.rejected}

## Consequences

**${decision.mark}** moves if this answer flips — that pointer is the assumption mark the sheet
carried, and it is why this decision was written down rather than left on the sheet
([ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)).
`;
}

/** Inserts each coined term at the end of its `CONTEXT.md` section, and returns what landed. */
function coinTerms(deps: AcceptDeps, sheet: Sheet): Term[] {
  if (sheet.newTerms.length === 0) return [];

  let contents = deps.readFile("CONTEXT.md");
  const landed: Term[] = [];

  for (const term of sheet.newTerms) {
    // A term the file already carries is not coined again. `approved` is a
    // label, and a label can be removed and re-applied.
    if (contents.includes(`**${term.term}**:`)) continue;

    const inserted = insertTerm(contents, term);
    if (inserted === undefined) continue;
    contents = inserted;
    landed.push(term);
  }

  if (landed.length > 0) deps.writeFile("CONTEXT.md", contents);
  return landed;
}

/**
 * Inserts one entry at the end of its section, or returns `undefined` when
 * the section is not there.
 *
 * Not there means `CONTEXT.md` has been reorganised since this enum was
 * written, and the right answer is to leave the file alone and say so in the
 * accept comment. Creating the heading would let this lane quietly invent
 * structure in the one document the whole estate reads for its vocabulary.
 */
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

/**
 * Commits and pushes the accept's writes straight to `main`.
 *
 * Ruled with the move: this repo has no branch protection (§10 — on a private
 * Free account it is a purchase, not a setting) and work lands by direct
 * push today. A pull request here would add a second owner touch to a lane
 * §01 budgets at **two owner minutes**, which is the cost the accept exists
 * to hold down. Move 10 is where this flips, along with everything else that
 * writes.
 *
 * Rebases before pushing rather than force-pushing: the checkout is minutes
 * old at most, and a rejected push means something else landed while the
 * owner was reading — which is a thing to retry onto, never to overwrite.
 */
function commitAndPush(deps: AcceptDeps, issueNumber: number, adrs: string[], terms: Term[]): void {
  const paths = [...adrs, ...(terms.length > 0 ? ["CONTEXT.md"] : [])];

  // The corpus fixture moves in the same commit as the ADRs, because it is a snapshot of the
  // directory those ADRs just landed in — `missing-trailer.test.ts` reads the snapshot rather
  // than the corpus, and a snapshot one ADR behind is a test quietly running against a record
  // that no longer exists. `bin/gauntlet push` gates on exactly that (`regenerate && diff`), and
  // the `pre-push` hook installs itself on a runner as readily as on the owner's machine, so the
  // first accept ever to reach a push had its push refused by this repo's own gate for the ADR it
  // had just written. The fix is not to let the lane past the gate: it is that a lane which grows
  // the corpus owns keeping the snapshot true, the same way the owner's own hand-made ADR commits
  // always have.
  if (adrs.length > 0) {
    deps.regenerateCorpus();
    paths.push(CORPUS_RELATIVE_PATH);
  }

  deps.git(["add", ...paths]);
  deps.git(["commit", "-m", commitMessage(issueNumber, adrs, terms)]);
  deps.git(["fetch", "origin", "main"]);
  deps.git(["rebase", "origin/main"]);
  deps.git(["push", "origin", "HEAD:main"]);
}

/** `CLAUDE.md`: commit messages explain **why**, not what. */
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

**Dispatched to lane 02.** This click filed what the sheet decided, so the spec cites the rulings rather than re-deciding them, and then started the spec author on them. The spec arrives as its own \`PRD:\` issue — carrying numbered open questions if it had to guess at anything, and nothing further from you if it did not.`;
}

/** Drops `idea`, which is the only thing that stops this lane re-firing. */
function dropIdea(gh: GhExec, issueNumber: number): void {
  gh(["issue", "edit", String(issueNumber), "--remove-label", "idea"]);
}

/**
 * Moves the issue's label from the verb that was spent to the lane that is now owed.
 *
 * **This does not start lane 02** — `dispatchSpecAuthor` does, immediately below the call site. A
 * label applied by this job's built-in `GITHUB_TOKEN` starts no workflow run at all (ADR-0054), so
 * a reader who takes this for the trigger will go looking for a race that cannot happen and miss
 * the dispatch that can.
 *
 * What it is for is the tracker. `approved` is a verb in the past tense: it says the owner signed,
 * which the accept comment already says better and permanently. Left on the issue it reads as a
 * position, and the position it implies — *accepted, nothing pending* — is wrong for the whole
 * window in which lane 02 owes a spec. `to-spec` is where the work actually sits, which is the only
 * thing `docs/agents/pipeline-labels.md` lets a label assert.
 *
 * Removing `approved` cannot make the accept re-fire: `roundFor` judges an issue accepted from the
 * `shape-accepted:v1` marker on its comments, never from the label, so a re-applied `approved`
 * still returns `already-accepted`.
 */
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
