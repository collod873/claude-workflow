import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `bin/ticket_shape.py` is vendored from `collod873/agent-skills`, not written in this repo
 * (#239) — so there is no upstream CI here watching it for drift. The only thing this repo can
 * assert about a vendored file is that the working copy still holds the exact bytes it was
 * vendored with: a digest recorded once, at vendor time, and compared against the working copy
 * offline on every run. Fetching upstream to compare live would make the verdict depend on
 * network access and on upstream staying reachable at the ref this repo vendored from; a fixed,
 * offline digest instead makes any drift — a fresh vendor or a hand edit — a deliberate act that
 * has to update `VENDORED_DIGEST` here too.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const VENDORED_PATH = join(REPO_ROOT, "bin/ticket_shape.py");

/** sha256 of `bin/ticket_shape.py`, recorded at vendor time. Never fetched — only compared. */
const VENDORED_DIGEST = "fba6cf271e187921961e1cfa11e11e4ec74d5f08d47e2c671234b8f70993904a";

function digestOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("bin/ticket_shape.py vendor digest", () => {
  it("matches the digest recorded at vendor time, computed offline from the working copy", () => {
    expect(
      digestOf(VENDORED_PATH),
      "bin/ticket_shape.py no longer matches the digest recorded at vendor time — if this is a " +
        "deliberate re-vendor or edit, update VENDORED_DIGEST in this file to match",
    ).toBe(VENDORED_DIGEST);
  });
});
