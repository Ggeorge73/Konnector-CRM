import type { Instrumentation } from "next";
import { reportError } from "@/lib/server/observability";

export function register() {
  // No vendor SDK to initialise (see docs/OPERATIONS.md). Kept so Next loads onRequestError.
}

/**
 * Catches errors Next.js sees while rendering pages, running route handlers, server actions and
 * middleware. Only the path is reported (no query string, headers or body).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  reportError(err, {
    source: `next.${context.routeType}`,
    route: context.routePath || request.path,
  });
};
