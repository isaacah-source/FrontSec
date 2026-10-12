import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { can, errorText, formatDate, useStore } from "../lib/store";
import { Empty } from "../components/ui";
import { planImport, type End, type ImportPlan } from "../lib/importFile";
import { contactTypes, type Contact } from "../../shared/constants";

/**
 * Adds many contacts from an Excel file (for example the Outlook-sweep file, or a copy of
 * Master). The file is read in the browser; nothing is saved until you press Add. Rows that
 * match someone already in the tracker start unticked.
 */
export default function Import() {
  const { me, contacts, interactions, mutate, toast } = useStore();
  const [pickedNews, setPickedNews] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: Contact[]; links: number; skippedLinks: number; updated: number; touched: number } | null>(null);
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
      const p = planImport(sheets as { sheet: string; data: unknown[][] }[], contacts, interactions);
      setPlan(p);
      setPicked(new Set(p.rows.filter((r) => !r.duplicateOf).map((r) => r.fileId)));
      setPickedNews(new Set([...p.updates.map((u) => u.key), ...p.touches.filter((t) => !t.duplicate).map((t) => t.key)]));
    } catch (e) {
      setError(/zip|xlsx|spreadsheet/i.test(String(e)) ? "That file could not be read as an Excel workbook (.xlsx)." : errorText(e));
    }
  };

  const run = async () => {
    if (!plan) return;
    const chosen = plan.rows.filter((r) => picked.has(r.fileId));
    const updates = plan.updates.filter((u) => pickedNews.has(u.key));
    const touches = plan.touches.filter((t) => pickedNews.has(t.key));
    if (!chosen.length && !updates.length && !touches.length) return;
    if (!confirm(`Save to the tracker workbook: ${summary(chosen.length, updates.length, touches.length)}?`)) return;
    setProgress("Saving…");
    try {
      const out = await mutate(async (repo) => {
        const added = chosen.length
          ? await repo.importContacts(chosen.map((r) => r.contact), (n) => setProgress(`Adding contacts: ${n} of ${chosen.length}`))
          : [];
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

        // Changes to existing contacts: one save per contact, only the ticked fields.
        const byContact = new Map<number, Partial<Contact>>();
        for (const u of updates) byContact.set(u.contact.id, { ...byContact.get(u.contact.id), [u.field]: u.value });
        let updated = 0;
        for (const [id, changes] of byContact) {
          setProgress(`Updating contacts: ${++updated} of ${byContact.size}`);
          await repo.updateContact(id, changes);
        }

        // Touchpoints last, against fresh rows, so Date of Last Contact moves forward correctly.
        let touched = 0;
        if (touches.length) {
          const fresh = new Map((await repo.load()).contacts.map((c) => [c.id, c]));
          for (const t of touches) {
            const target = "fileId" in t.who ? made.get(t.who.fileId) : fresh.get(t.who.trackerId);
            const c = target && fresh.get(target.id);
            if (!c) continue;
            setProgress(`Logging touchpoints: ${++touched} of ${touches.length}`);
            fresh.set(c.id, await repo.addTouchpoint(c, { date: t.date, type: t.type, summary: t.summary }));
          }
        }
        return { added, links, skippedLinks: skipped + plan.unmatchedLinks, updated: byContact.size, touched };
      });
      setResult(out);
      setPlan(null);
      toast(`Saved: ${summary(out.added.length, out.updated, out.touched)}.`);
    } catch (e) {
      setError(`${errorText(e)} Some contacts may already be saved; reload the Contacts page before trying again.`);
    } finally {
      setProgress(null);
    }
  };

  const toggleNews = (k: string) => setPickedNews((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
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
      <header className="page-head"><h1>Import contacts and updates</h1></header>

      <section className="card">
        <p>
          Choose an Excel file whose contacts tab uses the same column headings as the Master tab
          (Name, Organization, Relationship Type, Email, and so on), such as the Outlook-sweep file.
          A Connections tab in the file is imported too, and the weekly email sweep's Updates and
          Touchpoints tabs suggest changes to people already in the tracker. You see every row before anything is saved.
        </p>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!!progress}
          onChange={(e) => open(e.target.files?.[0])} />
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <section className="card">
          <h2>Done</h2>
          <p>
            Added {result.added.length} contacts and {result.links} connections, updated {result.updated} existing
            contact{result.updated === 1 ? "" : "s"}, and logged {result.touched} touchpoint{result.touched === 1 ? "" : "s"}.
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
            <h2>{fileName}</h2>
          </div>
          {plan.rows.length > 0 && <p>
            New contacts (tab “{plan.sheetName}”): {plan.rows.length} rows: <b>{plan.rows.length - dupCount} new</b>
            {dupCount > 0 && <>, <b>{dupCount} look like people already in the tracker</b> (unticked; tick any that are really someone else)</>}.
            {" "}{plan.links.length} connections{plan.unmatchedLinks > 0 && ` (${plan.unmatchedLinks} more name people who are not in the file or the tracker and will be skipped)`}.
          </p>}
          {(plan.updates.length > 0 || plan.touches.length > 0) && (
            <p>
              Existing contacts: {plan.updates.length} suggested update{plan.updates.length === 1 ? "" : "s"} and {plan.touches.length} touchpoint{plan.touches.length === 1 ? "" : "s"} (see below).
              {plan.skippedNews > 0 && ` ${plan.skippedNews} more were left out: already current, or the contact was not found.`}
            </p>
          )}
          <div className="row import-bar">
            <button className="btn primary" disabled={!!progress || picked.size + pickedNews.size === 0} onClick={run}>
              {progress ?? `Save ${summary(picked.size, plan.updates.filter((u) => pickedNews.has(u.key)).length, plan.touches.filter((t) => pickedNews.has(t.key)).length)}`}
            </button>
            {plan.rows.length > 0 && <>
            <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
              <option value="all">Show all rows</option>
              <option value="new">Only new</option>
              <option value="dup">Only possible duplicates</option>
            </select>
            <button className="linkish" disabled={!!progress} onClick={() => setPicked(new Set(plan.rows.map((r) => r.fileId)))}>Tick all</button>
            <button className="linkish" disabled={!!progress} onClick={() => setPicked(new Set())}>Untick all</button>
            </>}
          </div>
          {plan.rows.length > 0 && <div className="table-wrap">
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
          </div>}
          {plan.updates.length > 0 && (
            <>
              <h3>Updates to existing contacts</h3>
              <div className="table-wrap">
                <table className="contacts import">
                  <thead><tr><th className="check" /><th>Contact</th><th>Field</th><th>Now</th><th>Change to</th><th>Seen in</th></tr></thead>
                  <tbody>
                    {plan.updates.map((u) => (
                      <tr key={u.key} className={pickedNews.has(u.key) ? "sel" : ""} onClick={() => !progress && toggleNews(u.key)}>
                        <td className="check"><input type="checkbox" checked={pickedNews.has(u.key)} disabled={!!progress} onChange={() => toggleNews(u.key)} onClick={(e) => e.stopPropagation()} aria-label={`Update ${u.label} for ${u.contact.name}`} /></td>
                        <td className="strong"><Link to={`/contacts/${u.contact.id}`} onClick={(e) => e.stopPropagation()}>{u.contact.name}</Link></td>
                        <td className="small">{u.label}</td>
                        <td className="small muted">{show2(u.current) || "blank"}</td>
                        <td className="small">{show2(u.value) || "blank"}</td>
                        <td className="small muted">{u.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {plan.touches.length > 0 && (
            <>
              <h3>Touchpoints to log</h3>
              <p className="muted small">Logging a touchpoint also moves the contact's Date of Last Contact forward.</p>
              <div className="table-wrap">
                <table className="contacts import">
                  <thead><tr><th className="check" /><th>Contact</th><th>Date</th><th>Type</th><th>Summary</th></tr></thead>
                  <tbody>
                    {plan.touches.map((t) => (
                      <tr key={t.key} className={pickedNews.has(t.key) ? "sel" : ""} onClick={() => !progress && toggleNews(t.key)}>
                        <td className="check"><input type="checkbox" checked={pickedNews.has(t.key)} disabled={!!progress} onChange={() => toggleNews(t.key)} onClick={(e) => e.stopPropagation()} aria-label={`Log touchpoint for ${t.who.name}`} /></td>
                        <td className="strong">{t.who.name}{"fileId" in t.who && <span className="muted small"> (new)</span>}</td>
                        <td className="small">{formatDate(t.date)}</td>
                        <td className="small">{t.type}</td>
                        <td className="small">{t.summary}{t.duplicate && <span className="muted"> · already logged</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function summary(contacts: number, updates: number, touches: number): string {
  const parts = [];
  if (contacts) parts.push(`${contacts} new contact${contacts === 1 ? "" : "s"}`);
  if (updates) parts.push(`${updates} update${updates === 1 ? "" : "s"} to existing contacts`);
  if (touches) parts.push(`${touches} touchpoint${touches === 1 ? "" : "s"}`);
  return parts.join(", ") || "nothing";
}

function show2(v: string | boolean | null): string {
  return typeof v === "boolean" ? (v ? "Yes" : "No") : v ?? "";
}
