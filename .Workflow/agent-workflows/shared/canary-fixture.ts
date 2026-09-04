import { runLaneCli } from "./lane-cli.ts";
import { acceptedMarker, sheetMarker } from "./marker.ts";
import type { Sheet } from "./sheet-schema.ts";

export interface CanaryFixture {
  title: string;
  body: string;
  comments: string[];
  label: string;
  ensureLabels: string[];
}

const SPEC_SHEET: Sheet = {
  restatement:
    "The canary seed ships one test that asserts 1 + 1, so a green run proves the runner started " +
    "and nothing else. The seed should carry a check that fails when the thing it names is broken.",
  priorArt: [],
  decisions: [
    {
      question: "Should the seed's check read the repository, or stay a self-contained assertion?",
      recommendation:
        "Read package.json and assert every script the contract names is present, so the check " +
        "fails when the seed and its contract drift apart.",
      rejected:
        "Keep the arithmetic assertion, which cannot fail for any reason a session would want to know about.",
      mark: "",
      adrTitle: "",
      adrReversal: "",
    },
  ],
  survivors: [],
  route: "short",
  routeReason: "One file, one assertion, no new dependency and no new venue.",
  newTerms: [],
  round: 0,
};

const FIXTURES: Record<string, CanaryFixture> = {
  spec: {
    title: "canary: the seed's smoke test cannot fail",
    body:
      "tests/smoke.test.mjs asserts that 1 + 1 is 2. It passes on a seed whose scripts are missing " +
      "and on one whose contract names commands that do not exist. Give the seed a check that reads " +
      "package.json and fails when a script the contract names is gone.",
    comments: [
      sheetMarker(SPEC_SHEET),
      acceptedMarker({ adrPaths: [], coinedTerms: [], route: "short" }),
    ],
    label: "to-spec",
    ensureLabels: ["to-spec", "prd", "sliceable"],
  },
};

export function fixtureFor(lane: string): CanaryFixture | undefined {
  return FIXTURES[lane];
}

runLaneCli(import.meta.url, "usage: canary-fixture.ts <lane>", (lane) => fixtureFor(lane) ?? { kind: "none" });
