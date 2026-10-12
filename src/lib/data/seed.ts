/**
 * Seed data for the demo backend, tests and `supabase/seed.sql`.
 * Organisations are public agencies or fictional companies; every deal, person,
 * number and note below is invented for demonstration.
 */
import type {
  Account,
  Activity,
  BaseRow,
  BdEvent,
  BidCriterion,
  BidDecision,
  Consultant,
  Contact,
  EventLead,
  Notification,
  Opportunity,
  OrgSettings,
  Organization,
  PartnerVetting,
  ProjectHealth,
  Quote,
  Registration,
  SavedView,
  Stage,
  Tag,
  RecordTag,
  Task,
  User,
} from "@/lib/domain/types";
import { emptyDataset, type Dataset } from "./memory-store";

/** Deterministic UUID-shaped id from a readable key, so tests can reference rows. */
export function sid(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(2);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const DAY = 86_400_000;

export const DEFAULT_BID_WEIGHTS: Record<BidCriterion, number> = {
  strategic_fit: 20,
  customer_relationship: 15,
  competitive_position: 15,
  capability: 15,
  staffing_availability: 15,
  margin: 10,
  risk: 10,
};

export const DEFAULT_SETTINGS: OrgSettings = {
  margin_floor_pct: 18,
  low_survey_threshold: 6,
  bid_weights: DEFAULT_BID_WEIGHTS,
  stages: [
    { key: "signal", label: "Signal", probability: 5, wip_limit: null, closed: false },
    { key: "qualify", label: "Qualify", probability: 10, wip_limit: 8, closed: false },
    { key: "capture", label: "Capture", probability: 25, wip_limit: 6, closed: false },
    { key: "bid_no_bid", label: "Bid / No-Bid", probability: 35, wip_limit: 4, closed: false },
    { key: "proposal", label: "Proposal", probability: 50, wip_limit: 4, closed: false },
    { key: "submitted", label: "Submitted", probability: 60, wip_limit: null, closed: false },
    { key: "won", label: "Won", probability: 100, wip_limit: null, closed: true },
    { key: "lost", label: "Lost", probability: 0, wip_limit: null, closed: true },
    { key: "no_bid", label: "No-Bid", probability: 0, wip_limit: null, closed: true },
  ],
};

export const ORG_ID = sid("org:konnector");

export const SEED_USERS = {
  admin: sid("user:gbenga"),
  exec: sid("user:adaeze"),
  bd1: sid("user:marcus"),
  bd2: sid("user:priya"),
  delivery: sid("user:lara"),
  recruiter: sid("user:tiara"),
} as const;

export function buildSeed(now: Date = new Date()): Dataset {
  const d = emptyDataset();
  const iso = (offsetDays: number, hour = 15) => {
    const t = new Date(now.getTime() + offsetDays * DAY);
    t.setUTCHours(hour, 0, 0, 0);
    return t.toISOString();
  };
  const date = (offsetDays: number) => iso(offsetDays).slice(0, 10);
  const base = (key: string, createdOffset = -120): BaseRow => ({
    id: sid(key),
    created_at: iso(createdOffset),
    updated_at: iso(Math.min(createdOffset + 10, 0)),
    created_by: SEED_USERS.admin,
    archived_at: null,
  });

  // ---------------- Organization & users ----------------
  d.organizations.push({ ...base("org:konnector", -400), name: "Konnector LLC", settings: DEFAULT_SETTINGS } satisfies Organization);

  const users: Array<[keyof typeof SEED_USERS, string, string, string, User["role"], string]> = [
    ["admin", "Olugbenga George", "gbenga@konnectorllc.com", "Managing Director", "admin", "#0075FF"],
    ["exec", "Adaeze Okafor", "adaeze@konnectorllc.com", "VP, Growth", "executive", "#F5B841"],
    ["bd1", "Marcus Bell", "marcus@konnectorllc.com", "Capture Manager", "bd", "#21D4FD"],
    ["bd2", "Priya Raman", "priya@konnectorllc.com", "Business Development Lead", "bd", "#7551FF"],
    ["delivery", "Lara Mitchell", "lara@konnectorllc.com", "Delivery Director", "delivery_lead", "#01B574"],
    ["recruiter", "Tiara Johnson", "tiara@konnectorllc.com", "Talent Partner", "recruiter", "#FFB547"],
  ];
  for (const [k, full_name, email, title, role, avatar_color] of users) {
    d.users.push({
      ...base(`user:${email.split("@")[0]}`, -400),
      id: SEED_USERS[k],
      org_id: ORG_ID,
      email,
      full_name,
      title,
      role,
      avatar_color,
      time_zone: "America/New_York",
    });
  }
  const U = SEED_USERS;

  // ---------------- Accounts ----------------
  type A = Omit<Account, keyof BaseRow | "org_id" | "logo_url" | "konnect_hub_client_id" | "survey_score">;
  const accounts: Array<[string, A]> = [
    [
      "gta",
      {
        name: "Georgia Technology Authority",
        type: "government_state",
        sector: "Public sector IT",
        country: "US",
        state_region: "GA",
        city: "Atlanta",
        lat: 33.7537,
        lng: -84.3863,
        website: "https://gta.georgia.gov",
        owner_id: U.bd1,
        tier: "A",
        status: "active_client",
        description: "State IT agency; runs enterprise services and statewide procurement vehicles.",
      },
    ],
    [
      "dor",
      {
        name: "Georgia Department of Revenue",
        type: "government_state",
        sector: "Tax & revenue",
        country: "US",
        state_region: "GA",
        city: "Atlanta",
        lat: 33.7713,
        lng: -84.3897,
        website: "https://dor.georgia.gov",
        owner_id: U.bd1,
        tier: "A",
        status: "prospect",
        description: "Modernising taxpayer services and motor-vehicle systems.",
      },
    ],
    [
      "gdot",
      {
        name: "Georgia Department of Transportation",
        type: "government_state",
        sector: "Transportation",
        country: "US",
        state_region: "GA",
        city: "Atlanta",
        lat: 33.7488,
        lng: -84.391,
        website: "https://www.dot.ga.gov",
        owner_id: U.bd2,
        tier: "B",
        status: "prospect",
        description: "Asset-management and traffic-data platform work in the pipeline.",
      },
    ],
    [
      "atl",
      {
        name: "City of Atlanta",
        type: "government_local",
        sector: "Municipal government",
        country: "US",
        state_region: "GA",
        city: "Atlanta",
        lat: 33.749,
        lng: -84.39,
        website: "https://www.atlantaga.gov",
        owner_id: U.bd2,
        tier: "A",
        status: "active_client",
        description: "311 and permitting modernisation; strong executive sponsor.",
      },
    ],
    [
      "fulton",
      {
        name: "Fulton County Government",
        type: "government_local",
        sector: "County government",
        country: "US",
        state_region: "GA",
        city: "Atlanta",
        lat: 33.7901,
        lng: -84.4682,
        website: "https://www.fultoncountyga.gov",
        owner_id: U.bd1,
        tier: "B",
        status: "prospect",
        description: "Courts case-management replacement under evaluation.",
      },
    ],
    [
      "savannah",
      {
        name: "City of Savannah",
        type: "government_local",
        sector: "Municipal government",
        country: "US",
        state_region: "GA",
        city: "Savannah",
        lat: 32.0809,
        lng: -81.0912,
        website: "https://www.savannahga.gov",
        owner_id: U.bd2,
        tier: "C",
        status: "prospect",
        description: "Early conversations on utility billing.",
      },
    ],
    [
      "va",
      {
        name: "U.S. Department of Veterans Affairs",
        type: "government_federal",
        sector: "Federal health",
        country: "US",
        state_region: "DC",
        city: "Washington",
        lat: 38.9007,
        lng: -77.0365,
        website: "https://www.va.gov",
        owner_id: U.bd1,
        tier: "A",
        status: "prospect",
        description: "Subcontracting route via a prime on a scheduling-integration task order.",
      },
    ],
    [
      "cdc",
      {
        name: "Centers for Disease Control and Prevention",
        type: "government_federal",
        sector: "Public health",
        country: "US",
        state_region: "GA",
        city: "Atlanta",
        lat: 33.7995,
        lng: -84.3283,
        website: "https://www.cdc.gov",
        owner_id: U.exec,
        tier: "A",
        status: "past_client",
        description: "Data-integration staffing engagement closed out last year with strong CPARS.",
      },
    ],
    [
      "lagos",
      {
        name: "Lagos State Ministry of Innovation, Science & Technology",
        type: "government_foreign",
        sector: "Digital government",
        country: "NG",
        state_region: "Lagos",
        city: "Lagos",
        lat: 6.5244,
        lng: 3.3792,
        website: null,
        owner_id: U.admin,
        tier: "B",
        status: "prospect",
        description: "E-government service portal; requires local partner and anti-corruption attestations.",
      },
    ],
    [
      "peachtree",
      {
        name: "Peachtree Health Partners",
        type: "private",
        sector: "Healthcare",
        country: "US",
        state_region: "GA",
        city: "Macon",
        lat: 32.8407,
        lng: -83.6324,
        website: null,
        owner_id: U.bd2,
        tier: "A",
        status: "active_client",
        description: "Regional provider network; EHR integration and data platform.",
      },
    ],
    [
      "magnolia",
      {
        name: "Magnolia Community Bank",
        type: "private",
        sector: "Financial services",
        country: "US",
        state_region: "GA",
        city: "Augusta",
        lat: 33.4735,
        lng: -82.0105,
        website: null,
        owner_id: U.bd2,
        tier: "B",
        status: "prospect",
        description: "Core-banking integration and staff augmentation.",
      },
    ],
    [
      "harbor",
      {
        name: "Harborline Logistics",
        type: "private",
        sector: "Logistics",
        country: "US",
        state_region: "GA",
        city: "Savannah",
        lat: 32.0835,
        lng: -81.0998,
        website: null,
        owner_id: U.bd1,
        tier: "C",
        status: "dormant",
        description: "Went quiet after budget freeze; revisit next fiscal year.",
      },
    ],
    [
      "northwind",
      {
        name: "Northwind Cloud Systems",
        type: "oem_vendor",
        sector: "Cloud infrastructure",
        country: "US",
        state_region: "TX",
        city: "Austin",
        lat: 30.2672,
        lng: -97.7431,
        website: null,
        owner_id: U.exec,
        tier: "A",
        status: "partner",
        description: "OEM for cloud licences we resell; authorised reseller agreement in place.",
      },
    ],
    [
      "okeke",
      {
        name: "Okeke & Hart Consulting",
        type: "partner_subcontractor",
        sector: "Professional services",
        country: "NG",
        state_region: "Lagos",
        city: "Lagos",
        lat: 6.4541,
        lng: 3.3947,
        website: null,
        owner_id: U.admin,
        tier: "B",
        status: "partner",
        description: "Local delivery partner for West Africa engagements.",
      },
    ],
    [
      "ritter",
      {
        name: "Ritter Secure Networks",
        type: "oem_vendor",
        sector: "Network security",
        country: "DE",
        state_region: "Bavaria",
        city: "Munich",
        lat: 48.1351,
        lng: 11.582,
        website: null,
        owner_id: U.exec,
        tier: "C",
        status: "partner",
        description: "Firewall OEM; vetting refresh due.",
      },
    ],
  ];
  const acc: Record<string, string> = {};
  for (const [key, a] of accounts) {
    acc[key] = sid(`acct:${key}`);
    d.accounts.push({
      ...base(`acct:${key}`, -300),
      org_id: ORG_ID,
      logo_url: null,
      konnect_hub_client_id: null,
      survey_score: null,
      ...a,
    });
  }

  // ---------------- Contacts ----------------
  const contacts: Array<[string, string, string, string, string, Contact["role_in_buying"]]> = [
    ["gta", "Denise", "Walker", "Chief Technology Officer", "denise.walker@gta.example.gov", "decision_maker"],
    ["gta", "Robert", "Nguyen", "Procurement Officer", "robert.nguyen@gta.example.gov", "procurement_officer"],
    ["gta", "Keisha", "Adams", "Enterprise Architect", "keisha.adams@gta.example.gov", "technical_evaluator"],
    ["dor", "Thomas", "Greer", "Deputy Commissioner", "thomas.greer@dor.example.gov", "decision_maker"],
    ["dor", "Angela", "Price", "IT Program Manager", "angela.price@dor.example.gov", "champion"],
    ["gdot", "Michael", "Osei", "Director, Data & Analytics", "michael.osei@gdot.example.gov", "influencer"],
    ["atl", "Jasmine", "Carter", "Chief Information Officer", "jasmine.carter@atl.example.gov", "decision_maker"],
    ["atl", "Brian", "Holloway", "311 Program Lead", "brian.holloway@atl.example.gov", "champion"],
    ["fulton", "Patricia", "Monroe", "Court Administrator", "patricia.monroe@fulton.example.gov", "decision_maker"],
    ["savannah", "Gregory", "Ellis", "Utilities IT Manager", "gregory.ellis@savannah.example.gov", "influencer"],
    ["va", "Sandra", "Whitfield", "Contracting Officer", "sandra.whitfield@va.example.gov", "procurement_officer"],
    ["cdc", "Ravi", "Shah", "Branch Chief, Informatics", "ravi.shah@cdc.example.gov", "champion"],
    ["lagos", "Tunde", "Adebayo", "Permanent Secretary", "tunde.adebayo@lagos.example.ng", "decision_maker"],
    ["peachtree", "Hannah", "Brooks", "Chief Operating Officer", "hannah.brooks@peachtree.example.com", "decision_maker"],
    ["peachtree", "Victor", "Lane", "Director of Integration", "victor.lane@peachtree.example.com", "technical_evaluator"],
    ["magnolia", "Olivia", "Grant", "SVP Operations", "olivia.grant@magnolia.example.com", "decision_maker"],
    ["harbor", "Sam", "Porter", "IT Director", "sam.porter@harbor.example.com", "influencer"],
    ["northwind", "Elena", "Vasquez", "Channel Partner Manager", "elena.vasquez@northwind.example.com", "champion"],
    ["okeke", "Chidi", "Okeke", "Managing Partner", "chidi.okeke@okekehart.example.ng", "decision_maker"],
  ];
  const ct: Record<string, string> = {};
  for (const [a, first, last, title, email, role] of contacts) {
    const key = `contact:${first.toLowerCase()}.${last.toLowerCase()}`;
    ct[`${first} ${last}`] = sid(key);
    d.contacts.push({
      ...base(key, -280),
      org_id: ORG_ID,
      account_id: acc[a],
      first_name: first,
      last_name: last,
      title,
      email,
      phone: `+1 404 555 ${String(1000 + d.contacts.length * 37).slice(-4)}`,
      role_in_buying: role,
      owner_id: d.accounts.find((x) => x.id === acc[a])!.owner_id,
    });
  }

  // ---------------- Opportunities ----------------
  const stageProb = Object.fromEntries(DEFAULT_SETTINGS.stages.map((s) => [s.key, s.probability])) as Record<Stage, number>;
  type O = Partial<Opportunity> & Pick<Opportunity, "name" | "kind" | "stage" | "value" | "owner_id" | "source" | "service_lines">;
  const opps: Array<[string, string, O]> = [
    [
      "gta-ess",
      "gta",
      {
        name: "Enterprise Service Desk Modernisation",
        kind: "public_bid",
        stage: "proposal",
        value: 2_450_000,
        owner_id: U.bd1,
        source: "signal",
        service_lines: ["implementation", "systems_integration"],
        solicitation_no: "GTA-RFP-2026-0417",
        agency_buyer: "GTA Procurement",
        procurement_vehicle: "Team Georgia Marketplace",
        naics: "541512",
        set_aside: "None",
        questions_due: date(-6),
        proposal_due: date(9),
        submission_method: "Team Georgia Marketplace upload",
        incumbent: "Legacy MSP",
        next_step: "Pricing volume red-team",
        next_step_due: date(2),
        expected_close: date(60),
        pwin: 45,
      },
    ],
    [
      "gta-cloud",
      "gta",
      {
        name: "GTA Cloud Licence Renewal (Northwind)",
        kind: "reseller_quote",
        stage: "won",
        value: 380_000,
        owner_id: U.bd1,
        source: "partner",
        service_lines: ["reselling"],
        expected_close: date(-40),
        next_step: "Kick-off with delivery",
        procurement_vehicle: "state contract",
      },
    ],
    [
      "dor-mvs",
      "dor",
      {
        name: "Motor Vehicle System Integration",
        kind: "public_bid",
        stage: "bid_no_bid",
        value: 3_900_000,
        owner_id: U.bd1,
        source: "signal",
        service_lines: ["systems_integration", "implementation"],
        solicitation_no: "DOR-RFP-26-112",
        agency_buyer: "DOR Contracts Office",
        procurement_vehicle: "Team Georgia Marketplace",
        naics: "541512",
        set_aside: "None",
        questions_due: date(4),
        proposal_due: date(21),
        submission_method: "Sealed electronic",
        incumbent: "None (new build)",
        next_step: "Bid/No-Bid review with exec",
        next_step_due: date(1),
        expected_close: date(90),
        pwin: 30,
      },
    ],
    [
      "dor-tax",
      "dor",
      {
        name: "Taxpayer Portal Accessibility Remediation",
        kind: "public_bid",
        stage: "submitted",
        value: 640_000,
        owner_id: U.bd2,
        source: "signal",
        service_lines: ["implementation"],
        solicitation_no: "DOR-RFQ-26-077",
        procurement_vehicle: "Team Georgia Marketplace",
        naics: "541511",
        set_aside: "Small business",
        proposal_due: date(-5),
        expected_close: date(20),
        pwin: 55,
        next_step: "Await evaluation",
        next_step_due: date(10),
      },
    ],
    [
      "gdot-data",
      "gdot",
      {
        name: "Traffic Data Platform Pilot",
        kind: "public_bid",
        stage: "capture",
        value: 1_200_000,
        owner_id: U.bd2,
        source: "event",
        service_lines: ["systems_integration", "advisory"],
        solicitation_no: "GDOT-RFI-26-031",
        procurement_vehicle: "Team Georgia Marketplace",
        naics: "541519",
        questions_due: date(12),
        proposal_due: date(38),
        expected_close: date(120),
        pwin: 25,
        next_step: "Shape requirements with Michael Osei",
        next_step_due: date(5),
      },
    ],
    [
      "atl-311",
      "atl",
      {
        name: "311 Platform Phase 2",
        kind: "private_deal",
        stage: "won",
        value: 1_750_000,
        owner_id: U.bd2,
        source: "referral",
        service_lines: ["implementation", "systems_integration"],
        expected_close: date(-75),
        next_step: "Quarterly business review",
      },
    ],
    [
      "atl-permits",
      "atl",
      {
        name: "Permitting Portal Extension",
        kind: "private_deal",
        stage: "qualify",
        value: 520_000,
        owner_id: U.bd2,
        source: "inbound",
        service_lines: ["implementation"],
        expected_close: date(75),
        next_step: "Discovery workshop",
        next_step_due: date(6),
      },
    ],
    [
      "fulton-courts",
      "fulton",
      {
        name: "Courts Case Management Replacement",
        kind: "public_bid",
        stage: "qualify",
        value: 5_100_000,
        owner_id: U.bd1,
        source: "signal",
        service_lines: ["implementation", "systems_integration"],
        solicitation_no: "FC-26-RFP-0093",
        procurement_vehicle: "direct",
        naics: "541512",
        questions_due: date(15),
        proposal_due: date(45),
        expected_close: date(150),
        pwin: 20,
        next_step: "Teaming call with OEM",
        next_step_due: date(3),
      },
    ],
    [
      "sav-util",
      "savannah",
      {
        name: "Utility Billing Upgrade",
        kind: "public_bid",
        stage: "signal",
        value: 900_000,
        owner_id: U.bd2,
        source: "signal",
        service_lines: ["implementation"],
        expected_close: date(200),
        next_step: "Pull forecast from city budget",
        next_step_due: date(14),
      },
    ],
    [
      "va-sched",
      "va",
      {
        name: "VA Scheduling Integration (sub to prime)",
        kind: "public_bid",
        stage: "capture",
        value: 2_800_000,
        owner_id: U.bd1,
        source: "partner",
        service_lines: ["systems_integration", "staffing"],
        solicitation_no: "36C10B26Q0142",
        agency_buyer: "VA Technology Acquisition Center",
        procurement_vehicle: "SAM.gov",
        naics: "541512",
        set_aside: "SDVOSB",
        questions_due: date(7),
        proposal_due: date(26),
        submission_method: "Via prime",
        incumbent: "Unknown",
        expected_close: date(100),
        pwin: 30,
        next_step: "Teaming agreement redlines",
        next_step_due: date(4),
      },
    ],
    [
      "cdc-data",
      "cdc",
      {
        name: "Data Modernisation Staffing Recompete",
        kind: "staffing_placement",
        stage: "proposal",
        value: 1_350_000,
        owner_id: U.exec,
        source: "referral",
        service_lines: ["staffing"],
        solicitation_no: "75D301-26-R-71920",
        procurement_vehicle: "GSA schedule",
        naics: "541519",
        proposal_due: date(13),
        expected_close: date(55),
        pwin: 60,
        next_step: "Confirm 4 named resumes",
        next_step_due: date(3),
      },
    ],
    [
      "lagos-portal",
      "lagos",
      {
        name: "Lagos E-Services Portal",
        kind: "public_bid",
        stage: "capture",
        value: 2_200_000,
        owner_id: U.admin,
        source: "event",
        service_lines: ["implementation", "advisory"],
        procurement_vehicle: "direct",
        proposal_due: date(32),
        expected_close: date(140),
        pwin: 25,
        next_step: "Complete partner vetting for Okeke & Hart",
        next_step_due: date(7),
      },
    ],
    [
      "peach-ehr",
      "peachtree",
      {
        name: "EHR Integration Hub",
        kind: "private_deal",
        stage: "won",
        value: 980_000,
        owner_id: U.bd2,
        source: "referral",
        service_lines: ["systems_integration"],
        expected_close: date(-20),
        next_step: "Handoff to delivery",
      },
    ],
    [
      "peach-staff",
      "peachtree",
      {
        name: "Integration Engineers (3 FTE)",
        kind: "staffing_placement",
        stage: "proposal",
        value: 610_000,
        owner_id: U.bd2,
        source: "inbound",
        service_lines: ["staffing"],
        expected_close: date(25),
        next_step: "Send consultant profiles",
        next_step_due: date(1),
      },
    ],
    [
      "mag-core",
      "magnolia",
      {
        name: "Core Banking Integration",
        kind: "private_deal",
        stage: "capture",
        value: 1_050_000,
        owner_id: U.bd2,
        source: "event",
        service_lines: ["systems_integration", "staffing"],
        expected_close: date(80),
        next_step: "Architecture session",
        next_step_due: date(8),
      },
    ],
    [
      "mag-fw",
      "magnolia",
      {
        name: "Firewall Refresh (Ritter)",
        kind: "reseller_quote",
        stage: "proposal",
        value: 210_000,
        owner_id: U.bd2,
        source: "partner",
        service_lines: ["reselling"],
        expected_close: date(18),
        next_step: "Quote approval",
        next_step_due: date(2),
      },
    ],
    [
      "harbor-wms",
      "harbor",
      {
        name: "Warehouse Management Integration",
        kind: "private_deal",
        stage: "lost",
        value: 740_000,
        owner_id: U.bd1,
        source: "inbound",
        service_lines: ["systems_integration"],
        expected_close: date(-30),
        lost_reason: "Budget frozen; client paused programme",
      },
    ],
    [
      "gdot-asset",
      "gdot",
      {
        name: "Bridge Asset Inspection App",
        kind: "public_bid",
        stage: "no_bid",
        value: 450_000,
        owner_id: U.bd2,
        source: "signal",
        service_lines: ["implementation"],
        solicitation_no: "GDOT-RFP-26-018",
        procurement_vehicle: "Team Georgia Marketplace",
        proposal_due: date(-12),
        no_bid_reason: "Incumbent wired; requirements tailored to an existing product",
        expected_close: date(-12),
      },
    ],
    [
      "gta-renew",
      "gta",
      {
        name: "Service Desk Support Renewal FY27",
        kind: "private_deal",
        stage: "submitted",
        value: 420_000,
        owner_id: U.bd1,
        source: "referral",
        service_lines: ["implementation"],
        expected_close: date(30),
        next_step: "Client decision in Konnect Hub",
        next_step_due: date(12),
      },
    ],
  ];
  const op: Record<string, string> = {};
  for (const [key, a, o] of opps) {
    op[key] = sid(`opp:${key}`);
    d.opportunities.push({
      ...base(`opp:${key}`, -150 + d.opportunities.length * 5),
      org_id: ORG_ID,
      account_id: acc[a],
      currency: "USD",
      probability: stageProb[o.stage],
      pwin: null,
      expected_close: null,
      next_step: null,
      next_step_due: null,
      lost_reason: null,
      no_bid_reason: null,
      shared_with: [],
      parent_opportunity_id: null,
      solicitation_no: null,
      agency_buyer: null,
      procurement_vehicle: null,
      naics: null,
      set_aside: null,
      questions_due: null,
      proposal_due: null,
      submission_method: null,
      incumbent: null,
      ...o,
    });
  }
  // Priya is shared on the DOR bid as pricing lead
  d.opportunities.find((o) => o.id === op["dor-mvs"])!.shared_with = [U.bd2];
  d.opportunities.find((o) => o.id === op["gta-renew"])!.parent_opportunity_id = op["gta-cloud"];

  // ---------------- Bid decisions ----------------
  const bd = (
    key: string,
    oppKey: string,
    scores: number[],
    verdict: BidDecision["verdict"],
    status: BidDecision["status"],
    notes: string,
  ) => {
    const s = Object.fromEntries((Object.keys(DEFAULT_BID_WEIGHTS) as BidCriterion[]).map((c, i) => [c, scores[i]])) as Record<
      BidCriterion,
      number
    >;
    const total = Object.entries(DEFAULT_BID_WEIGHTS).reduce((sum, [c, w]) => sum + (s[c as BidCriterion] / 5) * w, 0);
    d.bid_decisions.push({
      ...base(key, -30),
      opportunity_id: op[oppKey],
      scores: s,
      weights: DEFAULT_BID_WEIGHTS,
      total_score: Math.round(total),
      verdict,
      notes,
      decided_by: d.opportunities.find((o) => o.id === op[oppKey])!.owner_id,
      status,
      approved_by: status === "approved" ? U.exec : null,
      approved_at: status === "approved" ? iso(-25) : null,
    });
  };
  bd("bid:gta-ess", "gta-ess", [5, 4, 3, 4, 4, 3, 3], "bid", "approved", "Strong relationship with CTO; incumbent weak on ITIL maturity.");
  bd("bid:cdc-data", "cdc-data", [4, 5, 4, 5, 3, 3, 4], "bid", "approved", "Recompete — strong CPARS. Need two more data engineers.");
  bd(
    "bid:dor-mvs",
    "dor-mvs",
    [4, 3, 3, 3, 2, 3, 2],
    "conditional",
    "pending_approval",
    "Bid only if we land a COTS partner and a named architect.",
  );
  bd("bid:gdot-asset", "gdot-asset", [2, 2, 1, 3, 3, 2, 2], "no_bid", "approved", "Requirements point to incumbent product.");

  // ---------------- Quotes ----------------
  const quote = (
    key: string,
    oppKey: string,
    number: string,
    title: string,
    status: Quote["status"],
    lines: Array<[string, number, number, number, string | null]>,
  ) => {
    const o = d.opportunities.find((x) => x.id === op[oppKey])!;
    d.quotes.push({
      ...base(key, -20),
      org_id: ORG_ID,
      opportunity_id: o.id,
      account_id: o.account_id,
      number,
      title,
      currency: "USD",
      status,
      valid_until: date(30),
      terms: "Net 30. Prices exclude applicable taxes. Valid for 30 days.",
      internal_notes: "OEM deal registration approved; extra 4% back-end rebate expected.",
      approved_by: status === "approved" || status === "sent" || status === "accepted" ? U.exec : null,
      approved_at: status === "draft" ? null : iso(-10),
      owner_id: o.owner_id,
    });
    lines.forEach(([item, qty, unit_cost, unit_price, partner], i) =>
      d.quote_lines.push({
        ...base(`${key}:line:${i}`, -20),
        quote_id: sid(key),
        position: i + 1,
        item,
        description: null,
        qty,
        unit_cost,
        unit_price,
        oem_partner_account_id: partner ? acc[partner] : null,
      }),
    );
  };
  quote("quote:mag-fw", "mag-fw", "Q-2026-0142", "Firewall refresh — 2 sites", "draft", [
    ["Ritter NGFW 3400 appliance", 4, 28_500, 33_900, "ritter"],
    ["Ritter threat-intel subscription (3 yr)", 4, 9_800, 11_400, "ritter"],
    ["Installation & configuration (days)", 12, 900, 1_450, null],
  ]);
  quote("quote:gta-cloud", "gta-cloud", "Q-2026-0098", "Northwind cloud licences FY26", "accepted", [
    ["Northwind Compute Enterprise (annual)", 250, 1_150, 1_380, "northwind"],
    ["Northwind Storage Tier 2 (TB/yr)", 120, 310, 395, "northwind"],
  ]);
  quote("quote:peach-staff", "peach-staff", "Q-2026-0151", "Integration engineers — 12 months", "pending_approval", [
    ["Senior Integration Engineer (hours)", 2_080, 88, 112, null],
    ["Integration Engineer (hours)", 4_160, 64, 78, null],
  ]);
  quote("quote:gta-renew", "gta-renew", "Q-2026-0160", "Service desk support FY27", "sent", [
    ["Tier-2 support (monthly)", 12, 22_000, 29_500, null],
    ["Quarterly optimisation review", 4, 4_000, 6_500, null],
  ]);

  // ---------------- Registrations ----------------
  const reg = (
    key: string,
    kind: Registration["kind"],
    name: string,
    identifier: string | null,
    issuer: string,
    expiresIn: number | null,
  ) =>
    d.registrations.push({
      ...base(key, -365),
      org_id: ORG_ID,
      kind,
      name,
      identifier,
      issuer,
      issued_on: date(-365),
      expires_on: expiresIn === null ? null : date(expiresIn),
      owner_id: U.admin,
      notes: null,
    });
  reg("reg:sam", "sam_uei", "SAM.gov entity registration", "KNX7Q4M2L9P1", "GSA / SAM.gov", 41);
  reg("reg:cage", "cage", "CAGE code", "9KX42", "DLA", 41);
  reg("reg:ga", "georgia_supplier", "Team Georgia Marketplace supplier", "GA-0004471182", "Georgia DOAS", 210);
  reg("reg:mbe", "certification", "MBE certification", "MBE-26-1187", "Georgia Minority Supplier Development Council", 12);
  reg("reg:gl", "insurance", "General liability insurance ($2M)", "GL-88213-26", "Peach State Mutual", 95);
  reg("reg:cyber", "insurance", "Cyber liability insurance ($5M)", "CY-55410-26", "Peach State Mutual", -3);
  reg("reg:iso", "certification", "ISO/IEC 27001", "ISMS-04421", "Accredited registrar", 300);

  // ---------------- Partner vetting ----------------
  const vet = (
    key: string,
    a: string,
    risk: PartnerVetting["risk_rating"],
    due: number,
    sanctions: PartnerVetting["sanctions_screen"],
    attested: boolean,
    notes: string,
  ) =>
    d.partner_vetting.push({
      ...base(key, -90),
      org_id: ORG_ID,
      account_id: acc[a],
      sanctions_screen: sanctions,
      pep_screen: sanctions === "pending" ? "pending" : "clear",
      beneficial_ownership: a === "okeke" ? "Chidi Okeke 60%, Amara Hart 40%" : "Publicly listed parent",
      anti_corruption_attested: attested,
      references_checked: attested,
      risk_rating: risk,
      review_due: date(due),
      reviewer_id: U.exec,
      notes,
    });
  vet("vet:northwind", "northwind", "low", 200, "clear", true, "Authorised reseller agreement on file.");
  vet("vet:okeke", "okeke", "medium", 6, "pending", false, "Awaiting signed anti-corruption attestation and two references.");
  vet("vet:ritter", "ritter", "medium", -10, "clear", true, "Export-control classification to re-confirm.");

  // ---------------- Consultants ----------------
  const cons: Array<[string, string, string[], string[], number, number, number | null, string, Consultant["status"], string | null]> = [
    [
      "Aisha Bello",
      "Solution Architect",
      ["Solution architecture", "Azure", "Integration", "ServiceNow"],
      ["TOGAF", "AZ-305"],
      95,
      185,
      0,
      "Atlanta, GA",
      "available",
      "Public Trust",
    ],
    [
      "James Whitaker",
      "Senior Integration Engineer",
      ["MuleSoft", "Java", "HL7 FHIR", "APIs"],
      ["MuleSoft Certified Developer"],
      88,
      150,
      21,
      "Macon, GA",
      "partial",
      null,
    ],
    [
      "Mei Chen",
      "Data Engineer",
      ["Python", "Databricks", "SQL", "Airflow"],
      ["Databricks DE Associate"],
      76,
      135,
      0,
      "Remote (GA)",
      "available",
      "Public Trust",
    ],
    [
      "Carlos Rivera",
      "Project Manager",
      ["PMP", "Agile", "Government delivery"],
      ["PMP", "SAFe SPC"],
      82,
      160,
      45,
      "Atlanta, GA",
      "allocated",
      "Secret",
    ],
    [
      "Ngozi Eze",
      "Business Analyst",
      ["Requirements", "Process mapping", "Accessibility"],
      ["CBAP"],
      60,
      115,
      0,
      "Lagos, NG",
      "available",
      null,
    ],
    [
      "Derek Owens",
      "ServiceNow Developer",
      ["ServiceNow", "ITSM", "JavaScript"],
      ["CSA", "CAD"],
      80,
      145,
      10,
      "Atlanta, GA",
      "partial",
      null,
    ],
    [
      "Fatima Al-Sayed",
      "Security Engineer",
      ["Network security", "Zero trust", "Ritter NGFW"],
      ["CISSP"],
      92,
      175,
      0,
      "Augusta, GA",
      "available",
      "Secret",
    ],
    ["Tom Becker", "Cloud Engineer", ["Northwind Cloud", "Terraform", "Kubernetes"], ["CKA"], 85, 155, 60, "Remote", "allocated", null],
    [
      "Grace Mensah",
      "QA Lead",
      ["Test automation", "Playwright", "Section 508"],
      ["ISTQB"],
      62,
      120,
      0,
      "Atlanta, GA",
      "available",
      "Public Trust",
    ],
    ["Ibrahim Yusuf", "Data Scientist", ["Python", "ML", "Public health data"], [], 78, 140, 30, "Remote", "partial", null],
    [
      "Rachel Stone",
      "Change Manager",
      ["Prosci ADKAR", "Training", "Communications"],
      ["Prosci"],
      70,
      130,
      0,
      "Savannah, GA",
      "available",
      null,
    ],
    ["Kwame Asante", "Integration Engineer", ["MuleSoft", "Boomi", "SQL"], [], 64, 118, 14, "Atlanta, GA", "partial", null],
  ];
  cons.forEach(([full_name, title, skills, certifications, cost, bill, availIn, location, status, clearance]) =>
    d.consultants.push({
      ...base(`cons:${full_name}`, -200),
      org_id: ORG_ID,
      full_name,
      title,
      email: `${full_name.split(" ")[0].toLowerCase()}@bench.konnectorllc.com`,
      skills,
      certifications,
      rate_cost: cost,
      rate_bill: bill,
      currency: "USD",
      availability_from: availIn === null ? null : date(availIn),
      location,
      clearance,
      resume_file_id: null,
      status,
    }),
  );

  // ---------------- Events ----------------
  const ev = (key: string, name: string, kind: BdEvent["kind"], start: number, location: string, budget: number) =>
    d.events.push({
      ...base(key, -60),
      org_id: ORG_ID,
      name,
      kind,
      starts_on: date(start),
      ends_on: date(start + 1),
      location,
      budget,
      currency: "USD",
      attendee_ids: [U.bd1, U.bd2],
      notes: null,
    });
  ev("event:gta-summit", "Georgia Digital Government Summit", "summit", -45, "Atlanta, GA", 6_500);
  ev("event:gdot-fair", "GDOT Small Business Procurement Fair", "procurement_fair", 18, "Forest Park, GA", 1_200);
  ev("event:lagos-expo", "West Africa GovTech Expo", "expo", 52, "Lagos, NG", 14_000);
  const lead = (eventKey: string, contactName: string, interest: string) =>
    d.event_leads.push({
      ...base(`lead:${eventKey}:${contactName}`, -44),
      event_id: sid(eventKey),
      contact_id: ct[contactName],
      interest,
      follow_up_task_id: null,
    });
  lead("event:gta-summit", "Michael Osei", "Traffic data platform");
  lead("event:gta-summit", "Olivia Grant", "Core banking integration");

  // ---------------- Handoffs & health (from Konnect Hub) ----------------
  const handoff = (oppKey: string, projectId: string) => {
    d.handoffs.push({
      ...base(`handoff:${oppKey}`, -60),
      opportunity_id: op[oppKey],
      status: "acknowledged",
      attempts: 1,
      last_error: null,
      konnect_hub_project_id: projectId,
      konnect_hub_url: `https://hub.konnectorllc.com/projects/${projectId}`,
      payload_version: "1",
      payload: {},
      next_attempt_at: null,
    });
  };
  handoff("atl-311", "khp_atl311");
  handoff("gta-cloud", "khp_gtacloud");
  d.accounts.find((a) => a.id === acc.atl)!.konnect_hub_client_id = "khc_atl";
  d.accounts.find((a) => a.id === acc.gta)!.konnect_hub_client_id = "khc_gta";
  const health = (
    key: string,
    projectId: string,
    oppKey: string,
    a: string,
    name: string,
    s: ProjectHealth["health_schedule"],
    b: ProjectHealth["health_budget"],
    ac: ProjectHealth["health_acceptance"],
    pct: number,
    end: number,
  ) =>
    d.project_health.push({
      ...base(key, -60),
      konnect_hub_project_id: projectId,
      opportunity_id: op[oppKey],
      account_id: acc[a],
      project_name: name,
      health_schedule: s,
      health_budget: b,
      health_acceptance: ac,
      percent_complete: pct,
      status: "in_progress",
      hub_updated_at: iso(-1, 13),
      end_date: date(end),
    });
  health("health:atl311", "khp_atl311", "atl-311", "atl", "311 Platform Phase 2", "green", "amber", "green", 62, 140);
  health("health:gtacloud", "khp_gtacloud", "gta-cloud", "gta", "GTA Cloud Licence Renewal", "green", "green", "green", 90, 35);
  // Peachtree EHR won but not yet handed off — shows the wizard.

  // ---------------- Client items ----------------
  d.client_items.push({
    ...base("ci:gta-renew", -4),
    org_id: ORG_ID,
    type: "renewal_offer",
    account_id: acc.gta,
    opportunity_id: op["gta-renew"],
    quote_id: sid("quote:gta-renew"),
    konnect_hub_client_id: "khc_gta",
    konnect_hub_project_id: "khp_gtacloud",
    title: "Service desk support renewal FY27",
    summary: "Twelve months of tier-2 support plus quarterly optimisation reviews.",
    amount: 380_000,
    currency: "USD",
    lines: [
      { item: "Tier-2 support (monthly)", description: null, qty: 12, unit_price: 29_500 },
      { item: "Quarterly optimisation review", description: null, qty: 4, unit_price: 6_500 },
    ],
    terms: "Net 30. Renewal term July 1 – June 30.",
    new_end_date: date(400),
    document_file_id: null,
    respond_by: date(12),
    version: 1,
    lineage_id: sid("ci:gta-renew"),
    status: "viewed",
    decided_by_name: null,
    decided_by_title: null,
    decided_by_email: null,
    decided_at: null,
    decision_ip: null,
    decision_note: null,
    survey_score: null,
    published_by: U.bd1,
    published_at: iso(-4),
    owner_id: U.bd1,
  });
  d.client_items.push({
    ...base("ci:atl-survey", -15),
    org_id: ORG_ID,
    type: "survey",
    account_id: acc.atl,
    opportunity_id: op["atl-311"],
    quote_id: null,
    konnect_hub_client_id: "khc_atl",
    konnect_hub_project_id: "khp_atl311",
    title: "Quarterly satisfaction survey — Q3",
    summary: "How likely are you to recommend Konnector?",
    amount: null,
    currency: "USD",
    lines: [],
    terms: null,
    new_end_date: null,
    document_file_id: null,
    respond_by: date(-2),
    version: 1,
    lineage_id: sid("ci:atl-survey"),
    status: "accepted",
    decided_by_name: "Jasmine Carter",
    decided_by_title: "Chief Information Officer",
    decided_by_email: "jasmine.carter@atl.example.gov",
    decided_at: iso(-6),
    decision_ip: "203.0.113.24",
    decision_note: "Great responsiveness; budget reporting could be clearer.",
    survey_score: 8,
    published_by: U.bd2,
    published_at: iso(-15),
    owner_id: U.bd2,
  });
  d.accounts.find((a) => a.id === acc.atl)!.survey_score = 8;

  // ---------------- Activities ----------------
  let n = 0;
  const act = (
    type: Activity["type"],
    subject: string,
    body: string | null,
    offset: number,
    rel: Activity["related_type"],
    relKey: string,
    relId: string,
    accountKey: string | null,
    actor: string | null,
    mentions: string[] = [],
  ) =>
    d.activities.push({
      ...base(`act:${n++}`, offset),
      org_id: ORG_ID,
      type,
      subject,
      body,
      occurred_at: iso(offset, 14 + (n % 5)),
      related_type: rel,
      related_id: relId,
      account_id: accountKey ? acc[accountKey] : null,
      actor_id: actor,
      mentions,
      reactions: {},
    });
  act(
    "meeting",
    "Capability briefing with GTA CTO",
    "Walked through ITSM modernisation case studies. Denise asked for a phased migration plan.",
    -40,
    "account",
    "gta",
    acc.gta,
    "gta",
    U.bd1,
  );
  act(
    "call",
    "Pre-RFP call with Robert Nguyen",
    "Confirmed Team Georgia Marketplace route and Q&A window.",
    -20,
    "opportunity",
    "gta-ess",
    op["gta-ess"],
    "gta",
    U.bd1,
  );
  act("stage_change", "Stage moved Capture → Bid / No-Bid", null, -18, "opportunity", "gta-ess", op["gta-ess"], "gta", U.bd1);
  act(
    "stage_change",
    "Stage moved Bid / No-Bid → Proposal",
    "Bid approved by Adaeze Okafor (score 75).",
    -15,
    "opportunity",
    "gta-ess",
    op["gta-ess"],
    "gta",
    U.exec,
  );
  act(
    "note",
    "Pricing strategy",
    "@Adaeze Okafor we should hold blended rate under $150 to stay competitive with the incumbent.",
    -3,
    "opportunity",
    "gta-ess",
    op["gta-ess"],
    "gta",
    U.bd1,
    [U.exec],
  );
  act(
    "email",
    "Sent questions to DOR contracts",
    "Submitted 6 clarification questions on data-migration scope.",
    -2,
    "opportunity",
    "dor-mvs",
    op["dor-mvs"],
    "dor",
    U.bd1,
  );
  act(
    "note",
    "Need a COTS partner",
    "@Priya Raman can you price the Northwind option for the MVS bid?",
    -1,
    "opportunity",
    "dor-mvs",
    op["dor-mvs"],
    "dor",
    U.bd1,
    [U.bd2],
  );
  act(
    "meeting",
    "Discovery: permitting backlog",
    "Jasmine shared backlog metrics; 40% of permits exceed SLA.",
    -9,
    "opportunity",
    "atl-permits",
    op["atl-permits"],
    "atl",
    U.bd2,
  );
  act(
    "handoff",
    "Handed off to Konnect Hub",
    "Project 311 Platform Phase 2 created (khp_atl311).",
    -60,
    "opportunity",
    "atl-311",
    op["atl-311"],
    "atl",
    U.delivery,
  );
  act(
    "system",
    "Health updated from Konnect Hub",
    "Budget moved to amber (change request pending).",
    -1,
    "account",
    "atl",
    acc.atl,
    "atl",
    null,
  );
  act(
    "call",
    "Intro with Hannah Brooks",
    "Peachtree wants three integration engineers by next month.",
    -12,
    "account",
    "peachtree",
    acc.peachtree,
    "peachtree",
    U.bd2,
  );
  act(
    "stage_change",
    "Stage moved Submitted → Won",
    "Signed MSA received.",
    -20,
    "opportunity",
    "peach-ehr",
    op["peach-ehr"],
    "peachtree",
    U.bd2,
  );
  act(
    "meeting",
    "Teaming call with VA prime",
    "Prime confirmed our scope: scheduling API integration + 4 FTE.",
    -6,
    "opportunity",
    "va-sched",
    op["va-sched"],
    "va",
    U.bd1,
  );
  act(
    "note",
    "Lagos partner status",
    "Okeke & Hart attestation outstanding — blocking proposal.",
    -4,
    "opportunity",
    "lagos-portal",
    op["lagos-portal"],
    "lagos",
    U.admin,
  );
  act(
    "email",
    "Recompete intel",
    "Ravi confirmed the recompete will be on GSA MAS; same evaluation criteria.",
    -14,
    "opportunity",
    "cdc-data",
    op["cdc-data"],
    "cdc",
    U.exec,
  );
  act(
    "meeting",
    "Met Michael Osei at summit",
    "Interested in traffic data platform; RFI coming.",
    -45,
    "contact",
    "gdot",
    ct["Michael Osei"],
    "gdot",
    U.bd2,
  );
  act(
    "call",
    "Check-in with Olivia Grant",
    "Core banking vendor shortlist down to two.",
    -7,
    "account",
    "magnolia",
    acc.magnolia,
    "magnolia",
    U.bd2,
  );
  act(
    "system",
    "Client viewed renewal offer",
    "Viewed in Konnect Hub portal by Denise Walker.",
    -2,
    "client_item",
    "ci:gta-renew",
    sid("ci:gta-renew"),
    "gta",
    null,
  );
  act(
    "system",
    "Survey submitted: 8/10",
    "Great responsiveness; budget reporting could be clearer.",
    -6,
    "account",
    "atl",
    acc.atl,
    "atl",
    null,
  );
  act(
    "note",
    "Firewall quote below margin floor?",
    "Install line is fine; appliance margin is thin. Needs exec approval.",
    -1,
    "quote",
    "quote:mag-fw",
    sid("quote:mag-fw"),
    "magnolia",
    U.bd2,
  );

  // ---------------- Tasks ----------------
  const task = (
    key: string,
    title: string,
    due: number,
    assignee: string,
    priority: Task["priority"],
    rel: Task["related_type"],
    relId: string | null,
    accountKey: string | null,
    status: Task["status"] = "open",
  ) =>
    d.tasks.push({
      ...base(key, -10),
      org_id: ORG_ID,
      title,
      due_at: iso(due, 17),
      assignee_id: assignee,
      priority,
      status,
      related_type: rel,
      related_id: relId,
      account_id: accountKey ? acc[accountKey] : null,
      notes: null,
    });
  task("task:1", "Send capability statement to Michael Osei", -1, U.bd2, "high", "contact", ct["Michael Osei"], "gdot");
  task("task:2", "Pricing volume red-team for GTA ESS", 2, U.bd1, "high", "opportunity", op["gta-ess"], "gta");
  task("task:3", "Book Bid/No-Bid review for DOR MVS", 1, U.bd1, "high", "opportunity", op["dor-mvs"], "dor");
  task("task:4", "Send consultant profiles to Peachtree", 1, U.bd2, "medium", "opportunity", op["peach-staff"], "peachtree");
  task("task:5", "Chase Okeke & Hart attestation", 3, U.admin, "high", "partner_vetting", sid("vet:okeke"), "okeke");
  task("task:6", "Renew cyber liability insurance", -3, U.admin, "high", "registration", sid("reg:cyber"), null);
  task("task:7", "Follow up with Olivia Grant after summit", -30, U.bd2, "medium", "contact", ct["Olivia Grant"], "magnolia", "done");
  task("task:8", "Confirm 4 named resumes for CDC recompete", 3, U.recruiter, "high", "opportunity", op["cdc-data"], "cdc");
  task("task:9", "Draft teaming agreement redlines (VA)", 4, U.bd1, "medium", "opportunity", op["va-sched"], "va");
  task("task:10", "Run handoff wizard for Peachtree EHR", 0, U.delivery, "high", "opportunity", op["peach-ehr"], "peachtree");

  // ---------------- Tags ----------------
  const tag = (key: string, name: string, color: string) => d.tags.push({ ...base(key, -300), org_id: ORG_ID, name, color } satisfies Tag);
  tag("tag:strategic", "Strategic", "#F5B841");
  tag("tag:recompete", "Recompete", "#21D4FD");
  tag("tag:teaming", "Teaming", "#7551FF");
  const rt = (tagKey: string, rel: RecordTag["related_type"], relId: string) =>
    d.record_tags.push({ ...base(`rt:${tagKey}:${relId}`, -100), tag_id: sid(tagKey), related_type: rel, related_id: relId });
  rt("tag:strategic", "account", acc.gta);
  rt("tag:strategic", "account", acc.va);
  rt("tag:recompete", "opportunity", op["cdc-data"]);
  rt("tag:teaming", "opportunity", op["va-sched"]);

  // ---------------- Saved views ----------------
  const view = (key: string, owner: string, entity: SavedView["entity"], name: string, query: Record<string, string>) =>
    d.saved_views.push({ ...base(key, -50), org_id: ORG_ID, owner_id: owner, entity, name, query, shared: true });
  view("view:gov", U.admin, "accounts", "Government accounts", { segment: "government" });
  view("view:clients", U.admin, "accounts", "Active clients", { status: "active_client" });
  view("view:bids", U.admin, "opportunities", "Open public bids", { kind: "public_bid", open: "true" });

  // ---------------- Notifications ----------------
  const notif = (key: string, user: string, kind: Notification["kind"], title: string, href: string | null, read: boolean) =>
    d.notifications.push({ ...base(key, -1), user_id: user, kind, title, body: null, href, read_at: read ? iso(-1) : null });
  notif(
    "n:1",
    U.exec,
    "mention",
    "Marcus Bell mentioned you on Enterprise Service Desk Modernisation",
    `/opportunities/${op["gta-ess"]}`,
    false,
  );
  notif(
    "n:2",
    U.exec,
    "approval",
    "Bid/No-Bid approval needed: Motor Vehicle System Integration",
    `/opportunities/${op["dor-mvs"]}`,
    false,
  );
  notif("n:3", U.bd2, "mention", "Marcus Bell mentioned you on Motor Vehicle System Integration", `/opportunities/${op["dor-mvs"]}`, false);
  notif("n:4", U.admin, "expiry", "Cyber liability insurance expired 3 days ago", "/registrations", false);
  notif("n:5", U.bd1, "client_decision", "GTA viewed the FY27 renewal offer", `/opportunities/${op["gta-renew"]}`, true);
  notif("n:6", U.exec, "approval", "Quote Q-2026-0151 needs margin approval", `/quotes/${sid("quote:peach-staff")}`, false);

  return d;
}

export function seedIds() {
  return {
    org: ORG_ID,
    users: SEED_USERS,
    account: (k: string) => sid(`acct:${k}`),
    opp: (k: string) => sid(`opp:${k}`),
    quote: (k: string) => sid(`quote:${k}`),
  };
}

export type { EventLead };
