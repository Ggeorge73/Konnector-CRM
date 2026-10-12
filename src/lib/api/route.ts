import "server-only";
import { handleApi } from "./http";
import type { Resource } from "./resources";
import { apiStore } from "./store";

type IdParams = { params: Promise<{ id: string }> };

/** Route handlers for /api/v1/<resource>. */
export function collectionRoute(resource: Resource) {
  const h = (req: Request) => handleApi(req, { resource }, { store: apiStore() });
  return { GET: h, POST: h, PATCH: h, PUT: h, DELETE: h };
}

/** Route handlers for /api/v1/<resource>/<id>. */
export function itemRoute(resource: Resource) {
  const h = async (req: Request, { params }: IdParams) => handleApi(req, { resource, id: (await params).id }, { store: apiStore() });
  return { GET: h, POST: h, PATCH: h, PUT: h, DELETE: h };
}
