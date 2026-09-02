import { describe, expect, it } from "vitest";
import {
  ENROL_SOURCE,
  ENROL_SOURCE_RELATIVE,
  enrolSource,
  laneCode,
  presence,
} from "./327-enrol.fixture";

describe("#327 — ADR-0093's repository setting", () => {
  // The lane issues ADR-0093's `PUT` and reads the value back, treating a read-back that is not
  it("writes the pull-request approval setting and reads it back", () => {
    expect(presence(ENROL_SOURCE_RELATIVE, ENROL_SOURCE)).toBe("present");

    // The criterion's own check reads the file as it stands.
    expect(enrolSource()).toContain("can_approve_pull_request_reviews");

    // ...and this reads the code, where the call has to live: a lane that only mentions the setting
    // in a docstring satisfies a `grep` without ever issuing anything.
    const code = laneCode();
    expect(code).toContain("can_approve_pull_request_reviews");
    expect(code).toContain("actions/permissions/workflow");
    expect(code).toMatch(/\bPUT\b/);
  });
});
