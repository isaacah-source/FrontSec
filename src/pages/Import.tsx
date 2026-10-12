import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { can, errorText, useStore } from "../lib/store";
import { Empty } from "../components/ui";
import { planImport, type End, type ImportPlan } from "../lib/importFile";
import { contactTypes, type Contact } from "../../shared/constants";

/**
 * Adds many contacts from an Excel file (for example the Outlook-sweep file, or a copy of
 * Master). The file is read in the browser; nothing is saved until you press Add. Rows that
 * match someone already in the tracker start unticked.
 */
export default function Import() {
  const { me, contacts, mutate, toast } = useStore();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: Contact[]; links: number; skippedLinks: number } | null>(null);
  const [show, setShow] = useState<"all" | "new" | "dup">("all");

  const rows = useMemo(() => {
    if (!plan) return [];
    return plan.rows.filter((r) => show === "all" || (show === "dup" ? r.duplicateOf : !r.duplicateOf));
  }, [plan, show]);

  if (!can(me, "editor")) return <div className="page"><Empty>Only editors and admins can import contacts.</Empty></div>;

  const open = async (file: File | undefined) => {
    setError("");
    setResult(null);
    setPlan(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = await readXlsxFile(file);
      const p = planImport(sheets as { sheet: string; data: unknown[][] }[], contacts);
      setPlan(p);
      setPicked(new Set(p.rows.filter((r) => !r.duplicateOf).map((r) => r.fileId)));
    } catch (e) {
      setError(/zip|xlsx|spreadsheet/i.test(String(e)) ? "That file could not be read as an Excel workbook (.xlsx)." : errorText(e));
    }
  };

  const run = async () => {
    if (!plan) return;
    const chosen = plan.rows.filter((r) => picked.has(r.fileId));
    if (!chosen.length) return;
    if (!confirm(`Add ${chosen.length} contacts to the tracker workbook?`)) return;
    setProgress(`Adding contacts: 0 of ${chosen.length}`);
    try {
      const out = await mutate(async (repo) => {
        const added = await repo.importContacts(chosen.map((r) => r.contact), (n) => setProgress(`Adding contacts: ${n} of ${chosen.length}`));
        const made = new Map(chosen.map((r, i) => [r.fileId, added[i]]));
        const byId = new Map(contacts.map((c) => [c.id, c]));
        const resolve = (e: End): Contact | undefined => ("fileId" in e ? made.get(e.fileId) : byId.get(e.trackerId));
        const list = [];
        let skipped = 0;
        for (const l of plan.links) {
          const a = resolve(l.a);
          const b = resolve(l.b);
          if (a && b) list.push({ a, b, kind: l.kind, note: l.note });
          else skipped++;
        }
        setProgress(`Adding ${list.length} connections…`);
        const links = list.length ? await repo.addConnections(list) : 0;
        return { added, links, skippedLinks: skipped + plan.unmatchedLinks };
      });
      setResult(out);
      setPlan(null);
      toast(`Added ${out.added.length} contacts and ${out.links} connections.`);
    } catch (e) {
      setError(`${errorText(e)} Some contacts may already be saved; reload the Contacts page before trying again.`);
    } finally {
      setProgress(null);
    }
  };

  const toggle = (id: number) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const dupCount = plan?.rows.filter((r) => r.duplicateOf).length ?? 0;

  return (
    <div className="page">
      <div className="crumbs"><Link to="/contacts">← Contacts</Link></div>
      <header className="page-head"><h1>Import contacts</h1></header>

      <section className="card">
        <p>
          Choose an Excel file whose contacts tab uses the same column headings as the Master tab
          (Name, Organization, Relationship Type, Email, and so on), such as the Outlook-sweep file.
          A Connections tab in the file is imported too. You see every row before anything is saved.
        </p>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!!progress}
          onChange={(e) => open(e.target.files?.[0])} />
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <section className="card">
          <h2>Done</h2>
          <p>
            Added {result.added.length} contacts and {result.links} connections.
            {result.skippedLinks > 0 && ` ${result.skippedLinks} connections were left out because one of the two people was not imported or not found.`}
          </p>
          <p className="row">
            <Link className="btn primary" to="/contacts?sort=added">See them on Contacts (newest first)</Link>
            <Link className="btn" to="/network">Network map</Link>
          </p>
        </section>
      )}

      {plan && (
        <section className="card">
          <div className="card-head">
            <h2>{fileName} · tab “{plan.sheetName}”</h2>
          </div>
          <p>
            {plan.rows.length} rows: <b>{plan.rows.length - dupCount} new</b>
            {dupCount > 0 && <>, <b>{dupCount} look like people already in the tracker</b> (unticked; tick any that are really someone else)</>}.
            {" "}{plan.links.length} connections{plan.unmatchedLinks > 0 && ` (${plan.unmatchedLinks} more name people who are not in the file or the tracker and will be skipped)`}.
          </p>
          <div className="row import-bar">
            <button className="btn primary" disabled={!!progress || picked.size === 0} onClick={run}>
              {progress ?? `Add ${picked.size} contacts`}
            </button>
            <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
              <option value="all">Show all rows</option>
              <option value="new">Only new</option>
              <option value="dup">Only possible duplicates</option>
            </select>
            <button className="linkish" disabled={!!progress} onClick={() => setPicked(new Set(plan.rows.map((r) => r.fileId)))}>Tick all</button>
            <button className="linkish" disabled={!!progress} onClick={() => setPicked(new Set())}>Untick all</button>
          </div>
          <div className="table-wrap">
            <table className="contacts import">
              <thead>
                <tr><th className="check" /><th>Name</th><th>Organization</th><th>Type</th><th>Email</th><th>Already in tracker?</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.fileId} className={picked.has(r.fileId) ? "sel" : ""} onClick={() => !progress && toggle(r.fileId)}>
                    <td className="check"><input type="checkbox" checked={picked.has(r.fileId)} disabled={!!progress} onChange={() => toggle(r.fileId)} onClick={(e) => e.stopPropagation()} aria-label={`Import ${r.contact.name}`} /></td>
                    <td className="strong">{r.contact.name}<div className="muted small">{r.contact.title}</div></td>
                    <td>{r.contact.organization}</td>
                    <td className="small">{contactTypes({ relationshipType: r.contact.relationshipType ?? null, otherTypes: r.contact.otherTypes }).join(", ")}</td>
                    <td className="small">{r.contact.email}</td>
                    <td className="small">
                      {r.duplicateOf ? (
                        r.duplicateOf.id ? <Link to={`/contacts/${r.duplicateOf.id}`} onClick={(e) => e.stopPropagation()}>{r.duplicateOf.name}</Link> : r.duplicateOf.name
                      ) : <span className="muted">No</span>}
                      {r.duplicateOf && <span className="muted"> · {r.duplicateOf.why}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
