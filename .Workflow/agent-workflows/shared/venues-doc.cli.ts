export type VenueSlots = { venue: string; slots: string[] };

export function readVenueSlots(): VenueSlots[] {
  throw new Error("#554: not built");
}

export function venuesTableMarkers(): { begin: string; end: string } {
  throw new Error("#554: not built");
}

export function renderVenuesTable(): string {
  throw new Error("#554: not built");
}

export function regenerateVenuesDoc(_doc: string): string {
  throw new Error("#554: not built");
}

export function checkVenuesDoc(_doc: string): { ok: boolean; message: string } {
  throw new Error("#554: not built");
}

if (process.argv[1] !== undefined && process.argv[1].includes("venues-doc.cli")) {
  throw new Error("#554: not built");
}
