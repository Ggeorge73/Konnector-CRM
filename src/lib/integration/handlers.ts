import { onDecided, onSurvey, onViewed } from "@/lib/services/client-items";
import { applyHealthUpdate } from "@/lib/services/handoff";
import type { InboundHandlers } from "./inbound";

/** Inbound Konnect Hub event → CRM handler. */
export const inboundHandlers: InboundHandlers = {
  "project.health_updated": (c, e) => applyHealthUpdate(c, e),
  "client_item.viewed": (c, e) => onViewed(c, e),
  "client_item.decided": (c, e) => onDecided(c, e),
  "survey.submitted": (c, e) => onSurvey(c, e),
};
