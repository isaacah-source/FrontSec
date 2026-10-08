/**
 * Settings read at startup from config.json next to index.html, so the same build can be
 * pointed at a different tenant or folder without rebuilding. See config.example.json.
 */
export interface AppConfig {
  /** Directory (tenant) ID from the Entra app registration. */
  tenantId: string;
  /** Application (client) ID from the Entra app registration. */
  clientId: string;
  /** Sharing link to the OneDrive or SharePoint folder that holds the workbook. */
  folderUrl: string;
  /** File name of the workbook in that folder. Optional when the folder has one .xlsx. */
  workbookName?: string;
  /**
   * Emails allowed to run first-time setup (which makes them an admin). When omitted, the
   * first person with edit access to open the app can run it.
   */
  setupAdmins?: string[];
  /** Run against built-in sample data with no Microsoft sign-in (for trying the app). */
  demo?: boolean;
}

export const BASE = import.meta.env.BASE_URL;

export async function loadConfig(): Promise<AppConfig> {
  const demo = new URLSearchParams(window.location.search).has("demo");
  // Static hosts often answer a missing file with index.html, so a body that is not JSON
  // counts as "no config".
  const res = await fetch(`${BASE}config.json`, { cache: "no-store" }).catch(() => null);
  const cfg = res?.ok ? ((await res.json().catch(() => null)) as AppConfig | null) : null;
  if (demo || cfg?.demo) return { tenantId: "", clientId: "", folderUrl: "", ...cfg, demo: true };
  if (!cfg?.clientId || !cfg.tenantId || !cfg.folderUrl) {
    throw new Error("config.json is missing or incomplete. Copy config.example.json to public/config.json and fill it in.");
  }
  return cfg;
}
