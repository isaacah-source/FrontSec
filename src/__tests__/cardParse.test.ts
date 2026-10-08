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
