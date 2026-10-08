import type { Cell, SheetIO } from "./sheets";
import { STATUSES, type Connection, type Contact, type Interaction, type Role, type User, ROLES } from "../../shared/constants";

/**
 * Reads and writes the relationship workbook. The Master tab keeps its original columns
 * A-T (the category tabs read them by position), and the app appends its own columns
 * after them. Three more tabs hold what the workbook had no place for: Touchpoints,
 * Connections, and App Users.
 *
 * Columns are found by header text, so people can still add columns in Excel. Rows are
 * found by Unique ID immediately before each write, so sorting or inserting rows in Excel
 * between a read and a write does not send the change to the wrong person.
 */

export const MASTER = "Master";
export const TOUCHPOINTS = "Touchpoints";
export const CONNECTIONS = "Connections";
export const USERS = "App Users";

type Field = keyof Contact;

/** Workbook header -> contact field. The first 20 are the workbook's own columns. */
const MASTER_COLUMNS: [string, Field][] = [
  ["Unique ID", "id"],
  ["Name", "name"],
  ["Organization", "organization"],
  ["Relationship Type", "relationshipType"],
  ["Status", "status"],
  ["Relationship Owner", "owner"],
  ["Email", "email"],
  ["Phone", "phone"],
  ["Geo", "geo"],
  ["Interest Area", "interestArea"],
  ["International", "international"],
  ["Restricted", "restricted"],
  ["Referred By — Name", "referredByName"],
  ["Referred By — Role", "referredByRole"],
  ["Date of Last Contact", "lastContact"],
  ["Next Follow-Up Date", "nextFollowUp"],
  ["Date Added", "dateAdded"],
  ["Added By", "addedBy"],
  ["Notes", "notes"],
  ["Tags / Category", "tags"],
  ["Title", "title"],
  ["LinkedIn", "linkedin"],
  ["Website", "website"],
  ["Address", "address"],
  ["Updated At", "updatedAt"],
  ["Updated By", "updatedBy"],
];
const SYNTHETIC_ID = 1_000_000;
const DATE_FIELDS = new Set<Field>(["lastContact", "nextFollowUp", "dateAdded"]);
const BOOL_FIELDS = new Set<Field>(["international", "restricted"]);

const TOUCHPOINT_HEADERS = ["ID", "Contact ID", "Contact", "Date", "Type", "Summary", "Logged By", "Logged By Email", "Logged At"];
const CONNECTION_HEADERS = ["ID", "Contact A ID", "Contact A", "Contact B ID", "Contact B", "Connection", "Note", "Added By", "Added At"];
const USER_HEADERS = ["Email", "Name", "Role", "Active"];

export class ConflictError extends Error {
  constructor(public current: Contact) {
    super("Someone else changed this contact while you were editing.");
  }
}

export class NotFoundError extends Error {}

export interface Me {
  email: string;
  name: string;
}

export interface Snapshot {
  contacts: Contact[];
  interactions: Interaction[];
  connections: Connection[];
  users: User[];
  /** False until an admin runs setup (the App Users tab does not exist yet). */
  initialized: boolean;
}

// ---- Cell conversion -----------------------------------------------------------------

const norm = (s: unknown) => String(s ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().replace(/ - /g, " — ");

export function cellText(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u00a0\u202f\u2007]/g, " ").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** Excel stores dates as days since 1899-12-30; text dates also occur in the sheet. */
export function cellDate(v: Cell): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400_000).toISOString().slice(0, 10);
  }
  const s = cellText(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Value to write for a text field. Excel treats text that starts with = + - @ as a formula
 * and turns digit strings into numbers (dropping leading zeros), so those get the
 * apostrophe prefix that means "this is text".
 */
export function toCell(v: string | null | undefined): Cell {
  if (v === null || v === undefined || v === "") return "";
  return /^[=+\-@]/.test(v) || /^\d[\d\s.,/-]*$/.test(v) ? `'${v}` : v;
}

const nowStamp = () => new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
const today = () => new Date().toISOString().slice(0, 10);

// ---- Repository ----------------------------------------------------------------------

export class Repo {
  constructor(private io: SheetIO, private me: Me) {}

  async load(): Promise<Snapshot> {
    const [master, touch, conn, users] = await Promise.all([
      this.io.read(MASTER),
      this.io.read(TOUCHPOINTS),
      this.io.read(CONNECTIONS),
      this.io.read(USERS),
    ]);
    if (!master) throw new NotFoundError('The workbook has no "Master" tab.');
    const contacts = parseMaster(master).contacts;
    const ids = new Set(contacts.map((c) => c.id));
    return {
      contacts: contacts.sort((a, b) => a.name.localeCompare(b.name)),
      interactions: parseTouchpoints(touch ?? []).filter((i) => ids.has(i.contactId)),
      connections: parseConnections(conn ?? []).filter((x) => ids.has(x.contactA) && ids.has(x.contactB)),
      users: parseUsers(users ?? []),
      initialized: users !== null,
    };
  }

  /** Creates the app's tabs and columns, and makes the person running it an admin. */
  async setup(): Promise<void> {
    const master = await this.io.read(MASTER);
    if (!master) throw new NotFoundError('The workbook has no "Master" tab.');
    await this.ensureMasterColumns(master);
    for (const [sheet, headers] of [[TOUCHPOINTS, TOUCHPOINT_HEADERS], [CONNECTIONS, CONNECTION_HEADERS], [USERS, USER_HEADERS]] as const) {
      const rows = await this.io.read(sheet);
      if (!rows) await this.io.addSheet(sheet);
      if (!rows?.length) await this.io.writeRow(sheet, 1, [...headers]);
    }
    const users = parseUsers((await this.io.read(USERS)) ?? []);
    if (!users.some((u) => u.email.toLowerCase() === this.me.email.toLowerCase())) {
      await this.appendRow(USERS, [this.me.email, this.me.name, "admin", "Y"]);
    }
  }

  /** Adds any of the app's columns that Master lacks, to the right of the last header. */
  private async ensureMasterColumns(master: Cell[][]): Promise<Map<Field, number>> {
    const header = master[0] ?? [];
    const { cols } = mapHeader(header);
    const missing = MASTER_COLUMNS.filter(([, f]) => !cols.has(f));
    if (missing.length) {
      let last = header.length;
      while (last > 0 && !cellText(header[last - 1])) last--;
      await this.io.writeCells(MASTER, 1, last + 1, missing.map(([h]) => h));
      missing.forEach(([, f], i) => cols.set(f, last + 1 + i));
    }
    return cols;
  }

  // ---- Contacts ----

  async createContact(data: Partial<Contact>): Promise<Contact> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const master = (await this.io.read(MASTER))!;
      const cols = await this.ensureMasterColumns(master);
      const { contacts } = parseMaster(master);
      const id = Math.max(0, ...contacts.map((c) => c.id)) + 1;
      // First row below the last one with a Name, so stray formatting further down is ignored.
      let row = master.length;
      const nameCol = cols.get("name")! - 1;
      while (row > 1 && !cellText(master[row - 1]?.[nameCol] ?? null)) row--;
      row += 1;
      const contact: Contact = {
        ...blankContact(),
        ...data,
        id,
        status: data.status ?? "Not yet engaged",
        dateAdded: today(),
        addedBy: this.me.name,
        updatedAt: nowStamp(),
        updatedBy: this.me.name,
      } as Contact;
      await this.io.writeRow(MASTER, row, buildRow(contact, cols, []));
      // Two people adding at the same moment can pick the same row. Whoever's row did
      // not survive tries again further down.
      const check = (await this.io.read(MASTER))!;
      const back = check[row - 1];
      if (back && Number(back[cols.get("id")! - 1]) === id && cellText(back[nameCol]) === cellText(contact.name)) return contact;
    }
    throw new Error("Could not add the contact because others were adding at the same time. Try again.");
  }

  /**
   * Applies `changes` to one contact. `expectedUpdatedAt` is the Updated At value the
   * person saw; if the row has changed since, nothing is written and ConflictError
   * carries the current version.
   */
  async updateContact(id: number, changes: Partial<Contact>, expectedUpdatedAt?: string | null): Promise<Contact> {
    const master = (await this.io.read(MASTER))!;
    const cols = await this.ensureMasterColumns(master);
    const found = parseMaster(master).contacts.find((c) => c.id === id);
    if (!found) throw new NotFoundError("That contact was deleted or its Unique ID changed.");
    if (expectedUpdatedAt !== undefined && (found.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) {
      throw new ConflictError(found);
    }
    const { row, ...current } = found;
    const next: Contact = { ...current, ...changes, id: current.id, updatedAt: nowStamp(), updatedBy: this.me.name };
    // A row that had no Unique ID gets a real one the first time it is saved.
    if (next.id >= SYNTHETIC_ID) {
      next.id = Math.max(0, ...parseMaster(master).contacts.map((c) => c.id).filter((n) => n < SYNTHETIC_ID)) + 1;
    }
    await this.io.writeRow(MASTER, row, buildRow(next, cols, master[row - 1]));
    return next;
  }

  async deleteContact(id: number): Promise<void> {
    const master = (await this.io.read(MASTER))!;
    const found = parseMaster(master).contacts.find((c) => c.id === id);
    if (!found) return;
    await this.io.deleteRow(MASTER, found.row);
    // Remove its touchpoints and connections, bottom row first so row numbers stay valid.
    for (const [sheet, matches] of [
      [TOUCHPOINTS, (r: Cell[]) => Number(r[1]) === id],
      [CONNECTIONS, (r: Cell[]) => Number(r[1]) === id || Number(r[3]) === id],
    ] as const) {
      const rows = (await this.io.read(sheet)) ?? [];
      for (let r = rows.length; r >= 2; r--) if (matches(rows[r - 1])) await this.io.deleteRow(sheet, r);
    }
  }

  // ---- Touchpoints ----

  async addTouchpoint(contact: Contact, t: { date: string; type: string; summary: string; nextFollowUp?: string | null }): Promise<Contact> {
    const rows = (await this.io.read(TOUCHPOINTS)) ?? [];
    const id = Math.max(0, ...rows.slice(1).map((r) => Number(r[0]) || 0)) + 1;
    await this.appendRow(TOUCHPOINTS, [id, contact.id, contact.name, t.date, t.type, toCell(t.summary), this.me.name, this.me.email, nowStamp()]);
    const changes: Partial<Contact> = {};
    if (!contact.lastContact || contact.lastContact < t.date) changes.lastContact = t.date;
    if (t.nextFollowUp !== undefined) changes.nextFollowUp = t.nextFollowUp;
    if (!contact.status || contact.status === "Not yet engaged") changes.status = "Cultivating";
    return this.updateContact(contact.id, changes);
  }

  async deleteTouchpoint(id: number): Promise<void> {
    await this.deleteWhere(TOUCHPOINTS, (r) => Number(r[0]) === id);
  }

  // ---- Connections ----

  async addConnection(a: Contact, b: Contact, kind: string, note: string | null): Promise<void> {
    const rows = (await this.io.read(CONNECTIONS)) ?? [];
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const exists = rows.slice(1).some((r) => Number(r[1]) === x.id && Number(r[3]) === y.id && cellText(r[5]) === kind);
    if (exists) throw new Error("Those two are already linked that way.");
    const id = Math.max(0, ...rows.slice(1).map((r) => Number(r[0]) || 0)) + 1;
    await this.appendRow(CONNECTIONS, [id, x.id, x.name, y.id, y.name, kind, toCell(note), this.me.name, nowStamp()]);
  }

  async deleteConnection(id: number): Promise<void> {
    await this.deleteWhere(CONNECTIONS, (r) => Number(r[0]) === id);
  }

  // ---- Users ----

  async saveUser(user: User): Promise<void> {
    const rows = (await this.io.read(USERS)) ?? [];
    const values: Cell[] = [user.email.trim(), user.name.trim(), user.role, user.active ? "Y" : "N"];
    const idx = rows.findIndex((r, i) => i > 0 && norm(r[0]) === norm(user.email));
    if (idx > 0) await this.io.writeRow(USERS, idx + 1, values);
    else await this.appendRow(USERS, values);
  }

  // ---- helpers ----

  private async appendRow(sheet: string, values: Cell[]) {
    const rows = (await this.io.read(sheet)) ?? [];
    await this.io.writeRow(sheet, Math.max(rows.length, 1) + 1, values);
  }

  private async deleteWhere(sheet: string, match: (r: Cell[]) => boolean) {
    const rows = (await this.io.read(sheet)) ?? [];
    const idx = rows.findIndex((r, i) => i > 0 && match(r));
    if (idx > 0) await this.io.deleteRow(sheet, idx + 1);
  }
}

// ---- Parsing ---------------------------------------------------------------------------

function mapHeader(header: Cell[]) {
  const byName = new Map(MASTER_COLUMNS.map(([h, f]) => [norm(h), f]));
  byName.set(norm("Tags"), "tags");
  byName.set(norm("Owner"), "owner");
  const cols = new Map<Field, number>();
  header.forEach((h, i) => {
    const f = byName.get(norm(h));
    if (f && !cols.has(f)) cols.set(f, i + 1);
  });
  return { cols };
}

function blankContact(): Omit<Contact, "id" | "name"> {
  return {
    title: null, organization: null, relationshipType: null, status: null, owner: null, email: null, phone: null,
    geo: null, interestArea: null, international: false, restricted: false, referredByName: null, referredByRole: null,
    lastContact: null, nextFollowUp: null, dateAdded: null, addedBy: null, notes: null, tags: null, linkedin: null,
    address: null, website: null, updatedAt: null, updatedBy: null,
  };
}

/** Match a sheet status to the app's list ignoring case ("Not Yet Engaged"). */
function normalizeStatus(v: string | null) {
  return v ? (STATUSES.find((s) => s.toLowerCase() === v.toLowerCase()) ?? v) : null;
}

export function parseMaster(rows: Cell[][]): { contacts: (Contact & { row: number })[] } {
  const { cols } = mapHeader(rows[0] ?? []);
  if (!cols.has("name")) throw new NotFoundError('The Master tab has no "Name" column.');
  const contacts: (Contact & { row: number })[] = [];
  const seen = new Set<number>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (f: Field) => (cols.has(f) ? row[cols.get(f)! - 1] ?? null : null);
    const name = cellText(get("name"));
    if (!name) continue;
    let id = Number(get("id"));
    // Rows without a usable Unique ID get one derived from their row so the app can still
    // show them; the first edit writes it into the sheet.
    if (!Number.isInteger(id) || id <= 0 || id >= SYNTHETIC_ID || seen.has(id)) id = SYNTHETIC_ID + r + 1;
    seen.add(id);
    const c = { ...blankContact(), id, name, row: r + 1 } as Contact & { row: number };
    for (const [, f] of MASTER_COLUMNS) {
      if (f === "id" || f === "name") continue;
      const v = get(f);
      if (DATE_FIELDS.has(f)) (c as unknown as Record<string, unknown>)[f] = cellDate(v);
      else if (BOOL_FIELDS.has(f)) (c as unknown as Record<string, unknown>)[f] = /^(y|yes|true|1)$/i.test(cellText(v) ?? "");
      else (c as unknown as Record<string, unknown>)[f] = cellText(v);
    }
    c.status = normalizeStatus(c.status);
    contacts.push(c);
  }
  return { contacts };
}

/** Lays a contact into a row, keeping values in columns the app does not know about. */
function buildRow(c: Contact, cols: Map<Field, number>, existing: Cell[]): Cell[] {
  const width = Math.max(existing.length, ...cols.values());
  const row: Cell[] = Array.from({ length: width }, (_, i) => existing[i] ?? "");
  for (const [f, col] of cols) {
    const v = c[f];
    if (f === "id") row[col - 1] = c.id;
    else if (BOOL_FIELDS.has(f)) row[col - 1] = v ? "Y" : existing[col - 1] ? "N" : "";
    else if (DATE_FIELDS.has(f)) row[col - 1] = (v as string | null) ?? "";
    else row[col - 1] = toCell(v as string | null);
  }
  return row;
}

function parseTouchpoints(rows: Cell[][]): Interaction[] {
  return rows.slice(1).filter((r) => Number(r[0]) > 0).map((r) => ({
    id: Number(r[0]),
    contactId: Number(r[1]),
    date: cellDate(r[3]) ?? "",
    type: cellText(r[4]) ?? "Other",
    summary: cellText(r[5]) ?? "",
    userName: cellText(r[6]),
    userEmail: cellText(r[7]),
    loggedAt: cellText(r[8]),
  }));
}

function parseConnections(rows: Cell[][]): Connection[] {
  return rows.slice(1).filter((r) => Number(r[0]) > 0).map((r) => ({
    id: Number(r[0]),
    contactA: Number(r[1]),
    contactB: Number(r[3]),
    kind: cellText(r[5]) ?? "Other",
    note: cellText(r[6]),
  }));
}

function parseUsers(rows: Cell[][]): User[] {
  return rows.slice(1).filter((r) => cellText(r[0])).map((r) => ({
    email: cellText(r[0])!,
    name: cellText(r[1]) ?? cellText(r[0])!,
    role: ((ROLES as readonly string[]).includes(norm(r[2])) ? norm(r[2]) : "viewer") as Role,
    active: !/^(n|no|false|0)$/i.test(cellText(r[3]) ?? ""),
  }));
}
