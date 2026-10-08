/**
 * The smallest set of workbook operations the app needs. GraphSheets (graph.ts) does
 * them against the Excel file in OneDrive; MemorySheets does them in memory for tests
 * and the offline demo.
 *
 * Rows are 1-based like Excel. `read` returns every row from 1 down to the last used row,
 * each padded to the same width, or null when the tab does not exist.
 */
export type Cell = string | number | boolean | null;

export interface SheetIO {
  read(sheet: string): Promise<Cell[][] | null>;
  /** Write values starting at column A of `row`. */
  writeRow(sheet: string, row: number, values: Cell[]): Promise<void>;
  /** Write values into one cell range of a row, starting at column `col` (1-based). */
  writeCells(sheet: string, row: number, col: number, values: Cell[]): Promise<void>;
  deleteRow(sheet: string, row: number): Promise<void>;
  addSheet(sheet: string): Promise<void>;
  /** Changes whenever the file changes; used to decide when to reload. */
  version(): Promise<string>;
}

export function columnLetter(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export class MemorySheets implements SheetIO {
  sheets = new Map<string, Cell[][]>();
  private rev = 0;
  /** Lets tests simulate another person writing right after this one. */
  afterWrite?: (sheet: string, row: number) => void;

  constructor(init: Record<string, Cell[][]> = {}) {
    for (const [k, v] of Object.entries(init)) this.sheets.set(k, v.map((r) => [...r]));
  }

  async read(sheet: string) {
    const rows = this.sheets.get(sheet);
    if (!rows) return null;
    let last = rows.length;
    while (last > 0 && rows[last - 1].every((v) => v === null || v === "")) last--;
    const width = Math.max(0, ...rows.slice(0, last).map((r) => r.length));
    return rows.slice(0, last).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  }

  async writeRow(sheet: string, row: number, values: Cell[]) {
    return this.writeCells(sheet, row, 1, values);
  }

  async writeCells(sheet: string, row: number, col: number, values: Cell[]) {
    const rows = this.sheets.get(sheet);
    if (!rows) throw new Error(`No sheet ${sheet}`);
    while (rows.length < row) rows.push([]);
    const r = rows[row - 1];
    values.forEach((v, i) => {
      // Mirror Excel: a leading apostrophe marks text and is not part of the value.
      r[col - 1 + i] = typeof v === "string" && v.startsWith("'") ? v.slice(1) : v;
    });
    this.rev++;
    this.afterWrite?.(sheet, row);
  }

  async deleteRow(sheet: string, row: number) {
    this.sheets.get(sheet)?.splice(row - 1, 1);
    this.rev++;
  }

  async addSheet(sheet: string) {
    if (!this.sheets.has(sheet)) this.sheets.set(sheet, []);
    this.rev++;
  }

  async version() {
    return String(this.rev);
  }
}
