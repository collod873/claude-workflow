import { describe, expect, it } from "vitest";
import { BY_HAND_LABEL } from "../shared/immutable-set";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { TO_BUILD_LABEL, wakesReconciler, type WakeEvent } from "./reconcile";

function wake(over: Partial<WakeEvent> = {}): WakeEvent {
  return { eventName: "issues", action: "labeled", label: TO_BUILD_LABEL, senderIsOwner: true, ...over };
}

describe("#519: the reconciler reads the label edit that woke it instead of a job condition", () => {
  it.each(["workflow_dispatch", "workflow_run", "push", "repository_dispatch"])("wakes for a %s ending whoever sent it", (eventName) => {
    expect(wakesReconciler(wake({ eventName, senderIsOwner: false, label: "" }))).toBe(true);
  });

  it("wakes when the owner adds the to-build label", () => {
    expect(wakesReconciler(wake())).toBe(true);
  });

  it.each([NEEDS_HUMAN_LABEL, BY_HAND_LABEL])("wakes when the owner lifts a %s hold", (label) => {
    expect(wakesReconciler(wake({ action: "unlabeled", label }))).toBe(true);
  });

  it("refuses a label edit from anyone but the owner, so a stranger cannot move the ready set", () => {
    expect(wakesReconciler(wake({ senderIsOwner: false }))).toBe(false);
  });

  it("refuses a label the ready set does not turn on", () => {
    expect(wakesReconciler(wake({ label: "documentation" }))).toBe(false);
  });

  it("refuses a to-build label being removed, which is not the door that opens work", () => {
    expect(wakesReconciler(wake({ action: "unlabeled", label: TO_BUILD_LABEL }))).toBe(false);
  });

  it("refuses an issues action that is neither labeling nor unlabeling", () => {
    expect(wakesReconciler(wake({ action: "closed" }))).toBe(false);
  });

  it("treats an unknown sender with no owner set as not the owner", () => {
    expect(wakesReconciler(wake({ senderIsOwner: false, action: "unlabeled", label: NEEDS_HUMAN_LABEL }))).toBe(false);
  });
});
