import type { ElementDefinition } from "cytoscape";
import { splitIssues, type Contact } from "../../shared/constants";

export const TYPE_COLORS: Record<string, string> = {
  Fellows: "#2f6fdf",
  Advisors: "#5b8def",
  Board: "#1c3f8f",
  "AI Labs": "#8a4fd6",
  Media: "#e0782d",
  "Policy/NatSec/Gov": "#1f9d6b",
  Congress: "#6b8e23",
  "Donors/Funders": "#c9a227",
  "Research/Institutional Partners": "#d1497b",
  "International Gov/Diplomatic": "#1aa6b7",
};
export const OTHER = "#8a94a6";

export type Layer = "org" | "issue" | "owner" | "personal";

const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Builds the network drawing.
 *
 * Organizations are boxes that hold their people, with a nested box per office or
 * department, so each organization's people sit together and boxes do not overlap. Issues
 * and staff owners are hub nodes joined to their people by lines, and personal connections
 * are lines between two people. Groups with one person add nothing, so they are left out
 * unless `singletons` is on (owners always show).
 *
 * `hubs` lists the people behind every box and hub, for the side panel.
 */
export function buildGraph(
  contacts: Contact[],
  connections: { id: number; contactA: number; contactB: number; kind: string }[],
  layers: Set<Layer>,
  opts: { singletons: boolean; isolated: boolean },
): { elements: ElementDefinition[]; hubs: Map<string, Contact[]> } {
  const minMembers = opts.singletons ? 1 : 2;
  const hubs = new Map<string, Contact[]>();
  const label = new Map<string, string>();
  const add = (id: string, text: string, c: Contact) => {
    hubs.set(id, [...(hubs.get(id) ?? []), c]);
    if (!label.has(id)) label.set(id, text);
  };

  // Organization and office boxes.
  const parentOf = new Map<number, string>();
  const boxes: ElementDefinition[] = [];
  if (layers.has("org")) {
    const orgs = new Map<string, Contact[]>();
    for (const c of contacts) {
      if (!c.organization?.trim()) continue;
      const id = `org:${key(c.organization)}`;
      orgs.set(id, [...(orgs.get(id) ?? []), c]);
      if (!label.has(id)) label.set(id, c.organization.trim());
    }
    for (const [orgId, members] of orgs) {
      if (members.length < minMembers) continue;
      hubs.set(orgId, members);
      boxes.push({ data: { id: orgId, label: label.get(orgId), kind: "org" } });
      const offices = new Map<string, Contact[]>();
      for (const c of members) {
        if (!c.office?.trim()) continue;
        const id = `office:${orgId.slice(4)}|${key(c.office)}`;
        offices.set(id, [...(offices.get(id) ?? []), c]);
        if (!label.has(id)) label.set(id, c.office.trim());
      }
      for (const m of members) parentOf.set(m.id, orgId);
      for (const [officeId, people] of offices) {
        if (people.length < minMembers) continue;
        hubs.set(officeId, people);
        boxes.push({ data: { id: officeId, label: label.get(officeId), kind: "office", parent: orgId } });
        for (const p of people) parentOf.set(p.id, officeId);
      }
    }
  }

  // Issue and owner hubs.
  for (const c of contacts) {
    if (layers.has("issue")) for (const i of splitIssues(c.tags, c.interestArea)) add(`issue:${key(i)}`, i, c);
    if (layers.has("owner") && c.owner) add(`owner:${key(c.owner)}`, c.owner, c);
  }
  const keptHubs = [...hubs.entries()].filter(([id, m]) => id.startsWith("owner:") || (id.startsWith("issue:") && m.length >= minMembers));

  const ids = new Set(contacts.map((c) => c.id));
  const personal = layers.has("personal") ? connections.filter((x) => ids.has(x.contactA) && ids.has(x.contactB)) : [];

  const linked = new Set<number>(parentOf.keys());
  for (const [, m] of keptHubs) for (const c of m) linked.add(c.id);
  for (const x of personal) {
    linked.add(x.contactA);
    linked.add(x.contactB);
  }

  // Parents first, so every box exists before the people placed in it.
  const elements: ElementDefinition[] = [...boxes];
  for (const c of contacts) {
    if (!opts.isolated && !linked.has(c.id)) continue;
    elements.push({
      data: { id: `c:${c.id}`, label: c.name, kind: "contact", color: TYPE_COLORS[c.relationshipType ?? ""] ?? OTHER, parent: parentOf.get(c.id) },
    });
  }
  for (const [id, members] of keptHubs) {
    const kind = id.split(":")[0];
    elements.push({ data: { id, label: label.get(id), kind, size: 18 + Math.min(members.length, 30) * 1.4 } });
    for (const c of members) elements.push({ data: { id: `${id}->${c.id}`, source: id, target: `c:${c.id}`, kind } });
  }
  for (const x of personal) {
    elements.push({ data: { id: `p:${x.id}`, source: `c:${x.contactA}`, target: `c:${x.contactB}`, kind: "personal", label: x.kind } });
  }
  return { elements, hubs };
}
