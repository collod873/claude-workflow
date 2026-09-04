#!/usr/bin/env node
// @shell `bin/canary-graph` runs this as `node "$HERE/canary-graph-gen.mjs" "$OUT"`. Nothing

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: canary-graph-gen.mjs <outDir>"); process.exit(2); }
mkdirSync(join(outDir, ".github/workflows"), { recursive: true });

const triggers = {
  verify: `  push:
    branches: [main]
    paths-ignore:
      - "**.md"
      - "docs/**"
      - "LICENSE"
  repository_dispatch:
    types: [implementation-opened]`,
  "back-stamp": `  push:
    branches: [main]
    paths:
      - "docs/adr/**"
      - "docs/research/**"`,
  "missing-trailer-counter": `  push:
    branches: [main]
    paths:
      - "docs/adr/**"
      - "docs/research/**"`,
  "bypass-counter": `  workflow_run:
    workflows: ["Verify"]
    types: [completed]`,
  "decline-on-revert": `  push:
    branches: [main]
    paths:
      - "CODING_STANDARDS.md"
      - "eslint.config.js"`,
  "dispatch-reconcile": `  repository_dispatch:
    types: [session-captured, graph-changed]
  issues:
    types: [labeled]
  workflow_dispatch:`,
  fixer: `  workflow_run:
    workflows: ["Verify"]
    types: [completed]
  repository_dispatch:
    types: [fixer-needed]
  workflow_dispatch:`,
  implement: `  repository_dispatch:
    types: [ticket-ready]`,
  integrate: `  repository_dispatch:
    types: [implementation-opened]`,
  "lost-dispatch-counter": `  issues:
    types: [labeled]`,
  ratify: `  repository_dispatch:
    types: [ratification-due]`,
  "ratify-on-prd-close": `  issues:
    types: [closed]`,
  "ratify-release": `  pull_request:
    types: [closed]`,
  recover: `  workflow_run:
    workflows: ["Implement"]
    types: [completed]
  repository_dispatch:
    types: [implement-failed]
  workflow_dispatch:`,
  review: `  workflow_run:
    workflows: ["Verify"]
    types: [completed]`,
  "run-watchdog": `  repository_dispatch:
    types: [session-captured]`,
  shape: `  issues:
    types: [labeled]
  issue_comment:
    types: [created]`,
  "shape-accept": `  issues:
    types: [labeled]`,
  spec: `  issues:
    types: [labeled]
  repository_dispatch:
    types: [sheet-accepted]`,
  "to-tickets": `  repository_dispatch:
    types: [prd-sliceable]`,
  acceptance: `  issues:
    types: [edited]
  repository_dispatch:
    types: [acceptance-wanted]`,
  audit: `  repository_dispatch:
    types: [session-captured]`,
  "walk-home": `  repository_dispatch:
    types: [session-captured]`,
  enrol: `  push:
    branches: [main]
    paths:
      - ".github/workflows/*-caller.yml"
  workflow_dispatch:`,
};

const dispatchForward = {
  verify: [`dispatch fixer-needed`],
  implement: [`dispatch implementation-opened`],
  fixer: [`dispatch implementation-opened`],
  recover: [`dispatch ticket-ready`],
  integrate: [`dispatch graph-changed`],
  "dispatch-reconcile": [`dispatch ticket-ready`],
  spec: [`dispatch prd-sliceable`],
  "to-tickets": [`dispatch ticket-ready`],
  "ratify-release": [`dispatch implementation-opened`],
};

const labelForward = {
  shape: { guard: "graph-noop:shaped", add: null },
  "shape-accept": { guard: "graph-noop:accepted", add: "to-spec" },
};

function jobPermissions(id) {
  const perms = ["contents: read"];
  if (dispatchForward[id] || id === "enrol") perms[0] = "contents: write";
  if (id === "shape" || id === "shape-accept" || id === "ratify-on-prd-close" || id === "lost-dispatch-counter") {
    perms.push("issues: write");
  }
  return perms.map((p) => `      ${p}`).join("\n");
}

const hasWorkflowRunDoor = new Set(["fixer", "recover"]);
const MAX_HOPS = 12;

function dispatchStep(id, displayName) {
  const forwards = dispatchForward[id];
  if (!forwards) return "";
  const eventGate = hasWorkflowRunDoor.has(id)
    ? `
      - name: The workflow_run door only reads -- it does not forward
        if: github.event_name == 'workflow_run'
        run: |
          echo "GRAPH-NOOP: ${displayName} fired via workflow_run -- logging only, no forward (matches production: this door is a passive reader)"
`
    : "";
  return `${eventGate}
      - name: Cycle guard and forward (dispatch)
        if: github.event_name != 'workflow_run'
        env:
          GH_TOKEN: \${{ github.token }}
          PATH_IN: \${{ github.event.client_payload.path }}
        run: |
          set -euo pipefail
          LANE="${displayName}"
          case ",\${PATH_IN:-}," in
            *",\$LANE,"*)
              echo "GRAPH-NOOP: \$LANE already in path [\${PATH_IN:-}] -- cycle guard stops forwarding"
              exit 0
              ;;
          esac
          HOP_COUNT=\$(( \$(grep -o ',' <<<",\${PATH_IN:-}," | wc -l) ))
          if [ "\$HOP_COUNT" -ge ${MAX_HOPS} ]; then
            echo "GRAPH-NOOP: path [\${PATH_IN:-}] already \$HOP_COUNT hops -- safety cap stops forwarding"
            exit 0
          fi
          NEW_PATH="\${PATH_IN:+\$PATH_IN,}\$LANE"
          echo "GRAPH-NOOP: forwarding with path=\$NEW_PATH"
${forwards
  .map(
    (line) => {
      const [, type] = line.split(" ");
      return `          gh api "repos/\${{ github.repository }}/dispatches" -f "event_type=${type}" -f "client_payload[path]=\$NEW_PATH"`;
    }
  )
  .join("\n")}
`;
}

function labelStep(id, displayName) {
  const cfg = labelForward[id];
  if (!cfg) return "";
  const echoNames = [cfg.guard, cfg.add].filter(Boolean);
  const selfEcho = echoNames.map((l) => `[ "\$INCOMING_LABEL" = "${l}" ]`).join(" || ");
  const addLines = [cfg.guard, cfg.add]
    .filter(Boolean)
    .map((l) => `          gh issue edit "\$ISSUE" -R "\${{ github.repository }}" --add-label "${l}"`)
    .join("\n");
  return `
      - name: Guarded label forward
        if: github.event.issue.number != null
        env:
          GH_TOKEN: \${{ github.token }}
          ISSUE: \${{ github.event.issue.number }}
          INCOMING_LABEL: \${{ github.event.label.name }}
        run: |
          set -euo pipefail
          if ${selfEcho}; then
            echo "GRAPH-NOOP: ${displayName} ignoring its own marker label (\$INCOMING_LABEL) -- guard stops the loop"
            exit 0
          fi
          CURRENT=\$(gh issue view "\$ISSUE" -R "\${{ github.repository }}" --json labels --jq '.labels[].name')
          if grep -qxF "${cfg.guard}" <<<"\$CURRENT"; then
            echo "GRAPH-NOOP: ${displayName} already forwarded this issue (${cfg.guard} present) -- guard stops the loop"
            exit 0
          fi
          echo "GRAPH-NOOP: ${displayName} forwarding"
${addLines}
`;
}

const issueLabelFilter = {
  spec: "to-spec",
  "dispatch-reconcile": "to-build",
};

function specFilterGuard(id) {
  const label = issueLabelFilter[id];
  if (!label) return "";
  return `
      - name: Only the label this lane actually reacts to
        if: github.event_name == 'issues' && github.event.label.name != '${label}'
        run: |
          echo "GRAPH-NOOP: ${displayNames[id]} ignoring label '\${{ github.event.label.name }}' (not ${label}) -- no forward"
          exit 0
`;
}

const displayNames = {
  verify: "Verify",
  "back-stamp": "Back-stamp",
  "missing-trailer-counter": "Missing-trailer counter",
  "bypass-counter": "Bypass counter",
  "decline-on-revert": "Decline on revert",
  "dispatch-reconcile": "Dispatch reconcile",
  fixer: "Fixer",
  implement: "Implement",
  integrate: "Integrate",
  "lost-dispatch-counter": "Lost-dispatch counter",
  ratify: "Ratify",
  "ratify-on-prd-close": "Ratify on PRD close",
  "ratify-release": "Ratify release",
  recover: "Recover",
  review: "Review",
  "run-watchdog": "Run watchdog",
  shape: "Shape",
  "shape-accept": "Shape accept",
  spec: "Spec",
  "to-tickets": "To-Tickets",
  acceptance: "Acceptance",
  audit: "Audit",
  "walk-home": "Walk home",
  enrol: "Enrol",
};

for (const [id, onBlock] of Object.entries(triggers)) {
  const name = displayNames[id];
  const body = `name: ${name}

"on":
${onBlock}

jobs:
  noop:
    name: graph-noop
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
${jobPermissions(id)}
    steps:
      - name: Log arrival
        run: |
          echo "GRAPH-NOOP: ${name} fired -- event=\${{ github.event_name }} action=\${{ github.event.action }} label=\${{ github.event.label.name }}"
${specFilterGuard(id)}${dispatchStep(id, name)}${labelStep(id, name)}
`;
  writeFileSync(join(outDir, `.github/workflows/${id}.yml`), body);
}

console.log(`wrote ${Object.keys(triggers).length} stub workflows to ${outDir}/.github/workflows`);
