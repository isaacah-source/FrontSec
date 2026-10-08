import type { Cell, SheetIO } from "./sheets";
import { columnLetter } from "./sheets";

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Plain-language messages for the failures people actually hit. */
function explain(status: number, code: string, message: string): string {
  if (status === 401) return "Your Microsoft sign-in expired. Sign in again.";
  if (status === 403 || code === "accessDenied") {
    return "Your Microsoft account does not have access to the tracker folder, or has view-only access. Ask the folder's owner to share it with you (with edit access to make changes).";
  }
  if (status === 404 && code === "itemNotFound") return "The tracker folder or workbook was not found. It may have been moved or the sharing link removed.";
  if (status === 423 || code === "resourceLocked") return "The workbook is locked by another program. Try again in a minute.";
  if (status === 429 || status === 503) return "Microsoft is busy. Wait a few seconds and try again.";
  return message || `Microsoft Graph error ${status}`;
}

/** Converts a sharing link into the id the /shares endpoint takes ("u!" + base64url). */
export function encodeShareUrl(url: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(url.trim())));
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

export interface WorkbookInfo {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
  folderWebUrl: string;
}

/**
 * The workbook in OneDrive, read and written through the Excel part of Microsoft Graph as
 * the signed-in person. A persistent workbook session keeps calls fast; when it expires
 * (after a few idle minutes) the next call opens a new one.
 */
export class GraphSheets implements SheetIO {
  private session: Promise<string | null> | null = null;
  info!: WorkbookInfo;

  constructor(private token: () => Promise<string>) {}

  private async call<T>(method: string, path: string, body?: unknown, opts: { session?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.token()}`, ...opts.headers };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const sessionId = opts.session ? await this.sessionId() : null;
      if (sessionId) headers["workbook-session-id"] = sessionId;
      const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      const err = await res.json().catch(() => ({}));
      const code: string = err?.error?.code ?? "";
      const inner: string = err?.error?.innerError?.code ?? "";
      // Expired workbook session: drop it and retry once with a new one.
      if (opts.session && attempt === 0 && (/session/i.test(code) || /session/i.test(inner))) {
        this.session = null;
        continue;
      }
      // Throttling: honor Retry-After, up to three times.
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
        const wait = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new GraphError(res.status, code, explain(res.status, code, err?.error?.message ?? ""));
    }
  }

  private sessionId(): Promise<string | null> {
    this.session ??= this.call<{ id: string }>("POST", `${this.itemPath()}/workbook/createSession`, { persistChanges: true })
      .then((s) => s.id)
      // Some tenants and file states refuse sessions; calls work without one, just slower.
      .catch(() => null);
    return this.session;
  }

  private itemPath() {
    return `/drives/${this.info.driveId}/items/${this.info.itemId}`;
  }

  private sheetPath(sheet: string) {
    return `${this.itemPath()}/workbook/worksheets/${encodeURIComponent(sheet)}`;
  }

  /** Finds the workbook from the folder's sharing link. */
  async open(folderUrl: string, workbookName?: string): Promise<WorkbookInfo> {
    type Item = { id: string; name: string; webUrl: string; file?: unknown; folder?: unknown; parentReference: { driveId: string } };
    const shared = await this.call<Item>("GET", `/shares/${encodeShareUrl(folderUrl)}/driveItem`, undefined, {
      // Opening the link for the first time records access, as clicking it in Teams would.
      headers: { Prefer: "redeemSharingLink" },
    });
    const driveId = shared.parentReference.driveId;
    let file: Item | undefined;
    if (shared.file) file = shared;
    else {
      const list = await this.call<{ value: Item[] }>("GET", `/drives/${driveId}/items/${shared.id}/children?$top=200&$select=id,name,webUrl,file,parentReference`);
      const books = list.value.filter((i) => i.file && /\.xlsx$/i.test(i.name) && !i.name.startsWith("~$"));
      file = workbookName
        ? books.find((b) => b.name.toLowerCase() === workbookName.toLowerCase())
        : books.length === 1 ? books[0] : books.find((b) => /relationship/i.test(b.name));
      if (!file) {
        throw new GraphError(404, "itemNotFound", workbookName
          ? `No workbook named "${workbookName}" in the shared folder.`
          : `The shared folder has ${books.length} workbooks; set "workbookName" in config.json to pick one.`);
      }
    }
    this.info = { driveId, itemId: file.id, name: file.name, webUrl: file.webUrl, folderWebUrl: shared.webUrl };
    return this.info;
  }

  async read(sheet: string): Promise<Cell[][] | null> {
    try {
      const r = await this.call<{ address: string; values: Cell[][] }>(
        "GET", `${this.sheetPath(sheet)}/usedRange(valuesOnly=true)?$select=address,values`, undefined, { session: true },
      );
      // usedRange may not start at A1 (for example an empty first column). Pad so that
      // index 0 is always row 1, column A.
      const m = /!?\$?([A-Z]+)\$?(\d+)/.exec(r.address.split("!").pop() ?? "A1");
      const firstCol = m ? m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) : 1;
      const firstRow = m ? Number(m[2]) : 1;
      const rows: Cell[][] = Array.from({ length: firstRow - 1 }, () => []);
      for (const v of r.values) rows.push([...Array(firstCol - 1).fill(""), ...v]);
      // An empty sheet reports a single blank cell.
      if (rows.length === 1 && rows[0].every((v) => v === "" || v === null)) return [];
      return rows;
    } catch (e) {
      if (e instanceof GraphError && e.status === 404) return null;
      throw e;
    }
  }

  async writeRow(sheet: string, row: number, values: Cell[]) {
    return this.writeCells(sheet, row, 1, values);
  }

  async writeCells(sheet: string, row: number, col: number, values: Cell[]) {
    if (!values.length) return;
    const address = `${columnLetter(col)}${row}:${columnLetter(col + values.length - 1)}${row}`;
    await this.call("PATCH", `${this.sheetPath(sheet)}/range(address='${address}')`, { values: [values.map((v) => v ?? "")] }, { session: true });
  }

  async deleteRow(sheet: string, row: number) {
    await this.call("POST", `${this.sheetPath(sheet)}/range(address='${row}:${row}')/delete`, { shift: "Up" }, { session: true });
  }

  async addSheet(sheet: string) {
    await this.call("POST", `${this.itemPath()}/workbook/worksheets/add`, { name: sheet }, { session: true });
  }

  async version(): Promise<string> {
    const r = await this.call<{ cTag?: string; eTag?: string }>("GET", `${this.itemPath()}?$select=cTag,eTag`);
    return r.cTag ?? r.eTag ?? "";
  }
}
