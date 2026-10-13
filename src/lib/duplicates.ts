import { allEmails, allPhones, type Contact, type DuplicateMark } from "../../shared/constants";

/**
 * Finds contacts that are probably the same person: same email, same phone, the same name
 * written differently ("Bob Smith" / "Robert Smith", "J. Smith", a typo), plus any pair
 * someone flagged by hand. Pairs someone marked "not duplicate" are left out.
 */

export interface DuplicatePair {
  a: Contact;
  b: Contact;
  reasons: string[];
  /** The Duplicates-tab row behind this pair, if someone flagged it. */
  mark: DuplicateMark | null;
}

const NICKNAMES: string[][] = [
  ["robert", "bob", "rob", "bobby"], ["william", "bill", "will", "billy"], ["richard", "rick", "dick", "rich"],
  ["michael", "mike"], ["james", "jim", "jimmy", "jamie"], ["thomas", "tom", "tommy"], ["joseph", "joe", "joey"],
  ["david", "dave"], ["daniel", "dan", "danny"], ["christopher", "chris"], ["matthew", "matt"], ["andrew", "andy", "drew"],
  ["anthony", "tony"], ["steven", "stephen", "steve"], ["gregory", "greg"], ["jonathan", "jon"], ["nicholas", "nick"],
  ["samuel", "sam"], ["benjamin", "ben"], ["alexander", "alex"], ["edward", "ed", "ted"], ["timothy", "tim"],
  ["patrick", "pat"], ["peter", "pete"], ["charles", "charlie", "chuck"], ["kenneth", "ken"], ["ronald", "ron"],
  ["donald", "don"], ["isaac", "ike"], ["elizabeth", "liz", "beth", "betsy", "eliza"], ["katherine", "kate", "kathy", "katie", "catherine"],
  ["jennifer", "jen", "jenny"], ["margaret", "maggie", "meg", "peggy"], ["rebecca", "becky"], ["susan", "sue"],
  ["deborah", "deb", "debbie"], ["victoria", "vicky", "tori"], ["abigail", "abbey", "abby"], ["gabriella", "gabby", "gabrielle"],
  ["joshua", "josh"], ["zachary", "zach"], ["jacob", "jake"], ["theodore", "theo"], ["frederick", "fred"],
];
const NICK = new Map<string, number>();
NICKNAMES.forEach((group, i) => group.forEach((n) => NICK.set(n, i)));

const TITLES = /^(dr|mr|mrs|ms|prof|sen|rep|gen|adm|col|maj|capt|lt|hon|amb)\.?$/;
const SUFFIXES = /^(jr|sr|ii|iii|iv|phd|ph\.d|md|esq|ret)\.?$/;

/** First and last name, lowercased, without titles, suffixes, middle names or punctuation. */
export function nameParts(name: string): { first: string; last: string; full: string } {
  const words = name
    .replace(/\(.*?\)/g, " ")
    .split(/[\s,]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z.'-]/g, ""))
    .filter((w) => w && !TITLES.test(w) && !SUFFIXES.test(w));
  const clean = words.map((w) => w.replace(/[.'-]/g, ""));
  const first = clean[0] ?? "";
  const last = clean.length > 1 ? clean[clean.length - 1] : "";
  return { first, last, full: clean.join("") };
}

function sameFirst(x: string, y: string): string | null {
  if (!x || !y) return null;
  if (x === y) return "same name";
  if (NICK.has(x) && NICK.get(x) === NICK.get(y)) return "nickname";
  if ((x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))) return "initial";
  return null;
}

/** Edit distance, stopping early once it passes `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

const digits = (p: string | null) => (p ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export function findDuplicates(contacts: Contact[], marks: DuplicateMark[]): DuplicatePair[] {
  const key = (x: number, y: number) => `${Math.min(x, y)}|${Math.max(x, y)}`;
  const markOf = new Map(marks.map((m) => [key(m.contactA, m.contactB), m]));
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const found = new Map<string, DuplicatePair>();
  const add = (a: Contact, b: Contact, reason: string) => {
    if (a.id === b.id) return;
    const k = key(a.id, b.id);
    const mark = markOf.get(k) ?? null;
    if (mark?.status === "not duplicate") return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const p = found.get(k) ?? { a: x, b: y, reasons: [], mark };
    if (!p.reasons.includes(reason)) p.reasons.push(reason);
    found.set(k, p);
  };

  // Every address and number counts, not just the main ones.
  const groups = (keysOf: (c: Contact) => string[], reason: string) => {
    const m = new Map<string, Contact[]>();
    for (const c of contacts) {
      for (const k of new Set(keysOf(c))) if (k) m.set(k, [...(m.get(k) ?? []), c]);
    }
    for (const g of m.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) add(g[i], g[j], reason);
  };
  groups((c) => allEmails(c).map((e) => e.toLowerCase()), "same email");
  groups((c) => allPhones(c).map((p) => digits(p)).filter((p) => p.length >= 7), "same phone");

  // Names: compare within the same last name, and catch typos across close spellings.
  const parts = contacts.map((c) => ({ c, ...nameParts(c.name) }));
  const byLast = new Map<string, typeof parts>();
  for (const p of parts) if (p.last) byLast.set(p.last, [...(byLast.get(p.last) ?? []), p]);
  for (const g of byLast.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const how = sameFirst(g[i].first, g[j].first);
        if (how === "same name") add(g[i].c, g[j].c, "same name");
        else if (how) add(g[i].c, g[j].c, how === "nickname" ? "same name (nickname)" : "same last name and initial");
      }
    }
  }
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const x = parts[i];
      const y = parts[j];
      if (x.full.length < 8 || y.full.length < 8 || x.last === y.last) continue;
      if (x.full[0] === y.full[0] && within(x.full, y.full, 2)) add(x.c, y.c, "similar spelling");
    }
  }

  for (const m of marks) {
    if (m.status !== "flagged") continue;
    const a = byId.get(m.contactA);
    const b = byId.get(m.contactB);
    if (a && b) add(a, b, `flagged by ${m.by ?? "someone"}`);
  }
  // Strongest evidence first.
  const weight = (p: DuplicatePair) => (p.mark ? 4 : 0) + (p.reasons.includes("same email") ? 3 : 0) + (p.reasons.includes("same name") ? 2 : 0) + p.reasons.length;
  return [...found.values()].sort((p, q) => weight(q) - weight(p) || p.a.name.localeCompare(q.a.name));
}
