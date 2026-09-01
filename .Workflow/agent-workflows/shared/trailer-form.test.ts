import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { malformedTrailers } from "./trailer-form.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, ".Workflow/agent-workflows/shared/trailer-form.ts");

/**
 * The judgement is graded against the three real trailers that shipped malformed — ADR-0087,
 * ADR-0098 and ADR-0115 — rather than against invented strings, so a rewrite that stopped catching
 * the actual defect fails here (#107's lesson: measure against the history that motivated the
 * check, not a fixture written to agree with it).
 */
const REAL_MALFORMED = "Amends [ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-thre.md).";
const REAL_CANONICAL = "Amends: [ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-thre.md).";

describe("malformedTrailers", () => {
  it("catches the colon-less form all three real defects used", () => {
    const found = malformedTrailers([{ path: "docs/adr/0087-x.md", content: REAL_MALFORMED }]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("docs/adr/0087-x.md:1");
  });

  it("names the repair, not just the fault", () => {
    const [finding] = malformedTrailers([{ path: "a.md", content: REAL_MALFORMED }]);
    expect(finding).toContain("amends: ADR-NNNN");
  });

  it("flags the once-canonical prose trailer too, now that the edge lives in frontmatter", () => {
    expect(malformedTrailers([{ path: "a.md", content: REAL_CANONICAL }])).toHaveLength(1);
    expect(malformedTrailers([{ path: "a.md", content: "Amends: ADR-0008" }])).toHaveLength(1);
  });

  it("flags the other two retired keys, which also moved into frontmatter", () => {
    expect(malformedTrailers([{ path: "a.md", content: "Recorded 2026-08-26." }])[0]).toContain("date:");
    expect(malformedTrailers([{ path: "a.md", content: "Status: superseded by ADR-0072" }])[0])
      .toContain("status:");
  });

  it("passes a body carrying none of the retired keys", () => {
    const clean = "---\nstatus: note\ndate: 2026-08-26\namends: ADR-0008\nreversal: x\n---\n\n# A title\n\nBody.\n";
    expect(malformedTrailers([{ path: "a.md", content: clean }])).toEqual([]);
  });

  it("leaves an amendment to a spec alone — ADR-0113 carries one, correctly", () => {
    const issue = "Amends #240, which tightened `validatePlan` to demand one unblocked root.";
    expect(malformedTrailers([{ path: "docs/adr/0113-x.md", content: issue }])).toEqual([]);
  });

  it("only reads the line's opening, so prose naming an ADR mid-sentence is not a trailer", () => {
    const prose = "This rule, unlike ADR-0056, never fires twice.";
    expect(malformedTrailers([{ path: "a.md", content: prose }])).toEqual([]);
  });
});

describe("the check as bin/gauntlet spawns it", () => {
  const run = (root: string) => {
    try {
      execFileSync("node", [SCRIPT, root], { encoding: "utf8", stdio: "pipe" });
      return 0;
    } catch (error) {
      return (error as { status: number }).status;
    }
  };

  it("exits 0 against this repo, whose trailers are all canonical", () => {
    expect(run(REPO_ROOT)).toBe(0);
  });

  /**
   * The `main()` guard compared `import.meta.url` to a `file://` template and this checkout lives
   * under "Claude Projects" — the space is percent-encoded on one side only, so the comparison was
   * always false and the check exited 0 having read nothing. It passed twice that way. A gate that
   * cannot go red is the failure ADR-0087 measured at 255 consecutive clean runs, and ADR-0087 is
   * one of the three ADRs this check exists to have caught.
   */
  it("exits 0 because it read the corpus, not because it never ran", () => {
    const dir = join(REPO_ROOT, "docs", "adr");
    expect(run(dir)).toBe(0); // no docs/adr *inside* docs/adr — ENOENT, and nothing to check
    expect(readFileSync(SCRIPT, "utf8")).toContain("pathToFileURL(process.argv[1]).href");
  });

  it("reads a tree with no docs/adr as clean, never as could-not-run", () => {
    expect(run(join(REPO_ROOT, "bin"))).toBe(0);
  });
});

describe("the check is wired to the venue that runs it", () => {
  const gauntlet = readFileSync(join(REPO_ROOT, "bin/gauntlet"), "utf8");

  it("is named in the push venue's check list, so a failure is reported under a name", () => {
    expect(gauntlet).toMatch(/checks="\$checks[^"]*\btrailers\b[^"]*"/);
  });

  it("is spawned by bin/gauntlet, not merely importable from a test", () => {
    expect(gauntlet).toContain("shared/trailer-form.ts");
  });

  it("has its exit 2 read as a gauntlet that could not run, not as a finding", () => {
    expect(gauntlet).toMatch(/own_protocol="[^"]*\btrailers\b[^"]*"/);
  });
});
