// Vocabulary and record shapes used across the app. The first two lists come from the
// dropdowns in the FSI Relationship Tracker workbook so imported rows keep their values.

export const RELATIONSHIP_TYPES = [
  "Fellows",
  "Advisors",
  "Board",
  "AI Labs",
  "Media",
  "Policy/NatSec/Gov",
  "Donors/Funders",
  "Research/Institutional Partners",
  "International Gov/Diplomatic",
] as const;

/**
 * Choices for a Relationship Type picker: the standard list, plus any other value already
 * in the workbook (for example the retired "Fellows/Advisors/Board"), so contacts that
 * still carry an old type can be found and moved.
 */
export function typeOptions(contacts: { relationshipType: string | null }[]): string[] {
  const extra = new Set<string>();
  for (const c of contacts) {
    if (c.relationshipType && !(RELATIONSHIP_TYPES as readonly string[]).includes(c.relationshipType)) extra.add(c.relationshipType);
  }
  return [...RELATIONSHIP_TYPES, ...[...extra].sort()];
}

export const STATUSES = [
  "Not yet engaged",
  "Cultivating",
  "Pledged",
  "Active Partner",
  "Stalled",
  "Cold - needs decision",
] as const;

export const ROLES = ["admin", "editor", "contributor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything, including managing who has which role.",
  editor: "Add and edit any contact, assign owners, map connections.",
  contributor: "Add contacts and log touchpoints; edit only contacts they own; claim unassigned contacts.",
  viewer: "Read-only.",
};

export const INTERACTION_TYPES = ["Meeting", "Call", "Email", "Event", "Message", "Other"] as const;

export const CONNECTION_KINDS = ["Personal", "Referral", "Colleague", "Family", "Other"] as const;

/** A row of the "App Users" tab. */
export interface User {
  email: string;
  name: string;
  role: Role;
  active: boolean;
}

/** A row of the Master tab. `owner` holds the name typed in Relationship Owner. */
export interface Contact {
  id: number;
  name: string;
  title: string | null;
  organization: string | null;
  relationshipType: string | null;
  status: string | null;
  owner: string | null;
  email: string | null;
  phone: string | null;
  geo: string | null;
  interestArea: string | null;
  international: boolean;
  restricted: boolean;
  referredByName: string | null;
  referredByRole: string | null;
  lastContact: string | null;
  nextFollowUp: string | null;
  dateAdded: string | null;
  addedBy: string | null;
  notes: string | null;
  tags: string | null;
  linkedin: string | null;
  address: string | null;
  website: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface Interaction {
  id: number;
  contactId: number;
  date: string;
  type: string;
  summary: string;
  userName: string | null;
  userEmail: string | null;
  loggedAt: string | null;
}

export interface Connection {
  id: number;
  contactA: number;
  contactB: number;
  kind: string;
  note: string | null;
}

/** Split an Interest Area or Tags cell into individual issues. */
export function splitIssues(...values: (string | null | undefined)[]): string[] {
  const out = new Map<string, string>();
  for (const v of values) {
    if (!v) continue;
    for (const part of v.split(/[;,|]/)) {
      const t = part.replace(/\s+/g, " ").trim();
      if (t) out.set(t.toLowerCase(), out.get(t.toLowerCase()) ?? t);
    }
  }
  return [...out.values()];
}
