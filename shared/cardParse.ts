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
  return words.every((w) => /^[A-Z][a-zA-Z'’.-]*,?$/.test(w) || /^(de|van|von|da|del|la|le)$/i.test(w));
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
      if (!out.website) out.website = url[1];
      rest = rest.replace(url[0], "").trim();
    }
    const phone = rest.match(PHONE);
    if (phone && phone[1].replace(/\D/g, "").length >= 10) {
      const label = /\b(m|mobile|cell|c)\b[:.]?/i.test(rest);
      if (!out.phone || label) out.phone = phone[1].trim();
      else extra.push(rest);
      continue;
    }
    if (STREET.test(rest) || CITY_STATE.test(rest)) {
      out.address = out.address ? `${out.address}, ${rest}` : rest;
      const cs = rest.match(CITY_STATE);
      if (cs) out.geo = `${cs[1].trim()}, ${cs[2]}`;
      continue;
    }
    if (rest) left.push(rest);
  }

  const nameIdx = left.findIndex(isNameLike);
  if (nameIdx >= 0) out.name = left[nameIdx].replace(/,$/, "");
  const remaining = left.filter((_, i) => i !== nameIdx);
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
  const orgIdx = remaining.findIndex((l, i) => i !== titleIdx && ORG_WORDS.test(l));
  const orgPick = orgIdx >= 0 ? orgIdx : remaining.findIndex((_, i) => i !== titleIdx);
  if (orgPick >= 0) out.organization = remaining[orgPick];
  if (!out.organization && fallbackOrgFromEmail && out.email) {
    const domain = out.email.split("@")[1]?.split(".")[0] ?? "";
    if (domain && !/^(gmail|yahoo|outlook|hotmail|icloud|aol|proton|me)$/i.test(domain)) {
      out.organization = domain.toUpperCase().length <= 4 ? domain.toUpperCase() : domain[0].toUpperCase() + domain.slice(1);
    }
  }
  out.other = [...remaining.filter((_, i) => i !== titleIdx && i !== orgPick), ...extra].join("\n");
  return out;
}
