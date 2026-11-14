/** Single source for product naming and environment-driven flags. */
export const APP_NAME = "Konnector CRM";
export const COMPANY_NAME = "Konnector LLC";
export const HQ = { city: "Atlanta", state: "GA", lat: 33.749, lng: -84.388 } as const;

export const env = {
  /** `demo` runs on the seeded in-memory store; `supabase` uses the real database. */
  dataBackend: (process.env.DATA_BACKEND ?? "demo") as "demo" | "supabase",
  allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN ?? "konnectorllc.com",
  konnectHubBaseUrl: process.env.KONNECT_HUB_BASE_URL ?? "",
  konnectHubWebUrl: process.env.KONNECT_HUB_WEB_URL ?? "https://hub.konnectorllc.com",
  integrationSecret: process.env.KONNECTOR_INTEGRATION_SECRET ?? "dev-only-shared-secret",
  mockKonnectHub: process.env.MOCK_KONNECT_HUB !== "false",
  /** Same value as LEAD_WEBHOOK_SECRET on konnectortech.com. No default: unset means the endpoint refuses everything. */
  leadWebhookSecret: process.env.LEAD_WEBHOOK_SECRET ?? "",
  /** Optional: who owns accounts/deals created from website enquiries. Default: the longest-standing admin. */
  leadDefaultOwnerEmail: process.env.LEAD_DEFAULT_OWNER_EMAIL ?? "",
};

export function isDemo() {
  return env.dataBackend === "demo";
}
