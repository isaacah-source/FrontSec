import { cellDate, cellText, parseMaster, updatableField } from "./repo";
import type { Cell } from "./sheets";
import { INTERACTION_TYPES, normalizeConnectionKind, type Contact, type Interaction } from "../../shared/constants";

/**
 * Turns a spreadsheet of contacts into an import plan. The contacts tab uses the same
 * headers as Master (so a copy of Master, or the Outlook-sweep file, both work); an
 * optional Connections tab uses the tracker's Connections headers. Unique IDs in the file
 * only link its own rows together; the tracker gives every imported contact a new ID.
 *
 * Two more optional tabs carry news about people already in the tracker (the weekly email
 * sweep writes them):
 * - Updates: Unique ID, Name, Field (a Master heading), New value, Source.
 * - Touchpoints: Contact ID, Contact, Date, Type, Summary. The Contact ID may also be the
 *   file ID of a row on the contacts tab.
 */

export interface SheetIn {
  sheet: string;
  data: unknown[][];
}

export interface ImportRow {
  /** Unique ID in the file (or its row number when the file has none). */
  fileId: number;
  contact: Partial<Contact>;
  /** Someone already in the tracker (same email or same name), or earlier in the file. */
  duplicateOf: { id: number | null; name: string; why: string } | null;
}

export interface ImportLink {
  a: End;
  b: End;
  kind: string;
  note: string | null;
}
/** One side of a connection: a row being imported, or a contact already in the tracker. */
export type End = { fileId: number; name: string } | { trackerId: number; name: string };

export interface ImportUpdate {
  key: string;
  contact: Contact;
  field: keyof Contact;
  label: string;
  value: string | boolean | null;
  current: string | boolean | null;
  source: string | null;
}

export interface ImportTouch {
  key: string;
  who: End;
  date: string;
  type: string;
  summary: string;
  /** A touchpoint on the same day with the same summary is already logged. */
  duplicate: boolean;
}

export interface ImportPlan {
  sheetName: string | null;
  rows: ImportRow[];
  links: ImportLink[];
  /** Connections that name someone in neither the file nor the tracker. */
  unmatchedLinks: number;
  updates: ImportUpdate[];
  touches: ImportTouch[];
  /** Update or touchpoint rows whose contact could not be found, or whose value is already current. */
  skippedNews: number;
}

const key = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");

function toCells(data: unknown[][]): Cell[][] {
  return data.map((r) => r.map((v): Cell => {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    if (v === null || v === undefined) return null;
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);
  }));
}

function headerOf(s: SheetIn): string[] {
  return (s.data[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
}

function contactRows(sheet: SheetIn, existing: Contact[]): ImportRow[] {
  const byEmail = new Map(existing.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  const byName = new Map(existing.map((c) => [key(c.name), c]));
  const seenEmail = new Map<string, string>();
  const seenName = new Map<string, string>();
  // A row with an email but no name still comes in, named by its email, so nobody is
  // silently dropped; the name can be fixed afterwards.
  const cells = toCells(sheet.data);
  const h = headerOf(sheet);
  const nameAt = h.indexOf("name");
  const emailAt = h.indexOf("email");
  for (const r of cells.slice(1)) {
    if (!cellText(r[nameAt] ?? null) && emailAt >= 0 && cellText(r[emailAt] ?? null)) r[nameAt] = cellText(r[emailAt])!;
  }
  return parseMaster(cells).contacts.map(({ row: _row, id, updatedAt: _u, updatedBy: _b, ...c }) => {
    const email = c.email?.toLowerCase() ?? "";
    const name = key(c.name);
    let duplicateOf: ImportRow["duplicateOf"] = null;
    const hit = (email && byEmail.get(email)) || (name.length > 3 && byName.get(name));
    if (hit) duplicateOf = { id: hit.id, name: hit.name, why: email && byEmail.get(email) ? "same email" : "same name" };
    else if (email && seenEmail.has(email)) duplicateOf = { id: null, name: seenEmail.get(email)!, why: "same email earlier in this file" };
    else if (name.length > 3 && seenName.has(name)) duplicateOf = { id: null, name: seenName.get(name)!, why: "same name earlier in this file" };
    if (email) seenEmail.set(email, c.name);
    if (name) seenName.set(name, c.name);
    return { fileId: id, contact: c, duplicateOf };
  });
}

export function planImport(sheets: SheetIn[], existing: Contact[], logged: Interaction[] = []): ImportPlan {
  const looksLikeContacts = (s: SheetIn) => {
    const h = headerOf(s);
    return h.includes("name") && (h.includes("organization") || h.includes("email"));
  };
  const sheet = sheets.find((s) => s.sheet.toLowerCase() === "new contacts" && looksLikeContacts(s))
    ?? sheets.find((s) => s.sheet.toLowerCase() === "master" && looksLikeContacts(s))
    ?? sheets.find(looksLikeContacts);
  const updatesTab = sheets.find((s) => s.sheet.trim().toLowerCase() === "updates");
  const touchTab = sheets.find((s) => s.sheet.trim().toLowerCase() === "touchpoints");
  if (!sheet && !updatesTab && !touchTab) {
    throw new Error('No tab in this file has a "Name" column next to "Organization" or "Email". Use the Master tab layout.');
  }

  const byName = new Map(existing.map((c) => [key(c.name), c]));
  const byId = new Map(existing.map((c) => [c.id, c]));

  let rows: ImportRow[] = [];
  if (sheet) rows = contactRows(sheet, existing);
  const links: ImportLink[] = [];
  let unmatchedLinks = 0;
  const conn = sheets.find((s) => s !== sheet && headerOf(s).includes("contact a id") && headerOf(s).includes("contact b id"));
  if (conn) {
    const h = headerOf(conn);
    const at = (name: string) => h.indexOf(name);
    const fileRows = new Map(rows.map((r) => [r.fileId, r]));
    const end = (idCell: unknown, nameCell: unknown): End | null => {
      const id = Number(idCell);
      const name = cellText(nameCell as Cell) ?? "";
      const inFile = fileRows.get(id);
      // The file's own IDs win when the name agrees; a duplicate row points at the tracker copy.
      if (inFile && (!name || key(inFile.contact.name) === key(name))) {
        return inFile.duplicateOf?.id ? { trackerId: inFile.duplicateOf.id, name: inFile.duplicateOf.name } : { fileId: id, name: inFile.contact.name ?? name };
      }
      const t = byId.get(id);
      if (t && (!name || key(t.name) === key(name))) return { trackerId: t.id, name: t.name };
      const n = byName.get(key(name));
      return n ? { trackerId: n.id, name: n.name } : null;
    };
    for (const r of conn.data.slice(1)) {
      if (!r.some((v) => v !== null && v !== "")) continue;
      const a = end(r[at("contact a id")], r[at("contact a")]);
      const b = end(r[at("contact b id")], r[at("contact b")]);
      if (!a || !b) {
        unmatchedLinks++;
        continue;
      }
      links.push({
        a,
        b,
        kind: normalizeConnectionKind(cellText(r[at("connection")] as Cell)),
        note: at("note") >= 0 ? cellText(r[at("note")] as Cell) : null,
      });
    }
  }

  // News about people already in the tracker. The ID must point at the same name, so a
  // row cannot land on the wrong person if IDs shifted.
  let skippedNews = 0;
  const tracker = (idCell: unknown, nameCell: unknown): Contact | null => {
    const c = byId.get(Number(idCell));
    const name = cellText(nameCell as Cell);
    return c && (!name || key(c.name) === key(name)) ? c : null;
  };
  const updates: ImportUpdate[] = [];
  if (updatesTab) {
    const h = headerOf(updatesTab);
    const at = (n: string) => h.indexOf(n);
    updatesTab.data.slice(1).forEach((r, i) => {
      if (!r.some((v) => v !== null && v !== "")) return;
      const c = tracker(r[at("unique id")], r[at("name")]);
      const f = updatableField(String(r[at("field")] ?? ""));
      if (!c || !f) {
        skippedNews++;
        return;
      }
      const raw = r[at("new value")];
      const value = f.flag ? /^(y|yes|true|1)$/i.test(String(raw ?? "")) : f.date ? cellDate(toCells([[raw]])[0][0]) : cellText(toCells([[raw]])[0][0]);
      const current = c[f.field] as string | boolean | null;
      if (value === current || (typeof value === "string" && typeof current === "string" && value.toLowerCase() === current.toLowerCase())) {
        skippedNews++;
        return;
      }
      updates.push({ key: `u${i}`, contact: c, field: f.field, label: f.label, value, current, source: at("source") >= 0 ? cellText(r[at("source")] as Cell) : null });
    });
  }

  const touches: ImportTouch[] = [];
  if (touchTab) {
    const h = headerOf(touchTab);
    const at = (n: string) => h.indexOf(n);
    const fileRows = new Map(rows.map((r) => [r.fileId, r]));
    touchTab.data.slice(1).forEach((r, i) => {
      if (!r.some((v) => v !== null && v !== "")) return;
      const id = Number(r[at("contact id")]);
      const name = cellText(r[at("contact")] as Cell) ?? "";
      const date = cellDate(toCells([[r[at("date")]]])[0][0]);
      const summary = cellText(r[at("summary")] as Cell);
      const inFile = fileRows.get(id);
      const c = inFile ? null : tracker(id, name);
      if ((!inFile && !c) || !date || !summary) {
        skippedNews++;
        return;
      }
      const t = cellText(r[at("type")] as Cell) ?? "Email";
      const type = (INTERACTION_TYPES as readonly string[]).find((x) => x.toLowerCase() === t.toLowerCase()) ?? "Other";
      const who: End = inFile
        ? inFile.duplicateOf?.id ? { trackerId: inFile.duplicateOf.id, name: inFile.duplicateOf.name } : { fileId: id, name: inFile.contact.name ?? name }
        : { trackerId: c!.id, name: c!.name };
      const duplicate = "trackerId" in who && logged.some((x) => x.contactId === who.trackerId && x.date === date && x.summary.trim() === summary.trim());
      touches.push({ key: `t${i}`, who, date, type, summary, duplicate });
    });
  }

  return { sheetName: sheet?.sheet ?? null, rows, links, unmatchedLinks, updates, touches, skippedNews };
}
