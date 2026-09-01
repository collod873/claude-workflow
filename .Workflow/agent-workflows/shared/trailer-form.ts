#!/usr/bin/env node
/**
 * Refuses an `Amends` trailer that names an ADR but omits the colon.
 *
 * The trailer is the only declared edge in the amendment graph: `missing-trailer.ts` reads
 * `/^Amends:/m` and `back-stamp.ts` slices from the line that `startsWith("Amends:")`. A trailer
 * written `Amends [ADR-0056](…)` is therefore invisible to both — the successor looks amended to a
 * human and unamended to every machine, and the predecessor never gets its `Status: superseded by`.
 *
 * That is not hypothetical. ADR-0087 → ADR-0056, ADR-0098 → ADR-0030 and ADR-0115 → ADR-0094 all
 * shipped in this form, and all three predecessors sat unstamped from August until this check was
 * written. The missing-trailer counter *did* flag one of them; a counter files an issue and nothing
 * else, and that issue went uncleared. A malformed field is exact where a missing one is judgement,
 * so this one is a gate rather than a counter (ADR-0046's taxonomy): it can name the byte that is
 * wrong, so it is allowed to refuse.
 *
 * **What it deliberately does not flag.** `Amends #240` — an amendment to a *spec*, not to an ADR.
 * ADR-0113 carries exactly that, correctly, and a guard that caught it would be a guard someone
 * turns off. The pattern requires an `ADR-NNNN` on the line, which is what makes the difference
 * between the two mechanical rather than a matter of taste.
 *
 * Exit is three-valued, like every other check this venue runs: 0 clean, 1 a finding, 2 could not
 * run. A checker that folded 2 into 0 would report clean having read nothing, which is the failure
 * ADR-0087 — the very ADR whose trailer was malformed — measured at 255 consecutive green runs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLEAN = 0;
const FINDING = 1;
const CANNOT_RUN = 2;

const LANDED = /^\d{4}-.+\.md$/;

/**
 * A line opening with `Amends`, naming an `ADR-NNNN`, and *not* carrying the colon that both
 * readers of the graph require. `[^:\n]*` is what excludes the canonical form: a colon anywhere
 * between `Amends` and the number means the trailer parses, whether it is `Amends: ADR-0008` or the
 * hand-written `Amends: [ADR-0026](0026-slug.md)`.
 */
const MALFORMED = /^Amends[^:\n]*ADR-\d{4}/;

export function malformedTrailers(files: { path: string; content: string }[]): string[] {
  const findings: string[] = [];
  for (const { path, content } of files) {
    content.split("\n").forEach((line, i) => {
      if (MALFORMED.test(line)) {
        findings.push(
          `${path}:${i + 1}: \`Amends\` names an ADR without the colon, so the amendment ` +
            `graph cannot see it. Write \`Amends: ${line.slice(7).trim()}\`.`,
        );
      }
    });
  }
  return findings;
}

function main(): number {
  const repoRoot = process.argv[2] ?? process.cwd();
  const dir = join(repoRoot, "docs", "adr");
  let files: { path: string; content: string }[];
  try {
    files = readdirSync(dir)
      .filter((name) => LANDED.test(name))
      .sort()
      .map((name) => ({
        path: join("docs", "adr", name),
        content: readFileSync(join(dir, name), "utf8"),
      }));
  } catch (error) {
    // A tree with no `docs/adr` has no corpus, and nothing to check is clean — never "could not
    // run". The scratch repos this venue's own fixtures build have no ADRs at all, so reading
    // ENOENT as a failure would make every one of them red for a check with no subject. Only a
    // directory that exists and cannot be read is a genuine inability to answer.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return CLEAN;
    console.error(`trailer-form: cannot read ${dir}: ${(error as Error).message}`);
    return CANNOT_RUN;
  }

  const findings = malformedTrailers(files);
  for (const finding of findings) console.error(finding);
  return findings.length > 0 ? FINDING : CLEAN;
}

// `pathToFileURL`, never a `file://` template. This repo's checkout is under "Claude Projects",
// and `import.meta.url` percent-encodes that space while `process.argv[1]` does not — so the
// template form is never equal here, `main()` never runs, and the check exits 0 having read
// nothing. That is precisely the "green run that checked nothing" this file exists to prevent,
// and it passed twice before being caught by deliberately reintroducing the defect it guards.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
