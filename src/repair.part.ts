import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { handedOn, HAND_OFF_CAP, ISSUE_CAP } from "./repair.ts";
import { REPAIR_HAND_OFF } from "./post.ts";
import { authored, BIN, execute, issueStage, wellFormedNote } from "./scenarios.ts";
import { STUCK } from "./spelled.ts";
import { declarePart, HANDED_ON } from "./part-files.ts";

export const HAND_OFF = `${REPAIR_HAND_OFF}\nthe slice builder of #902 stopped: STRIPE_SECRET_KEY reads a different Stripe sandbox than dev's.`;
const POSTED = "https://github.com/collod873/Mezzanine/issues/902#issuecomment-7";

export const FIXED = { outcome: "fixed", found: "The builders' Stripe key was for another sandbox than dev's.", changed: "Copied dev's two test keys from .env.local to the repo's secrets.", question: "", recommendation: "" };
export const ASKS = { outcome: "asks", found: "Only a live Stripe key reads the Connected account.", changed: "", question: "Should the builders get a second test Connected account?", recommendation: "Yes: it keeps live keys out of every builder." };

export function repairing({ answer = FIXED, labels = ["ticket", STUCK], comments = [HAND_OFF], refusing = "" }: { answer?: object; labels?: string[]; comments?: string[]; refusing?: string } = {}) {
  const { root, ...stage } = issueStage(
    "repair-",
    { title: "Pay a vendor from the dashboard", body: wellFormedNote, state: "OPEN", labels: labels.map((name) => ({ name })) },
    answer,
    POSTED,
    [`[[ "$*" == *"/comments"* ]] && { printf '%s' '${authored(comments).replaceAll("'", "'\\''")}'; exit 0; }`, refusing].join("\n"),
    `printf '%s' "\${GH_TOKEN-unset}" >"$PWD/agent-gh-token"\n`,
  );
  return {
    ...stage,
    agentToken: () => (existsSync(join(root, "agent-gh-token")) ? readFileSync(join(root, "agent-gh-token"), "utf8") : undefined),
    run: (...args: string[]) => execute(join(BIN, "repair"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_REPO: "collod873/Mezzanine", GH_TOKEN: "app-token", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "collod873/Mezzanine", GITHUB_RUN_ID: "6000" }, args.length > 0 ? args : ["902"]),
  };
}

declarePart({
  part: { name: "bin/repair", file: "bin/repair", stops: "https://github.com/collod873/claude-workflow/issues/1761" },
  prompts: [
    {
      name: "repair agent",
      file: "src/repair.ts",
      cap: ISSUE_CAP + HAND_OFF_CAP + 2 * HANDED_ON,
      slots: ["title", "body", "handOff"],
      build: (filled) => handedOn({ repo: "collod873/Mezzanine", issue: "902", title: filled.title ?? "", body: filled.body ?? "", handOff: filled.handOff ?? "" }),
    },
  ],
  scenarios: [
    { label: "fixing a stuck issue", run: () => repairing().run() },
    { label: "asking the owner", run: () => repairing({ answer: ASKS }).run() },
    { label: "with no answer", run: () => repairing({ answer: {} }).run() },
    { label: "calling the owner on an unfinished repair", run: () => repairing().run("--unfinished", "902", "cancelled") },
  ],
});
