import { applyHealthUpdate } from "@/lib/services/handoff";
import type { InboundHandlers } from "./inbound";

/** Inbound Konnect Hub event → CRM handler. */
export const inboundHandlers: InboundHandlers = {
  "project.health_updated": (c, e) => applyHealthUpdate(c, e),
};
