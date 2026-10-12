import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { can, errorText, useStore } from "../lib/store";
import { Empty, Field } from "../components/ui";
import { ContactPicker } from "../components/ContactPicker";
import { CONNECTION_KINDS, type Contact } from "../../shared/constants";

/**
 * Who knows who: links between two people that the workbook cannot infer on its own
 * (introductions, personal ties, past work together). Same-organization links need no
 * entry; the app already groups people by organization.
 */
export default function Connections() {
  const { me, contacts, connections, mutate, toast } = useStore();
  const [params] = useSearchParams();
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const [a, setA] = useState<Contact | null>(byId.get(Number(params.get("a"))) ?? null);
  const [b, setB] = useState<Contact | null>(null);
  const [kind, setKind] = useState<string>(CONNECTION_KINDS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filterKind, setFilterKind] = useState("");

  const kinds = useMemo(() => {
    const extra = new Set(connections.map((x) => x.kind).filter((k) => !(CONNECTION_KINDS as readonly string[]).includes(k)));
    return [...CONNECTION_KINDS, ...[...extra].sort()];
  }, [connections]);

  const list = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return connections
      .map((x) => ({ ...x, A: byId.get(x.contactA)!, B: byId.get(x.contactB)! }))
      .filter((x) => x.A && x.B)
      .filter((x) => !filterKind || x.kind === filterKind)
      .filter((x) => {
        const hay = `${x.A.name} ${x.A.organization ?? ""} ${x.B.name} ${x.B.organization ?? ""} ${x.note ?? ""}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .sort((x, y) => y.id - x.id);
  }, [connections, byId, q, filterKind]);

  const editable = can(me, "contributor");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!a || !b) return;
    setBusy(true);
    try {
      await mutate((r) => r.addConnection(a, b, kind, note.trim() || null));
      toast(`Connected ${a.name} and ${b.name}.`);
      setB(null);
      setNote("");
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Who knows who <span className="muted count">{connections.length}</span></h1>
        <div className="head-actions"><Link className="btn" to="/network">Network map</Link></div>
      </header>

      {editable && (
        <form className="card form-grid" onSubmit={submit}>
          {/* Not <Field>: a <label> would pass the click on a name to the Change button that replaces it. */}
          <div className="field"><span className="field-label">Person</span>
            <ContactPicker contacts={contacts} value={a} onChange={setA} placeholder="Type a name" exclude={b?.id} />
          </div>
          <div className="field"><span className="field-label">Knows</span>
            <ContactPicker contacts={contacts} value={b} onChange={setB} placeholder="Type a name" exclude={a?.id} />
          </div>
          <Field label="How they are connected">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {CONNECTION_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={kind === "Introduced / connected" ? "Who introduced whom, and when" : "e.g. served together at DIU, 2019"} />
          </Field>
          <div className="wide">
            <button className="btn primary" disabled={busy || !a || !b}>{busy ? "Saving…" : "Connect them"}</button>
            <span className="muted small"> People at the same organization are linked automatically; use this for everything else.</span>
          </div>
        </form>
      )}

      <div className="filters">
        <input type="search" className="search" placeholder="Search names, organizations, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} aria-label="Connection type">
          <option value="">All kinds</option>
          {kinds.map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>

      {list.length === 0 ? <Empty>No connections {q || filterKind ? "match" : "recorded yet"}.</Empty> : (
        <ul className="card plain conn-list">
          {list.map((x) => (
            <li key={x.id}>
              <Link to={`/contacts/${x.A.id}`}>{x.A.name}</Link>
              <span className="badge plain">{x.kind}</span>
              <Link to={`/contacts/${x.B.id}`}>{x.B.name}</Link>
              {x.note && <div className="muted small">{x.note}</div>}
              {editable && (
                <button className="linkish small" onClick={() => {
                  if (confirm(`Remove the link between ${x.A.name} and ${x.B.name}?`)) mutate((r) => r.deleteConnection(x.id)).catch((err) => toast(errorText(err)));
                }}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
