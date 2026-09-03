import { describe, expect, it } from "vitest";
import { listIssueForms, readIssueForm, readIssueWriterCandidates } from "./issue-forms.fixture";

/**
 * Lane 00's micro door. The door is two YAML files and a label — there is no code
 * to unit-test, which is exactly why this file exists: the whole contract lives on the far side of
 * a language boundary no compiler and no type checker can see across, and GitHub only validates
 * the forms after they are pushed. The failure this guards is not a broken form, it is a *working*
 * form that has quietly grown a third field.
 *
 * Both criteria the forms carry are shape claims:
 *
 *   1. One required field. Every additional field is a question asked at a red light, and the
 *      fields worth having — urgency, scope, what it touches — are what lane 01 exists to work
 *      out. A form that grows an "impact" dropdown has not become more useful, it has become a
 *      door the owner routes around.
 *   2. The owner's words are stored verbatim and nothing downstream edits them. Half of that is
 *      the form's own shape (no prefilled `value`, so nothing but his typing reaches the body);
 *      the other half is the absence of any issue-body writer anywhere in the repo, which is what
 *      the second describe block below asserts.
 *
 * Every read of the repo — the forms, the chooser config, the source walk — goes through
 * `issue-forms.fixture.ts`; this file only asserts on what comes back.
 */

/** `markdown` renders instructions and reaches no issue body; every other type collects input. */
const INPUT_TYPES = new Set(["input", "textarea", "dropdown", "checkboxes"]);

interface FormField {
  type?: string;
  attributes?: { value?: string };
  validations?: { required?: boolean };
}

interface IssueForm {
  name?: string;
  title?: string;
  labels?: string[];
  body?: FormField[];
}

/** The label each form is expected to apply, keyed by filename. Written out rather than derived
 * from the filename so that renaming a file to dodge the assertion fails instead of passing. */
const EXPECTED_LABEL: Record<string, string> = {
  "idea.yml": "idea",
  "bug.yml": "bug",
};

function loadForm(file: string): IssueForm {
  return readIssueForm<IssueForm>(file);
}

describe("the micro door", () => {
  it("is the two forms and no others", () => {
    expect(listIssueForms().sort()).toEqual(Object.keys(EXPECTED_LABEL).sort());
  });

  it.each(Object.keys(EXPECTED_LABEL))("%s applies its label automatically", (file) => {
    // The label is the whole trigger surface: lane 01 fires on `idea` and nothing else, so a form
    // that files an unlabelled issue files it into a lane that will never look at it.
    expect(loadForm(file).labels).toContain(EXPECTED_LABEL[file]);
  });

  it.each(Object.keys(EXPECTED_LABEL))("%s asks exactly one required question", (file) => {
    const fields = (loadForm(file).body ?? []).filter((f) => INPUT_TYPES.has(f.type ?? ""));
    expect(fields).toHaveLength(1);
    expect(fields[0].validations?.required).toBe(true);
  });

  it.each(Object.keys(EXPECTED_LABEL))("%s prefills the title", (file) => {
    // GitHub requires a non-empty issue title and no form field can supply one — every field lands
    // in the body. Without a prefill the owner is asked for two things, which makes "one required
    // field" true of the YAML and false of the red light it was designed for.
    expect(loadForm(file).title ?? "").not.toBe("");
  });

  it.each(Object.keys(EXPECTED_LABEL))("%s prefills nothing the owner did not type", (file) => {
    // A `value:` is text the form puts in his mouth. The issue body is then partly the machine's
    // words, and lane 01 has nothing clean to check its restatement against.
    for (const field of loadForm(file).body ?? []) {
      expect(field.attributes?.value).toBeUndefined();
    }
  });

  it("leaves the blank issue enabled", () => {
    // Capture must never refuse — a form that is the only way in is a refusal
    // wearing a friendlier shape, and the one thing lane 00 exists to prevent is a lost idea.
    const config = readIssueForm<{ blank_issues_enabled?: boolean }>("config.yml");
    expect(config.blank_issues_enabled).toBe(true);
  });
});

/** Matches the token pair in either language it appears in here: `gh issue edit` in a shell step,
 * and `["issue", "edit"` in a stage's argv array. */
const ISSUE_EDIT = /issue["'\s,]+edit/g;

/** A `gh` argv array closes on `])`; a shell command closes at the newline. Whichever comes first
 * ends the call, and only flags inside it belong to it. */
function callText(source: string, from: number): string {
  const rest = source.slice(from);
  const ends = [rest.indexOf("\n"), rest.indexOf("])")].filter((i) => i !== -1);
  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

describe("nothing downstream edits the owner's words", () => {
  const files = readIssueWriterCandidates();

  it("has files to scan", () => {
    // A walk that silently found nothing would make every assertion below vacuously green.
    expect(files.length).toBeGreaterThan(20);
  });

  it("never passes a body to `gh issue edit`", () => {
    // `issue edit --add-label` is the repo's whole use of this verb, and labels are the state
    // machine (§1). `--body` on the same call is the one that overwrites what the owner wrote.
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(ISSUE_EDIT)) {
        if (callText(text, match.index).includes("--body")) {
          offenders.push(`${path}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never updates an issue through the API", () => {
    // The same write, reached around `gh`. `issue comment` and `issue create` are deliberately not
    // here: a comment is a new object beside the idea, and a create is a different issue entirely.
    const offenders = files
      .filter(({ text }) => /issues\.update|updateIssue|PATCH[^\n]*\/issues\//.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
