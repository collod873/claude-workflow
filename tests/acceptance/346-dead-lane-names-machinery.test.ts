import { describe, expect, it } from "vitest";
import { deadLanesDocstring, signalFor } from "./346-dead-lanes.fixture";

/**
 * #346's acceptance, authored by hand after lane 04's own author was refused for writing a
 * fixture that turned on a path no pull request may change. These call the subject instead: what
 * a dead-lane signal *says* about a stub, and which spelling the retirement search can match.
 */

const STUB = ".github/workflows/audit-caller.yml";
const REUSABLE = ".github/workflows/audit.yml";
const UNSPLIT = ".github/workflows/enrol.yml";

describe("#346 — a dead-lane signal names the machinery behind the stub", () => {
  // A dead-lane signal names the reusable workflow behind the stub that carried the run:
  it("names both halves, and actionlints the reusable one", () => {
    const signal = signalFor({ path: STUB, name: "Audit (caller)" });
    expect(signal.error).toBeUndefined();

    expect(signal.reusableHalf).toBe(REUSABLE);
    expect(signal.title).toContain(STUB);
    expect(signal.title).toContain(REUSABLE);
    expect(signal.body).toContain(REUSABLE);
    // The remediation has to reach the half that can actually be broken, not only the stub.
    expect(signal.body).toContain(`actionlint ${REUSABLE}`);
  });

  // A dead-lane signal names the reusable workflow behind the stub that carried the run:
  it("invents no second half for a lane that was never split", () => {
    const signal = signalFor({ path: UNSPLIT, name: "Enrol" });
    expect(signal.error).toBeUndefined();

    expect(signal.reusableHalf).toBe(UNSPLIT);
    expect(signal.title).toBe(`${UNSPLIT} is dead: its runs execute zero jobs`);
  });

  // The lane's identity is unchanged: `signalMarker` still keys on the stub path, so a standing
  it("keys the marker on the stub path, so a standing signal is still found by it", () => {
    const signal = signalFor({ path: STUB, name: "Audit (caller)" });
    expect(signal.error).toBeUndefined();

    expect(signal.marker).toBe(`<!-- dead-lane:${STUB} -->`);
    // The body a second sweep searches carries that exact marker, machinery mention or not.
    expect(signal.body).toContain(signal.marker);
  });

  // The unparseable-name branch (`dead-lanes.ts:222`) fires on a condition that can still occur
  it("explains an unreadable name only when the run is named after its own file", () => {
    // A stub GitHub could not parse: no `name:` was read, so the run is named after the file.
    // That is the case the branch still describes correctly after the split.
    const unreadable = signalFor({ path: STUB, name: STUB });
    expect(unreadable.error).toBeUndefined();
    expect(unreadable.body).toContain("could not parse");

    // A stub that parsed, delegating to a reusable half that did not: the run carries the
    // caller's declared name, so the branch must stay silent rather than assert something untrue.
    const parsed = signalFor({ path: STUB, name: "Audit (caller)" });
    expect(parsed.body).not.toContain("could not parse");
  });

  // A standing signal whose marker names a file that can no longer carry a run — every reusable
  it("translates a marker spelled as the reusable half onto the stub that carries the runs", () => {
    const fromReusable = signalFor({ path: REUSABLE, name: "Audit" });
    expect(fromReusable.error).toBeUndefined();
    expect(fromReusable.callerHalf).toBe(STUB);

    // Already a stub: unchanged, so the retirement search cannot double-translate.
    const fromStub = signalFor({ path: STUB, name: "Audit (caller)" });
    expect(fromStub.callerHalf).toBe(STUB);
  });

  // `dead-lanes.ts`'s module docstring states the attribution rule this ticket turns on — a
  it("states the attribution rule in its own module docstring", () => {
    const docstring = deadLanesDocstring();
    expect(docstring).toMatch(/caller/i);
    expect(docstring).toMatch(/uses:|reusable/);
  });
});
