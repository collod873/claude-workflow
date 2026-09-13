import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runRegenerator } from "./regenerate-cli";

export type VenueSlots = { venue: string; slots: string[] };

const VENUE_SLOTS: VenueSlots[] = [
  { venue: "turn", slots: ["typecheck", "lint_one", "test_related"] },
  { venue: "stop", slots: ["typecheck", "lint_one", "test_related"] },
  { venue: "push", slots: ["typecheck", "lint", "test", "clones", "adrs"] },
];

const VENUE_META: Record<string, { firesAt: string; onFailure: string }> = {
  turn: { firesAt: "PostToolUse, per edit", onFailure: "Hands the report back to Claude" },
  stop: { firesAt: "Stop, per turn end", onFailure: "Reports once, never holds the turn" },
  push: { firesAt: "pre-push", onFailure: "**Refuses the push**" },
};

const CI_ROW = {
  venue: "CI",
  firesAt: "`push: main`, dispatch",
  slots: "`npm run check`, which is the push venue against the target",
  onFailure: "Red run; rings the fixer",
};

const VENUES_TABLE_OPEN = "<!-- venues-table:v1 -->";
const VENUES_TABLE_CLOSE = "<!-- /venues-table:v1 -->";

export const VENUES_DOC_RELATIVE_PATH = "docs/agents/venues.md";

export function readVenueSlots(): VenueSlots[] {
  return VENUE_SLOTS;
}

export function venuesTableMarkers(): { begin: string; end: string } {
  return { begin: VENUES_TABLE_OPEN, end: VENUES_TABLE_CLOSE };
}

function slotList(slots: string[]): string {
  return slots.map((slot) => `\`${slot}\``).join(", ");
}

export function renderVenuesTable(): string {
  const header = "| Venue | Fires at | Slots | On failure |\n| --- | --- | --- | --- |";
  const rows = readVenueSlots().map(({ venue, slots }) => {
    const meta = VENUE_META[venue];
    return `| \`${venue}\` | ${meta.firesAt} | ${slotList(slots)} | ${meta.onFailure} |`;
  });
  rows.push(`| ${CI_ROW.venue} | ${CI_ROW.firesAt} | ${CI_ROW.slots} | ${CI_ROW.onFailure} |`);
  return [header, ...rows].join("\n");
}

export function regenerateVenuesDoc(doc: string): string {
  const { begin, end } = venuesTableMarkers();
  const open = doc.indexOf(begin);
  const close = doc.indexOf(end);
  if (open === -1 || close === -1) {
    throw new Error(`the doc carries no ${begin} … ${end} block to regenerate`);
  }
  return `${doc.slice(0, open)}${begin}\n${renderVenuesTable()}\n${end}${doc.slice(close + end.length)}`;
}

export function checkVenuesDoc(doc: string): { ok: boolean; message: string } {
  if (regenerateVenuesDoc(doc) === doc) {
    return { ok: true, message: `${VENUES_DOC_RELATIVE_PATH} is current` };
  }
  return {
    ok: false,
    message: `venues-doc: ${VENUES_DOC_RELATIVE_PATH} is stale; run \`npm run venues-doc\`.`,
  };
}

function venuesDocIsCurrent(root: string): boolean {
  const doc = readFileSync(join(root, VENUES_DOC_RELATIVE_PATH), "utf8");
  return checkVenuesDoc(doc).ok;
}

function regenerateVenuesDocFile(root: string): string[] {
  const path = join(root, VENUES_DOC_RELATIVE_PATH);
  const doc = readFileSync(path, "utf8");
  const next = regenerateVenuesDoc(doc);
  if (next === doc) return [];
  writeFileSync(path, next);
  return [VENUES_DOC_RELATIVE_PATH];
}

function isMainModule(moduleUrl: string): boolean {
  return process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;
}

if (isMainModule(import.meta.url)) {
  const slotsFlagIndex = process.argv.indexOf("--slots");
  if (slotsFlagIndex === -1) {
    runRegenerator(import.meta.url, {
      name: "venues-doc",
      target: VENUES_DOC_RELATIVE_PATH,
      command: "npm run venues-doc",
      isCurrent: venuesDocIsCurrent,
      regenerate: regenerateVenuesDocFile,
    });
  } else {
    const venue = process.argv[slotsFlagIndex + 1];
    const entry = readVenueSlots().find((candidate) => candidate.venue === venue);
    if (entry === undefined) {
      console.error(`venues-doc: no such venue "${venue}"`);
      process.exitCode = 1;
    } else {
      console.log(entry.slots.join(" "));
    }
  }
}
