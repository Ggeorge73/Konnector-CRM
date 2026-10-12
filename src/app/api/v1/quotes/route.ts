import { collectionRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";
export const { GET, POST, PATCH, PUT, DELETE } = collectionRoute("quotes");
