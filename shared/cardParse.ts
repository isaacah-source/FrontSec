/**
 * Turns raw OCR text from a business card into contact fields. This is the on-device
 * fallback used when the server has no AI card reader; it gets the email, phone, and
 * website reliably and makes a reasonable guess at name, title, and organization.
 */

export interface ParsedCard {
  name: string;
  title: string;
  organization: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
  address: string;
  geo: string;
  other: string;
}

/** A word as the text reader reports it: text, confidence 0-100, and position. */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Turns the reader's lines into clean text lines:
 * - splits a line where a wide gap separates words, because two-column cards (address on
 *   the left, email and phone on the right) otherwise come back merged;
 * - drops symbol-only marks and low-confidence scraps from logos and seals, but keeps
 *   anything with a digit, @, or dot, since phone numbers often read correctly at low
 *   confidence;
 * - drops a line whose words are mostly low-confidence.
 */
export function cleanOcrLines(lines: { words: OcrWord[] }[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const words = line.words.filter((w) => w.text.trim());
    if (!words.length) continue;
    const height = Math.max(...words.map((w) => w.bbox.y1 - w.bbox.y0), 1);
    const groups: OcrWord[][] = [[words[0]]];
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
      if (gap > height * 2.5) groups.push([]);
      groups[groups.length - 1].push(words[i]);
    }
    for (const group of groups) {
      const kept = group.filter((w) => {
        const t = w.text.trim();
        if (!/[a-z0-9]/i.test(t)) return false;
        if (/[\d@]|\.\w/.test(t)) return true;
        return w.confidence >= 50 || (t.length > 3 && w.confidence >= 30);
      });
      if (!kept.length) continue;
      const avg = kept.reduce((n, w) => n + w.confidence, 0) / kept.length;
      if (avg < 35 && !kept.some((w) => /[\d@]/.test(w.text))) continue;
      out.push(kept.map((w) => w.text.trim()).join(" "));
    }
  }
  return out;
}

const TITLE_WORDS =
  /\b(chief|officer|director|manager|president|vice|vp|head|lead|founder|partner|principal|senior|sr\.?|junior|associate|analyst|engineer|counsel|advisor|adviser|fellow|professor|researcher|scientist|editor|reporter|correspondent|ceo|cto|cfo|coo|ciso|chair|secretary|staff|deputy|assistant|specialist|consultant|executive|member|legislative|policy)\b/i;
const ORG_WORDS =
  /\b(inc|llc|ltd|corp|corporation|company|co\.|group|institute|university|college|foundation|center|centre|council|agency|department|office|committee|association|labs?|partners|capital|ventures|news|post|times|journal|bank|fund|school|government|ministry|embassy|senate|house)\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|io|ai|co|us|uk|mil|int)(?:\/[^\s]*)?)\b/i;
const PHONE = /(\+?\(?\d[\d\s().-]{7,}\d)/;
const STREET = /\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|way|lane|ln|suite|ste|floor|fl|pl|place|ct|court|nw|ne|sw|se)\b/i;
const CITY_STATE = /\b([A-Z][a-zA-Z.\s]+),\s*([A-Z]{2})\b\s*(\d{5}(-\d{4})?)?/;

function isNameLike(line: string): boolean {
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (/[\d@/]/.test(line) || TITLE_WORDS.test(line) || ORG_WORDS.test(line)) return false;
  // Names use one style throughout ("Kevin Harrington" or "KEVIN HARRINGTON"); mixed
  // styles such as "CIN Fes" are scraps of logo or seal lettering.
  const main = words.filter((w) => !/^(de|van|von|da|del|la|le)$/i.test(w) && !/^[A-Z]\.?$/.test(w));
  const caps = main.filter((w) => /^[A-Z]{2,},?$/.test(w)).length;
  if (caps > 0 && caps < main.length) return false;
  return words.every((w, i) => {
    if (/^(de|van|von|da|del|la|le)$/i.test(w)) return true;
    // A middle initial ("R." or "R"), never first or last.
    if (/^[A-Z]\.?$/.test(w)) return i > 0 && i < words.length - 1;
    // Capitalized ("Kevin", "O'Neill") or all capitals of 3+ letters ("KEVIN"); needs a vowel.
    return (/^[A-Z][a-z'’.-]+,?$/.test(w) || /^[A-Z]{3,},?$/.test(w)) && /[aeiouy]/i.test(w);
  });
}

/** Lower-case letters only, for comparing "Potomac Institute" with "potomacinstitute". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const MINOR = new Set(["of", "for", "the", "and", "on", "in", "at", "&"]);

/** Whether a line looks like the organization behind an email or web domain. */
function matchesDomain(line: string, domain: string): boolean {
  if (domain.length < 3) return false;
  if (squash(line).includes(domain)) return true;
  const initials = line.split(/\s+/).filter((w) => !MINOR.has(w.toLowerCase())).map((w) => w[0]?.toLowerCase() ?? "").join("");
  return initials.length >= 3 && initials === domain;
}

export function parseCardText(text: string, fallbackOrgFromEmail = true): ParsedCard {
  const out: ParsedCard = {
    name: "", title: "", organization: "", email: "", phone: "", website: "", linkedin: "", address: "", geo: "", other: "",
  };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[|•·]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
  const left: string[] = [];
  const extra: string[] = [];

  for (const line of lines) {
    let rest = line;
    const email = rest.match(EMAIL);
    if (email) {
      if (!out.email) out.email = email[0].toLowerCase();
      rest = rest.replace(email[0], "").trim();
    }
    if (/linkedin/i.test(rest)) {
      out.linkedin ||= rest.replace(/^.*?(linkedin\.com\S*|in\/\S+).*$/i, "$1");
      continue;
    }
    const url = rest.match(URL);
    if (url && !EMAIL.test(line.slice(line.indexOf(url[0]) - 1))) {
      // Readers often double the w's ("wWww."); normalize the start of a web address.
      if (!out.website) out.website = url[1].toLowerCase().replace(/^(https?:\/\/)?w{2,}\./, "$1www.");
      rest = rest.replace(url[0], "").trim();
    }
    const phone = rest.match(PHONE);
    if (phone && phone[1].replace(/\D/g, "").length >= 10) {
      const label = /\b(m|mobile|cell|c)\b[:.]?/i.test(rest);
      if (!out.phone || label) out.phone = phone[1].trim();
      else extra.push(rest);
      continue;
    }
    if (STREET.test(rest) || CITY_STATE.test(rest) || /^(suite|ste\.?|floor|fl\.?|room|rm\.?|unit|p\.?o\.? box)\s*\w+/i.test(rest)) {
      out.address = out.address ? `${out.address}, ${rest}` : rest;
      const cs = rest.match(CITY_STATE);
      if (cs) out.geo = `${cs[1].trim()}, ${cs[2]}`;
      continue;
    }
    if (rest) left.push(rest);
  }

  // The email usually holds the surname ("kharrington" -> "Harrington") and the domain the
  // organization ("potomacinstitute.org"). Prefer lines that agree with them; seals and logos
  // produce name-shaped scraps, and the first name-shaped line is often one of those.
  const local = squash(out.email.split("@")[0] ?? "");
  const domainOf = (s: string) => (s.replace(/^.*@/, "").replace(/^(https?:\/\/)?(www\.)?/i, "").split(/[./]/)[0] ?? "").toLowerCase();
  const domains = [domainOf(out.email), domainOf(out.website)].filter((d) => d && !/^(gmail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail|me)$/.test(d));
  const candidates = left.map((l, i) => ({ l, i })).filter(({ l }) => isNameLike(l));
  const byEmail = local.length >= 3
    ? candidates.find(({ l }) => l.split(/\s+/).some((w) => squash(w).length >= 3 && local.includes(squash(w))))
    : undefined;
  const nameIdx = (byEmail ?? candidates[0])?.i ?? -1;
  if (nameIdx >= 0) out.name = left[nameIdx].replace(/,$/, "");
  const remaining = left.filter((_, i) => i !== nameIdx);
  const orgByDomain = remaining.findIndex((l) => domains.some((d) => matchesDomain(l, d)));
  // "Meridian Policy Institute" and "Senior Fellow, Technology Policy" both contain a
  // title word, so score each line: title words count for it, organization words against.
  const count = (re: RegExp, l: string) => (l.match(new RegExp(re.source, "gi")) ?? []).length;
  let titleIdx = -1;
  let best = 0;
  remaining.forEach((l, i) => {
    const score = count(TITLE_WORDS, l) - 2 * count(ORG_WORDS, l);
    if (score > best) {
      best = score;
      titleIdx = i;
    }
  });
  if (titleIdx >= 0) out.title = remaining[titleIdx];
  if (orgByDomain >= 0 && orgByDomain === titleIdx) {
    titleIdx = remaining.findIndex((l, i) => i !== orgByDomain && TITLE_WORDS.test(l));
    out.title = titleIdx >= 0 ? remaining[titleIdx] : "";
  }
  const orgIdx = orgByDomain >= 0 ? orgByDomain : remaining.findIndex((l, i) => i !== titleIdx && ORG_WORDS.test(l));
  const orgPick = orgIdx >= 0 ? orgIdx : remaining.findIndex((l, i) => i !== titleIdx && /[a-z]{4,}/i.test(l));
  if (orgPick >= 0) out.organization = remaining[orgPick];
  if (!out.organization && fallbackOrgFromEmail && out.email) {
    const domain = out.email.split("@")[1]?.split(".")[0] ?? "";
    if (domain && !/^(gmail|yahoo|outlook|hotmail|icloud|aol|proton|me)$/i.test(domain)) {
      out.organization = domain.toUpperCase().length <= 4 ? domain.toUpperCase() : domain[0].toUpperCase() + domain.slice(1);
    }
  }
  // Keep leftovers that look like real information (a word of 4+ letters, or a number such
  // as a fax line); drop scraps from logos and seals like "CIN" or "Lcy S".
  const meaningful = (l: string) => /[a-z]{4,}/i.test(l) || /\d{3,}/.test(l);
  out.other = [...remaining.filter((l, i) => i !== titleIdx && i !== orgPick && meaningful(l)), ...extra].join("\n");
  return out;
}
