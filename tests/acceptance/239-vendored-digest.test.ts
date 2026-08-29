import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "./workflow-shape.fixture";

/**
 * #239 — the vendored `bin/ticket_shape.py` is pinned by a digest recorded here at vendor time and
 * compared offline, so a silent local edit to a file this repo did not author is caught.
 *
 * Asserted against what the pin actually is rather than by shelling out to the criterion's own
 * `npx vitest run …` (vitest inside vitest): the recorded digest has to appear, verbatim, in the
 * vendor test, and it has to be the digest of the file as it stands right now.
 */

const VENDOR_TEST = path.join(
  repoRoot,
  ".Workflow",
  "agent-workflows",
  "shared",
  "ticket-shape-vendor.test.ts",
);
const VENDORED = path.join(repoRoot, "bin", "ticket_shape.py");

const ALGORITHMS = ["sha256", "sha512", "sha1", "md5"] as const;
const ENCODINGS = ["hex", "base64", "base64url"] as const;

/** Every spelling of `bytes`'s digest a recorded constant might plausibly be written as. */
function digestSpellings(bytes: Buffer): string[] {
  const out: string[] = [];
  for (const algorithm of ALGORITHMS) {
    for (const encoding of ENCODINGS) {
      out.push(createHash(algorithm).update(bytes).digest(encoding));
    }
  }
  return out;
}

/**
 * `src` with block and line comments dropped.
 *
 * Load-bearing rather than tidy: the vendor test is expected to *say* in prose that it never
 * fetches upstream, and a matcher that read comments could not tell the explanation from the deed.
 * The `[^:]` guard keeps a `https://…` inside surviving code from being eaten as a line comment.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

/** Ways a test could reach the network for the upstream file instead of comparing offline. */
const FETCHERS = [
  "fetch(",
  "node-fetch",
  "undici",
  "axios",
  "XMLHttpRequest",
  "node:https",
  "node:http",
  "https.get",
  "http.get",
  "raw.githubusercontent",
  "curl",
  "wget",
  "gh api",
  "git fetch",
];

describe("#239 vendored ticket_shape.py digest pin", () => {
  // Acceptance criterion, verbatim:
  // The recorded digest of bin/ticket_shape.py matches its current contents, computed offline rather than fetched — check: `npx vitest run .Workflow/agent-workflows/shared/ticket-shape-vendor.test.ts`
  it("records a digest that matches the working copy of bin/ticket_shape.py, computed offline rather than fetched", () => {
    expect(
      fs.existsSync(VENDOR_TEST),
      `${VENDOR_TEST} does not exist — the slice that vendors the file writes the test and records the digest`,
    ).toBe(true);

    const src = fs.readFileSync(VENDOR_TEST, "utf8");
    const spellings = digestSpellings(fs.readFileSync(VENDORED));
    const recorded = spellings.filter((spelling) => src.includes(spelling));

    expect(
      recorded,
      `no digest of ${VENDORED} appears in ${VENDOR_TEST} — the pin has to carry the digest as a ` +
        `recorded constant, and it has to be the digest of the file's current contents ` +
        `(sha256 today: ${createHash("sha256").update(fs.readFileSync(VENDORED)).digest("hex")})`,
    ).not.toEqual([]);

    const code = withoutComments(src);
    const reaches = FETCHERS.filter((fetcher) => code.includes(fetcher));

    expect(
      reaches,
      `${VENDOR_TEST} reaches upstream (${reaches.join(", ")}) — the gate answers "is the file we ` +
        `vendored the file that is running" offline; reporting upstream drift is bin/re-seed's job`,
    ).toEqual([]);
  });
});
