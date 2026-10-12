// Vocabulary and record shapes used across the app. The first two lists come from the
// dropdowns in the FSI Relationship Tracker workbook so imported rows keep their values.

export const RELATIONSHIP_TYPES = [
  "Fellows",
  "Advisors",
  "Board",
  "AI Labs",
  "Media",
  "Policy/NatSec/Gov",
  "Congress",
  "Donors/Funders",
  "Research/Institutional Partners",
  "International Gov/Diplomatic",
] as const;

/**
 * Choices for a Relationship Type picker: the standard list, plus any other value already
 * in the workbook (for example the retired "Fellows/Advisors/Board"), so contacts that
 * still carry an old type can be found and moved.
 */
export function typeOptions(contacts: { relationshipType: string | null; otherTypes?: string | null }[]): string[] {
  const extra = new Set<string>();
  for (const c of contacts) {
    for (const t of contactTypes(c)) if (!(RELATIONSHIP_TYPES as readonly string[]).includes(t)) extra.add(t);
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

/**
 * How two contacts know each other, beyond working at the same place (the app already
 * groups people by organization on its own). Older rows may still say Personal, Referral
 * or Colleague; those keep showing as written.
 */
export const CONNECTION_KINDS = [
  "Introduced / connected",
  "Knows personally",
  "Worked together",
  "Former colleagues",
  "Met at an event",
  "Family",
  "Other",
] as const;

/** Maps the older connection words, as in the Outlook import file, onto the current list. */
export function normalizeConnectionKind(kind: string | null | undefined): string {
  const k = (kind ?? "").trim();
  const legacy: Record<string, string> = {
    referral: "Introduced / connected",
    introduced: "Introduced / connected",
    personal: "Knows personally",
    colleague: "Worked together",
  };
  if (!k) return "Other";
  return legacy[k.toLowerCase()] ?? (CONNECTION_KINDS as readonly string[]).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k;
}

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
  /** The office, department or committee within the organization ("Office / Department"). */
  office: string | null;
  relationshipType: string | null;
  /** More categories beyond the main one, separated by semicolons ("Other Types" column). */
  otherTypes: string | null;
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

/**
 * A row of the Duplicates tab: either someone flagged two contacts as the same person, or
 * someone decided a suggested pair are different people (so it stops being suggested).
 */
export interface DuplicateMark {
  id: number;
  contactA: number;
  contactB: number;
  status: "flagged" | "not duplicate";
  note: string | null;
  by: string | null;
}

export interface Connection {
  id: number;
  contactA: number;
  contactB: number;
  kind: string;
  note: string | null;
}

/** Every category a contact is in: the main Relationship Type first, then the others. */
export function contactTypes(c: { relationshipType: string | null; otherTypes?: string | null }): string[] {
  const out: string[] = [];
  for (const t of [c.relationshipType, ...(c.otherTypes ?? "").split(";")]) {
    const v = (t ?? "").trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
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
