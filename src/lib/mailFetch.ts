/**
 * Reads the signed-in person's Inbox and Sent Items for a date range through Microsoft
 * Graph, in their browser, with a Mail.Read token requested at the moment they press the
 * review button. Nothing here writes to the mailbox.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface MailMessage {
  id: string;
  conversationId: string;
  folder: "Inbox" | "Sent Items";
  date: string;
  subject: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  /** Plain-text body with quoted earlier messages cut off, so a thread is not read twice. */
  body: string;
}

interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}
interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  body?: { content?: string };
  bodyPreview?: string;
}

const addr = (r?: GraphRecipient) => (r?.emailAddress?.address ?? "").trim().toLowerCase();

/** Cuts the quoted history that replies carry ("On ... wrote:", "From: ... Sent: ..."). */
export function trimQuoted(text: string, max = 3500): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) continue;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    if (/^On .{6,200}wrote:\s*$/i.test(l)) break;
    if (/^\s*From:\s.+/i.test(l) && lines.slice(i + 1, i + 5).some((n) => /^\s*(Sent|Date|To|Subject):\s/i.test(n))) break;
    if (/^_{8,}\s*$/.test(l) && lines.slice(i + 1, i + 3).some((n) => /^\s*From:\s/i.test(n))) break;
    out.push(l);
  }
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return body.length > max ? `${body.slice(0, max)}\n[...]` : body;
}

async function getAll(token: string, url: string, folder: MailMessage["folder"], onPage: (n: number) => void): Promise<MailMessage[]> {
  const out: MailMessage[] = [];
  let next: string | null = url;
  while (next) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
    });
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("Retry-After")) || 5) * 1000));
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Could not read your ${folder} (${res.status}): ${err?.error?.message ?? res.statusText}`);
    }
    const page: { value: GraphMessage[]; "@odata.nextLink"?: string } = await res.json();
    for (const m of page.value) {
      out.push({
        id: m.id,
        conversationId: m.conversationId ?? m.id,
        folder,
        date: (folder === "Sent Items" ? m.sentDateTime : m.receivedDateTime) ?? "",
        subject: m.subject ?? "",
        from: addr(m.from),
        fromName: m.from?.emailAddress?.name ?? "",
        to: (m.toRecipients ?? []).map(addr).filter(Boolean),
        cc: (m.ccRecipients ?? []).map(addr).filter(Boolean),
        body: trimQuoted(m.body?.content ?? m.bodyPreview ?? ""),
      });
    }
    onPage(out.length);
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

/** Every Inbox and Sent Items message from `since` (ISO date) onward. */
export async function fetchMail(token: string, since: string, onProgress: (text: string) => void): Promise<MailMessage[]> {
  const iso = new Date(`${since}T00:00:00`).toISOString();
  const select = "$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,bodyPreview&$top=50";
  const inbox = await getAll(token,
    `${GRAPH}/me/mailFolders('inbox')/messages?$filter=receivedDateTime ge ${iso}&$orderby=receivedDateTime desc&${select}`,
    "Inbox", (n) => onProgress(`Reading your Inbox: ${n} emails`));
  const sent = await getAll(token,
    `${GRAPH}/me/mailFolders('sentitems')/messages?$filter=sentDateTime ge ${iso}&$orderby=sentDateTime desc&${select}`,
    "Sent Items", (n) => onProgress(`Reading your Sent Items: ${n} emails`));
  return [...inbox, ...sent];
}
