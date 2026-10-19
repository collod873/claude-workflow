import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "consent-only-quote.ts");
const ticket = (why: string) => ["## Why", "", why, "", "## Done when", "", "- a fix lands", ""].join("\n");
const metered = (why: string) => spawnSync("node", [SCRIPT], { input: ticket(why), encoding: "utf8" }).stdout;

describe("the consent-only quote (meter) reads the ticket's last > passage under Why (#906)", () => {
  it("would refuse, quoting the passage and its word count, when the last > passage is 5 words or fewer", () => {
    const why = [
      "The owner proposed a plan and later confirmed it:",
      "",
      "> The assistant proposed building a consent-only quote meter that flags short trailing quotes as likely consent",
      "> rather than intent, spanning this single passage across two consecutive quoted lines held together",
      "",
      "> ok do those",
    ].join("\n");

    expect(metered(why)).toBe('consent-only quote (meter): would refuse, quoting "ok do those" (3 words)\n');
  });

  it("would refuse nothing when the last > passage is over 5 words, or Why has no > passage at all", () => {
    expect(metered("The owner, in session:\n\n> Let's ship the whole consent meter feature by the end of this week please")).toBe("consent-only quote (meter): would refuse nothing\n");
    expect(metered('The owner, in session: "this quotes only inline, never a > line, so Why carries no passage at all".')).toBe("consent-only quote (meter): would refuse nothing\n");
  });
});
