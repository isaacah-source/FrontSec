import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConflictError } from "../lib/repo";
import { can, errorText, today, useStore } from "../lib/store";
import { readPhotoDate } from "../../shared/photoDate";
import { ownerNames } from "./Contacts";
import { Field } from "../components/ui";
import { readCard, type ScanProgress } from "../lib/scanCard";
import { RELATIONSHIP_TYPES, STATUSES, type Contact } from "../../shared/constants";

type Form = Record<string, string | boolean | number | null>;

const BLANK: Form = {
  name: "", title: "", organization: "", relationshipType: "", status: "Not yet engaged", owner: "",
  email: "", phone: "", geo: "", interestArea: "", tags: "", international: false, restricted: false,
  referredByName: "", referredByRole: "", lastContact: "", nextFollowUp: "", dateAdded: "", notes: "", linkedin: "", website: "", address: "",
};

export default function ContactForm() {
  const params = useParams();
  const editingId = params.id ? Number(params.id) : null;
  const { me, users, contacts, mutate } = useStore();
  const navigate = useNavigate();
  const existing = editingId ? contacts.find((c) => c.id === editingId) : undefined;
  const [form, setForm] = useState<Form>(() =>
    existing ? toForm(existing) : { ...BLANK, owner: me.role === "contributor" ? me.name : "", dateAdded: today() },
  );
  // Where the Date added value came from, shown under the field. A date the person typed is
  // never replaced by a later scan.
  const [dateSource, setDateSource] = useState<"today" | "photo" | "file" | "manual" | null>(existing ? null : "today");
  // What the form started from: only fields that differ from it are saved, so edits other
  // people make in the meantime to other fields survive.
  const [base, setBase] = useState<Form>(() => (existing ? toForm(existing) : { ...BLANK }));
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(existing?.updatedAt ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<Contact[]>([]);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [scanned, setScanned] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Warn about likely duplicates while someone types a new contact.
  useEffect(() => {
    if (editingId) return;
    const name = String(form.name ?? "").trim().toLowerCase();
    const email = String(form.email ?? "").trim().toLowerCase();
    if (name.length < 3 && !email) {
      setDupes([]);
      return;
    }
    setDupes(contacts.filter((c) => (name.length >= 3 && c.name.toLowerCase() === name) || (email && c.email?.toLowerCase() === email)));
  }, [form.name, form.email, editingId, contacts]);

  if (editingId && !existing) return <div className="page"><p>Contact not found.</p></div>;
  if (!can(me, "contributor")) return <div className="page"><p>Your role is read-only.</p></div>;

  const set = (k: string, v: string | boolean | number | null) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: string, props: Record<string, unknown> = {}) => (
    <input
      value={String(form[k] ?? "")}
      onChange={(e) => set(k, e.target.value)}
      className={scanned.includes(k) ? "scanned" : ""}
      {...props}
    />
  );

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      if (dateSource !== "manual") {
        // The date the photo was taken (from the camera's EXIF data); otherwise the file's
        // own date; otherwise today. A picture of a card from last week's event dates the
        // contact to that event.
        const fromPhoto = readPhotoDate(await file.arrayBuffer());
        const fromFile = file.lastModified ? localDate(new Date(file.lastModified)) : null;
        const date = [fromPhoto, fromFile].find((d) => d && d <= today());
        set("dateAdded", date ?? today());
        setDateSource(date === fromPhoto && fromPhoto ? "photo" : date ? "file" : "today");
      }
      const fields = await readCard(file, setScan);
      const filled: string[] = [];
      setForm((f) => {
        const next = { ...f };
        for (const [k, v] of Object.entries(fields)) {
          if (k === "other" || !v) continue;
          if (!next[k]) {
            next[k] = v;
            filled.push(k);
          }
        }
        if (fields.other) next.notes = [f.notes, `From business card: ${fields.other}`].filter(Boolean).join("\n");
        return next;
      });
      setScanned(filled);
      if (!filled.length) setError("Could not pick out any details. Try a sharper photo, or type them in.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the card.");
    } finally {
      setScan(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      const value = typeof v === "string" ? v.trim() || null : v;
      const before = typeof base[k] === "string" ? (base[k] as string).trim() || null : base[k];
      if (!editingId || value !== before) changes[k] = value;
    }
    changes.name = String(form.name).trim();
    try {
      const saved = await mutate((r) =>
        editingId ? r.updateContact(editingId, changes as Partial<Contact>, seenUpdatedAt) : r.createContact(changes as Partial<Contact>),
      );
      navigate(`/contacts/${saved.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ConflictError) {
        setError("Someone else saved this contact while you were editing. Their version is loaded below; re-apply your change and save again.");
        setForm(toForm(err.current));
        setBase(toForm(err.current));
        setSeenUpdatedAt(err.current.updatedAt);
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const ownerChoices = can(me, "editor")
    ? ownerNames(users, contacts)
    : [...new Set([me.name, String(form.owner ?? "")].filter(Boolean))];

  return (
    <div className="page">
      <div className="crumbs"><Link to={editingId ? `/contacts/${editingId}` : "/contacts"}>← Back</Link></div>
      <header className="page-head">
        <h1>{editingId ? `Edit ${existing!.name}` : "New contact"}</h1>
      </header>

      {!editingId && (
        <div className="card scan">
          <div className="grow">
            <b>Scan a business card</b>
            <div className="muted small">
              Take a photo or pick one from your library. The text is read on this device; the photo is not uploaded. Check the fields before saving.
            </div>
            {scan && (
              <div className="progress"><div style={{ width: `${Math.round(scan.progress * 100)}%` }} /><span>{scan.label}</span></div>
            )}
          </div>
          <label className={`btn primary${scan ? " disabled" : ""}`}>
            📷 Scan card
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden disabled={!!scan} onChange={(e) => onPhoto(e.target.files?.[0])} />
          </label>
        </div>
      )}

      {dupes.length > 0 && (
        <div className="banner warn">
          Possible duplicate: {dupes.map((d, i) => (
            <span key={d.id}>{i > 0 && ", "}<Link to={`/contacts/${d.id}`}>{d.name}</Link>{d.organization ? ` (${d.organization})` : ""}</span>
          ))}. Open it to log a touchpoint instead of adding a second record.
        </div>
      )}

      <form className="card form-grid" onSubmit={submit}>
        <Field label="Name *">{text("name", { required: true, autoFocus: !editingId })}</Field>
        <Field label="Title">{text("title")}</Field>
        <Field label="Organization">{text("organization", { list: "orgs" })}</Field>
        <datalist id="orgs">
          {[...new Set(contacts.map((c) => c.organization).filter(Boolean))].sort().map((o) => <option key={o} value={o!} />)}
        </datalist>
        <Field label="Relationship type">
          <select value={String(form.relationshipType ?? "")} onChange={(e) => set("relationshipType", e.target.value)}>
            <option value="">Choose…</option>
            {RELATIONSHIP_TYPES.map((t) => <option key={t}>{t}</option>)}
            {/* Keep a retired type selectable so opening the form does not silently change it. */}
            {form.relationshipType && !(RELATIONSHIP_TYPES as readonly string[]).includes(String(form.relationshipType)) && (
              <option value={String(form.relationshipType)}>{String(form.relationshipType)} (old category)</option>
            )}
          </select>
        </Field>
        <Field label="Status">
          <select value={String(form.status ?? "")} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Relationship owner">
          <select value={String(form.owner ?? "")} onChange={(e) => set("owner", e.target.value)}>
            <option value="">Unassigned</option>
            {ownerChoices.map((n) => <option key={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Email">{text("email", { type: "email", inputMode: "email" })}</Field>
        <Field label="Phone">{text("phone", { type: "tel", inputMode: "tel" })}</Field>
        <Field label="Location (Geo)">{text("geo")}</Field>
        <Field label="Interest area">{text("interestArea", { placeholder: "Separate issues with ;" })}</Field>
        <Field label="Tags / category">{text("tags", { placeholder: "e.g. Fundraising, National Security" })}</Field>
        <Field label="Referred by (name)">{text("referredByName")}</Field>
        <Field label="Referred by (role)">{text("referredByRole")}</Field>
        <Field label="Date of last contact"><input type="date" value={String(form.lastContact ?? "")} onChange={(e) => set("lastContact", e.target.value)} /></Field>
        <Field label="Next follow-up"><input type="date" value={String(form.nextFollowUp ?? "")} onChange={(e) => set("nextFollowUp", e.target.value)} /></Field>
        <Field label="Date added">
          <input
            type="date"
            value={String(form.dateAdded ?? "")}
            max={today()}
            className={dateSource === "photo" || dateSource === "file" ? "scanned" : ""}
            onChange={(e) => {
              set("dateAdded", e.target.value);
              setDateSource("manual");
            }}
          />
          {dateSource === "photo" && <span className="muted small">Date the card photo was taken</span>}
          {dateSource === "file" && <span className="muted small">Date of the photo file</span>}
          {dateSource === "today" && <span className="muted small">Today; change it if you met them earlier</span>}
        </Field>
        <Field label="LinkedIn">{text("linkedin")}</Field>
        <Field label="Website">{text("website")}</Field>
        <Field label="Address" wide>{text("address")}</Field>
        <Field label="Notes" wide>
          <textarea rows={4} value={String(form.notes ?? "")} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <label className="check-field">
          <input type="checkbox" checked={Boolean(form.international)} onChange={(e) => set("international", e.target.checked)} /> International
        </label>
        <label className="check-field">
          <input type="checkbox" checked={Boolean(form.restricted)} onChange={(e) => set("restricted", e.target.checked)} />
          Restricted (a label only: everyone with access to the workbook can still read it)
        </label>
        {error && <p className="error wide">{error}</p>}
        <div className="wide row">
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Add contact"}</button>
          <Link className="btn" to={editingId ? `/contacts/${editingId}` : "/contacts"}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}

function toForm(c: Contact): Form {
  const f: Form = {};
  for (const k of Object.keys(BLANK)) {
    const v = (c as unknown as Record<string, unknown>)[k];
    f[k] = typeof v === "boolean" ? v : ((v as string | null) ?? "");
  }
  return f;
}

/** "YYYY-MM-DD" in the device's own time zone. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
