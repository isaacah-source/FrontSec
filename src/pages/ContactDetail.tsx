import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDays, can, canEditContact, errorText, formatDate, isOwner, today, useStore } from "../lib/store";
import { Empty, Field, FollowUp, StatusBadge, initials } from "../components/ui";
import { ownerNames } from "./Contacts";
import { CONNECTION_KINDS, INTERACTION_TYPES, STATUSES, splitIssues, type Contact } from "../../shared/constants";

export default function ContactDetail() {
  const id = Number(useParams().id);
  const { me, users, contacts, interactions, connections, mutate, toast } = useStore();
  const navigate = useNavigate();
  const [showLog, setShowLog] = useState(false);
  const c = contacts.find((x) => x.id === id);

  const related = useMemo(() => {
    if (!c) return null;
    const sameOrg = c.organization
      ? contacts.filter((x) => x.id !== c.id && x.organization?.toLowerCase() === c.organization!.toLowerCase())
      : [];
    const myIssues = splitIssues(c.tags, c.interestArea).map((i) => i.toLowerCase());
    const sharedIssue = myIssues.length
      ? contacts.filter((x) => x.id !== c.id && splitIssues(x.tags, x.interestArea).some((i) => myIssues.includes(i.toLowerCase())))
      : [];
    const links = connections
      .filter((x) => x.contactA === c.id || x.contactB === c.id)
      .map((x) => ({ ...x, other: contacts.find((o) => o.id === (x.contactA === c.id ? x.contactB : x.contactA)) }))
      .filter((x) => x.other);
    const log = interactions.filter((i) => i.contactId === c.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return { sameOrg, sharedIssue, links, log, issues: splitIssues(c.tags, c.interestArea) };
  }, [c, contacts, connections, interactions]);

  if (!c || !related) return <div className="page"><div className="crumbs"><Link to="/contacts">← Contacts</Link></div><Empty>This contact is not in the workbook. Someone may have deleted it.</Empty></div>;
  const editable = canEditContact(me, c);

  // One-field changes (owner, status, follow-up) are applied to the latest row without a
  // version check: they cannot undo someone else's edit to a different field.
  const quickSet = async (change: Partial<Contact>) => {
    try {
      await mutate((r) => r.updateContact(c.id, change));
    } catch (e) {
      toast(errorText(e));
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${c.name} and their touchpoints from the workbook? You can restore it from the file's version history in OneDrive.`)) return;
    try {
      await mutate((r) => r.deleteContact(c.id));
      navigate("/contacts");
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div className="page">
      <div className="crumbs"><Link to="/contacts">← Contacts</Link></div>
      <header className="profile">
        <div className="avatar big" aria-hidden>{initials(c.name)}</div>
        <div className="grow">
          <h1>{c.name}{c.restricted && <span className="lock" title="Marked restricted in the workbook"> 🔒</span>}</h1>
          <div className="muted">{[c.title, c.organization].filter(Boolean).join(" · ")}</div>
          <div className="badges">
            <StatusBadge status={c.status} />
            {c.relationshipType && <span className="badge plain">{c.relationshipType}</span>}
            {c.international && <span className="badge plain">International</span>}
          </div>
        </div>
      </header>

      <div className="actions">
        {c.phone && <a className="btn" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>Call</a>}
        {c.email && <a className="btn" href={`mailto:${c.email}`}>Email</a>}
        {can(me, "contributor") && <button className="btn primary" onClick={() => setShowLog((s) => !s)}>Log touchpoint</button>}
        {editable && <Link className="btn" to={`/contacts/${c.id}/edit`}>Edit</Link>}
        {me.role === "admin" && <button className="btn danger" onClick={remove}>Delete</button>}
      </div>

      {showLog && <LogTouchpoint contact={c} onDone={() => setShowLog(false)} />}

      <div className="grid2">
        <section className="card">
          <h2>Relationship</h2>
          <dl className="facts">
            <dt>Owner</dt>
            <dd>
              {can(me, "editor") ? (
                <select value={c.owner ?? ""} onChange={(e) => quickSet({ owner: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {ownerNames(users, contacts).map((n) => <option key={n}>{n}</option>)}
                </select>
              ) : (
                c.owner ?? <span className="muted">Unassigned</span>
              )}
              {!c.owner && me.role === "contributor" && (
                <button className="linkish" onClick={() => quickSet({ owner: me.name })}>Take ownership</button>
              )}
            </dd>
            <dt>Status</dt>
            <dd>
              {editable ? (
                <select value={c.status ?? ""} onChange={(e) => quickSet({ status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  {c.status && !(STATUSES as readonly string[]).includes(c.status) && <option>{c.status}</option>}
                </select>
              ) : <StatusBadge status={c.status} />}
            </dd>
            <dt>Next follow-up</dt>
            <dd>
              <FollowUp date={c.nextFollowUp} />
              {editable && (
                <span className="quick">
                  {([["1w", 7], ["2w", 14], ["1m", 30], ["3m", 90]] as const).map(([l, d]) => (
                    <button key={l} className="chip" onClick={() => quickSet({ nextFollowUp: addDays(today(), d) })}>+{l}</button>
                  ))}
                  {c.nextFollowUp && <button className="chip" onClick={() => quickSet({ nextFollowUp: null })}>Clear</button>}
                </span>
              )}
            </dd>
            <dt>Last contact</dt><dd>{formatDate(c.lastContact) || <span className="muted">Never logged</span>}</dd>
            {c.referredByName && (<><dt>Referred by</dt><dd>{c.referredByName}{c.referredByRole ? ` (${c.referredByRole})` : ""}</dd></>)}
            <dt>Added</dt><dd>{formatDate(c.dateAdded)}{c.addedBy ? ` by ${c.addedBy}` : ""}</dd>
            {c.updatedAt && (<><dt>Last edit</dt><dd className="small">{c.updatedBy ?? "Someone"} · {c.updatedAt}</dd></>)}
          </dl>
        </section>

        <section className="card">
          <h2>Contact info</h2>
          <dl className="facts">
            {c.email && (<><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></>)}
            {c.phone && (<><dt>Phone</dt><dd><a href={`tel:${c.phone}`}>{c.phone}</a></dd></>)}
            {c.geo && (<><dt>Location</dt><dd>{c.geo}</dd></>)}
            {c.address && (<><dt>Address</dt><dd>{c.address}</dd></>)}
            {c.website && (<><dt>Website</dt><dd><a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a></dd></>)}
            {c.linkedin && (<><dt>LinkedIn</dt><dd><a href={c.linkedin.startsWith("http") ? c.linkedin : `https://${c.linkedin}`} target="_blank" rel="noreferrer">{c.linkedin}</a></dd></>)}
            {related.issues.length > 0 && (
              <>
                <dt>Issues</dt>
                <dd className="chips">{related.issues.map((i) => <Link key={i} className="chip" to={`/contacts?issue=${encodeURIComponent(i)}`}>{i}</Link>)}</dd>
              </>
            )}
          </dl>
          {c.notes && <p className="notes">{c.notes}</p>}
        </section>
      </div>

      <section className="card">
        <h2>Touchpoints</h2>
        {related.log.length === 0 ? (
          <Empty>No touchpoints yet.</Empty>
        ) : (
          <ul className="timeline">
            {related.log.map((i) => (
              <li key={i.id}>
                <div className="small muted">
                  {formatDate(i.date)} · {i.type} · {i.userName ?? "Unknown"}
                  {(i.userEmail?.toLowerCase() === me.email.toLowerCase() || can(me, "editor")) && (
                    <button className="linkish small" onClick={async () => {
                      if (confirm("Delete this touchpoint?")) await mutate((r) => r.deleteTouchpoint(i.id)).catch((e) => toast(errorText(e)));
                    }}>Delete</button>
                  )}
                </div>
                <div className="prewrap">{i.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Connections</h2>
          <Link to={`/network?focus=${c.id}`} className="linkish">See on network map →</Link>
        </div>
        <h3>People they know</h3>
        {related.links.length === 0 ? <p className="muted small">No personal connections recorded.</p> : (
          <ul className="plain">
            {related.links.map((l) => (
              <li key={l.id}>
                <Link to={`/contacts/${l.other!.id}`}>{l.other!.name}</Link>
                <span className="muted small"> · {l.kind}{l.note ? ` · ${l.note}` : ""}</span>
                {can(me, "contributor") && (
                  <button className="linkish small" onClick={() => mutate((r) => r.deleteConnection(l.id)).catch((e) => toast(errorText(e)))}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {can(me, "contributor") && <AddConnection contact={c} />}
        {related.sameOrg.length > 0 && (
          <>
            <h3>Also at {c.organization} ({related.sameOrg.length})</h3>
            <p className="chips">{related.sameOrg.slice(0, 20).map((x) => <Link key={x.id} className="chip" to={`/contacts/${x.id}`}>{x.name}</Link>)}</p>
          </>
        )}
        {related.sharedIssue.length > 0 && (
          <>
            <h3>Share an issue ({related.sharedIssue.length})</h3>
            <p className="chips">{related.sharedIssue.slice(0, 20).map((x) => <Link key={x.id} className="chip" to={`/contacts/${x.id}`}>{x.name}</Link>)}</p>
          </>
        )}
        {isOwner(me, c) && <p className="muted small">You own this relationship.</p>}
      </section>
    </div>
  );
}

function LogTouchpoint({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const { mutate } = useStore();
  const [date, setDate] = useState(today());
  const [type, setType] = useState<string>("Meeting");
  const [summary, setSummary] = useState("");
  const [follow, setFollow] = useState(contact.nextFollowUp && contact.nextFollowUp > today() ? contact.nextFollowUp : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await mutate((r) => r.addTouchpoint(contact, { date, type, summary: summary.trim(), nextFollowUp: follow || null }));
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form-grid" onSubmit={submit}>
      <Field label="Date"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></Field>
      <Field label="Type">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {INTERACTION_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="What happened" wide>
        <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Topics, asks, commitments, who else was there…" required />
      </Field>
      <Field label="Next follow-up" wide>
        <div className="row">
          <input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} />
          {([["1w", 7], ["2w", 14], ["1m", 30], ["3m", 90]] as const).map(([l, d]) => (
            <button type="button" key={l} className="chip" onClick={() => setFollow(addDays(date, d))}>+{l}</button>
          ))}
        </div>
      </Field>
      {error && <p className="error wide">{error}</p>}
      <div className="wide"><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save touchpoint"}</button></div>
    </form>
  );
}

function AddConnection({ contact }: { contact: Contact }) {
  const { contacts, mutate, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("Personal");
  const [note, setNote] = useState("");
  const matches = q.length < 2 ? [] : contacts
    .filter((x) => x.id !== contact.id && x.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);

  const link = async (other: Contact) => {
    try {
      await mutate((r) => r.addConnection(contact, other, kind, note.trim() || null));
      setOpen(false);
      setQ("");
      setNote("");
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>+ Add a connection</button>;
  return (
    <div className="connect-box">
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Connection type">
          {CONNECTION_KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <input placeholder="Note (optional), e.g. “college roommates”" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <input autoFocus placeholder={`Who does ${contact.name.split(" ")[0]} know? Type a name`} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="plain picker">
        {matches.map((m) => (
          <li key={m.id}><button className="linkish" onClick={() => link(m)}>{m.name}</button> <span className="muted small">{m.organization}</span></li>
        ))}
      </ul>
      <button className="linkish small" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
