import { beforeEach, describe, expect, it } from "vitest";
import { MemorySheets, type Cell } from "../lib/sheets";
import { ConflictError, Repo, cellDate, toCell } from "../lib/repo";

const HEADER = [
  "Unique ID", "Name", "Organization", "Relationship Type", "Status", "Relationship Owner", "Email", "Phone", "Geo",
  "Interest Area", "International", "Restricted", "Referred By — Name", "Referred By — Role", "Date of Last Contact",
  "Next Follow-Up Date", "Date Added", "Added By", "Notes", "Tags / Category",
];
const row = (id: number, name: string, org: string | null, extra: Record<number, Cell> = {}) => {
  const r: Cell[] = [id, name, org, "Media", "Not Yet Engaged", "Ike", null, null, null, null, null, null, null, null, null, null, "2026-10-05", "Susan", null, null];
  for (const [i, v] of Object.entries(extra)) r[Number(i)] = v;
  return r;
};

let io: MemorySheets;
let repo: Repo;
const me = { email: "ike@frontsec.org", name: "Ike Harris" };

beforeEach(() => {
  io = new MemorySheets({
    Master: [HEADER, row(1, "Ellen Nakashima", "Washington Post", { 16: 46300 }), row(2, "Jason Matheny", "RAND")],
  });
  repo = new Repo(io, me);
});

describe("reading the workbook", () => {
  it("parses Master and reports that setup has not run", async () => {
    const s = await repo.load();
    expect(s.initialized).toBe(false);
    expect(s.contacts.map((c) => c.name)).toEqual(["Ellen Nakashima", "Jason Matheny"]);
    expect(s.contacts[0]).toMatchObject({ status: "Not yet engaged", owner: "Ike", dateAdded: cellDate(46300) });
  });

  it("converts Excel date serials", () => {
    expect(cellDate(46300)).toBe("2026-10-05");
    expect(cellDate("2026-10-05")).toBe("2026-10-05");
  });

  it("protects text Excel would treat as a formula or number", () => {
    expect(toCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(toCell("+1 202 555 0100")).toBe("'+1 202 555 0100");
    expect(toCell("0207 555")).toBe("'0207 555");
    expect(toCell("Hello")).toBe("Hello");
  });
});

describe("setup", () => {
  it("adds tabs, app columns after T, and the first admin, without touching A-T", async () => {
    await repo.setup();
    const master = io.sheets.get("Master")!;
    expect(master[0].slice(0, 20)).toEqual(HEADER);
    expect(master[0].slice(20)).toEqual(["Title", "LinkedIn", "Website", "Address", "Updated At", "Updated By"]);
    const s = await repo.load();
    expect(s.initialized).toBe(true);
    expect(s.users).toEqual([{ email: me.email, name: me.name, role: "admin", active: true }]);
    await repo.setup();
    expect((await repo.load()).users).toHaveLength(1);
  });
});

describe("writing", () => {
  beforeEach(() => repo.setup());

  it("adds a contact below the last named row with the next Unique ID", async () => {
    const c = await repo.createContact({ name: "New Person", organization: "Anthropic", phone: "+1 415 555 0101" });
    expect(c.id).toBe(3);
    const master = io.sheets.get("Master")!;
    expect(master[3].slice(0, 3)).toEqual([3, "New Person", "Anthropic"]);
    expect(master[3][7]).toBe("+1 415 555 0101");
  });

  it("retries when someone else takes the same row", async () => {
    let raced = false;
    // The other person's write to the same row lands just after ours and wins.
    io.afterWrite = (sheet, r) => {
      if (raced || sheet !== "Master") return;
      raced = true;
      io.sheets.get("Master")![r - 1] = row(3, "Someone Else", "X");
    };
    const c = await repo.createContact({ name: "Mine" });
    const names = (await repo.load()).contacts.map((x) => x.name);
    expect(names).toContain("Someone Else");
    expect(names).toContain("Mine");
    expect(c.id).toBe(4);
  });

  it("finds the row by ID even if rows moved, and keeps unknown columns", async () => {
    io.sheets.get("Master")![0][30] = "Custom";
    io.sheets.get("Master")![2][30] = "keep me";
    // Someone sorts the sheet in Excel: Jason moves above Ellen.
    const m = io.sheets.get("Master")!;
    [m[1], m[2]] = [m[2], m[1]];
    const before = (await repo.load()).contacts.find((c) => c.id === 2)!;
    const after = await repo.updateContact(2, { status: "Pledged" }, before.updatedAt);
    expect(after.status).toBe("Pledged");
    expect(m[1][4]).toBe("Pledged");
    expect(m[1][30]).toBe("keep me");
    expect(m[2][4]).toBe("Not Yet Engaged");
  });

  it("refuses a stale edit", async () => {
    const c = (await repo.load()).contacts[0];
    await repo.updateContact(c.id, { notes: "first" }, c.updatedAt);
    await expect(repo.updateContact(c.id, { notes: "second" }, c.updatedAt)).rejects.toBeInstanceOf(ConflictError);
  });

  it("logs a touchpoint and moves last contact and status", async () => {
    const c = (await repo.load()).contacts[0];
    const updated = await repo.addTouchpoint(c, { date: "2026-10-07", type: "Call", summary: "Intro", nextFollowUp: "2026-10-21" });
    expect(updated).toMatchObject({ lastContact: "2026-10-07", nextFollowUp: "2026-10-21", status: "Cultivating", updatedBy: "Ike Harris" });
    const s = await repo.load();
    expect(s.interactions).toMatchObject([{ contactId: c.id, summary: "Intro", userEmail: me.email }]);
  });

  it("links people once and deletes a contact with its rows", async () => {
    const [a, b] = (await repo.load()).contacts;
    await repo.addConnection(b, a, "Personal", "old friends");
    await expect(repo.addConnection(a, b, "Personal", null)).rejects.toThrow();
    await repo.addTouchpoint(a, { date: "2026-10-07", type: "Call", summary: "x" });
    await repo.deleteContact(a.id);
    const s = await repo.load();
    expect(s.contacts.map((c) => c.id)).toEqual([b.id]);
    expect(s.connections).toEqual([]);
    expect(io.sheets.get("Touchpoints")!.length).toBe(1);
  });

  it("adds and updates app users by email", async () => {
    await repo.saveUser({ email: "susan@frontsec.org", name: "Susan Malandrino", role: "editor", active: true });
    await repo.saveUser({ email: "SUSAN@frontsec.org", name: "Susan Malandrino", role: "contributor", active: true });
    const users = (await repo.load()).users;
    expect(users).toHaveLength(2);
    expect(users[1].role).toBe("contributor");
  });
});
