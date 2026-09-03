import { describe, expect, it } from "vitest";
import { listIssueForms, readIssueForm, readIssueWriterCandidates } from "./issue-forms.fixture";

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
    expect(loadForm(file).labels).toContain(EXPECTED_LABEL[file]);
  });

  it.each(Object.keys(EXPECTED_LABEL))("%s asks exactly one required question", (file) => {
    const fields = (loadForm(file).body ?? []).filter((f) => INPUT_TYPES.has(f.type ?? ""));
    expect(fields).toHaveLength(1);
    expect(fields[0].validations?.required).toBe(true);
  });

  it.each(Object.keys(EXPECTED_LABEL))("%s prefills the title", (file) => {
    expect(loadForm(file).title ?? "").not.toBe("");
  });

  it.each(Object.keys(EXPECTED_LABEL))("%s prefills nothing the owner did not type", (file) => {
    for (const field of loadForm(file).body ?? []) {
      expect(field.attributes?.value).toBeUndefined();
    }
  });

  it("leaves the blank issue enabled", () => {
    const config = readIssueForm<{ blank_issues_enabled?: boolean }>("config.yml");
    expect(config.blank_issues_enabled).toBe(true);
  });
});

const ISSUE_EDIT = /issue["'\s,]+edit/g;

function callText(source: string, from: number): string {
  const rest = source.slice(from);
  const ends = [rest.indexOf("\n"), rest.indexOf("])")].filter((i) => i !== -1);
  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

describe("nothing downstream edits the owner's words", () => {
  const files = readIssueWriterCandidates();

  it("has files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("never passes a body to `gh issue edit`", () => {
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
    const offenders = files
      .filter(({ text }) => /issues\.update|updateIssue|PATCH[^\n]*\/issues\//.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
