import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphSheets, encodeShareUrl } from "../lib/graph";
import { MemorySheets, type Cell } from "../lib/sheets";
import { Repo } from "../lib/repo";

/**
 * A stand-in for the parts of Microsoft Graph the app calls, backed by MemorySheets.
 * It checks request shapes (paths, addresses, headers) the way the real service would.
 */
const FOLDER_URL = "https://contoso-my.sharepoint.com/:f:/g/personal/ike/AbC?e=1";

function fakeGraph(book: MemorySheets, opts: { denied?: Set<string>; expireSessionOnce?: boolean } = {}) {
  const calls: { method: string; url: string; session: string | null }[] = [];
  let sessions = 0;
  let expire = opts.expireSessionOnce ?? false;
  const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input)).replace("https://graph.microsoft.com/v1.0", "");
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const session = headers["workbook-session-id"] ?? null;
    calls.push({ method, url, session });
    const token = headers.Authorization?.replace("Bearer ", "");
    if (opts.denied?.has(token ?? "")) return json(403, { error: { code: "accessDenied", message: "Access denied" } });

    if (url.startsWith("/shares/")) {
      expect(url.split("/")[2]).toBe(encodeShareUrl(FOLDER_URL));
      return json(200, { id: "folder1", name: "Tracker", webUrl: "https://x/folder", folder: {}, parentReference: { driveId: "d1" } });
    }
    if (url.startsWith("/drives/d1/items/folder1/children")) {
      return json(200, { value: [
        { id: "book1", name: "FSI_Relationship_Tracker.xlsx", webUrl: "https://x/book", file: {}, parentReference: { driveId: "d1" } },
        { id: "lock", name: "~$FSI_Relationship_Tracker.xlsx", webUrl: "", file: {}, parentReference: { driveId: "d1" } },
      ] });
    }
    if (url === "/drives/d1/items/book1/workbook/createSession") return json(201, { id: `s${++sessions}` });
    if (url.startsWith("/drives/d1/items/book1?$select=cTag")) return json(200, { cTag: `c${await book.version()}` });
    if (session && expire && url.includes("/worksheets/")) {
      expire = false;
      return json(404, { error: { code: "itemNotFound", message: "session gone", innerError: { code: "invalidSessionReCreatable" } } });
    }
    const ws = /\/workbook\/worksheets\/([^/]+)\/(.*)$/.exec(url);
    if (ws) {
      const sheet = ws[1];
      const rest = ws[2];
      if (rest.startsWith("usedRange")) {
        const rows = await book.read(sheet);
        if (!rows) return json(404, { error: { code: "itemNotFound", message: "no sheet" } });
        const values = rows.length ? rows : [[""]];
        return json(200, { address: `${sheet}!A1:Z${values.length}`, values });
      }
      const m = /^range\(address='([A-Z]+)(\d+):([A-Z]+)(\d+)'\)$/.exec(rest);
      if (m && method === "PATCH") {
        const body = JSON.parse(String(init!.body)) as { values: Cell[][] };
        const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        expect(body.values[0].length).toBe(m[3].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - col + 1);
        await book.writeCells(sheet, Number(m[2]), col, body.values[0]);
        return json(200, {});
      }
      const d = /^range\(address='(\d+):(\d+)'\)\/delete$/.exec(rest);
      if (d && method === "POST") {
        expect(JSON.parse(String(init!.body))).toEqual({ shift: "Up" });
        await book.deleteRow(sheet, Number(d[1]));
        return json(204, null);
      }
    }
    if (url === "/drives/d1/items/book1/workbook/worksheets/add") {
      await book.addSheet(JSON.parse(String(init!.body)).name);
      return json(201, {});
    }
    return json(400, { error: { code: "unexpected", message: `${method} ${url}` } });
  };
  return { handler, calls };
}

const HEADER = ["Unique ID", "Name", "Organization", "Relationship Type", "Status", "Relationship Owner"];
let book: MemorySheets;

beforeEach(() => {
  book = new MemorySheets({ Master: [HEADER, [1, "Ellen Nakashima", "Washington Post", "Media", "Cultivating", "Ike"]] });
});
afterEach(() => vi.unstubAllGlobals());

describe("GraphSheets", () => {
  it("encodes sharing links the way /shares expects", () => {
    expect(encodeShareUrl("https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1"))
      .toBe("u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx");
  });

  it("finds the workbook in the shared folder, ignoring Office lock files", async () => {
    const g = fakeGraph(book);
    vi.stubGlobal("fetch", g.handler);
    const io = new GraphSheets(async () => "alice");
    const info = await io.open(FOLDER_URL);
    expect(info).toMatchObject({ driveId: "d1", itemId: "book1", name: "FSI_Relationship_Tracker.xlsx" });
  });

  it("runs setup and edits through Graph, and a second person sees the change", async () => {
    const g = fakeGraph(book);
    vi.stubGlobal("fetch", g.handler);
    const alice = new GraphSheets(async () => "alice");
    const bob = new GraphSheets(async () => "bob");
    await alice.open(FOLDER_URL);
    await bob.open(FOLDER_URL);
    const aliceRepo = new Repo(alice, { email: "alice@org", name: "Alice" });
    const bobRepo = new Repo(bob, { email: "bob@org", name: "Bob" });

    await aliceRepo.setup();
    const v1 = await bob.version();
    const c = (await aliceRepo.load()).contacts[0];
    await aliceRepo.addTouchpoint(c, { date: "2026-10-07", type: "Meeting", summary: "=not a formula" });
    expect(await bob.version()).not.toBe(v1);
    const seen = await bobRepo.load();
    expect(seen.interactions[0].summary).toBe("=not a formula");
    expect(seen.contacts[0]).toMatchObject({ lastContact: "2026-10-07", updatedBy: "Alice" });
    // Writes use a workbook session; the version check does not.
    expect(g.calls.filter((x) => x.method === "PATCH").every((x) => x.session)).toBe(true);
  });

  it("opens a new workbook session when the old one expired", async () => {
    const g = fakeGraph(book, { expireSessionOnce: true });
    vi.stubGlobal("fetch", g.handler);
    const io = new GraphSheets(async () => "alice");
    await io.open(FOLDER_URL);
    expect((await io.read("Master"))?.[1][1]).toBe("Ellen Nakashima");
    expect(new Set(g.calls.map((x) => x.session).filter(Boolean))).toEqual(new Set(["s1", "s2"]));
  });

  it("explains a missing share in plain language", async () => {
    const g = fakeGraph(book, { denied: new Set(["mallory"]) });
    vi.stubGlobal("fetch", g.handler);
    await expect(new GraphSheets(async () => "mallory").open(FOLDER_URL)).rejects.toThrow(/does not have access/);
  });

  it("returns null for a tab that does not exist", async () => {
    vi.stubGlobal("fetch", fakeGraph(book).handler);
    const io = new GraphSheets(async () => "alice");
    await io.open(FOLDER_URL);
    expect(await io.read("Touchpoints")).toBeNull();
  });
});
