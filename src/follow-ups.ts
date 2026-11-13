import { NO_EM_DASH } from "./brief.ts";
import { addBlocker, postedUnderOrigin } from "./issue-links.ts";
import { commentOnTicket, FILED, followUpBody, gh, heardIn, LABELLED_WAITING, nothingHears, OWNER, post, WAITING } from "./post.ts";

const DIRECT_LINK = /^https:\/\/\S+$/;

const CLICK = {
  type: "object",
  properties: {
    action: { type: "string", pattern: NO_EM_DASH, description: "One action the owner takes, such as Click Generate token." },
    at: {
      type: "string",
      pattern: DIRECT_LINK.source,
      description: "The exact settings page as a direct link, pre-filled where GitHub allows, as a fine-grained token's https://github.com/settings/personal-access-tokens/new?name=NAME&target_name=OWNER&expires_in=DAYS&PERMISSION=read.",
    },
    picks: {
      type: "array",
      description: "Every field the page asks, each with the one value to set, such as Expiration and Repository access for a token.",
      items: {
        type: "object",
        properties: { field: { type: "string", pattern: NO_EM_DASH }, value: { type: "string", minLength: 1, pattern: NO_EM_DASH } },
        required: ["field", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["action", "at", "picks"],
  additionalProperties: false,
};

export const STEP_TRAILER = "Owner-step";

export const OWNER_STEPS = {
  type: "array",
  items: {
    type: "object",
    description: "Missing work that needs the owner's own login, money or identity, which no tool here can do. Never a try: a hand check on his phone, a look after deploy or a confirm is not a step (agent-hooks#83).",
    properties: {
      title: { type: "string", pattern: NO_EM_DASH },
      why: { type: "string", pattern: NO_EM_DASH },
      needs: { type: "string", pattern: NO_EM_DASH },
      clicks: { type: "array", minItems: 1, items: CLICK, description: "The owner's numbered steps, one action each; a step missing a link or a value is refused, not filed." },
      handover: {
        type: "string",
        pattern: NO_EM_DASH,
        description: "The last step: how a secret this makes reaches its home without being pasted into a chat, such as running gh secret set NAME --repo OWNER/REPO and pasting at its prompt. Empty when it makes no secret.",
      },
    },
    required: ["title", "why", "needs", "clicks", "handover"],
    additionalProperties: false,
  },
};

interface Click {
  action: string;
  at: string;
  picks: { field: string; value: string }[];
}

export interface OwnerStep {
  title: string;
  why: string;
  needs: string;
  clicks: Click[];
  handover: string;
}

const PAGES_ASKING = [{ page: "https://github.com/settings/personal-access-tokens/new", asks: ["Expiration", "Repository access"], prefills: ["name", "target_name", "expires_in"], unpermitted: ["name", "description", "target_name", "expires_in"] }];
const UNANSWERED = /^\s*(|any|whatever|your (call|choice)|choose|pick one|tbd|n\/a|\?+|depends)\s*$/i;
const SECRET = /\b(tokens?|secrets?|passwords?|keys?|pat)\b|_(KEY|TOKEN|SECRET|PAT)\b/i;

const linked = (at: string) => DIRECT_LINK.test(at) && URL.canParse(at);
const askingAt = (url: URL) => PAGES_ASKING.find(({ page }) => `${url.origin}${url.pathname}` === page);

function clickRefusals({ at, picks }: Click, index: number): string[] {
  const number = index + 1;
  if (!linked(at)) return [`step ${number} links no page: "${at}" is no direct https link`];
  const url = new URL(at);
  const asking = askingAt(url);
  const permitted = asking === undefined || [...url.searchParams.keys()].some((param) => !asking.unpermitted.includes(param));
  const unfilled = [...(asking?.prefills ?? []).filter((param) => !url.searchParams.has(param)), ...(permitted ? [] : ["a permission"])];
  return [
    ...picks.filter(({ value }) => UNANSWERED.test(value)).map(({ field }) => `step ${number} leaves "${field}" unanswered`),
    ...(unfilled.length > 0 ? [`step ${number} links its page without pre-filling ${unfilled.join(", ")}`] : []),
  ];
}

function unaskedRefusals(clicks: Click[]): string[] {
  const fields = clicks.flatMap(({ picks }) => picks.map(({ field }) => field.toLowerCase()));
  const firstOnPage = new Map<(typeof PAGES_ASKING)[number], number>();
  clicks.forEach(({ at }, index) => {
    const asking = linked(at) ? askingAt(new URL(at)) : undefined;
    if (asking !== undefined && !firstOnPage.has(asking)) firstOnPage.set(asking, index);
  });
  return [...firstOnPage].flatMap(([{ asks }, index]) => asks.filter((ask) => !fields.some((field) => field.includes(ask.toLowerCase()))).map((ask) => `step ${index + 1} leaves "${ask}" unanswered, which its page asks`));
}

function ownerStepRefusals(step: OwnerStep): string[] {
  if (step.clicks.length === 0) return ["it gives no numbered steps, so the owner must work out where to click"];
  const said = [step.title, step.why, step.needs, ...step.clicks.map(({ action }) => action)].join("\n");
  const unhanded = SECRET.test(said) && step.handover.trim() === "" ? ["it makes a secret, but no last step says how to hand it over without pasting it into a chat"] : [];
  return [...new Set([...step.clicks.flatMap(clickRefusals), ...unaskedRefusals(step.clicks)]), ...unhanded];
}

export function stepsUnfileable(steps: OwnerStep[]): string | undefined {
  const refused = steps.flatMap((step) => ownerStepRefusals(step).map((refusal) => `- "${step.title}": ${refusal}`));
  return refused.length === 0 ? undefined : ["These owner steps would be refused, not filed:", refused.join("\n"), "Answer again with each under its same title, fixed: nothing is posted, filed or landed until every one would file."].join("\n\n");
}

const numbered = ({ clicks, handover }: OwnerStep): string =>
  [
    ...clicks.flatMap(({ action, at, picks }, index) => [`${index + 1}. ${action}: ${at}`, ...picks.map(({ field, value }) => `   - ${field}: **${value}**`)]),
    ...(handover.trim() === "" ? [] : [`${clicks.length + 1}. ${handover.trim()}`]),
  ].join("\n");

export const MOST_FIXES = 3;

export const FOLLOW_UPS = {
  fixes: {
    type: "array",
    maxItems: MOST_FIXES,
    items: {
      type: "object",
      properties: {
        fault: { type: "string", pattern: NO_EM_DASH },
        title: { type: "string", pattern: NO_EM_DASH },
        done: { type: "array", minItems: 1, items: { type: "string", pattern: NO_EM_DASH } },
        waits: { type: "string", pattern: NO_EM_DASH },
      },
      required: ["fault", "title", "done"],
      additionalProperties: false,
    },
  },
  asks: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
};

interface Fix {
  fault: string;
  title: string;
  done: string[];
  waits?: string | undefined;
}

export type Filed = { named: string; refusals: string[]; said: string };

const keyOf = (named: string) => named.trim().toLowerCase();

const blocks = (step: OwnerStep) => step.needs.trim() !== "";

const ownerStepFiled = (left: string) => (step: OwnerStep): Filed => {
  const named = `${step.title}: ${step.why}`;
  const refusals = ownerStepRefusals(step);
  if (refusals.length > 0) return { named, refusals, said: "" };
  const needs = blocks(step) ? `Needs: ${step.needs.trim()}\n\n` : "";
  return { named, ...post({ kind: blocks(step) ? "owner" : "note", title: step.title, text: `## Why\n\n${step.why}\n\n## Steps\n\n${numbered(step)}\n\n${needs}${left}\n` }, gh) };
};

function pingedUnheard(filed: Filed, note: string): Filed {
  const repo = process.env.GH_REPO ?? "";
  const fix = FILED.exec(filed.said)?.[1];
  if (fix === undefined || heardIn(repo)) return filed;
  commentOnTicket(fix, `#${fix} waits on #${note}, ${LABELLED_WAITING}. ${nothingHears(fix, repo)} #${note}`, gh);
  return filed;
}

function fixFiled(found: string, { fault, title, done, waits }: Fix, notes: Map<string, Filed>, unneeded: Set<string>): Filed {
  const text = followUpBody([found, "", `> ${fault}`], done);
  if (waits === undefined || waits.trim() === "" || unneeded.has(keyOf(waits))) return { named: title, ...postedUnderOrigin({ kind: "ticket", title, text }, gh) };
  const number = FILED.exec(notes.get(keyOf(waits))?.said ?? "")?.[1];
  if (number === undefined) return { named: title, refusals: [`it waits on the owner step "${waits}", which was not filed`], said: "" };
  const filed: Filed = { named: title, ...postedUnderOrigin({ kind: "ticket", title, text, labels: [WAITING] }, gh) };
  const fix = FILED.exec(filed.said)?.[1];
  const repo = process.env.GH_REPO ?? "";
  if (fix !== undefined) addBlocker(repo, Number(fix), repo, Number(number));
  return pingedUnheard(filed, number);
}

const ENDS = { fixed: "fixed here", nothing: "needs nothing" } as const;

export const ROUTED = {
  fixes: FOLLOW_UPS.fixes,
  risks: {
    type: "array",
    items: {
      type: "object",
      properties: {
        risk: { type: "string", pattern: NO_EM_DASH },
        ends: { enum: Object.keys(ENDS) },
        why: { type: "string", pattern: NO_EM_DASH },
      },
      required: ["risk", "ends", "why"],
      additionalProperties: false,
    },
  },
};

export const ROUTED_REQUIRED = ["risks"];

interface Risk {
  risk: string;
  ends: keyof typeof ENDS;
  why: string;
}

export interface FollowUps {
  fixes: Fix[];
  risks: Risk[];
  steps: OwnerStep[];
  asks: string[];
}

export type Answered = Partial<{ [Kind in keyof FollowUps]: FollowUps[Kind] | undefined }>;

const latestBy = <Named>(named: (one: Named) => string, rounds: (Named[] | undefined)[]) => [...new Map(rounds.flatMap((round) => round ?? []).map((one) => [keyOf(named(one)), one])).values()];

export const gathered = (...answers: (Answered | undefined)[]): FollowUps => ({
  fixes: latestBy(({ title }) => title, answers.map((answer) => answer?.fixes)),
  risks: latestBy(({ risk }) => risk, answers.map((answer) => answer?.risks)),
  steps: latestBy(({ title }) => title, answers.map((answer) => answer?.steps)),
  asks: latestBy((ask) => ask, answers.map((answer) => answer?.asks)),
});

function routedOn({ fixes, risks }: FollowUps): string[] {
  const ended = [...fixes.map(({ fault, title }) => `- filed as the ticket "${title}" once it lands: ${fault}`), ...risks.map(({ risk, ends, why }) => `- ${ENDS[ends]}: ${risk} ${why}`)];
  return ended.length === 0 ? [] : [`Where each risk its reviewer saw ends:\n\n${ended.join("\n")}`];
}

export const approvedOn = (reasons: string[], followUps: FollowUps) => [...reasons, ...routedOn(followUps)].join("\n\n");

export function filed({ fixes, steps, asks }: FollowUps, from: { found: string; left: string; asked?: { title: string; by: string } }): Filed[] {
  const stepsFiled = steps.map((step) => ({ step, filed: ownerStepFiled(from.left)(step) }));
  const notes = new Map(stepsFiled.filter(({ step }) => blocks(step)).map(({ step, filed }) => [keyOf(step.title), filed]));
  const unneeded = new Set(steps.filter((step) => !blocks(step)).map((step) => keyOf(step.title)));
  const tickets = [...stepsFiled.map(({ filed }) => filed), ...fixes.map((fix) => fixFiled(from.found, fix, notes, unneeded))];
  if (from.asked === undefined || asks.length === 0) return tickets;
  const { title, by } = from.asked;
  const text = ["## Why", "", `@${OWNER} ${by} leaves these to you:`, "", ...asks.map((ask) => `- ${ask}`), ""].join("\n");
  return [...tickets, { named: title, ...post({ kind: "note", title, text }, gh) }];
}
