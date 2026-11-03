import { describe, expect, it } from "vitest";
import { trimQuoted, type MailMessage } from "../lib/mailFetch";
import { chunkThreads, findingsToSheets, mergeFindings, threadsToReview, type Findings } from "../lib/emailReview";
import { planImport } from "../lib/importFile";
import type { Contact } from "../../shared/constants";

const msg = (over: Partial<MailMessage>): MailMessage => ({
  id: Math.random().toString(36), conversationId: "c1", folder: "Inbox", date: "2026-10-28T15:00:00Z", subject: "Hello",
  from: "a@example.org", fromName: "A", to: ["iharris@frontsec.org"], cc: [], body: "Hi", ...over,
});

const contact = (id: number, name: string, email: string | null): Contact =>
  ({ id, name, email, otherEmails: null, phone: null, otherPhones: null, organization: "Org", title: null, office: null,
    address: null, lastContact: null, nextFollowUp: null, relationshipType: null, otherTypes: null } as unknown as Contact);

describe("reading email", () => {
  it("cuts quoted history from replies but keeps the signature", () => {
    const body = "Thanks, Tuesday works.\n\nJane Doe\nDirector, Example Institute\n(202) 555-0100\n\nOn Mon, Oct 26, 2026 at 9:00 AM Ike Harris <iharris@frontsec.org> wrote:\n> Does Tuesday work?";
    expect(trimQuoted(body)).toBe("Thanks, Tuesday works.\n\nJane Doe\nDirector, Example Institute\n(202) 555-0100");
    const outlook = "Sounds good.\n\nFrom: Ike Harris <iharris@frontsec.org>\nSent: Monday, October 26, 2026 9:00 AM\nTo: Jane\nSubject: Meeting";
    expect(trimQuoted(outlook)).toBe("Sounds good.");
  });

  it("keeps threads with outside people and drops internal, automated and vendor mail", () => {
    const threads = threadsToReview([
      msg({ conversationId: "real", from: "jane@example.org", subject: "Re: Meeting" }),
      msg({ conversationId: "real", folder: "Sent Items", from: "iharris@frontsec.org", to: ["jane@example.org"], date: "2026-10-27T10:00:00Z", subject: "Meeting" }),
      msg({ conversationId: "internal", from: "kwasenko@frontsec.org", to: ["iharris@frontsec.org", "dan@safe.ai"] }),
      msg({ conversationId: "robot", from: "no-reply@notifications.example.com" }),
      msg({ conversationId: "travel", from: "michael.ashendorf@frosch.com" }),
    ], "iharris@frontsec.org");
    expect(threads.map((t) => t.subject)).toEqual(["Re: Meeting"]);
    expect(threads[0].messages.map((m) => m.folder)).toEqual(["Sent Items", "Inbox"]);
  });

  it("splits large weeks into several requests", () => {
    const big = Array.from({ length: 5 }, (_, i) => ({ subject: `t${i}`, messages: [msg({ body: "x".repeat(30_000) })] }));
    expect(chunkThreads(big, 60_000).map((c) => c.length)).toEqual([1, 1, 1, 1, 1]);
    expect(chunkThreads(big.slice(0, 2), 100_000).length).toBe(1);
  });
});

describe("turning Claude's findings into rows to review", () => {
  const contacts = [contact(12, "Leah Siskind", "lsiskind@fdd.org"), contact(40, "Abbey Chaver", "abbey@coefficientgiving.org")];
  const blank = { other_emails: "", title: "", office: "", phone: "", address: "", website: "", linkedin: "", relationship_type: "Media",
    status: "Cultivating", geo: "", international: "N", interest_area: "", referred_by: "", next_follow_up: "", tags: "", owner: "", notes: "" };
  const findings: Findings = {
    new_contacts: [
      { ...blank, email: "Yoko@WSJ.com", name: "Yoko Kubota", organization: "The Wall Street Journal", last_contact: "2026-10-26", notes: "Asked for coffee." },
      { ...blank, email: "yoko@wsj.com", name: "Yoko Kubota", organization: "", phone: "(202) 555-0111", last_contact: "2026-10-29", notes: "Met Oct 29." },
    ],
    updates: [
      { tracker_id: 12, field: "Title", new_value: "Senior Fellow", source: "Signature" },
      { tracker_id: 12, field: "Title", new_value: "Senior Fellow, AI", source: "Later signature" },
      { tracker_id: 999, field: "Title", new_value: "Unknown person", source: "x" },
    ],
    touchpoints: [
      { tracker_id: 12, new_contact_email: "", date: "2026-10-30", type: "Email", summary: "Sent the ChinaCon agenda." },
      { tracker_id: 0, new_contact_email: "yoko@wsj.com", date: "2026-10-29", type: "Meeting", summary: "Coffee on national security reporting." },
    ],
    connections: [
      { a_tracker_id: 12, a_email: "", b_tracker_id: 0, b_email: "yoko@wsj.com", kind: "Introduced / connected", note: "Leah introduced Yoko" },
      { a_tracker_id: 0, a_email: "yoko@wsj.com", b_tracker_id: 12, b_email: "", kind: "Introduced / connected", note: "same link again" },
    ],
    skipped: [{ email: "dy@saxonholdings.com", reason: "Office-space marketing" }],
  };

  it("merges what several batches found and keeps one row per person and field", () => {
    const m = mergeFindings(findings);
    expect(m.new_contacts).toHaveLength(1);
    expect(m.new_contacts[0]).toMatchObject({ email: "yoko@wsj.com", organization: "The Wall Street Journal", phone: "(202) 555-0111",
      last_contact: "2026-10-29", notes: "Asked for coffee. Met Oct 29." });
    expect(m.updates.filter((u) => u.tracker_id === 12)).toEqual([{ tracker_id: 12, field: "Title", new_value: "Senior Fellow, AI", source: "Later signature" }]);
    expect(m.connections).toHaveLength(1);
  });

  it("produces tabs the Import page reads, linked to the right people", () => {
    const sheets = findingsToSheets(mergeFindings(findings), contacts, "2026-11-03", "Ike Harris");
    const plan = planImport(sheets, contacts, []);
    expect(plan.rows.map((r) => [r.contact.name, r.contact.email, r.contact.dateAdded, r.contact.relationshipType])).toEqual([
      ["Yoko Kubota", "yoko@wsj.com", "2026-11-03", "Media"],
    ]);
    expect(plan.rows[0].contact.notes).toMatch(/^\[Email review 2026-11-03\] /);
    expect(plan.updates.map((u) => [u.contact.id, u.field, u.value])).toEqual([[12, "title", "Senior Fellow, AI"]]);
    expect(plan.touches.map((t) => [t.who, t.type])).toEqual([
      [{ trackerId: 12, name: "Leah Siskind" }, "Email"],
      [{ fileId: 900001, name: "Yoko Kubota" }, "Meeting"],
    ]);
    expect(plan.links).toHaveLength(1);
    expect([plan.links[0].a, plan.links[0].b]).toEqual(expect.arrayContaining([
      { trackerId: 12, name: "Leah Siskind" }, { fileId: 900001, name: "Yoko Kubota" },
    ]));
  });
});
