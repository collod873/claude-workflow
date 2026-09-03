import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `docs/agents/spec-format.md` exists twice on the workstation and has to stay one document.
 *
 * The canonical copy is this repo's: lane 02's author and reconciler read it at run time through
 * `spec/spec-format.ts`. The second is the `collod873/agent-skills` checkout's, which
 * `to-spec/SKILL.md` links relatively — the `/to-spec` skill runs in whatever repo the owner is
 * sitting in, where this repo's copy is not on any path it can name. That is the same arrangement
 * `docs/agents/ticket-format.md` already has, and it drifted, because nothing anywhere compared the
 * two.
 *
 * **Skipped when the second tree is absent, and that is deliberate.** A GitHub-hosted runner has
 * nothing under `~/`, so there is no mirror there to compare against and nothing this could
 * usefully say. The drift it exists to catch happens on the workstation — the machine where the
 * skill runs and where a doc gets edited in one tree and not the other — and that is exactly where
 * it fires.
 */

const CANONICAL = resolve(import.meta.dirname, "../../../docs/agents/spec-format.md");
const MIRROR = join(homedir(), ".agents/skills/docs/agents/spec-format.md");

describe("the two copies of the spec contract", () => {
  it.skipIf(!existsSync(MIRROR))("are byte-identical", () => {
    expect(readFileSync(MIRROR, "utf8")).toBe(readFileSync(CANONICAL, "utf8"));
  });
});
