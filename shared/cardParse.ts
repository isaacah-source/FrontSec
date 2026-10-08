/**
 * Sorts a business card's text into contact fields. The text comes from the phone's own
 * reader (Google Lens on Android, Live Text on iPhone), pasted or shared into the app.
 *
 * Email, phone, and web address have recognizable shapes. For the rest, the email and web
 * address do most of the work: the line holding the email's surname is the name, and the
 * line matching the domain is the organization. Readers still misread some typefaces (small
 * capitals turn C into G, digits stand in for letters), so those repairs stay.
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
  /\b(chief|officer|director|manager|president|vice|vp|head|lead|founder|partner|principal|senior|sr\.?|junior|associate|analyst|engineer|counsel|advisor|adviser|fellow|professor|researcher|scientist|editor|reporter|correspondent|ceo|cto|cfo|coo|ciso|chair|secretary|staff|deputy|assistant|specialist|consultant|executive|member|legislative|policy|professional|aide|liaison|clerk|counselor)\b/i;
const ORG_WORDS =
  /\b(inc|llc|ltd|corp|corporation|company|co\.|group|institute|university|college|foundation|center|centre|council|agency|department|office|(?:sub)?[cg]ommittee|[cg]ommission|[cg]aucus|representatives|congress|appropriations|majority|minority|association|labs?|partners|capital|ventures|news|post|times|journal|bank|fund|school|government|ministry|embassy|senate|house)\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|io|ai|co|us|uk|mil|int)(?:\/[^\s]*)?)\b/i;
const PHONE = /(\+?\(?\d[\d\s().-]{7,}\d)/;
const STREET = /\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|way|lane|ln|suite|ste|floor|fl|pl|place|ct|court|nw|ne|sw|se)\b/i;
const CITY_STATE = /\b([A-Z][a-zA-Z.\s]+),\s*([A-Z]{2})\b\s*(\d{5}(-\d{4})?)?/;

const PARTICLE = /^(de|van|von|da|del|la|le|di|du)$/i;

/**
 * How much a line looks like a person's name, or null if it cannot be one. Readers often
 * garble the capitals of small-caps cards ("Gina PizzicoNi GUPPLES"), so odd capitals cost
 * points instead of ruling a line out; matching the email decides most cards.
 */
function nameScore(line: string, emailLocal: string): number | null {
  const words = line.replace(/,$/, "").split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  if (/[\d@/&]/.test(line) || TITLE_WORDS.test(line) || ORG_WORDS.test(line)) return null;
  const main = words.filter((w, i) => !PARTICLE.test(w) && !(/^[A-Z]\.?$/.test(w) && i > 0 && i < words.length - 1));
  if (!main.length || !main.every((w) => /^[A-Za-z][A-Za-z'’.-]+$/.test(w) && /[aeiouy]/i.test(w))) return null;
  let score = 0;
  const title = main.filter((w) => /^[A-Z][a-z'’.-]+$/.test(w)).length;
  const caps = main.filter((w) => /^[A-Z'’.-]{2,}$/.test(w)).length;
  score += title === main.length || caps === main.length ? 2 : -2;
  score -= main.filter((w) => w.replace(/[^a-z]/gi, "").length <= 3).length;
  // C and G look alike in small capitals, so compare with both read as C.
  const cg = (x: string) => squash(x).replace(/g/g, "c");
  const local = cg(emailLocal);
  if (local.length >= 3 && main.some((w) => cg(w).length >= 3 && local.includes(cg(w)))) score += 10;
  return score;
}

/** "GINA PIZZICONI CUPPLES" or "PizzicoNi" -> "Gina Pizziconi Cupples"; keeps "U.S." as is. */
function tidyCaps(line: string): string {
  const letters = line.replace(/[^A-Za-z]/g, "");
  const oddCaps = line.split(/\s+/).some((w) => /[a-z][A-Z]/.test(w));
  if (!oddCaps && letters !== letters.toUpperCase()) return line;
  return line.split(/\s+/).map((w, i) => {
    if (/\./.test(w) && /^[A-Z.]+,?$/.test(w)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && (MINOR.has(lower) || PARTICLE.test(lower))) return lower;
    return lower.replace(/^([^a-z]*)([a-z])/, (_, pre, c) => pre + c.toUpperCase()).replace(/([-'’])([a-z])/g, (_, d, c) => d + c.toUpperCase());
  }).join(" ");
}

/**
 * The name and email spell the same words; where they disagree only on C versus G (the
 * misread small capitals cause: "Gupples" in the name, "pizzigoni" in the email), use C in
 * both. Letters that agree, and any other difference, are left alone.
 */
function reconcileCG(name: string, email: string): [string, string] {
  const [local, domain] = email.split("@");
  const letters = local.toLowerCase().replace(/[^a-z]/g, "");
  let fixedName = name;
  let fixedLetters = letters;
  for (const word of name.split(/\s+/)) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (w.length < 3) continue;
    const at = letters.replace(/g/g, "c").indexOf(w.replace(/g/g, "c"));
    if (at < 0) continue;
    const fromEmail = letters.slice(at, at + w.length);
    if (fromEmail === w) continue;
    let merged = "";
    for (let i = 0; i < w.length; i++) merged += w[i] !== fromEmail[i] ? "c" : w[i];
    fixedLetters = fixedLetters.slice(0, at) + merged + fixedLetters.slice(at + w.length);
    const fixedWord = [...word].map((ch, i) => (/[gG]/.test(ch) && merged[i] === "c" ? (ch === "G" ? "C" : "c") : ch)).join("");
    fixedName = fixedName.replace(word, fixedWord);
  }
  // Put the corrected letters back into the email, keeping its dots and digits in place.
  let k = 0;
  const fixedLocal = [...local].map((ch) => (/[a-z]/i.test(ch) ? fixedLetters[k++] ?? ch : ch)).join("");
  return [fixedName, `${fixedLocal}@${domain}`];
}

const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));
/** Fixes a state code the reader misread ("DG" -> "DC", "0H" -> "OH"). */
function fixState(code: string): string {
  if (STATES.has(code)) return code;
  const swaps: Record<string, string> = { G: "C", C: "G", "0": "O", "1": "I", "5": "S", "8": "B" };
  for (let i = 0; i < 2; i++) {
    const alt = code.slice(0, i) + (swaps[code[i]] ?? code[i]) + code.slice(i + 1);
    if (STATES.has(alt)) return alt;
  }
  return code;
}

/**
 * Puts back together an email the reader split with spaces ("GINA. PIZZ...@MAIL HOUSE.GOV"),
 * and turns digits wedged between letters back into letters ("p1zz1" -> "pizzi").
 */
/** Undoes C-read-as-G in words common on cards ("SUBGOMMITTEE", "GAPITOL"). */
function fixSmallCaps(line: string): string {
  return line.replace(/\b(sub)?g(ommittee|ommission|aucus|apitol|ongress|ounsel|hief|enter)\b/gi, (m, sub = "", rest) => {
    const c = m[sub.length] === "G" ? "C" : "c";
    return sub + c + rest;
  });
}

function repairEmail(line: string): string {
  if (!line.includes("@")) return line;
  return line
    .replace(/(\S+\.)\s+(?=\S*@)/g, "$1")
    .replace(/@(\S+?)\.?\s+(\S+\.(?:gov|com|org|net|edu|mil|int|io|ai|us|uk|co)\b)/gi, "@$1.$2");
}
const fixEmailLetters = (email: string) => email.toLowerCase().replace(/(?<=[a-z])1(?=[a-z])/g, "i").replace(/(?<=[a-z])0(?=[a-z])/g, "o");

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
    .map((l) => fixSmallCaps(repairEmail(l.replace(/[|•·‘’“”`]+/g, " ").replace(/\s+/g, " ").trim())))
    .filter((l) => l.length > 1);
  const left: string[] = [];
  const extra: string[] = [];

  for (const line of lines) {
    let rest = line;
    const email = rest.match(EMAIL);
    if (email) {
      if (!out.email) out.email = fixEmailLetters(email[0]);
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
      const cs = rest.match(CITY_STATE);
      if (cs) {
        const state = fixState(cs[2]);
        rest = tidyCaps(rest).replace(new RegExp(`,\\s*${cs[2]}\\b`, "i"), `, ${state}`);
        out.geo = `${tidyCaps(cs[1].trim())}, ${state}`;
        // A short line with a number just before the city ("H-405, U.S. Capitol") is the
        // street or building, even when it matches no street pattern.
        const prev = left[left.length - 1];
        if (prev && /\d/.test(prev) && prev.length <= 40 && !out.address.includes(prev)) {
          left.pop();
          out.address = out.address ? `${out.address}, ${tidyCaps(prev)}` : tidyCaps(prev);
        }
      }
      rest = rest.replace(/[\s:;=,.]+$/, "");
      out.address = out.address ? `${out.address}, ${rest}` : rest;
      continue;
    }
    if (rest) left.push(rest);
  }

  // The email usually holds the surname ("kharrington" -> "Harrington") and the domain the
  // organization ("potomacinstitute.org"). Prefer lines that agree with them; seals and logos
  // produce name-shaped scraps, and the first name-shaped line is often one of those.
  const local = squash(out.email.split("@")[0] ?? "");
  const domainOf = (s: string) => {
    const host = s.replace(/^.*@/, "").replace(/^(https?:\/\/)?(www\.)?/i, "").split("/")[0].toLowerCase();
    const parts = host.split(".").filter(Boolean);
    if (parts.length < 2) return parts[0] ?? "";
    const second = parts[parts.length - 2];
    return parts.length > 2 && /^(co|com|gov|ac|org|net|edu)$/.test(second) && parts[parts.length - 1].length === 2 ? parts[parts.length - 3] : second;
  };
  const domains = [domainOf(out.email), domainOf(out.website)].filter((d) => d && !/^(gmail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail|me)$/.test(d));
  let nameIdx = -1;
  let bestName = -2;
  left.forEach((l, i) => {
    const score = nameScore(l, local);
    if (score !== null && score > bestName) {
      bestName = score;
      nameIdx = i;
    }
  });
  if (nameIdx >= 0) {
    // A name with some words in capitals ("Ann Ricci GALDER") is small-caps text read
    // unevenly; write those words like the rest. Organizations are left alone ("IBM Research").
    const name = tidyCaps(left[nameIdx].replace(/,$/, ""));
    const words = name.split(" ");
    const allCaps = words.filter((w) => /^[A-Z]{2,}$/.test(w)).length;
    out.name = allCaps && allCaps < words.length
      ? words.map((w) => (/^[A-Z]{3,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(" ")
      : name;
  }
  if (out.name && out.email) [out.name, out.email] = reconcileCG(out.name, out.email);
  const remaining = left.filter((_, i) => i !== nameIdx);
  const orgByDomain = remaining.findIndex((l) => domains.some((d) => matchesDomain(l, d)));
  // "Meridian Policy Institute" and "Senior Fellow, Technology Policy" both contain a
  // title word, so score each line: title words count for it, organization words against.
  const count = (re: RegExp, l: string) => (l.match(new RegExp(re.source, "gi")) ?? []).length;
  // Among title-like lines, prefer the one right below the name ("Professional Staff"
  // under the name beats "Majority Staff" in the corner).
  const below = (i: number) => (nameIdx < 0 ? i : i >= nameIdx ? i - nameIdx : 50 + nameIdx - i);
  let titleIdx = -1;
  let best = 0;
  remaining.forEach((l, i) => {
    const score = count(TITLE_WORDS, l) - 2 * count(ORG_WORDS, l);
    if (score > 0 && (titleIdx < 0 || below(i) < below(titleIdx) || (below(i) === below(titleIdx) && score > best))) {
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
  if (orgPick >= 0) out.organization = tidyCaps(remaining[orgPick]);
  out.title = tidyCaps(out.title);
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
