import { runLaneCli } from "./lane-cli.ts";
import { acceptedMarker, sheetMarker } from "./marker.ts";
import type { Sheet } from "./sheet-schema.ts";

export interface CanaryFixture {
  title: string;
  body: string;
  comments: string[];
  label: string;
  ensureLabels: string[];
  payload?: Record<string, string>;
}

const SPEC_SHEET: Sheet = {
  restatement:
    "The seed's package.json carries no engines field, so nothing records which Node it runs on.",
  priorArt: [],
  decisions: [
    {
      question: "Where should the seed record its Node version?",
      recommendation: "An engines.node field in package.json.",
      rejected: "A .nvmrc, which npm does not read.",
      mark: "",
      adrTitle: "",
      adrReversal: "",
    },
  ],
  survivors: [],
  route: "short",
  routeReason: "One field in one file.",
  newTerms: [],
  round: 0,
};

const FIXTURES: Record<string, CanaryFixture> = {
  spec: {
    title: "canary: the seed does not say which Node it runs on",
    body:
      "package.json has no engines field. Add one naming Node 24, so the seed records the runtime " +
      "it expects. One field, one file: keep the spec as short as that scope deserves.",
    comments: [
      sheetMarker(SPEC_SHEET),
      acceptedMarker({ adrPaths: [], coinedTerms: [], route: "short" }),
    ],
    label: "to-spec",
    ensureLabels: ["to-spec", "prd", "sliceable"],
    payload: { issue: "@issue" },
  },
  acceptance: {
    title: "canary: record the Node the seed runs on",
    body: [
      "## Parent PRD",
      "none",
      "",
      "## Acceptance criteria",
      "- [ ] package.json at the repository root has an engines.node field naming 24.",
      "- [ ] npm test still passes.",
      "",
      "## Files claimed",
      "- package.json",
      "",
    ].join("\n"),
    comments: [],
    label: "canary-fire",
    ensureLabels: ["canary-fire", "prd", "running"],
    payload: { issue: "@issue" },
  },
  implement: {
    title: "canary: add engines.node to package.json",
    body:
      "Add an engines field naming Node 24 to package.json, rooted at the repository root. " +
      "One field, one file.",
    comments: [],
    label: "canary-fire",
    ensureLabels: ["canary-fire", "ticket", "running"],
    payload: { issue: "@issue" },
  },
  "to-tickets": {
    title: "canary: the seed does not say which Node it runs on",
    body:
      "package.json, rooted at the repository root, has no engines field. Add one naming Node 24, " +
      "so the seed records the runtime it expects. Name every file the way this sentence does, as " +
      "package.json at the repository root, never as ./package.json, because the lanes that read a " +
      "slice share no working directory and a relative path means nothing to them.",
    comments: [],
    label: "sliceable",
    ensureLabels: ["sliceable", "prd", "running"],
    payload: { issue: "@issue" },
  },
  audit: {
    title: "canary: audit the seed as it stands",
    body: "Nothing to fix; the audit lane reads the head it is handed.",
    comments: [],
    label: "canary-fire",
    ensureLabels: ["canary-fire"],
    payload: { head: "@head" },
  },
  ratify: {
    title: "canary: ratify the standards this batch settled",
    body: "Nothing to ratify; the ratify lane reads the head it is handed.",
    comments: [],
    label: "canary-fire",
    ensureLabels: ["canary-fire", "prd"],
    payload: { head: "@head", prd_closed: "@issue" },
  },
  integrate: {
    title: "canary: integrate the open pull request",
    body: "The integrate lane reads the pull request number it is handed.",
    comments: [],
    label: "canary-fire",
    ensureLabels: ["canary-fire"],
    payload: { pr: "@pr" },
  },
};

export function fixtureFor(lane: string): CanaryFixture | undefined {
  return FIXTURES[lane];
}

runLaneCli(import.meta.url, "usage: canary-fixture.ts <lane>", (lane) => fixtureFor(lane) ?? { kind: "none" });
