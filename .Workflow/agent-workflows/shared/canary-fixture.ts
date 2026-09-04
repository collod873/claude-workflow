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
  },
};

export function fixtureFor(lane: string): CanaryFixture | undefined {
  return FIXTURES[lane];
}

runLaneCli(import.meta.url, "usage: canary-fixture.ts <lane>", (lane) => fixtureFor(lane) ?? { kind: "none" });
