import { MemorySheets, type Cell } from "./sheets";

/**
 * Sample workbook for demo mode (?demo). If public/demo-seed.json exists (a {Master: rows}
 * object), it is used instead, which lets you preview real data locally without Microsoft.
 */
const HEADER = [
  "Unique ID", "Name", "Organization", "Relationship Type", "Status", "Relationship Owner", "Email", "Phone", "Geo",
  "Interest Area", "International", "Restricted", "Referred By — Name", "Referred By — Role", "Date of Last Contact",
  "Next Follow-Up Date", "Date Added", "Added By", "Notes", "Tags / Category",
];

const SAMPLE: [string, string, string, string, string | null, string][] = [
  ["Dana Whitfield", "Meridian Policy Institute", "Research/Institutional Partners", "Cultivating", "Demo User", "AI Safety; National Security"],
  ["Ravi Patel", "Meridian Policy Institute", "Research/Institutional Partners", "Not yet engaged", null, "Compute Governance"],
  ["Alex Moreno", "Northwind AI", "AI Labs", "Active Partner", "Demo User", "AI Safety"],
  ["Jordan Lee", "Northwind AI", "AI Labs", "Cultivating", "Sam Ortiz", "Compute Governance"],
  ["Priya Shah", "The Daily Ledger", "Media", "Not yet engaged", "Sam Ortiz", "National Security"],
  ["Chris Novak", "Senate Commerce Committee", "Policy/NatSec/Gov", "Pledged", "Demo User", "Export Controls; National Security"],
  ["Morgan Diaz", "Halcyon Foundation", "Donors/Funders", "Cultivating", null, "Fundraising"],
];

export async function demoSheets(): Promise<MemorySheets> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}demo-seed.json`, { cache: "no-store" });
    if (res.ok) return new MemorySheets(await res.json());
  } catch {
    // Missing, or not JSON (a static host's index.html fallback): use the built-in sample.
  }
  const rows: Cell[][] = [HEADER];
  SAMPLE.forEach(([name, org, type, status, owner, issues], i) => {
    rows.push([i + 1, name, org, type, status, owner, `${name.split(" ")[0].toLowerCase()}@example.org`, null, "Washington, D.C.",
      issues, "N", "N", null, null, null, null, "2026-10-05", "Demo", null, null]);
  });
  return new MemorySheets({ Master: rows, "App Users": [["Email", "Name", "Role", "Active"], ["demo@example.org", "Demo User", "admin", "Y"]] });
}
