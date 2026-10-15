/**
 * Row types for every table. Mirrors supabase/migrations exactly — change both together.
 * All rows share BaseRow; money is a number + ISO currency code.
 */

export interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  archived_at: string | null;
}

export type Currency = string; // ISO 4217, default USD

// ---------- Core ----------

export const ROLES = ["admin", "executive", "bd", "delivery_lead", "recruiter"] as const;
export type Role = (typeof ROLES)[number];

export interface Organization extends BaseRow {
  name: string;
  settings: OrgSettings;
}

export interface OrgSettings {
  margin_floor_pct: number;
  bid_weights: Record<BidCriterion, number>;
  stages: StageDef[];
  low_survey_threshold: number;
}

export interface User extends BaseRow {
  org_id: string;
  email: string;
  full_name: string;
  title: string;
  /** null = pending access: signed in from the allowed domain, waiting for an admin to assign a role. */
  role: Role | null;
  avatar_color: string;
  time_zone: string;
}

/** A user an admin has let in. Every Ctx carries one; pending users never reach services. */
export type ActiveUser = User & { role: Role };

export const ACCOUNT_TYPES = [
  "government_federal",
  "government_state",
  "government_local",
  "government_foreign",
  "private",
  "partner_subcontractor",
  "oem_vendor",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = ["prospect", "active_client", "past_client", "partner", "dormant"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface Account extends BaseRow {
  org_id: string;
  name: string;
  type: AccountType;
  sector: string;
  country: string;
  state_region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  logo_url: string | null;
  owner_id: string;
  tier: "A" | "B" | "C";
  status: AccountStatus;
  konnect_hub_client_id: string | null;
  survey_score: number | null;
  description: string | null;
}

export const BUYING_ROLES = ["decision_maker", "influencer", "procurement_officer", "technical_evaluator", "champion"] as const;
export type BuyingRole = (typeof BUYING_ROLES)[number];

export interface Contact extends BaseRow {
  org_id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  role_in_buying: BuyingRole | null;
  owner_id: string;
}

export const ACTIVITY_TYPES = ["note", "email", "call", "meeting", "task", "stage_change", "file", "handoff", "system"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export type RelatedType =
  "account" | "contact" | "opportunity" | "quote" | "consultant" | "event" | "registration" | "partner_vetting" | "client_item";

export interface Activity extends BaseRow {
  org_id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  occurred_at: string;
  related_type: RelatedType;
  related_id: string;
  account_id: string | null;
  actor_id: string | null;
  mentions: string[];
  reactions: Record<string, string[]>;
}

export interface Task extends BaseRow {
  org_id: string;
  title: string;
  due_at: string | null;
  assignee_id: string;
  priority: "low" | "medium" | "high";
  status: "open" | "done";
  related_type: RelatedType | null;
  related_id: string | null;
  account_id: string | null;
  notes: string | null;
}

export interface FileRow extends BaseRow {
  org_id: string;
  storage_path: string;
  name: string;
  size: number;
  mime: string;
  related_type: RelatedType;
  related_id: string;
}

export interface Tag extends BaseRow {
  org_id: string;
  name: string;
  color: string;
}

export interface RecordTag extends BaseRow {
  tag_id: string;
  related_type: RelatedType;
  related_id: string;
}

export interface SavedView extends BaseRow {
  org_id: string;
  owner_id: string;
  entity: "accounts" | "contacts" | "opportunities" | "consultants";
  name: string;
  query: Record<string, string>;
  shared: boolean;
}

export interface Notification extends BaseRow {
  user_id: string;
  kind: "mention" | "assignment" | "deadline" | "expiry" | "client_decision" | "handoff" | "approval" | "alert";
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
}

export interface Mention extends BaseRow {
  activity_id: string;
  user_id: string;
}

export interface RecentView extends BaseRow {
  user_id: string;
  related_type: RelatedType;
  related_id: string;
  label: string;
}

export interface AuditLog extends BaseRow {
  org_id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

// ---------- Opportunities ----------

export const STAGES = ["signal", "qualify", "capture", "bid_no_bid", "proposal", "submitted", "won", "lost", "no_bid"] as const;
export type Stage = (typeof STAGES)[number];

export interface StageDef {
  key: Stage;
  label: string;
  probability: number;
  wip_limit: number | null;
  closed: boolean;
}

export const OPP_KINDS = ["public_bid", "private_deal", "reseller_quote", "staffing_placement"] as const;
export type OppKind = (typeof OPP_KINDS)[number];

export const SERVICE_LINES = ["implementation", "systems_integration", "staffing", "reselling", "advisory"] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const OPP_SOURCES = ["signal", "referral", "event", "inbound", "partner"] as const;
export type OppSource = (typeof OPP_SOURCES)[number];

export const PROCUREMENT_VEHICLES = ["Team Georgia Marketplace", "SAM.gov", "GSA schedule", "state contract", "direct"] as const;

export interface Opportunity extends BaseRow {
  org_id: string;
  name: string;
  account_id: string;
  owner_id: string;
  kind: OppKind;
  stage: Stage;
  value: number;
  currency: Currency;
  probability: number;
  pwin: number | null;
  expected_close: string | null;
  source: OppSource;
  service_lines: ServiceLine[];
  next_step: string | null;
  next_step_due: string | null;
  lost_reason: string | null;
  no_bid_reason: string | null;
  shared_with: string[];
  parent_opportunity_id: string | null;
  // public-bid fields
  solicitation_no: string | null;
  agency_buyer: string | null;
  procurement_vehicle: string | null;
  naics: string | null;
  set_aside: string | null;
  questions_due: string | null;
  proposal_due: string | null;
  submission_method: string | null;
  incumbent: string | null;
}

export const BID_CRITERIA = [
  "strategic_fit",
  "customer_relationship",
  "competitive_position",
  "capability",
  "staffing_availability",
  "margin",
  "risk",
] as const;
export type BidCriterion = (typeof BID_CRITERIA)[number];

export interface BidDecision extends BaseRow {
  opportunity_id: string;
  scores: Record<BidCriterion, number>;
  weights: Record<BidCriterion, number>;
  total_score: number;
  verdict: "bid" | "no_bid" | "conditional";
  notes: string | null;
  decided_by: string | null;
  status: "pending_approval" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
}

export interface Quote extends BaseRow {
  org_id: string;
  opportunity_id: string;
  account_id: string;
  number: string;
  title: string;
  currency: Currency;
  status: "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "declined";
  valid_until: string | null;
  terms: string | null;
  internal_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  owner_id: string;
}

export interface QuoteLine extends BaseRow {
  quote_id: string;
  position: number;
  item: string;
  description: string | null;
  qty: number;
  unit_cost: number;
  unit_price: number;
  oem_partner_account_id: string | null;
}

// ---------- Compliance ----------

export interface Registration extends BaseRow {
  org_id: string;
  kind: "sam_uei" | "cage" | "georgia_supplier" | "certification" | "insurance" | "license";
  name: string;
  identifier: string | null;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  owner_id: string;
  notes: string | null;
}

export interface PartnerVetting extends BaseRow {
  org_id: string;
  account_id: string;
  sanctions_screen: "clear" | "hit" | "pending";
  pep_screen: "clear" | "hit" | "pending";
  beneficial_ownership: string | null;
  anti_corruption_attested: boolean;
  references_checked: boolean;
  risk_rating: "low" | "medium" | "high";
  review_due: string | null;
  reviewer_id: string | null;
  notes: string | null;
}

// ---------- Bench ----------

export interface Consultant extends BaseRow {
  org_id: string;
  full_name: string;
  title: string;
  email: string | null;
  skills: string[];
  certifications: string[];
  rate_cost: number | null;
  rate_bill: number;
  currency: Currency;
  availability_from: string | null;
  location: string;
  clearance: string | null;
  resume_file_id: string | null;
  status: "available" | "allocated" | "partial" | "inactive";
}

// ---------- Events ----------

export interface BdEvent extends BaseRow {
  org_id: string;
  name: string;
  kind: "summit" | "expo" | "procurement_fair" | "conference" | "webinar";
  starts_on: string;
  ends_on: string;
  location: string;
  budget: number;
  currency: Currency;
  attendee_ids: string[];
  notes: string | null;
}

export interface EventLead extends BaseRow {
  event_id: string;
  contact_id: string;
  interest: string | null;
  follow_up_task_id: string | null;
}

// ---------- Integration ----------

export interface Handoff extends BaseRow {
  opportunity_id: string;
  status: "pending" | "sent" | "acknowledged" | "failed";
  attempts: number;
  last_error: string | null;
  konnect_hub_project_id: string | null;
  konnect_hub_url: string | null;
  payload_version: string;
  payload: Record<string, unknown>;
  next_attempt_at: string | null;
}

export type Rag = "green" | "amber" | "red";

export interface ProjectHealth extends BaseRow {
  konnect_hub_project_id: string;
  opportunity_id: string | null;
  account_id: string | null;
  project_name: string;
  health_schedule: Rag;
  health_budget: Rag;
  health_acceptance: Rag;
  percent_complete: number;
  status: string;
  hub_updated_at: string;
  end_date: string | null;
}

export const CLIENT_ITEM_TYPES = ["quote", "contract_amendment", "renewal_offer", "survey"] as const;
export type ClientItemType = (typeof CLIENT_ITEM_TYPES)[number];
export const CLIENT_ITEM_STATUSES = [
  "draft",
  "published",
  "viewed",
  "accepted",
  "declined",
  "changes_requested",
  "expired",
  "withdrawn",
  "superseded",
] as const;
export type ClientItemStatus = (typeof CLIENT_ITEM_STATUSES)[number];

export interface ClientItemLine {
  item: string;
  description: string | null;
  qty: number;
  unit_price: number;
}

export interface ClientItem extends BaseRow {
  org_id: string;
  type: ClientItemType;
  account_id: string;
  opportunity_id: string | null;
  quote_id: string | null;
  konnect_hub_client_id: string | null;
  konnect_hub_project_id: string | null;
  title: string;
  summary: string | null;
  amount: number | null;
  currency: Currency;
  lines: ClientItemLine[];
  terms: string | null;
  new_end_date: string | null;
  document_file_id: string | null;
  respond_by: string | null;
  version: number;
  lineage_id: string;
  status: ClientItemStatus;
  decided_by_name: string | null;
  decided_by_title: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_ip: string | null;
  decision_note: string | null;
  survey_score: number | null;
  published_by: string | null;
  published_at: string | null;
  owner_id: string;
}

export interface IntegrationEvent extends BaseRow {
  direction: "outbound" | "inbound";
  event: string;
  idempotency_key: string;
  status: "pending" | "delivered" | "failed" | "processed" | "rejected";
  attempts: number;
  last_error: string | null;
  payload: Record<string, unknown>;
  response: Record<string, unknown> | null;
}

// ---------- PI-2: Copilot, mail/calendar sync, REST API & webhooks ----------

export const COPILOT_TASKS = ["account_summary", "followup_email", "bid_suggestion", "notes_to_tasks", "rfp_checklist"] as const;
export type CopilotTask = (typeof COPILOT_TASKS)[number];

/** One Copilot request: who asked, about what, and what it cost. Never stores the prompt or output text. */
export interface CopilotRun extends BaseRow {
  org_id: string;
  user_id: string;
  task: CopilotTask;
  related_type: RelatedType | null;
  related_id: string | null;
  model: string;
  status: "ok" | "refused" | "error" | "demo";
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  error: string | null;
}

export type MailProvider = "google" | "microsoft";

/** A user's own mailbox/calendar connection. Tokens are encrypted at rest and never sent to the browser. */
export interface MailConnection extends BaseRow {
  org_id: string;
  user_id: string;
  provider: MailProvider;
  email: string;
  status: "active" | "revoked" | "error";
  scopes: string[];
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  sync_cursor: Record<string, unknown>;
  last_error: string | null;
}

/** A message or calendar event pulled from a connection and linked to the timeline. */
export interface SyncedMessage extends BaseRow {
  connection_id: string;
  user_id: string;
  provider_message_id: string;
  kind: "email" | "event";
  direction: "inbound" | "outbound";
  subject: string;
  from_address: string | null;
  to_addresses: string[];
  occurred_at: string;
  activity_id: string | null;
  account_id: string | null;
  contact_id: string | null;
}

export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Personal API key. Only a SHA-256 hash and a short display prefix are stored. */
export interface ApiKey extends BaseRow {
  org_id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: ApiScope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export const WEBHOOK_EVENTS = [
  "account.created",
  "account.updated",
  "opportunity.created",
  "opportunity.stage_changed",
  "quote.status_changed",
  "client_item.decided",
  "handoff.acknowledged",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Outbound webhook subscription for other internal tools (accounting, e-signature…). Admin-managed. */
export interface WebhookSubscription extends BaseRow {
  org_id: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  secret_enc: string;
  active: boolean;
}

export interface WebhookDelivery extends BaseRow {
  subscription_id: string;
  event: WebhookEvent;
  event_id: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
}

/**
 * Fixed-window rate-limit counter (Copilot per user, REST API per key). Service role only;
 * written atomically by the take_rate_limit() SQL function. See src/lib/rate-limit.
 */
export interface RateLimitRow extends BaseRow {
  bucket: string;
  window_start: string;
  hits: number;
  expires_at: string;
}

// ---------- PI-3 S10: data onboarding ----------

export const IMPORT_ENTITIES = ["accounts", "contacts", "opportunities"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

/** Records one import batch created, by table — exactly what Undo archives. */
export interface ImportCreatedIds {
  accounts: string[];
  contacts: string[];
  opportunities: string[];
}

/** One committed CSV import: who, when, what, counts and the ids it created (for Undo within 7 days). */
export interface ImportBatch extends BaseRow {
  org_id: string;
  user_id: string;
  entity: ImportEntity;
  file_name: string;
  status: "committed" | "undone";
  total_rows: number;
  created_count: number;
  skipped_count: number;
  error_count: number;
  created_ids: ImportCreatedIds;
  undone_at: string | null;
  undone_by: string | null;
}

// ---------- Data quality (KCRM-77) ----------

export const DEDUPE_ENTITIES = ["accounts", "contacts"] as const;
export type DedupeEntity = (typeof DEDUPE_ENTITIES)[number];

/** A pair a leader marked "not a duplicate". Stored as an unordered pair: record_a < record_b. */
export interface DuplicateDismissal extends BaseRow {
  org_id: string;
  entity: DedupeEntity;
  record_a: string;
  record_b: string;
  dismissed_by: string | null;
  note: string | null;
}

export interface Tables {
  organizations: Organization;
  users: User;
  accounts: Account;
  contacts: Contact;
  activities: Activity;
  tasks: Task;
  files: FileRow;
  tags: Tag;
  record_tags: RecordTag;
  saved_views: SavedView;
  notifications: Notification;
  mentions: Mention;
  recent_views: RecentView;
  audit_log: AuditLog;
  opportunities: Opportunity;
  bid_decisions: BidDecision;
  quotes: Quote;
  quote_lines: QuoteLine;
  registrations: Registration;
  partner_vetting: PartnerVetting;
  consultants: Consultant;
  events: BdEvent;
  event_leads: EventLead;
  handoffs: Handoff;
  project_health: ProjectHealth;
  client_items: ClientItem;
  integration_events: IntegrationEvent;
  copilot_runs: CopilotRun;
  mail_connections: MailConnection;
  synced_messages: SyncedMessage;
  api_keys: ApiKey;
  webhook_subscriptions: WebhookSubscription;
  webhook_deliveries: WebhookDelivery;
  rate_limits: RateLimitRow;
  import_batches: ImportBatch;
  duplicate_dismissals: DuplicateDismissal;
}

export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T];
export type NewRow<T extends TableName> = Omit<Row<T>, keyof BaseRow> & Partial<BaseRow>;
