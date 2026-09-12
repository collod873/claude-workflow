import { describe, expect, it } from "vitest";
import { VERBS } from "./accept";
import {
  acceptsShapedIdea,
  IDEA_LABEL,
  shapeDoorFrom,
  shapesIdea,
  SHAPE_COMMENT_ASSOCIATIONS,
  type ShapeDoorValues,
} from "./doors";

const OWNER = "collod873";

function labelled(over: Partial<ShapeDoorValues> = {}): ShapeDoorValues {
  return {
    eventName: "issues",
    label: IDEA_LABEL,
    sender: OWNER,
    owner: OWNER,
    pullRequestUrl: "",
    labels: "",
    commentUserType: "",
    commentAuthorAssociation: "",
    ...over,
  };
}

function commented(over: Partial<ShapeDoorValues> = {}): ShapeDoorValues {
  return labelled({
    eventName: "issue_comment",
    label: "",
    labels: `${IDEA_LABEL},running`,
    commentUserType: "User",
    commentAuthorAssociation: "OWNER",
    ...over,
  });
}

const opens = (values: ShapeDoorValues) => shapesIdea(shapeDoorFrom(values));

describe("#519: the shape lane reads the label door instead of a job condition", () => {
  it("shapes an idea the owner labelled", () => {
    expect(opens(labelled())).toBe(true);
  });

  it("refuses a label anyone but the owner applied, so a stranger cannot spend an Opus run", () => {
    expect(opens(labelled({ sender: "passer-by" }))).toBe(false);
  });

  it("refuses a label that is not the one this lane waits for", () => {
    expect(opens(labelled({ label: "documentation" }))).toBe(false);
  });

  it.each(["repository_dispatch", "push", "workflow_dispatch"])("refuses a %s event, which is nobody's door here", (eventName) => {
    expect(opens(labelled({ eventName }))).toBe(false);
  });
});

describe("#519: the shape lane reads the comment door instead of a job condition", () => {
  it.each(SHAPE_COMMENT_ASSOCIATIONS)("re-shapes on a change request from a %s", (association) => {
    expect(opens(commented({ commentAuthorAssociation: association }))).toBe(true);
  });

  it("refuses a comment from someone with no standing in the repository", () => {
    expect(opens(commented({ commentAuthorAssociation: "NONE" }))).toBe(false);
  });

  it("refuses a comment a bot left, so the lane cannot answer its own comments forever", () => {
    expect(opens(commented({ commentUserType: "Bot" }))).toBe(false);
  });

  it("refuses a comment on an issue carrying no idea label", () => {
    expect(opens(commented({ labels: "prd,running" }))).toBe(false);
  });

  it("refuses a comment on a pull request, which GitHub delivers through this same door", () => {
    expect(opens(commented({ pullRequestUrl: "https://api.github.com/repos/o/r/pulls/7" }))).toBe(false);
  });

  it("does not ask a comment who applied a label, since a comment applies none", () => {
    expect(opens(commented({ sender: "collaborator" }))).toBe(true);
  });
});

describe("#519: the accept lane reads the verb label instead of a job condition", () => {
  it.each(VERBS)("accepts a %s the owner applied", (verb) => {
    expect(acceptsShapedIdea({ label: verb, sender: OWNER, owner: OWNER })).toBe(true);
  });

  it("refuses a verb anyone but the owner applied, since accepting writes ADRs to main", () => {
    expect(acceptsShapedIdea({ label: "approved", sender: "passer-by", owner: OWNER })).toBe(false);
  });

  it.each(["go-long", "go-short", IDEA_LABEL, ""])("refuses %s, which is not a verb this lane acts on", (label) => {
    expect(acceptsShapedIdea({ label, sender: OWNER, owner: OWNER })).toBe(false);
  });
});
