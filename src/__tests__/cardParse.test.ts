import { describe, expect, it } from "vitest";
import { parseCardText } from "../../shared/cardParse.js";
import { splitIssues } from "../../shared/constants.js";

describe("parseCardText", () => {
  it("pulls fields from a typical card", () => {
    const card = parseCardText(`
      RAND Corporation
      Jane Q. Doe
      Senior Policy Researcher
      1200 South Hayes Street
      Arlington, VA 22202
      M: (703) 555-0142   O: 703.555.0100
      jdoe@rand.org
      www.rand.org
    `);
    expect(card.name).toBe("Jane Q. Doe");
    expect(card.title).toBe("Senior Policy Researcher");
    expect(card.organization).toBe("RAND Corporation");
    expect(card.email).toBe("jdoe@rand.org");
    expect(card.phone).toBe("(703) 555-0142");
    expect(card.website).toBe("www.rand.org");
    expect(card.geo).toBe("Arlington, VA");
  });

  it("tells a title from an organization that share a word", () => {
    const card = parseCardText(
      "Meridian Policy Institute\nDana R. Whitfield\nSenior Fellow, Technology Policy\n1775 Massachusetts Ave NW\nWashington, DC 20036\nM: (202) 555-0187\ndwhitfield@meridianpolicy.org",
    );
    expect(card.organization).toBe("Meridian Policy Institute");
    expect(card.title).toBe("Senior Fellow, Technology Policy");
    expect(card.geo).toBe("Washington, DC");
  });

  it("guesses the organization from a work email when the card has no org line", () => {
    const card = parseCardText("Sam Lee\nsam.lee@anthropic.com\n+1 415 555 0101");
    expect(card.name).toBe("Sam Lee");
    expect(card.organization).toBe("Anthropic");
  });
});

describe("splitIssues", () => {
  it("splits and de-duplicates across fields", () => {
    expect(splitIssues("AI Safety; National Security", "national security, Data Centers ")).toEqual([
      "AI Safety", "National Security", "Data Centers",
    ]);
  });
});

// Made-up cards as Google Lens or Live Text hand them over: one line per printed line, the
// left column before the right, logo lettering included.
const LENS_TWO_COLUMN = [
  "MERIDIAN",
  "Dana Whitfield",
  "Senior Researcher",
  "Meridian Policy Institute",
  "1775 Massachusetts Ave NW",
  "Suite 400",
  "Washington, DC 20036",
  "dwhitfield@meridianpolicy.org",
  "(202) 555-0187",
  "www.meridianpolicy.org",
].join("\n");

describe("pasted text from a phone's reader", () => {
  it("sorts a two-column card", () => {
    expect(parseCardText(LENS_TWO_COLUMN)).toMatchObject({
      name: "Dana Whitfield",
      title: "Senior Researcher",
      organization: "Meridian Policy Institute",
      email: "dwhitfield@meridianpolicy.org",
      phone: "(202) 555-0187",
      website: "www.meridianpolicy.org",
      address: "1775 Massachusetts Ave NW, Suite 400, Washington, DC 20036",
      geo: "Washington, DC",
    });
  });

  it("handles an all-capitals government card read cleanly", () => {
    const card = parseCardText([
      "COMMITTEE ON THE BUDGET",
      "MAJORITY STAFF",
      "ANN RICCI CALDER",
      "PROFESSIONAL STAFF",
      "TRADE SUBCOMMITTEE",
      "U.S. HOUSE OF REPRESENTATIVES",
      "H-100, U.S. CAPITOL",
      "WASHINGTON, DC 20515",
      "(202) 225-0000 (MAIN)",
      "ANN.RICCICALDER@MAIL.HOUSE.GOV",
    ].join("\n"));
    expect(card).toMatchObject({
      name: "Ann Ricci Calder",
      title: "Professional Staff",
      organization: "U.S. House of Representatives",
      email: "ann.riccicalder@mail.house.gov",
      phone: "(202) 225-0000",
      address: "H-100, U.S. Capitol, Washington, DC 20515",
    });
  });

  it("does not take logo lettering as a name even without an email", () => {
    expect(parseCardText("CIN Fes\nURC INS So\nDana Whitfield\nSenior Researcher").name).toBe("Dana Whitfield");
  });

  it("matches an acronym domain to the organization", () => {
    const card = parseCardText("Sam Lee\nFoundation for Defense of Democracies\nslee@fdd.org");
    expect(card.organization).toBe("Foundation for Defense of Democracies");
  });

  it("returns nothing useful for text that is not a card", () => {
    const card = parseCardText("hello");
    expect([card.name, card.email, card.phone]).toEqual(["", "", ""]);
  });
});

// A made-up congressional card in small capitals, with the misreads that typeface causes:
// C read as G ("GALDER", "SUBGOMMITTEE", "DG"), odd capitals, and an email split by spaces
// whose digits stand in for letters. The name and email each get a different letter wrong.
const SMALL_CAPS_CARD = [
  "SFT",
  "GOMMITTEE ON THE BUDGET",
  "MAJORITY STAFF",
  "Ann Ricci GALDER",
  "PROFESSIONAL STAFF",
  "TRADE SUBGOMMITTEE",
  "U.S. HOUSE OF REPRESENTATIVES",
  "(202) 225-0000 (MAIN)",
  "H-100, U.S.",
  "ANN. R1GC1CALDER@MAIL HOUSE.GOV",
  "WASHINGTON, DG 20515",
].join("\n");

describe("reading a small-caps congressional card", () => {
  it("finds the person, not the subcommittee, and repairs misread letters", () => {
    expect(parseCardText(SMALL_CAPS_CARD)).toMatchObject({
      name: "Ann Ricci Calder",
      title: "Professional Staff",
      organization: "U.S. House of Representatives",
      email: "ann.riccicalder@mail.house.gov",
      phone: "(202) 225-0000",
      address: "H-100, U.S., Washington, DC 20515",
      geo: "Washington, DC",
    });
  });

  it("keeps committee lines readable in the notes", () => {
    expect(parseCardText(SMALL_CAPS_CARD).other).toContain("TRADE SUBCOMMITTEE");
  });
});
