import { CLAUDE_STREAMS_DIR_ENV } from "./claude-streams";
import { DISPATCH_REQUESTS_PATH_ENV } from "./dispatch-request";
import { IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";
import { NEEDS_HUMAN_LABEL, PRD_LABEL, SHAPE_REFUSED_LABEL, SLICE_FAILED_LABEL, SLICEABLE_LABEL, TO_BUILD_LABEL } from "./labels";
import { RATIFICATION_DUE_DISPATCH_ACTION, RATIFIER_MERGED_DISPATCH_ACTION } from "./ratification-dispatch";
import {
  ACCEPTANCE_WANTED_DISPATCH_ACTION,
  GRAPH_CHANGED_DISPATCH_ACTION,
  MECHANIC_WANTED_DISPATCH_ACTION,
  PRD_SLICEABLE_DISPATCH_ACTION,
  TICKET_READY_DISPATCH_ACTION,
} from "./ready-set";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "./spec-author-dispatch";
import { ladderClimbs } from "./strikes";
import { printYaml, type YamlMap, type YamlValue } from "./workflow-yaml";

export const LANE_OWNED = {
  sessionCaptured: "session-captured",
  prdSliceable: PRD_SLICEABLE_DISPATCH_ACTION,
  sliceable: SLICEABLE_LABEL,
  prd: PRD_LABEL,
  toBuild: TO_BUILD_LABEL,
  closeStateReason: "completed",
  immutabilityJob: "Immutability",
  gateJob: "Verify",
  gateStep: "Gauntlet",
  knowledgeBaseDir: "knowledge-base",
  shapeRefused: SHAPE_REFUSED_LABEL,
} as const;

export const DEAD_RUN_WIRES = {
  fixerNeeded: "fixer-needed",
} as const;

export const REVIEW_WANTED = "review-wanted";

export const RUN_ENDED = "run-ended";

export const MAIN_MOVED = "main-moved";

export const SHAPE_LABELS_APPLIED = [LANE_OWNED.shapeRefused, NEEDS_HUMAN_LABEL];

export const MACHINE_REPOSITORY = "collod873/claude-workflow";

const BUILD_LANE_TIMEOUT_MINUTES = 90;

export const TARGET_WORKSPACE = "${{ github.workspace }}/target";

export const CHECKPOINTS_ACTION = "./.github/actions/checkpoints";
export const TARGET_DEPS_ACTION = "./.github/actions/target-deps";
export const NODE_ACTION = "./.github/actions/node";
export const CHECKOUT_ACTION = "actions/checkout@v4";
const UPLOAD_ARTIFACT_ACTION = "actions/upload-artifact@v4";
export const ACTIONLINT_ACTION = "docker://rhysd/actionlint:1.7.7";

export const DISPATCH_SEND = "gh api --method POST 'repos/{owner}/{repo}/dispatches'";

export const WORKFLOWS_PATH = ".github/workflows";
export const STUB_SUFFIX = "-caller.yml";
export const CLAUDE_CODE_VERSION = "latest";
export const KNOWLEDGE_BASE_REPOSITORY = "collod873/Knowledge-Base";

const GITHUB_TOKEN = "${{ github.token }}";
const GITHUB_REPOSITORY = "${{ github.repository }}";
const GH = { GH_TOKEN: GITHUB_TOKEN, GH_REPO: GITHUB_REPOSITORY } as const;
const CLAUDE_CODE_OAUTH_TOKEN = "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}";
const KNOWLEDGE_BASE_DEPLOY_KEY = "${{ secrets.KNOWLEDGE_BASE_DEPLOY_KEY }}";
const ENROL_PAT = "${{ secrets.ENROL_PAT }}";
const SIGNAL_ASSIGNEE = "${{ github.repository_owner }}";
const JOB_STATUS = "${{ job.status }}";
const RUN_URL = "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}";
const ISSUE_NUMBER_DOOR = "${{ github.event.issue.number }}";
const PAYLOAD_ISSUE = "${{ github.event.client_payload.issue }}";
const PAYLOAD_RUNG = "${{ github.event.client_payload.rung }}";
const EVENT_ACTION = "${{ github.event.action }}";
const EVENT_NAME = "${{ github.event_name }}";
const EVENT_LABEL = "${{ github.event.label.name }}";
const EVENT_SENDER = "${{ github.event.sender.login }}";
const EVENT_ISSUE_LABELS = "${{ join(github.event.issue.labels.*.name, ',') }}";
const RUNNER_INPUT = "${{ inputs.runner }}";
const MACHINE_REF_INPUT = "${{ inputs.machine_ref }}";

const READS_THE_COMMENT_DOOR = {
  EVENT_NAME,
  EVENT_LABEL,
  EVENT_SENDER,
  EVENT_ISSUE_LABELS,
  EVENT_ISSUE_PULL_REQUEST: "${{ github.event.issue.pull_request.url }}",
  EVENT_COMMENT_USER_TYPE: "${{ github.event.comment.user.type }}",
  EVENT_COMMENT_ASSOCIATION: "${{ github.event.comment.author_association }}",
} as const;

const READS_THE_LABEL_DOOR = { EVENT_NAME, EVENT_LABEL, EVENT_SENDER, EVENT_ISSUE_LABELS } as const;

const READS_THE_DISPATCH_DOOR = { EVENT_NAME, EVENT_ACTION, EVENT_ISSUE_LABELS, EVENT_SENDER } as const;

const READS_THE_RECONCILE_DOOR = { EVENT_NAME, EVENT_ISSUE_ACTION: EVENT_ACTION, EVENT_LABEL, EVENT_SENDER } as const;

export type Scope = "read" | "write";
export type Permissions = Readonly<Partial<Record<"contents" | "issues" | "pull-requests" | "actions", Scope>>>;
export type Env = Readonly<Record<string, string>>;

export interface PushDoor {
  branches: readonly string[];
  paths?: readonly string[];
  pathsIgnore?: readonly string[];
}

export interface DispatchInput {
  description: string;
  required: boolean;
  default: string;
}

export interface Doors {
  repository_dispatch?: readonly string[];
  issues?: readonly string[];
  issue_comment?: readonly string[];
  workflow_run?: { workflows: readonly string[]; types: readonly string[] };
  push?: PushDoor;
  workflow_dispatch?: true | Readonly<Record<string, DispatchInput>>;
}

export interface CallInput {
  required: boolean;
  default?: string;
}

export interface StepWiring {
  name: string;
  id?: string;
  if?: string;
  timeout?: number;
  uses?: string;
  with?: Readonly<Record<string, string | number | boolean>>;
  workingDirectory?: string;
  env?: Env;
  run?: readonly string[];
  entrypoint?: string;
  rings?: readonly string[];
  appliesLabels?: readonly string[];
  handsOver?: true;
}

export interface JobWiring {
  name?: string;
  needs?: readonly string[];
  if?: string;
  timeout: number;
  concurrency?: string;
  outputs?: Readonly<Record<string, string>>;
  permissions?: Permissions;
  env?: Env;
  steps: readonly StepWiring[];
}

export interface StubWiring {
  job?: string;
  on: Doors;
  permissions: Permissions;
  with?: Readonly<Record<string, string>>;
}

export interface LaneWiring {
  name: string;
  runName?: string;
  stub?: StubWiring;
  on?: Doors;
  inputs?: Readonly<Record<string, CallInput>>;
  permissions: Permissions;
  concurrency?: string;
  jobs: Readonly<Record<string, JobWiring>>;
}

const tsx = (entrypoint: string, ...args: readonly string[]) => [`npx tsx .Workflow/agent-workflows/${entrypoint}`, ...args].join(" ");
const exportsEnv = (variable: string, value: string) => `echo "${variable}=${value}" >> "$GITHUB_ENV"`;
const ticketRunName = (lane: string) => `${lane} #${PAYLOAD_ISSUE}`;

const CHECKOUT: StepWiring = { name: "Checkout", uses: CHECKOUT_ACTION };

const CHECKOUT_MACHINE: StepWiring = {
  name: "Checkout machine",
  uses: CHECKOUT_ACTION,
  with: { repository: MACHINE_REPOSITORY, ref: MACHINE_REF_INPUT },
};

function checkoutMachine(options: { persistCredentials: false }): StepWiring {
  return { ...CHECKOUT_MACHINE, with: { ...CHECKOUT_MACHINE.with, "persist-credentials": options.persistCredentials } };
}

interface TargetCheckout {
  ref?: string;
  fetchDepth?: number;
  token?: string;
  persistCredentials?: false;
}

function checkoutTarget(options: TargetCheckout = {}): StepWiring {
  return {
    name: "Checkout target",
    uses: CHECKOUT_ACTION,
    with: {
      path: "target",
      ...(options.ref === undefined ? {} : { ref: options.ref }),
      ...(options.fetchDepth === undefined ? {} : { "fetch-depth": options.fetchDepth }),
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.persistCredentials === undefined ? {} : { "persist-credentials": options.persistCredentials }),
    },
  };
}

const IDENTIFIES_COMMITTER: StepWiring = {
  name: "Identify the committer",
  workingDirectory: "target",
  run: ["git config user.name 'github-actions[bot]'", "git config user.email '41898282+github-actions[bot]@users.noreply.github.com'"],
};

const CONFIGURES_COMMITTER: StepWiring = {
  name: "Configure a committer",
  workingDirectory: "target",
  run: [
    "set -euo pipefail",
    'git config user.name "github-actions[bot]"',
    'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
  ],
};

const SETS_UP_NODE: StepWiring = { name: "Set up Node and install dependencies", uses: NODE_ACTION };

const INSTALLS_TARGET: StepWiring = {
  name: "Install target dependencies",
  uses: TARGET_DEPS_ACTION,
  with: { "working-directory": "target" },
};

const INSTALLS_CLAUDE_CODE: StepWiring = {
  name: "Install Claude Code",
  run: [`npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`, exportsEnv(CLAUDE_STREAMS_DIR_ENV, "$RUNNER_TEMP/claude-streams")],
};

const KEEPS_CLAUDE_STREAMS: StepWiring = {
  name: "Keep the raw Claude stream, whatever ended this run",
  if: "always()",
  uses: UPLOAD_ARTIFACT_ACTION,
  with: {
    name: "claude-streams-${{ github.job }}-${{ github.run_attempt }}",
    path: "${{ runner.temp }}/claude-streams",
    "if-no-files-found": "ignore",
    "retention-days": 14,
  },
};

function exportsHandoff(name: string, paths: Readonly<Record<string, string>>): StepWiring {
  return { name, run: Object.entries(paths).map(([variable, value]) => exportsEnv(variable, value)) };
}

function preflight(secret: string, refusal: string, sink = ">&2"): StepWiring {
  return {
    name: `Preflight, ${secret} is set`,
    run: [
      "set -euo pipefail",
      `if [ -z "\${${secret}:-}" ]; then`,
      `  echo "${refusal}"${sink === "" ? "" : ` ${sink}`}`,
      "  exit 1",
      "fi",
    ],
  };
}

function checkpoint(phase: string, lane: string, issue: string): StepWiring {
  return {
    name: `${phase === "restore" ? "Restore" : "Upload"} checkpoints`,
    ...(phase === "upload" ? { if: "always()" } : {}),
    uses: CHECKPOINTS_ACTION,
    with: { phase, lane, issue: `\${{ env.${issue} }}` },
  };
}

const CHECKPOINT_RESTORE = (lane: string, issue: string) => checkpoint("restore", lane, issue);
const CHECKPOINT_UPLOAD = (lane: string, issue: string) => checkpoint("upload", lane, issue);

function reportsFailure(lane: string, issue: string, extra: Env = {}): StepWiring {
  return {
    name: "Report failure",
    if: "always()",
    env: { REPORT_LANE: lane, REPORT_ISSUE: `\${{ env.${issue} }}`, JOB_STATUS, RUN_URL, ...extra },
    run: [tsx("shared/report-lane-failure.ts")],
  };
}

function handsOver(lane: string, noun: string, variable: string): StepWiring {
  return {
    name: ladderClimbs(lane)
      ? `Queue the ${noun} again if this run died, leaving the strike ladder to say what runs next`
      : `Hand the ${noun} to the owner if this run died`,
    if: "always()",
    env: { JOB_STATUS },
    run: [tsx("shared/labels.cli.ts", "fail", `"$${variable}"`, "--status", '"$JOB_STATUS"', "--lane", lane)],
    handsOver: true,
  };
}

function wakesReconciler(options: { always?: true; env?: Env }): StepWiring {
  return {
    name: "Wake the reconciler, whatever ended this run",
    ...(options.always ? { if: "always()" } : {}),
    env: options.env,
    run: ["set -euo pipefail", `${DISPATCH_SEND} \\`, `  -f event_type=${RUN_ENDED} \\`, '  -f "client_payload[run_id]=$GITHUB_RUN_ID"'],
    rings: [RUN_ENDED],
  };
}

const COLLECTS_DISPATCHES: StepWiring = {
  name: "Collect the dispatches this run asked for",
  id: "collect-dispatch",
  run: [
    "set -euo pipefail",
    `[ -s "$${DISPATCH_REQUESTS_PATH_ENV}" ] || exit 0`,
    "{",
    '  echo "requests<<DISPATCH_REQUESTS_EOF"',
    `  cat "$${DISPATCH_REQUESTS_PATH_ENV}"`,
    '  echo "DISPATCH_REQUESTS_EOF"',
    '} >> "$GITHUB_OUTPUT"',
  ],
};

function sendsDispatches(name: string): StepWiring {
  return {
    name,
    run: [
      "set -euo pipefail",
      "printf '%s\\n' \"$DISPATCH_REQUESTS\" | while IFS= read -r request; do",
      '  [ -n "$request" ] || continue',
      `  printf '%s' "$request" | ${DISPATCH_SEND} --input -`,
      "done",
    ],
  };
}

function refusesToSlice(name: string, id: string, resolve: readonly string[], test: string, because: string): StepWiring {
  return {
    name,
    id,
    run: [
      "set -euo pipefail",
      ...resolve,
      `if ${test}; then`,
      `  gh issue comment "$PRD_NUMBER" --body "Refused to run: ${because}"`,
      `  gh issue edit "$PRD_NUMBER" --add-label ${SLICE_FAILED_LABEL}`,
      '  echo "refused=true" >> "$GITHUB_OUTPUT"',
      "  exit 1",
      "fi",
      'echo "refused=false" >> "$GITHUB_OUTPUT"',
    ],
    appliesLabels: [SLICE_FAILED_LABEL],
  };
}

const FAILURE_REASON_PATH = "$RUNNER_TEMP/failure_reason.txt";
const DISPATCH_REQUESTS_FILE = "$RUNNER_TEMP/dispatch-requests.jsonl";

const RESOLVES_THE_ENDING = [
  "${{ (github.event_name == 'repository_dispatch' && github.event.action)",
  `|| (github.event_name == 'push' && '${MAIN_MOVED}')`,
  `|| (github.event_name == 'issues' && github.event.action == 'unlabeled' && '${GRAPH_CHANGED_DISPATCH_ACTION}')`,
  `|| '${LANE_OWNED.sessionCaptured}' }}`,
].join(" ");

const CHECKS_OUT_THE_CORPUS: StepWiring = {
  name: "Checkout Knowledge-Base",
  uses: CHECKOUT_ACTION,
  with: { repository: KNOWLEDGE_BASE_REPOSITORY, "ssh-key": KNOWLEDGE_BASE_DEPLOY_KEY, path: `target/${LANE_OWNED.knowledgeBaseDir}` },
};

const LIFTS_SLICE_FAILED: StepWiring = {
  name: "Lift slice-failed, the PRD is split now",
  run: [`gh issue edit "$PRD_NUMBER" --remove-label ${SLICE_FAILED_LABEL}`],
};

interface Stage {
  name: string;
  entrypoint: string;
  args?: readonly string[];
  prelude?: readonly string[];
  id?: string;
  if?: string;
  timeout?: number;
  env?: Env;
}

function stage(spec: Stage): StepWiring {
  return { ...wire(spec), id: spec.id, if: spec.if, timeout: spec.timeout, env: { ...spec.env, TARGET_WORKSPACE } };
}

function wire(spec: Omit<Stage, "if" | "timeout" | "id">): StepWiring {
  return {
    name: spec.name,
    env: spec.env,
    run: [...(spec.prelude ?? []), tsx(spec.entrypoint, ...(spec.args ?? []))],
    entrypoint: spec.entrypoint,
  };
}

export const LANE_WIRING: Readonly<Record<string, LaneWiring>> = {
  shape: {
    name: "Shape",
    stub: {
      on: { issues: ["labeled"], issue_comment: ["created"] },
      permissions: { contents: "read", issues: "write" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "shape-${{ github.event.issue.number }}",
    jobs: {
      shape: {
        timeout: 30,
        env: { IDEA_NUMBER: ISSUE_NUMBER_DOOR, ...READS_THE_COMMENT_DOOR, ...GH, CLAUDE_CODE_OAUTH_TOKEN, CHANGE_REQUEST: "${{ github.event.comment.body }}" },
        steps: [
          exportsHandoff("Export the handoff path", { FAILURE_REASON_PATH }),
          CHECKOUT_MACHINE,
          checkoutTarget(),
          CHECKPOINT_RESTORE("shape", "IDEA_NUMBER"),
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run.", "> \"$FAILURE_REASON_PATH\""),
          SETS_UP_NODE,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Shape", entrypoint: "shape/shape.ts", args: ["--issue", "\"$IDEA_NUMBER\""] }),
          KEEPS_CLAUDE_STREAMS,
          CHECKPOINT_UPLOAD("shape", "IDEA_NUMBER"),
          reportsFailure("shape", "IDEA_NUMBER", { VERB: "", REPORT_REFUSED: "false" }),
          handsOver("shape", "idea", "IDEA_NUMBER"),
        ],
      },
    },
  },

  "shape-accept": {
    name: "Shape — accept",
    stub: {
      on: { issues: ["labeled"] },
      permissions: { contents: "write", issues: "write" },
    },
    permissions: { contents: "write", issues: "write" },
    concurrency: "shape-accept-${{ github.event.issue.number }}",
    jobs: {
      accept: {
        timeout: 10,
        env: { IDEA_NUMBER: ISSUE_NUMBER_DOOR, VERB: EVENT_LABEL, EVENT_SENDER, ...GH },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          CONFIGURES_COMMITTER,
          SETS_UP_NODE,
          stage({ name: "Accept", entrypoint: "shape/run-accept.ts", args: ["--issue", "\"$IDEA_NUMBER\"", "--verb", "\"$VERB\""] }),
          reportsFailure("shape-accept", "IDEA_NUMBER", { VERB: "${{ env.VERB }}", REPORT_REFUSED: "false" }),
        ],
      },
    },
  },

  spec: {
    name: "Spec",
    stub: {
      on: { issues: ["labeled"], repository_dispatch: [SPEC_AUTHOR_DISPATCH_EVENT_TYPE] },
      permissions: { contents: "write", issues: "write" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "spec-${{ github.event.issue.number || github.event.client_payload.issue }}",
    jobs: {
      spec: {
        timeout: 30,
        outputs: { "dispatch-requests": "${{ steps.collect-dispatch.outputs.requests }}" },
        env: { ISSUE_NUMBER: "${{ github.event.issue.number || github.event.client_payload.issue }}", ...READS_THE_LABEL_DOOR, SPEC_TRIGGER: "${{ (github.event.label.name == 'prd' && 'critique') || 'to-spec' }}", ...GH, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          exportsHandoff("Export the dispatch handoff path", { [DISPATCH_REQUESTS_PATH_ENV]: DISPATCH_REQUESTS_FILE }),
          CHECKOUT_MACHINE,
          checkoutTarget(),
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "::error::CLAUDE_CODE_OAUTH_TOKEN is empty; refusing to start the spec author", ""),
          SETS_UP_NODE,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Spec author", entrypoint: "spec/spec.ts" }),
          KEEPS_CLAUDE_STREAMS,
          COLLECTS_DISPATCHES,
          reportsFailure("spec", "ISSUE_NUMBER", { VERB: "", REPORT_REFUSED: "false" }),
          handsOver("spec", "source", "ISSUE_NUMBER"),
        ],
      },
      dispatch: {
        name: "Start lane 03",
        needs: ["spec"],
        if: "always()",
        timeout: 5,
        permissions: { contents: "write" },
        env: { ...GH, DISPATCH_REQUESTS: "${{ needs.spec.outputs.dispatch-requests }}" },
        steps: [
          sendsDispatches("Send the dispatch"),
        ],
      },
    },
  },

  "to-tickets": {
    name: "To-Tickets",
    stub: {
      on: { repository_dispatch: [LANE_OWNED.prdSliceable] },
      permissions: { contents: "write", issues: "write" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "to-tickets-${{ github.event.client_payload.issue }}",
    jobs: {
      "to-tickets": {
        timeout: 90,
        env: { PRD_NUMBER: PAYLOAD_ISSUE, ...GH, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          exportsHandoff("Export the handoff path", { FAILURE_REASON_PATH }),
          CHECKOUT_MACHINE,
          checkoutTarget(),
          CHECKPOINT_RESTORE("to-tickets", "PRD_NUMBER"),
          refusesToSlice(
            "Refuse, PRD already has sub-issues",
            "refuse-sub-issues",
            ["sub_count=$(gh api \"repos/${GH_REPO}/issues/${PRD_NUMBER}/sub_issues\" --jq 'length')"],
            '[ "$sub_count" != "0" ]',
            "this PRD already has ${sub_count} sub-issue(s). A slicing only runs against a PRD with no sub-issues. Close or detach the existing sub-issues, then remove and re-add \\`prd\\` to retry.",
          ),
          refusesToSlice(
            "Refuse, PRD is itself a sub-issue",
            "refuse-nested-prd",
            [
              'owner="${GH_REPO%%/*}"',
              'repo="${GH_REPO##*/}"',
              "# shellcheck disable=SC2016",
              "parent_number=$(gh api graphql -f query='",
              "  query($owner: String!, $repo: String!, $num: Int!) {",
              "    repository(owner: $owner, name: $repo) {",
              "      issue(number: $num) { parent { number } }",
              "    }",
              "  }' -f owner=\"$owner\" -f repo=\"$repo\" -F num=\"$PRD_NUMBER\" \\",
              "  --jq '.data.repository.issue.parent.number // empty')",
            ],
            '[ -n "$parent_number" ]',
            "this issue is itself a sub-issue of #${parent_number}. A nested PRD cannot be sliced. Detach it from its parent, then remove and re-add \\`prd\\` to retry.",
          ),
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run.", "> \"$FAILURE_REASON_PATH\""),
          SETS_UP_NODE,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Seam sweep", entrypoint: "to-tickets/to-tickets.ts", args: ["--stage", "seam-sweep", "--issue", "\"$PRD_NUMBER\""] }),
          stage({ name: "Slice", entrypoint: "to-tickets/to-tickets.ts", args: ["--stage", "slice", "--issue", "\"$PRD_NUMBER\""] }),
          stage({ name: "Audit and publish", entrypoint: "to-tickets/to-tickets.ts", args: ["--stage", "audit-and-publish", "--issue", "\"$PRD_NUMBER\""] }),
          KEEPS_CLAUDE_STREAMS,
          LIFTS_SLICE_FAILED,
          CHECKPOINT_UPLOAD("to-tickets", "PRD_NUMBER"),
          reportsFailure("to-tickets", "PRD_NUMBER", { REPORT_REFUSED: "${{ steps.refuse-sub-issues.outputs.refused == 'true' || steps.refuse-nested-prd.outputs.refused == 'true' }}", VERB: "" }),
          handsOver("to-tickets", "PRD", "PRD_NUMBER"),
        ],
      },
      "wake-reconciler": {
        name: "Wake the reconciler",
        needs: ["to-tickets"],
        if: "always()",
        timeout: 5,
        permissions: { contents: "write" },
        steps: [
          wakesReconciler({ env: { ...GH } }),
        ],
      },
    },
  },

  acceptance: {
    name: "Acceptance",
    runName: "Acceptance #${{ github.event.client_payload.issue || github.event.issue.number }}",
    stub: {
      job: "acceptance",
      on: { issues: ["edited"], repository_dispatch: [ACCEPTANCE_WANTED_DISPATCH_ACTION] },
      permissions: { contents: "write", issues: "write", actions: "read" },
    },
    permissions: { contents: "write", issues: "write" },
    concurrency: "acceptance-${{ github.event.issue.number || github.event.client_payload.issue }}",
    jobs: {
      refire: {
        timeout: 30,
        env: { PRD_NUMBER: ISSUE_NUMBER_DOOR, PRD_BODY_BEFORE: "${{ github.event.changes.body.from }}", RUNG: PAYLOAD_RUNG, ...READS_THE_DISPATCH_DOOR, ...GH, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          IDENTIFIES_COMMITTER,
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run."),
          SETS_UP_NODE,
          INSTALLS_TARGET,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Re-fire acceptance for affected slices", entrypoint: "acceptance/acceptance.ts", args: ["--refire", "\"$PRD_NUMBER\""] }),
          KEEPS_CLAUDE_STREAMS,
        ],
      },
      author: {
        timeout: 30,
        env: { TICKET_NUMBER: PAYLOAD_ISSUE, PRD_BODY_BEFORE: "${{ github.event.changes.body.from }}", RUNG: PAYLOAD_RUNG, ...READS_THE_DISPATCH_DOOR, ...GH, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          IDENTIFIES_COMMITTER,
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run."),
          SETS_UP_NODE,
          INSTALLS_TARGET,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Author acceptance tests for the published slice", entrypoint: "acceptance/acceptance.ts", args: ["\"$TICKET_NUMBER\""] }),
          KEEPS_CLAUDE_STREAMS,
          handsOver("acceptance", "ticket", "TICKET_NUMBER"),
        ],
      },
      "wake-reconciler": {
        name: "Wake the reconciler",
        needs: ["refire", "author"],
        if: "always()",
        timeout: 5,
        permissions: { contents: "write" },
        steps: [
          wakesReconciler({ env: { ...GH } }),
        ],
      },
    },
  },

  implement: {
    name: "Implement",
    runName: ticketRunName("Implement"),
    stub: {
      on: { repository_dispatch: [TICKET_READY_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    },
    permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    concurrency: "implement-${{ github.event.client_payload.issue }}",
    jobs: {
      implement: {
        timeout: BUILD_LANE_TIMEOUT_MINUTES,
        env: { TICKET_NUMBER: PAYLOAD_ISSUE, ...GH, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ fetchDepth: 0 }),
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before the implementer can run."),
          SETS_UP_NODE,
          INSTALLS_TARGET,
          INSTALLS_CLAUDE_CODE,
          IDENTIFIES_COMMITTER,
          stage({ name: "Implement the ticket", entrypoint: "implement/implement.ts", args: ["\"$TICKET_NUMBER\""], prelude: ["echo \"implementing #$TICKET_NUMBER\""], id: "implement", env: { RUNG: "${{ github.event.client_payload.rung }}" } }),
          KEEPS_CLAUDE_STREAMS,
          handsOver("implement", "ticket", "TICKET_NUMBER"),
          wakesReconciler({ always: true }),
        ],
      },
    },
  },

  mechanic: {
    name: "Mechanic",
    runName: ticketRunName("Mechanic"),
    stub: {
      on: { repository_dispatch: [MECHANIC_WANTED_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "write", issues: "write", actions: "read" },
    },
    permissions: { contents: "write", "pull-requests": "write", issues: "write", actions: "read" },
    concurrency: "implement-${{ github.event.client_payload.issue }}",
    jobs: {
      mechanic: {
        timeout: BUILD_LANE_TIMEOUT_MINUTES,
        env: { TICKET_NUMBER: PAYLOAD_ISSUE, ...GH, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ fetchDepth: 0 }),
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before the mechanic can run."),
          SETS_UP_NODE,
          INSTALLS_TARGET,
          INSTALLS_CLAUDE_CODE,
          IDENTIFIES_COMMITTER,
          stage({ name: "Repair the ticket's cause", entrypoint: "mechanic/mechanic.ts", args: ["\"$TICKET_NUMBER\""], prelude: ["echo \"mechanic on #$TICKET_NUMBER\""] }),
          KEEPS_CLAUDE_STREAMS,
          handsOver("mechanic", "ticket", "TICKET_NUMBER"),
          wakesReconciler({ always: true }),
        ],
      },
    },
  },

  verify: {
    name: "Verify",
    stub: {
      job: "verify",
      on: { push: { branches: ["main"], paths: ["**", "!**.md", "!docs/**", "!LICENSE", "docs/adr/**"] }, repository_dispatch: [IMPLEMENTATION_PR_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "read" },
    },
    permissions: { contents: "read", "pull-requests": "read" },
    concurrency: "verify-${{ github.event.client_payload.pr || github.sha }}",
    jobs: {
      immutability: {
        name: "Immutability",
        timeout: 5,
        env: { EVENT_ACTION, CHANGED_FILES: "${{ github.event.client_payload.changed_files }}", PR: "${{ github.event.client_payload.pr }}", GH_TOKEN: GITHUB_TOKEN },
        steps: [
          CHECKOUT_MACHINE,
          SETS_UP_NODE,
          wire({ name: "Refuse a change to the immutable set", entrypoint: "integrate/immutability.ts" }),
        ],
      },
      verify: {
        name: "Verify",
        needs: ["immutability"],
        if: "always()",
        timeout: 15,
        env: { IMMUTABILITY_RESULT: "${{ needs.immutability.result }}" },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          { name: "Lint workflow files", uses: ACTIONLINT_ACTION, with: { args: "-color" } },
          SETS_UP_NODE,
          INSTALLS_TARGET,
          stage({ name: "Gauntlet", entrypoint: "integrate/gate.ts" }),
        ],
      },
      "signal-fixer": {
        name: "Signal the fixer",
        needs: ["immutability", "verify"],
        if: "always()",
        timeout: 5,
        permissions: { contents: "write" },
        env: { SIGNAL: "fixer", EVENT_ACTION, IMMUTABILITY_RESULT: "${{ needs.immutability.result }}", VERIFY_RESULT: "${{ needs.verify.result }}", PR: "${{ github.event.client_payload.pr }}", ...GH },
        steps: [
          CHECKOUT_MACHINE,
          SETS_UP_NODE,
          wire({ name: "Tell the Fixer this run went red", entrypoint: "integrate/signal.ts" }),
        ],
      },
      "signal-review": {
        name: "Signal the reviewer",
        needs: ["immutability", "verify"],
        if: "always()",
        timeout: 5,
        permissions: { contents: "write", "pull-requests": "read" },
        env: { SIGNAL: "review", EVENT_ACTION, IMMUTABILITY_RESULT: "${{ needs.immutability.result }}", VERIFY_RESULT: "${{ needs.verify.result }}", PR: "${{ github.event.client_payload.pr }}", ...GH },
        steps: [
          CHECKOUT_MACHINE,
          SETS_UP_NODE,
          wire({ name: "Tell Review this run went green, naming the commits it judged", entrypoint: "integrate/signal.ts" }),
        ],
      },
    },
  },

  integrate: {
    name: "Integrate",
    stub: {
      on: { repository_dispatch: [IMPLEMENTATION_PR_DISPATCH_ACTION] },
      permissions: { contents: "write", issues: "write", "pull-requests": "write", actions: "write" },
      with: { verify_workflow: "verify-caller.yml" },
    },
    inputs: { verify_workflow: { required: true } },
    permissions: { contents: "write", issues: "write", "pull-requests": "write", actions: "write" },
    concurrency: "integrate",
    jobs: {
      integrate: {
        timeout: 30,
        env: { PR: "${{ github.event.client_payload.pr }}", HEAD_SHA: "${{ github.sha }}", ...GH, SIGNAL_ASSIGNEE, VERIFY_WORKFLOW: "${{ inputs.verify_workflow }}" },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ fetchDepth: 0 }),
          IDENTIFIES_COMMITTER,
          SETS_UP_NODE,
          INSTALLS_TARGET,
          stage({ name: "Integrate the pull request", entrypoint: "integrate/integrate.ts", args: ["\"$PR\"", "\"$HEAD_SHA\""] }),
        ],
      },
    },
  },

  fixer: {
    name: "Fixer",
    stub: {
      on: { repository_dispatch: [DEAD_RUN_WIRES.fixerNeeded], workflow_dispatch: { run_id: { description: "A completed Verify run to react to. Empty resolves no pull request and exits.", required: false, default: "" } } },
      permissions: { contents: "write", "pull-requests": "write", issues: "write", actions: "read" },
      with: { run_id: "${{ github.event.client_payload.run_id || github.event.inputs.run_id }}" },
    },
    inputs: { run_id: { required: false, default: "" } },
    permissions: { contents: "write", "pull-requests": "write", issues: "write", actions: "read" },
    concurrency: "fixer-${{ inputs.run_id || github.run_id }}",
    jobs: {
      fixer: {
        timeout: 50,
        env: { ...GH, RUN_ID: "${{ inputs.run_id }}", CLAUDE_CODE_OAUTH_TOKEN, SIGNAL_ASSIGNEE },
        steps: [
          { name: "Resolve the pull request that Verify run was judging", id: "target", run: [
            "set -euo pipefail",
            "",
            "if [ -z \"${RUN_ID:-}\" ]; then",
            "  echo \"no Verify run named; nothing to resolve\"",
            "  exit 0",
            "fi",
            "",
            "STATUS=\"\"",
            "for _ in $(seq 1 30); do",
            "  STATUS=$(gh run view \"$RUN_ID\" --json status --jq .status)",
            "  if [ \"$STATUS\" = \"completed\" ]; then break; fi",
            "  sleep 10",
            "done",
            "if [ \"$STATUS\" != \"completed\" ]; then",
            "  echo \"::error::Verify run $RUN_ID is still \\\"$STATUS\\\" after five minutes; its log cannot be read, so no pull request was resolved\"",
            "  exit 1",
            "fi",
            "",
            "JOBS=$(gh run view \"$RUN_ID\" --json jobs --jq '.jobs')",
            "",
            "GATE_CONCLUSION=$(echo \"$JOBS\" | jq -r '[.[] | select(.name == \"Verify\" or (.name | endswith(\" / Verify\")))][0].conclusion // empty')",
            "RESOLVE_JOB_ID=$(echo \"$JOBS\" | jq -r '[.[] | select(.name == \"Immutability\" or (.name | endswith(\" / Immutability\")))][0].databaseId // empty')",
            "if [ -z \"$RESOLVE_JOB_ID\" ]; then",
            "  echo \"run $RUN_ID has no Immutability job; nothing to fix\"",
            "  exit 0",
            "fi",
            "",
            "MODE=\"model\"",
            "if [ \"$GATE_CONCLUSION\" != \"failure\" ]; then",
            "  MODE=\"escalate\"",
            "fi",
            "",
            "LINE=$(gh run view --job \"$RESOLVE_JOB_ID\" --log \\",
            "  | grep -oE 'judging https://[^ ]+/pull/[0-9]+ on implement/issue-[0-9]+' \\",
            "  | tail -1 || true)",
            "if [ -z \"$LINE\" ]; then",
            "  echo \"run $RUN_ID names no implementation pull request; nothing to fix\"",
            "  exit 0",
            "fi",
            "",
            "URL=${LINE#judging }",
            "URL=${URL%% on *}",
            "BRANCH=${LINE##* on }",
            "PR=${URL##*/}",
            "ISSUE=${BRANCH#implement/issue-}",
            "",
            "STATE=$(gh pr view \"$PR\" --json state --jq .state)",
            "if [ \"$STATE\" != \"OPEN\" ]; then",
            "  echo \"$URL is $STATE; nothing to fix\"",
            "  exit 0",
            "fi",
            "",
            "MARKER=\"<!-- fixer-run:$RUN_ID -->\"",
            "COMMENTS=$(gh pr view \"$PR\" --json comments --jq '.comments[].body')",
            "case \"$COMMENTS\" in",
            "  *\"$MARKER\"*)",
            "    echo \"run $RUN_ID was already reacted to (see the marker comment on $URL); nothing to do\"",
            "    exit 0",
            "    ;;",
            "esac",
            "gh pr comment \"$PR\" --body \"$(printf '%s\\n%s\\n' \\",
            "  \"$MARKER\" \\",
            "  \"[Verify run $RUN_ID]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$RUN_ID) came back red; the fixer is reacting to it.\")\"",
            "",
            "if [ \"$MODE\" = \"model\" ]; then",
            "  echo \"fixing $URL on $BRANCH for #$ISSUE\"",
            "  {",
            "    echo \"mode=model\"",
            "    echo \"pr=$PR\"",
            "    echo \"branch=$BRANCH\"",
            "    echo \"issue=$ISSUE\"",
            "  } >> \"$GITHUB_OUTPUT\"",
            "else",
            "  FAILED_NAME=$(echo \"$JOBS\" | jq -r '[.[] | select(.conclusion == \"failure\")][0].name // empty')",
            "  FAILED_ID=$(echo \"$JOBS\" | jq -r '[.[] | select(.conclusion == \"failure\")][0].databaseId // empty')",
            "  if [ -z \"$FAILED_NAME\" ]; then",
            "    echo \"run $RUN_ID reports no failed job; nothing to fix\"",
            "    exit 0",
            "  fi",
            "  ERROR_LINE=$(gh run view --job \"$FAILED_ID\" --log | grep -m1 -oE '::error::.*' || true)",
            "",
            "  echo \"escalating $URL (#$ISSUE): $FAILED_NAME failed before the gate ran\"",
            "  {",
            "    echo \"mode=escalate\"",
            "    echo \"pr=$PR\"",
            "    echo \"issue=$ISSUE\"",
            "    echo \"failed_job=$FAILED_NAME\"",
            "  } >> \"$GITHUB_OUTPUT\"",
            "  {",
            "    echo \"error_line<<FIXER_EOF\"",
            "    echo \"${ERROR_LINE:-(no ::error:: line found in the $FAILED_NAME log)}\"",
            "    echo \"FIXER_EOF\"",
            "  } >> \"$GITHUB_OUTPUT\"",
            "fi",
          ] },
          CHECKOUT_MACHINE,
          checkoutTarget({ ref: "${{ steps.target.outputs.branch }}", fetchDepth: 0 }),
          IDENTIFIES_COMMITTER,
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run."),
          SETS_UP_NODE,
          INSTALLS_TARGET,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "React to the red run", entrypoint: "fixer/fixer.ts", args: ["react"], if: "always()", timeout: 40, env: { FIXER_MODE: "${{ steps.target.outputs.mode }}", ISSUE: "${{ steps.target.outputs.issue }}", PR_NUMBER: "${{ steps.target.outputs.pr }}", BRANCH: "${{ steps.target.outputs.branch }}", FAILED_JOB: "${{ steps.target.outputs.failed_job }}", ERROR_LINE: "${{ steps.target.outputs.error_line }}" } }),
          KEEPS_CLAUDE_STREAMS,
        ],
      },
    },
  },

  review: {
    name: "Review",
    stub: {
      on: { repository_dispatch: [REVIEW_WANTED] },
      permissions: { contents: "read", issues: "write" },
      with: { head_sha: "${{ github.event.client_payload.head_sha }}", base_sha: "${{ github.event.client_payload.base_sha }}" },
    },
    inputs: { head_sha: { required: true }, base_sha: { required: true } },
    permissions: { contents: "read", issues: "write" },
    concurrency: "review-${{ inputs.head_sha }}",
    jobs: {
      review: {
        timeout: 15,
        env: { ...GH, SIGNAL_ASSIGNEE, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ ref: "${{ inputs.head_sha }}", fetchDepth: 0 }),
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run."),
          SETS_UP_NODE,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Run the correctness reviewer", entrypoint: "review/review.ts", args: ["\"${{ inputs.base_sha }}\"", "\"${{ inputs.head_sha }}\""] }),
          KEEPS_CLAUDE_STREAMS,
        ],
      },
    },
  },

  "dispatch-reconcile": {
    name: "Dispatch reconcile",
    stub: {
      on: { repository_dispatch: [LANE_OWNED.sessionCaptured, GRAPH_CHANGED_DISPATCH_ACTION, RUN_ENDED], issues: ["labeled", "unlabeled"], push: { branches: ["main"] }, workflow_dispatch: true },
      permissions: { contents: "write", issues: "write", actions: "read", "pull-requests": "read" },
      with: { verify_workflow: "verify-caller.yml" },
    },
    inputs: { verify_workflow: { required: true } },
    permissions: { contents: "write", issues: "write", actions: "read", "pull-requests": "read" },
    concurrency: "dispatch-reconcile",
    jobs: {
      reconcile: {
        if: "always()",
        timeout: 10,
        env: { EVENT_ACTION: RESOLVES_THE_ENDING, ...READS_THE_RECONCILE_DOOR, ...GH, VERIFY_WORKFLOW: "${{ inputs.verify_workflow }}" },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          SETS_UP_NODE,
          stage({ name: "Recompute the ready set", entrypoint: "dispatch/reconcile.ts" }),
        ],
      },
    },
  },

  audit: {
    name: "Audit",
    stub: {
      on: { repository_dispatch: [LANE_OWNED.sessionCaptured] },
      permissions: { contents: "write", "pull-requests": "write" },
    },
    permissions: { contents: "write", "pull-requests": "write" },
    concurrency: "audit",
    jobs: {
      audit: {
        timeout: 20,
        env: { HEAD_SHA: "${{ github.event.client_payload.head }}", EVENT_ACTION, ...GH, CLAUDE_CODE_OAUTH_TOKEN, KNOWLEDGE_BASE_DEPLOY_KEY },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ fetchDepth: 0 }),
          IDENTIFIES_COMMITTER,
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run."),
          preflight("KNOWLEDGE_BASE_DEPLOY_KEY", "KNOWLEDGE_BASE_DEPLOY_KEY is empty: set the repository secret before the corpus checkout can run."),
          CHECKS_OUT_THE_CORPUS,
          SETS_UP_NODE,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Run the audit", entrypoint: "observations/run-audit.ts" }),
          KEEPS_CLAUDE_STREAMS,
        ],
      },
    },
  },

  ratify: {
    name: "Ratify",
    stub: {
      on: { repository_dispatch: [RATIFICATION_DUE_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    },
    permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    concurrency: "ratify",
    jobs: {
      ratify: {
        timeout: 120,
        env: { HEAD_SHA: "${{ github.event.client_payload.head }}", PRD_CLOSED: "${{ github.event.client_payload.prd_closed }}", EVENT_ACTION, PR_BASE: "${{ github.event.repository.default_branch }}", ...GH, CLAUDE_CODE_OAUTH_TOKEN },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ fetchDepth: 0, token: "${{ secrets.ENROL_PAT || github.token }}" }),
          { name: "Fetch the refs this lane reads", workingDirectory: "target", run: [
            "git fetch origin '+refs/notes/observations:refs/notes/observations' || true",
            "git fetch origin '+refs/notes/ratifications:refs/notes/ratifications' || true",
            "git fetch origin '+refs/ratifier/last:refs/ratifier/last' || true",
            "git fetch origin '+refs/release/last:refs/release/last' || true",
          ] },
          IDENTIFIES_COMMITTER,
          preflight("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN is empty: set the repository secret before a stage can run."),
          SETS_UP_NODE,
          INSTALLS_CLAUDE_CODE,
          stage({ name: "Ratify this batch", entrypoint: "ratify/run-ratify.ts", timeout: 110 }),
          KEEPS_CLAUDE_STREAMS,
          { name: "Publish the advanced bookmark", workingDirectory: "target", run: [
            "set -euo pipefail",
            "if git rev-parse --verify --quiet refs/ratifier/last >/dev/null; then",
            "  git push origin refs/ratifier/last",
            "fi",
          ] },
          { name: "Retire the release channel's bookmark", workingDirectory: "target", run: [
            "set -euo pipefail",
            "if git rev-parse --verify --quiet refs/ratifier/last >/dev/null; then",
            "  git push origin --delete refs/release/last || true",
            "fi",
          ] },
        ],
      },
    },
  },

  "ratify-on-prd-close": {
    name: "Ratify on PRD close",
    stub: {
      on: { issues: ["closed"] },
      permissions: { contents: "write", issues: "read" },
    },
    permissions: { contents: "write", issues: "read" },
    concurrency: "ratify-on-prd-close-${{ github.event.issue.number }}",
    jobs: {
      "ratify-on-prd-close": {
        timeout: 10,
        env: { ISSUE_NUMBER: ISSUE_NUMBER_DOOR, STATE_REASON: "${{ github.event.issue.state_reason }}", LABELS: EVENT_ISSUE_LABELS, ...GH },
        steps: [
          checkoutMachine({ persistCredentials: false }),
          checkoutTarget({ persistCredentials: false }),
          SETS_UP_NODE,
          wire({ name: "Ring the ratifier lane", entrypoint: "ratify/prd-close.ts" }),
        ],
      },
    },
  },

  "record-ratifications": {
    name: "Record ratifications",
    stub: {
      on: { repository_dispatch: [RATIFIER_MERGED_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "read" },
    },
    permissions: { contents: "write", "pull-requests": "read" },
    jobs: {
      "record-ratifications": {
        timeout: 15,
        env: { PR: "${{ github.event.client_payload.pr }}", ...GH },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ fetchDepth: 0 }),
          { name: "Fetch the ratifications ref", workingDirectory: "target", run: ["git fetch origin '+refs/notes/ratifications:refs/notes/ratifications' || true"] },
          IDENTIFIES_COMMITTER,
          SETS_UP_NODE,
          stage({ name: "Record what this batch ratified", entrypoint: "observations/run-ratification.ts" }),
        ],
      },
    },
  },

  "decline-on-revert": {
    name: "Decline on revert",
    stub: {
      on: { push: { branches: ["main"], paths: ["CODING_STANDARDS.md", "eslint.config.js"] } },
      permissions: { contents: "write" },
    },
    permissions: { contents: "write" },
    concurrency: "decline-on-revert",
    jobs: {
      decline: {
        timeout: 10,
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget({ fetchDepth: 0 }),
          { name: "Fetch the ratifications ref", workingDirectory: "target", run: ["git fetch origin '+refs/notes/ratifications:refs/notes/ratifications' || true"] },
          IDENTIFIES_COMMITTER,
          SETS_UP_NODE,
          stage({ name: "Write declined memory for anything the owner took back out", entrypoint: "ratify/run-revert-detector.ts" }),
        ],
      },
    },
  },

  "run-watchdog": {
    name: "Run watchdog",
    stub: {
      on: { repository_dispatch: [LANE_OWNED.sessionCaptured] },
      permissions: { contents: "read", actions: "read", issues: "write" },
    },
    permissions: { contents: "read", actions: "read", issues: "write" },
    concurrency: "run-watchdog",
    jobs: {
      watch: {
        timeout: 10,
        env: { EVENT_ACTION, SIGNAL_ASSIGNEE, ...GH },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          SETS_UP_NODE,
          wire({ name: "Sweep for lanes that executed nothing", entrypoint: "watchdog/run-watchdog.ts" }),
        ],
      },
    },
  },

  "bypass-counter": {
    name: "Bypass counter",
    stub: {
      on: { workflow_run: { workflows: ["Verify"], types: ["completed"] } },
      permissions: { contents: "read", actions: "read", issues: "write" },
      with: { verify_workflow: "verify-caller.yml" },
    },
    inputs: { verify_workflow: { required: true } },
    permissions: { contents: "read", actions: "read", issues: "write" },
    concurrency: "bypass-counter",
    jobs: {
      count: {
        timeout: 10,
        env: { SIGNAL_ASSIGNEE, ...GH, VERIFY_WORKFLOW: "${{ inputs.verify_workflow }}" },
        steps: [
          CHECKOUT_MACHINE,
          SETS_UP_NODE,
          wire({ name: "Count bypasses of the free gates", entrypoint: "watchdog/bypass-counter.ts" }),
        ],
      },
    },
  },

  "lost-dispatch-counter": {
    name: "Lost-dispatch counter",
    stub: {
      on: { issues: ["labeled"] },
      permissions: { contents: "read", actions: "read", issues: "write" },
      with: { slicing_workflow: "to-tickets-caller.yml" },
    },
    inputs: { slicing_workflow: { required: true } },
    permissions: { contents: "read", actions: "read", issues: "write" },
    concurrency: "lost-dispatch-counter",
    jobs: {
      count: {
        timeout: 10,
        env: { LABEL_NAME: EVENT_LABEL, PRD_NUMBER: ISSUE_NUMBER_DOOR, ...GH, SLICING_WORKFLOW: "${{ inputs.slicing_workflow }}" },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          SETS_UP_NODE,
          wire({ name: "Count a lost dispatch", entrypoint: "watchdog/lost-dispatch-counter.ts" }),
        ],
      },
    },
  },

  "missing-trailer-counter": {
    name: "Missing-trailer counter",
    stub: {
      on: { push: { branches: ["main"], paths: ["docs/adr/**", "docs/research/**"] } },
      permissions: { contents: "read", issues: "write" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "missing-trailer-counter",
    jobs: {
      count: {
        timeout: 10,
        env: { SIGNAL_ASSIGNEE, ...GH },
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          SETS_UP_NODE,
          stage({ name: "Count missing trailers", entrypoint: "watchdog/missing-trailer-counter.ts" }),
        ],
      },
    },
  },

  "back-stamp": {
    name: "Back-stamp",
    stub: {
      on: { push: { branches: ["main"], paths: ["docs/adr/**", "docs/research/**"] } },
      permissions: { contents: "write" },
    },
    permissions: { contents: "write" },
    concurrency: "back-stamp",
    jobs: {
      stamp: {
        timeout: 10,
        steps: [
          CHECKOUT_MACHINE,
          checkoutTarget(),
          CONFIGURES_COMMITTER,
          SETS_UP_NODE,
          stage({ name: "Back-stamp superseded predecessors", entrypoint: "watchdog/back-stamp-walk.ts" }),
        ],
      },
    },
  },

  enrol: {
    name: "Enrol",
    on: { push: { branches: ["main"], paths: [".github/workflows/*-caller.yml"] }, workflow_dispatch: true },
    permissions: { contents: "read" },
    concurrency: "enrol",
    jobs: {
      enrol: {
        timeout: 20,
        steps: [
          CHECKOUT,
          SETS_UP_NODE,
          wire({ name: "Write the stub set into every enrolled repository", entrypoint: "enrol/enrol.ts", env: { GH_TOKEN: ENROL_PAT, CLAUDE_CODE_OAUTH_TOKEN, KNOWLEDGE_BASE_DEPLOY_KEY } }),
        ],
      },
    },
  },

  "walk-home": {
    name: "Walk home",
    on: { repository_dispatch: [LANE_OWNED.sessionCaptured] },
    permissions: { contents: "read", issues: "write" },
    concurrency: "walk-home",
    jobs: {
      walk: {
        timeout: 15,
        env: { EVENT_ACTION, GH_TOKEN: ENROL_PAT, GH_REPO: GITHUB_REPOSITORY },
        steps: [
          CHECKOUT,
          SETS_UP_NODE,
          wire({ name: "Walk red runs home", entrypoint: "watchdog/walk-home.ts" }),
        ],
      },
    },
  },
};

const STANDARD_CALL_INPUTS: Readonly<Record<string, YamlMap>> = {
  runner: { type: "string", required: false, default: "ubuntu-latest" },
  machine_ref: { type: "string", required: false, default: "main" },
};

function stepYaml(step: StepWiring): YamlMap {
  return {
    name: step.name,
    id: step.id,
    if: step.if,
    "timeout-minutes": step.timeout,
    uses: step.uses,
    with: step.with,
    "working-directory": step.workingDirectory,
    env: step.env,
    run: step.run?.join("\n"),
  };
}

function jobYaml(job: JobWiring, runsOn: string): YamlMap {
  return {
    name: job.name,
    needs: job.needs,
    if: job.if,
    "runs-on": runsOn,
    "timeout-minutes": job.timeout,
    concurrency: job.concurrency === undefined ? undefined : queued(job.concurrency),
    outputs: job.outputs,
    permissions: job.permissions,
    env: job.env,
    steps: job.steps.map(stepYaml),
  };
}

function queued(group: string): YamlMap {
  return { group, "cancel-in-progress": false };
}

function doorsYaml(doors: Doors): YamlMap {
  const rendered: Record<string, YamlValue> = {};
  for (const [event, condition] of Object.entries(doors)) {
    if (event === "push") {
      const push = condition as PushDoor;
      rendered[event] = { branches: push.branches, paths: push.paths, "paths-ignore": push.pathsIgnore };
    } else if (event === "workflow_run") {
      rendered[event] = condition as YamlMap;
    } else if (event === "workflow_dispatch") {
      rendered[event] = condition === true ? null : { inputs: condition as YamlMap };
    } else {
      rendered[event] = { types: condition as readonly string[] };
    }
  }
  return rendered;
}

function callInputsYaml(inputs: LaneWiring["inputs"]): YamlMap {
  const declared = Object.entries(inputs ?? {}).map(([name, input]) => [name, { type: "string", required: input.required, default: input.default }] as const);
  return { ...Object.fromEntries(declared), ...STANDARD_CALL_INPUTS };
}

export function wiredLanes(): string[] {
  return Object.keys(LANE_WIRING);
}

export function stubName(lane: string): string {
  return `${lane}${STUB_SUFFIX}`;
}

export function reusableName(lane: string): string {
  return `${lane}.yml`;
}

export function emitReusable(lane: string): string {
  const row = LANE_WIRING[lane];
  const standalone = row.stub === undefined;
  return printYaml({
    name: standalone ? row.name : `${row.name} (reusable)`,
    on: standalone ? doorsYaml(row.on ?? {}) : { workflow_call: { inputs: callInputsYaml(row.inputs) } },
    permissions: row.permissions,
    concurrency: row.concurrency === undefined ? undefined : queued(row.concurrency),
    jobs: Object.fromEntries(Object.entries(row.jobs).map(([key, job]) => [key, jobYaml(job, standalone ? "ubuntu-latest" : RUNNER_INPUT)])),
  });
}

export function emitStub(lane: string): string | undefined {
  const row = LANE_WIRING[lane];
  if (row.stub === undefined) return undefined;
  const job = row.stub.job ?? Object.keys(row.jobs)[0];
  return printYaml({
    name: row.name,
    "run-name": row.runName,
    on: doorsYaml(row.stub.on),
    jobs: {
      [job]: {
        permissions: row.stub.permissions,
        uses: `${MACHINE_REPOSITORY}/${WORKFLOWS_PATH}/${reusableName(lane)}@main`,
        with: row.stub.with,
        secrets: emitReusable(lane).includes("${{ secrets.") ? "inherit" : undefined,
      },
    },
  });
}

export function emitEstate(): { name: string; content: string }[] {
  return wiredLanes()
    .flatMap((lane) => {
      const stub = emitStub(lane);
      return [{ name: reusableName(lane), content: emitReusable(lane) }, ...(stub === undefined ? [] : [{ name: stubName(lane), content: stub }])];
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export interface LaneFacts {
  name: string;
  doors: Doors;
  shipsToCallers: boolean;
  entrypoints: string[];
  rings: string[];
  labelsApplied: string[];
  handsOverOnRed: boolean;
  spendsModel: boolean;
}

function stepsOf(row: LaneWiring): StepWiring[] {
  return Object.values(row.jobs).flatMap((job) => [...job.steps]);
}

export function laneFacts(lane: string): LaneFacts {
  const row = LANE_WIRING[lane];
  const steps = stepsOf(row);
  return {
    name: row.name,
    doors: row.stub?.on ?? row.on ?? {},
    shipsToCallers: row.stub !== undefined,
    entrypoints: [...new Set(steps.flatMap((step) => step.entrypoint ?? []))],
    rings: [...new Set(steps.flatMap((step) => step.rings ?? []))],
    labelsApplied: [...new Set(steps.flatMap((step) => step.appliesLabels ?? []))],
    handsOverOnRed: steps.some((step) => step.handsOver === true),
    spendsModel: Object.values(row.jobs).some((job) => job.env?.CLAUDE_CODE_OAUTH_TOKEN !== undefined),
  };
}

export function lanesNamed(display: string): string[] {
  return wiredLanes().filter((lane) => LANE_WIRING[lane].name === display);
}
