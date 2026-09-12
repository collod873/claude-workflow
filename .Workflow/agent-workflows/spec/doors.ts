import { isOwner, commaList } from "../shared/event-door";
import { SLICEABLE_LABEL } from "./open-questions";
import { PRD_LABEL } from "./publish";

export const TO_SPEC_LABEL = "to-spec";

export interface SpecDoor {
  eventName: string;
  label: string;
  senderIsOwner: boolean;
  issueLabels: readonly string[];
}

export interface SpecDoorValues {
  eventName: string;
  label: string;
  sender: string;
  owner: string;
  labels: string;
}

export function specDoorFrom(values: SpecDoorValues): SpecDoor {
  return {
    eventName: values.eventName,
    label: values.label,
    senderIsOwner: isOwner(values.sender, values.owner),
    issueLabels: commaList(values.labels),
  };
}

export function specsSource(door: SpecDoor): boolean {
  if (door.eventName === "repository_dispatch") return true;
  if (door.eventName !== "issues" || !door.senderIsOwner) return false;
  if (door.label === TO_SPEC_LABEL) return true;
  return door.label === PRD_LABEL && !door.issueLabels.includes(SLICEABLE_LABEL);
}
