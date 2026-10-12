import { beforeEach, describe, expect, it } from "vitest";
import { MemorySheets, type Cell } from "../lib/sheets";
import { Repo } from "../lib/repo";
import { planImport } from "../lib/importFile";
import { contactTypes, normalizeConnectionKind } from "../../shared/constants";

const HEADER = [
  "Unique ID", "Name", "Organization", "Relationship Type", "Status", "Relationship Owner", "Email", "Phone", "Geo",
  "Interest Area", "International", "Restricted", "Referred By — Name", "Referred By — Role", "Date of Last Contact",
  "Next Follow-Up Date", "Date Added", "Added By", "Notes", "Tags / Category",
];
const row = (id: number, name: string, org: string | null, email: string | null = null): Cell[] =>
  [id, name, org, "Media", "Not yet engaged", "Ike", email, null, null, null, null, null, null, null, null, null, "2026-10-05", "Susan", null, null];
const CONN_HEADER = ["ID", "Contact A ID", "Contact A", "Contact B ID", "Contact B", "Connection", "Note", "Added By", "Added At"];

let io: MemorySheets;
let repo: Repo;

beforeEach(async () => {
  io = new MemorySheets({
    Master: [HEADER, row(1, "Ellen Nakashima", "Washington Post", "ellen@washpost.com"), row(2, "Jason Matheny", "RAND")],
  });
  repo = new Repo(io, { email: "ike@frontsec.org", name: "Ike Harris" });
  await repo.setup();
});

describe("planning an import", () => {
  it("reads the contacts tab, flags people already in the tracker, and links connections", async () => {
    const { contacts } = await repo.load();
    const file = [
      { sheet: "How to use", data: [["Read me"]] },
      {
        sheet: "New contacts",
        data: [
          [...HEADER, "Title"],
          [301, "Leah Siskind", "FDD", "Research/Institutional Partners", "Cultivating", "Ike Harris", "lsiskind@fdd.org", null, "DC", null, "N", null, null, null, new Date("2026-10-02"), null, "2026-10-08", "Ike Harris (email sweep)", "note", "FDD", "Director"],
          [302, "Ellen  Nakashima", "WaPo", "Media", null, null, "ELLEN@washpost.com"],
          [303, "Abbey Chaver", "Coefficient Giving", "Donors/Funders"],
        ],
      },
      {
        sheet: "Connections",
        data: [
          CONN_HEADER,
          [5001, 301, "Leah Siskind", 303, "Abbey Chaver", "Referral", "Abbey introduced Leah"],
          [5002, 2, "Jason Matheny", 301, "Leah Siskind", "Colleague", null],
          [5003, 302, "Ellen Nakashima", 301, "Leah Siskind", "Other", null],
          [5004, 999, "Nobody Known", 301, "Leah Siskind", "Other", null],
        ],
      },
    ];
    const plan = planImport(file, contacts);
    expect(plan.sheetName).toBe("New contacts");
    expect(plan.rows.map((r) => r.contact.name)).toEqual(["Leah Siskind", "Ellen Nakashima", "Abbey Chaver"]);
    expect(plan.rows[0].contact).toMatchObject({ title: "Director", lastContact: "2026-10-02", dateAdded: "2026-10-08", international: false });
    expect(plan.rows[1].duplicateOf).toMatchObject({ id: 1, why: "same email" });
    expect(plan.rows[0].duplicateOf).toBeNull();
    expect(plan.links).toEqual([
      { a: { fileId: 301, name: "Leah Siskind" }, b: { fileId: 303, name: "Abbey Chaver" }, kind: "Introduced / connected", note: "Abbey introduced Leah" },
      { a: { trackerId: 2, name: "Jason Matheny" }, b: { fileId: 301, name: "Leah Siskind" }, kind: "Worked together", note: null },
      // The duplicate row points at the person already in the tracker.
      { a: { trackerId: 1, name: "Ellen Nakashima" }, b: { fileId: 301, name: "Leah Siskind" }, kind: "Other", note: null },
    ]);
    expect(plan.unmatchedLinks).toBe(1);
  });

  it("explains a file without a contacts tab", () => {
    expect(() => planImport([{ sheet: "Sheet1", data: [["a", "b"]] }], [])).toThrow(/Name/);
  });
});

describe("weekly sweep news about existing contacts", () => {
  it("reads Updates and Touchpoints, matching by ID and name and skipping what is already current", async () => {
    const s = await repo.load();
    await repo.addTouchpoint(s.contacts[0], { date: "2026-10-01", type: "Email", summary: "Sent the draft" });
    const { contacts, interactions } = await repo.load();
    const plan = planImport([
      { sheet: "New contacts", data: [HEADER, [900001, "Abbey Chaver", "Coefficient Giving"]] },
      {
        sheet: "Updates",
        data: [
          ["Unique ID", "Name", "Field", "New value", "Source"],
          [2, "Jason Matheny", "Title", "President and CEO", "Signature, Oct 6 email"],
          [2, "Jason Matheny", "Office", "Office of the President", "Signature"],
          [1, "Ellen Nakashima", "Organization", "washington post", "already current, different case"],
          [1, "Someone Else", "Title", "Wrong person", "name does not match the ID"],
          [2, "Jason Matheny", "Unique ID", "77", "not an updatable field"],
        ],
      },
      {
        sheet: "Touchpoints",
        data: [
          ["Contact ID", "Contact", "Date", "Type", "Summary"],
          [1, "Ellen Nakashima", "2026-10-01", "Email", "Sent the draft"],
          [2, "Jason Matheny", new Date("2026-10-06"), "email", "Discussed the T&E framework"],
          [900001, "Abbey Chaver", "2026-10-07", "Meeting", "Grant call"],
          [5, "Nobody", "2026-10-07", "Email", "unknown contact"],
        ],
      },
    ], contacts, interactions);
    expect(plan.rows.map((r) => r.contact.name)).toEqual(["Abbey Chaver"]);
    expect(plan.updates.map((u) => [u.contact.id, u.field, u.value])).toEqual([[2, "title", "President and CEO"], [2, "office", "Office of the President"]]);
    expect(plan.touches.map((t) => [t.who, t.date, t.type, t.duplicate])).toEqual([
      [{ trackerId: 1, name: "Ellen Nakashima" }, "2026-10-01", "Email", true],
      [{ trackerId: 2, name: "Jason Matheny" }, "2026-10-06", "Email", false],
      [{ fileId: 900001, name: "Abbey Chaver" }, "2026-10-07", "Meeting", false],
    ]);
    expect(plan.skippedNews).toBe(4);
  });

  it("accepts a file with only Updates", () => {
    const plan = planImport([{ sheet: "Updates", data: [["Unique ID", "Name", "Field", "New value"]] }], []);
    expect(plan).toMatchObject({ sheetName: null, rows: [], updates: [], touches: [] });
  });
});

describe("saving an import", () => {
  it("adds contacts with fresh IDs below the last row and keeps their dates", async () => {
    const made = await repo.importContacts([
      { name: "Leah Siskind", organization: "FDD", dateAdded: "2026-10-08", addedBy: "Ike Harris (email sweep)" },
      { name: "Abbey Chaver", organization: "Coefficient Giving" },
    ]);
    expect(made.map((c) => c.id)).toEqual([3, 4]);
    const s = await repo.load();
    const leah = s.contacts.find((c) => c.name === "Leah Siskind")!;
    expect(leah).toMatchObject({ id: 3, dateAdded: "2026-10-08", addedBy: "Ike Harris (email sweep)", status: "Not yet engaged" });
    expect(s.contacts.find((c) => c.name === "Abbey Chaver")!.addedBy).toBe("Ike Harris");
  });

  it("re-adds a row someone else overwrote at the same moment", async () => {
    let raced = false;
    io.afterWrite = (sheet, r) => {
      if (sheet === "Master" && r === 5 && !raced) {
        raced = true;
        io.sheets.get("Master")![4] = [99, "Someone Else"];
      }
    };
    const made = await repo.importContacts([{ name: "A One" }, { name: "B Two" }]);
    io.afterWrite = undefined;
    const names = (await repo.load()).contacts.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["A One", "B Two", "Someone Else"]));
    expect(made.map((c) => c.name)).toEqual(["A One", "B Two"]);
  });

  it("adds connections in one go and skips pairs already linked the same way", async () => {
    const s = await repo.load();
    const [ellen, jason] = s.contacts;
    await repo.addConnection(ellen, jason, "Knows personally", null);
    const n = await repo.addConnections([
      { a: jason, b: ellen, kind: "Knows personally", note: null },
      { a: jason, b: ellen, kind: "Introduced / connected", note: "at Potomac" },
    ]);
    expect(n).toBe(1);
    expect((await repo.load()).connections.map((c) => c.kind)).toEqual(["Knows personally", "Introduced / connected"]);
  });
});

describe("categories and connection words", () => {
  it("lists the main type first, then the others, without repeats", () => {
    expect(contactTypes({ relationshipType: "Policy/NatSec/Gov", otherTypes: "Congress; policy/natsec/gov;Donors/Funders" }))
      .toEqual(["Policy/NatSec/Gov", "Congress", "Donors/Funders"]);
    expect(contactTypes({ relationshipType: null, otherTypes: null })).toEqual([]);
  });

  it("saves extra categories in their own column", async () => {
    await repo.updateContact(2, { otherTypes: "Congress; Advisors" });
    const jason = (await repo.load()).contacts.find((c) => c.id === 2)!;
    expect(contactTypes(jason)).toEqual(["Media", "Congress", "Advisors"]);
    expect(io.sheets.get("Master")![0]).toContain("Other Types");
  });

  it("maps older connection words onto the current list", () => {
    expect(normalizeConnectionKind("Referral")).toBe("Introduced / connected");
    expect(normalizeConnectionKind("colleague")).toBe("Worked together");
    expect(normalizeConnectionKind("Family")).toBe("Family");
    expect(normalizeConnectionKind("Board together")).toBe("Board together");
    expect(normalizeConnectionKind("")).toBe("Other");
  });
});
