import { describe, expect, it } from "vitest";
import { cleanOcrLines, parseCardText } from "../../shared/cardParse.js";
import { findCardBox } from "../../shared/cardImage.js";
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

// A made-up card laid out like a real one that failed: a round seal on the left whose
// lettering reads as scraps ("CIN", "Lcy S"), the person's details on the right, and a second
// column (address) that the reader merges with the email, phone, and website.
const w = (text: string, confidence: number, x0: number, x1: number, y = 0) => ({
  text, confidence, bbox: { x0, y0: y, x1, y1: y + 30 },
});
const SEAL_CARD = [
  { words: [w("CIN", 71, 190, 260)] },
  { words: [w("o>", 16, 120, 150), w("Dana", 95, 700, 800), w("Whitfield", 96, 815, 1000)] },
  { words: [w("hy", 26, 100, 130), w("e)", 12, 140, 160), w("Senior", 95, 640, 760), w("Researcher", 96, 770, 1000)] },
  { words: [w("=", 69, 100, 110), w("Meridian", 96, 560, 720), w("Policy", 96, 730, 840), w("Institute", 96, 850, 1000)] },
  { words: [w("Lcy", 15, 190, 250), w("S", 80, 260, 280), w(":", 48, 290, 300)] },
  { words: [w("1775", 93, 100, 170), w("Mass.", 92, 180, 260), w("Ave", 96, 270, 330), w("NW", 96, 340, 380), w("dwhitfield@meridianpolicy.org", 90, 600, 1000)] },
  { words: [w("Suite", 95, 100, 180), w("400", 96, 190, 240), w("(202)", 0, 700, 780), w("555-0187", 8, 790, 1000)] },
  { words: [w("Washington,", 96, 100, 260), w("DC", 96, 270, 310), w("20036", 96, 320, 400), w("wWww.meridianpolicy.org", 43, 640, 1000)] },
];

describe("reading a two-column card with a seal", () => {
  it("splits columns and drops scraps", () => {
    const lines = cleanOcrLines(SEAL_CARD);
    expect(lines).toContain("Dana Whitfield");
    expect(lines).toContain("Senior Researcher");
    expect(lines).toContain("Suite 400");
    expect(lines).toContain("(202) 555-0187");
    expect(lines.join(" ")).not.toMatch(/o>|hy|e\)/);
  });

  it("uses the email and website to pick the name and organization", () => {
    const card = parseCardText(cleanOcrLines(SEAL_CARD).join("\n"));
    expect(card).toMatchObject({
      name: "Dana Whitfield",
      title: "Senior Researcher",
      organization: "Meridian Policy Institute",
      email: "dwhitfield@meridianpolicy.org",
      phone: "(202) 555-0187",
      website: "www.meridianpolicy.org",
      address: "1775 Mass. Ave NW, Suite 400, Washington, DC 20036",
      geo: "Washington, DC",
    });
    expect(card.other).toBe("");
  });

  it("does not take seal scraps as a name even without an email", () => {
    expect(parseCardText("CIN Fes\nURC INS So\nDana Whitfield\nSenior Researcher").name).toBe("Dana Whitfield");
  });

  it("matches an acronym domain to the organization", () => {
    const card = parseCardText("Sam Lee\nFoundation for Defense of Democracies\nslee@fdd.org");
    expect(card.organization).toBe("Foundation for Defense of Democracies");
  });
});

describe("findCardBox", () => {
  it("finds a light card on a dark background", () => {
    const W = 400, H = 300;
    const gray = new Uint8Array(W * H).fill(40);
    for (let y = 100; y < 220; y++) for (let x = 60; x < 340; x++) gray[y * W + x] = 235;
    const box = findCardBox(gray, W, H)!;
    expect(box.x).toBeLessThanOrEqual(60);
    expect(box.x).toBeGreaterThan(50);
    expect(box.y).toBeLessThanOrEqual(100);
    expect(box.x + box.w).toBeGreaterThanOrEqual(340);
    expect(box.y + box.h).toBeGreaterThanOrEqual(220);
  });

  it("leaves a photo alone when the card fills the frame", () => {
    expect(findCardBox(new Uint8Array(400 * 300).fill(235), 400, 300)).toBeNull();
  });
});
