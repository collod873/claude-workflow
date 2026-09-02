import { describe, expect, it } from "vitest";
import {
  ENROL_SOURCE,
  ENROL_SOURCE_RELATIVE,
  enrolSource,
  laneCode,
  presence,
} from "./327-enrol.fixture";

/**
 * The two names today's derivation happens to yield.
 *
 * They are here as things the lane's *code* may not spell — never as an expectation about what the
 * derivation should return. The set is whatever scanning the workflows produces on the day the lane
 * runs, and a lane that starts spending a third secret propagates it with nothing edited.
 */
const TODAYS_SECRETS = ["CLAUDE_CODE_OAUTH_TOKEN", "KNOWLEDGE_BASE_DEPLOY_KEY"];

describe("#327 — the secrets an enrolled repository receives", () => {
  // The secret set is derived from `secrets.<NAME>` references in `.github/workflows/`, with
  it("derives the secret set from the workflows instead of listing it", () => {
    expect(presence(ENROL_SOURCE_RELATIVE, ENROL_SOURCE)).toBe("present");

    // The criterion's own check, line for line: no line of the entrypoint names both.
    const bothOnOneLine = /CLAUDE_CODE_OAUTH_TOKEN.*KNOWLEDGE_BASE_DEPLOY_KEY/;
    const listed = enrolSource()
      .split("\n")
      .map((line, index) => ({ line: line.trim(), at: index + 1 }))
      .filter((entry) => bothOnOneLine.test(entry.line))
      .map((entry) => `${ENROL_SOURCE_RELATIVE}:${entry.at}: ${entry.line}`);
    expect(listed).toEqual([]);

    const code = laneCode();

    // Neither name is hard-coded anywhere in the lane's code. Comments are already stripped, so a
    // docstring explaining what the derivation yields today is not what this reads.
    const hardCoded = TODAYS_SECRETS.filter((name) => code.includes('"' + name + '"'));
    expect(hardCoded).toEqual([]);

    // ...and the derivation is actually performed: the lane reaches the workflow directory and looks
    // for `secrets.` references in it.
    expect(code).toMatch(/workflows/);
    expect(code).toMatch(/secrets/i);
  });
});
