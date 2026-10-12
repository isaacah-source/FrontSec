import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ConflictError } from "../lib/repo";
import { can, errorText, formatDate, useStore } from "../lib/store";
import { Empty } from "../components/ui";
import { contactTypes, splitIssues, type Contact } from "../../shared/constants";

/** Every likely duplicate pair, with Compare and "Not the same person". */
export default function Duplicates() {
  const { me, duplicates, mutate, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, fn: Parameters<typeof mutate>[0], msg: string) => {
    setBusy(key);
    try {
      await mutate(fn);
      toast(msg);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="crumbs"><Link to="/contacts">← Contacts</Link></div>
      <header className="page-head"><h1>Possible duplicates <span className="muted count">{duplicates.length}</span></h1></header>
      <p className="muted">
        Pairs with the same email or phone, the same name written differently, or flagged by someone.
        Compare opens both side by side so you can merge them into one contact.
      </p>
      {duplicates.length === 0 ? <Empty>No likely duplicates.</Empty> : (
        <ul className="dup-list">
          {duplicates.map(({ a, b, reasons, mark }) => {
            const key = `${a.id}-${b.id}`;
            return (
              <li key={key} className="card">
                <div className="dup-pair">
                  <Brief c={a} />
                  <Brief c={b} />
                </div>
                <div className="row">
                  <span className="badge warn">⚠ {reasons.join(" · ")}</span>
                  {mark?.note && <span className="muted small">“{mark.note}”</span>}
                </div>
                <div className="row">
                  {can(me, "editor") && <Link className="btn primary small" to={`/duplicates/merge?a=${a.id}&b=${b.id}`}>Compare and merge</Link>}
                  {can(me, "contributor") && (
                    <button className="btn small" disabled={busy === key}
                      onClick={() => act(key, (r) => r.markDuplicate(a, b, "not duplicate"), `${a.name} and ${b.name} are kept as different people.`)}>
                      Not the same person
                    </button>
                  )}
                  {mark?.status === "flagged" && can(me, "contributor") && (
                    <button className="linkish small" disabled={busy === key} onClick={() => act(key, (r) => r.clearDuplicateMark(mark.id), "Flag removed.")}>Remove flag</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Brief({ c }: { c: Contact }) {
  return (
    <div className="dup-brief">
      <Link className="strong" to={`/contacts/${c.id}`}>{c.name}</Link>
      <div className="muted small">{[c.title, c.organization, c.office].filter(Boolean).join(" · ")}</div>
      <div className="small">{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
      <div className="muted small">ID {c.id} · added {formatDate(c.dateAdded) || "date unknown"}{c.owner ? ` · owner ${c.owner}` : ""}</div>
    </div>
  );
}

// ---- Merge ---------------------------------------------------------------------------------

type Key = keyof Contact;
const FIELDS: [Key, string][] = [
  ["name", "Name"], ["title", "Title"], ["organization", "Organization"], ["office", "Office / Department"],
  ["relationshipType", "Relationship type"], ["status", "Status"], ["owner", "Relationship owner"], ["email", "Email"],
  ["phone", "Phone"], ["geo", "Location"], ["address", "Address"], ["website", "Website"], ["linkedin", "LinkedIn"],
  ["referredByName", "Referred by"], ["referredByRole", "Referred by (role)"], ["lastContact", "Last contact"],
  ["nextFollowUp", "Next follow-up"], ["dateAdded", "Date added"], ["addedBy", "Added by"], ["international", "International"],
  ["restricted", "Restricted"],
];
/** Fields whose two values can be kept together. */
const LISTS: [Key, string][] = [["otherTypes", "Other categories"], ["interestArea", "Interest area"], ["tags", "Tags"], ["notes", "Notes"]];

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : v ? String(v) : "");

export function MergeContacts() {
  const { me, contacts, interactions, connections, mutate, toast } = useStore();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const a = contacts.find((c) => c.id === Number(params.get("a")));
  const b = contacts.find((c) => c.id === Number(params.get("b")));
  // Keep the older record (lower Unique ID) unless the person picks the other.
  const [keepId, setKeepId] = useState<number | null>(null);
  const keep = a && b ? ((keepId ?? Math.min(a.id, b.id)) === a.id ? a : b) : undefined;
  const drop = keep && (keep === a ? b : a);
  const [choice, setChoice] = useState<Partial<Record<Key, "keep" | "drop">>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const merged = useMemo(() => {
    if (!keep || !drop) return null;
    const out: Partial<Contact> = {};
    for (const [k] of FIELDS) {
      const kv = keep[k];
      const dv = drop[k];
      let pick = choice[k];
      if (!pick) {
        // Sensible defaults: fill blanks, the latest contact, the earliest added date.
        if (k === "lastContact") pick = (dv ?? "") > (kv ?? "") ? "drop" : "keep";
        else if (k === "dateAdded") pick = dv && (!kv || dv < kv) ? "drop" : "keep";
        else if (k === "nextFollowUp") pick = dv && (!kv || dv < kv) ? "drop" : "keep";
        else pick = kv === null || kv === "" || kv === false ? (dv ? "drop" : "keep") : "keep";
      }
      (out as Record<string, unknown>)[k] = pick === "drop" ? dv : kv;
    }
    const otherTypes = contactTypes({ relationshipType: null, otherTypes: [keep.relationshipType, keep.otherTypes, drop.relationshipType, drop.otherTypes].filter(Boolean).join("; ") })
      .filter((t) => t !== out.relationshipType);
    out.otherTypes = otherTypes.join("; ") || null;
    out.interestArea = splitIssues(keep.interestArea, drop.interestArea).join("; ") || null;
    out.tags = splitIssues(keep.tags, drop.tags).join("; ") || null;
    out.notes = [keep.notes, drop.notes && drop.notes !== keep.notes ? `[Merged from ${drop.name}, ID ${drop.id}] ${drop.notes}` : null].filter(Boolean).join("\n\n") || null;
    return out;
  }, [keep, drop, choice]);

  if (!can(me, "editor")) return <div className="page"><Empty>Only editors and admins can merge contacts.</Empty></div>;
  if (!a || !b || !keep || !drop || !merged || a.id === b.id) {
    return <div className="page"><div className="crumbs"><Link to="/duplicates">← Possible duplicates</Link></div><Empty>One of these contacts no longer exists. It may already be merged.</Empty></div>;
  }

  const moved = interactions.filter((i) => i.contactId === drop.id).length;
  const links = connections.filter((x) => x.contactA === drop.id || x.contactB === drop.id).length;

  const run = async () => {
    if (!confirm(`Merge ${drop.name} (ID ${drop.id}) into ${keep.name} (ID ${keep.id})? ${drop.name}'s row is removed from Master; the file's version history can restore it.`)) return;
    setBusy(true);
    setError("");
    try {
      const saved = await mutate((r) => r.mergeContacts(keep, drop, merged));
      toast(`Merged into ${saved.name}.`);
      navigate(`/contacts/${saved.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ConflictError ? `${e.current.name} changed while this screen was open. Reload and check again.` : errorText(e));
      setBusy(false);
    }
  };

  const Pick = ({ k, label }: { k: Key; label: string }) => {
    const kv = show(keep[k]);
    const dv = show(drop[k]);
    if (kv === dv) return kv ? <tr className="same"><th>{label}</th><td colSpan={2}>{kv}</td></tr> : null;
    const cur = (merged as Record<string, unknown>)[k] === drop[k] && kv !== dv ? "drop" : "keep";
    return (
      <tr>
        <th>{label}</th>
        {(["keep", "drop"] as const).map((side) => {
          const v = side === "keep" ? kv : dv;
          return (
            <td key={side} className={cur === side ? "chosen" : ""}>
              <label className="pick">
                <input type="radio" name={k} checked={cur === side} onChange={() => setChoice((c) => ({ ...c, [k]: side }))} />
                {v || <span className="muted">blank</span>}
              </label>
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="page">
      <div className="crumbs"><Link to="/duplicates">← Possible duplicates</Link></div>
      <header className="page-head"><h1>Merge contacts</h1></header>
      <p className="muted">
        Pick the value to keep wherever the two differ. Categories, interest areas and tags are combined; notes from both are kept.
        {moved > 0 || links > 0 ? ` ${moved} touchpoint${moved === 1 ? "" : "s"} and ${links} connection${links === 1 ? "" : "s"} move to the kept contact.` : ""}
      </p>
      <div className="table-wrap card">
        <table className="merge">
          <thead>
            <tr>
              <th />
              {[keep, drop].map((c) => (
                <th key={c.id}>
                  <label className="pick">
                    <input type="radio" name="keep" checked={c === keep} onChange={() => { setKeepId(c.id); setChoice({}); }} />
                    {c === keep ? "Keep this record" : "Merge into the other"}
                  </label>
                  <div className="muted small">ID {c.id} · <Link to={`/contacts/${c.id}`}>open</Link></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(([k, label]) => <Pick key={k} k={k} label={label} />)}
            {LISTS.map(([k, label]) => (merged[k] ? <tr key={k} className="same"><th>{label}</th><td colSpan={2} className="prewrap">{show(merged[k])}</td></tr> : null))}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={run}>{busy ? "Merging…" : `Merge into ${keep.name}`}</button>
        <Link className="btn" to="/duplicates">Cancel</Link>
      </div>
    </div>
  );
}
