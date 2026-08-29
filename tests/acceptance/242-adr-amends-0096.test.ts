import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "./workflow-shape.fixture";

/**
 * #242 — the ruling that a ticket's check reads the tree while a spec's check reads the world,
 * landed as its own ADR naming ADR-0096 as the rule it amends rather than editing ADR-0096 in
 * place (CLAUDE.md: "Never edit an old ADR to reflect a new decision; write a new one that says
 * what it amends").
 */

const adrDir = path.join(repoRoot, "docs", "adr");

/**
 * `grep -rliE 'amends.*0096|0096.*amend'`.
 *
 * `-i`, so the alternation is case-insensitive. `grep` matches a line at a time and `.` never
 * crosses a newline, so this is applied per line rather than to the whole file — a body that says
 * "amends" in one paragraph and "0096" three paragraphs later does not satisfy the check.
 */
const AMENDS_0096 = /amends.*0096|0096.*amend/i;

/**
 * `| grep -v 0096-a-check-marker`.
 *
 * ADR-0096 is the rule being amended; it naming its own number is not evidence that anything
 * amended it, so the file whose name carries this slug is excluded exactly as the check excludes
 * it.
 */
const ADR_0096_SLUG = "0096-a-check-marker";

/**
 * The landed ADRs — the numbered files the check's `docs/adr/*.md` glob reaches.
 *
 * Numbered, because a number is claimed when an ADR lands and not when it is drafted (ADR-0080):
 * a draft sitting beside them is not a landed ADR and must not satisfy this.
 */
function landedAdrs(): string[] {
  return fs.readdirSync(adrDir).filter((name) => /^\d{4}-.*\.md$/.test(name));
}

function namesAdr0096AsAmended(name: string): boolean {
  const body = fs.readFileSync(path.join(adrDir, name), "utf8");
  return body.split("\n").some((line) => AMENDS_0096.test(line));
}

describe("#242 — the ADR amending ADR-0096 for a spec's check reading the world", () => {
  // Criterion, verbatim:
  // - [ ] A landed ADR file names ADR-0096 as amended — check: `grep -rliE 'amends.*0096|0096.*amend' docs/adr/*.md | grep -v 0096-a-check-marker`
  it("A landed ADR file names ADR-0096 as amended — check: `grep -rliE 'amends.*0096|0096.*amend' docs/adr/*.md | grep -v 0096-a-check-marker`", () => {
    const landed = landedAdrs();
    expect(
      landed.length,
      `no landed ADRs found in ${adrDir} — the check's docs/adr/*.md glob would match nothing`,
    ).toBeGreaterThan(0);

    const amending = landed
      .filter((name) => !name.includes(ADR_0096_SLUG))
      .filter(namesAdr0096AsAmended);

    expect(
      amending,
      `no landed ADR under docs/adr/ names ADR-0096 as amended: no file other than ${ADR_0096_SLUG}* has a line matching ${AMENDS_0096}`,
    ).not.toHaveLength(0);
  });
});
