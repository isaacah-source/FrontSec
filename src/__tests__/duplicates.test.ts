import { beforeEach, describe, expect, it } from "vitest";
import { MemorySheets, type Cell } from "../lib/sheets";
import { ConflictError, Repo } from "../lib/repo";
import { findDuplicates, nameParts } from "../lib/duplicates";
import { buildGraph } from "../lib/networkGraph";
import type { Contact } from "../../shared/constants";

const HEADER = [
  "Unique ID", "Name", "Organization", "Relationship Type", "Status", "Relationship Owner", "Email", "Phone", "Geo",
  "Interest Area", "International", "Restricted", "Referred By — Name", "Referred By — Role", "Date of Last Contact",
  "Next Follow-Up Date", "Date Added", "Added By", "Notes", "Tags / Category",
];
const row = (id: number, name: string, org: string | null, email: string | null = null, phone: string | null = null, notes: string | null = null): Cell[] =>
  [id, name, org, "Media", "Cultivating", "Ike", email, phone, null, "AI", null, null, null, null, "2026-09-01", null, "2026-10-05", "Susan", notes, "press"];

let io: MemorySheets;
let repo: Repo;

beforeEach(async () => {
  io = new MemorySheets({
    Master: [
      HEADER,
      row(1, "Robert Smith", "RAND", "rsmith@rand.org", null, "Met at Curve"),
      row(2, "Bob Smith", "RAND Corporation", null, "(202) 555-0100", "Coffee in May"),
      row(3, "Ellen Nakashima", "Washington Post", "ellen@washpost.com"),
      row(4, "Ellen Nakashma", "WaPo", null),
      row(5, "Jason Matheny", "RAND", "jm@rand.org", "202.555.0100"),
      row(6, "Dr. Jane Q. Doe, PhD", "CSIS"),
      row(7, "J. Doe", "CSIS"),
      row(8, "John Doe", "Other Org"),
    ],
  });
  repo = new Repo(io, { email: "ike@frontsec.org", name: "Ike Harris" });
  await repo.setup();
});

const pairOf = (pairs: ReturnType<typeof findDuplicates>, a: number, b: number) =>
  pairs.find((p) => (p.a.id === a && p.b.id === b) || (p.a.id === b && p.b.id === a));

describe("finding duplicates", () => {
  it("strips titles, suffixes and middle names", () => {
    expect(nameParts("Dr. Jane Q. Doe, PhD")).toMatchObject({ first: "jane", last: "doe" });
    expect(nameParts("Marek N. Posard, Ph.D.")).toMatchObject({ first: "marek", last: "posard" });
  });

  it("matches nicknames, typos, initials and shared phones, and skips different people", async () => {
    const { contacts, duplicateMarks } = await repo.load();
    const pairs = findDuplicates(contacts, duplicateMarks);
    expect(pairOf(pairs, 1, 2)?.reasons).toContain("same name (nickname)");
    expect(pairOf(pairs, 3, 4)?.reasons).toContain("similar spelling");
    expect(pairOf(pairs, 6, 7)?.reasons).toContain("same last name and initial");
    expect(pairOf(pairs, 2, 5)?.reasons).toEqual(["same phone"]);
    expect(pairOf(pairs, 6, 8)).toBeUndefined(); // Jane Doe and John Doe
  });

  it("adds hand-flagged pairs and drops pairs marked as different people", async () => {
    let s = await repo.load();
    const byId = (id: number) => s.contacts.find((c) => c.id === id)!;
    await repo.markDuplicate(byId(3), byId(5), "flagged", "same person?");
    await repo.markDuplicate(byId(2), byId(1), "not duplicate");
    s = await repo.load();
    const pairs = findDuplicates(s.contacts, s.duplicateMarks);
    expect(pairOf(pairs, 3, 5)?.reasons).toEqual(["flagged by Ike Harris"]);
    expect(pairOf(pairs, 1, 2)).toBeUndefined();
    // Marking the same pair again updates its row instead of adding one.
    await repo.markDuplicate(byId(1), byId(2), "flagged");
    expect((await repo.load()).duplicateMarks.filter((m) => m.contactA === 1 && m.contactB === 2).map((m) => m.status)).toEqual(["flagged"]);
  });
});

describe("merging", () => {
  it("keeps the chosen values, moves touchpoints and connections, and removes the other row", async () => {
    let s = await repo.load();
    const c = (id: number) => s.contacts.find((x) => x.id === id)!;
    await repo.addTouchpoint(c(2), { date: "2026-09-10", type: "Call", summary: "Bob call" });
    s = await repo.load();
    await repo.addConnection(c(2), c(5), "Worked together", null);
    await repo.addConnection(c(1), c(5), "Worked together", null);
    await repo.addConnection(c(1), c(2), "Knows personally", null);
    await repo.markDuplicate(c(1), c(2), "flagged");
    s = await repo.load();

    const saved = await repo.mergeContacts(c(1), c(2), { phone: "(202) 555-0100", notes: "Met at Curve\n\nCoffee in May" });
    expect(saved).toMatchObject({ id: 1, name: "Robert Smith", email: "rsmith@rand.org", phone: "(202) 555-0100" });

    const after = await repo.load();
    expect(after.contacts.map((x) => x.id)).not.toContain(2);
    expect(after.interactions.map((i) => i.contactId)).toEqual([1]);
    // 2-5 became a repeat of 1-5 and 1-2 became a self-link; both are gone.
    expect(after.connections.map((x) => [x.contactA, x.contactB, x.kind])).toEqual([[1, 5, "Worked together"]]);
    expect(after.duplicateMarks).toEqual([]);
  });

  it("refuses when either contact changed after the merge screen opened", async () => {
    const s = await repo.load();
    const [a, b] = [s.contacts.find((x) => x.id === 3)!, s.contacts.find((x) => x.id === 4)!];
    await repo.updateContact(4, { title: "Reporter" });
    await expect(repo.mergeContacts(a, b, {})).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.load()).contacts.map((x) => x.id)).toContain(4);
  });

  it("saves the office in its own column", async () => {
    await repo.updateContact(5, { office: "Center on AI, Security, and Technology" });
    expect((await repo.load()).contacts.find((x) => x.id === 5)!.office).toBe("Center on AI, Security, and Technology");
    expect(io.sheets.get("Master")![0]).toContain("Office / Department");
  });
});

describe("network boxes", () => {
  const person = (id: number, organization: string | null, office: string | null = null): Contact =>
    ({ id, name: `P${id}`, organization, office, relationshipType: "Media", otherTypes: null, tags: null, interestArea: null, owner: null } as Contact);

  it("puts people in organization boxes, with office boxes inside", () => {
    const people = [person(1, "RAND", "CAST"), person(2, "RAND ", "CAST"), person(3, "rand"), person(4, "Solo Org"), person(5, null)];
    const { elements, hubs } = buildGraph(people, [{ id: 1, contactA: 4, contactB: 5, kind: "Other" }], new Set(["org", "personal"]), { singletons: false, isolated: false });
    const data = new Map(elements.map((e) => [e.data.id, e.data]));
    expect(data.get("org:rand")).toMatchObject({ kind: "org", label: "RAND" });
    expect(data.get("office:rand|cast")).toMatchObject({ kind: "office", parent: "org:rand" });
    expect(data.get("c:1")!.parent).toBe("office:rand|cast");
    expect(data.get("c:3")!.parent).toBe("org:rand");
    // A one-person organization gets no box; its person shows because of the personal link.
    expect(data.has("org:solo org")).toBe(false);
    expect(data.get("c:4")!.parent).toBeUndefined();
    expect(hubs.get("org:rand")!.map((c) => c.id)).toEqual([1, 2, 3]);
    // Boxes come before the people placed in them.
    expect(elements.findIndex((e) => e.data.id === "org:rand")).toBeLessThan(elements.findIndex((e) => e.data.id === "c:1"));
  });
});

describe("more than one email and phone", () => {
  it("reads and writes labeled lists", async () => {
    const { parseExtras, joinExtras, allEmails, allPhones } = await import("../../shared/constants");
    expect(parseExtras("Mobile: 202-555-0100; personal@x.org;  ")).toEqual([{ label: "Mobile", value: "202-555-0100" }, { label: "", value: "personal@x.org" }]);
    expect(joinExtras([{ label: "Work", value: " a@b.org " }, { label: "Other", value: "" }])).toBe("Work: a@b.org");
    expect(allEmails({ email: "A@b.org", otherEmails: "Personal: a@b.org; c@d.org" })).toEqual(["A@b.org", "c@d.org"]);
    expect(allPhones({ phone: "(202) 555-0100", otherPhones: "Office: 202.555.0100; Mobile: 202-555-0111" })).toEqual(["(202) 555-0100", "202-555-0111"]);
  });

  it("finds duplicates through any address or number, and saves the extra columns", async () => {
    await repo.updateContact(3, { otherEmails: "Personal: nakashima@gmail.com" });
    await repo.updateContact(8, { email: "nakashima@gmail.com", otherPhones: "Mobile: 202 555 0100" });
    const s = await repo.load();
    const pairs = findDuplicates(s.contacts, s.duplicateMarks);
    expect(pairOf(pairs, 3, 8)?.reasons).toContain("same email");
    expect(pairOf(pairs, 8, 2)?.reasons).toContain("same phone");
    expect(io.sheets.get("Master")![0]).toEqual(expect.arrayContaining(["Other Emails", "Other Phones"]));
    expect(s.contacts.find((c) => c.id === 3)!.otherEmails).toBe("Personal: nakashima@gmail.com");
  });
});
