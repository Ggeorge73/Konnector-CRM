"use server";
import { run } from "@/lib/services/action";
import { saveConsultant, staffingMatches, type ConsultantInputT } from "@/lib/services/bench";
import { captureLead, saveEvent, type EventInputT, type LeadInputT } from "@/lib/services/events";

export async function saveConsultantAction(input: ConsultantInputT, id?: string) {
  return run((c) => saveConsultant(c, input, id), ["/bench", ...(id ? [`/bench/${id}`] : [])]);
}

export async function staffingMatchesAction(opportunityId: string, opts: { skills?: string[]; availableBy?: string } = {}) {
  return run((c) => staffingMatches(c, opportunityId, opts));
}

export async function saveEventAction(input: EventInputT, id?: string) {
  return run((c) => saveEvent(c, input, id), ["/events", ...(id ? [`/events/${id}`] : [])]);
}

export async function captureLeadAction(eventId: string, input: LeadInputT) {
  return run((c) => captureLead(c, eventId, input), ["/events", `/events/${eventId}`, "/my-work", "/contacts"]);
}
