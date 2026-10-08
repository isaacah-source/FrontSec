import { useState, type FormEvent } from "react";
import { errorText, isOwner, useStore } from "../lib/store";
import { Field } from "../components/ui";
import { ROLES, ROLE_DESCRIPTIONS, type Role, type User } from "../../shared/constants";

export default function Admin() {
  const { me, users, contacts, links, mutate, toast } = useStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("contributor");
  const [error, setError] = useState("");

  if (me.role !== "admin") return <div className="page"><p>Admins only.</p></div>;

  const owned = (u: User) => contacts.filter((c) => isOwner(u, c)).length;
  const isMe = (u: User) => u.email.toLowerCase() === me.email.toLowerCase();

  const save = async (u: User) => {
    try {
      await mutate((r) => r.saveUser(u));
    } catch (e) {
      toast(errorText(e));
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
      setError("That person is already listed.");
      return;
    }
    try {
      await mutate((r) => r.saveUser({ email: email.trim(), name: name.trim(), role, active: true }));
      setName("");
      setEmail("");
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Admin</h1></header>

      <section className="card">
        <h2>Who can get in</h2>
        <p className="small">
          Access comes from Microsoft 365. Anyone you share the tracker folder with (for example by sharing it
          in a Teams channel or chat) can sign in with their work account and see the data. Removing their access
          to the folder removes their access to the app. Share with <b>edit</b> permission for people who should add
          or change contacts; <b>view</b> permission is enough for read-only.
        </p>
        <div className="row">
          {links.folderUrl && <a className="btn" href={links.folderUrl} target="_blank" rel="noreferrer">Open folder to manage sharing</a>}
          {links.workbookUrl && <a className="btn" href={links.workbookUrl} target="_blank" rel="noreferrer">Open workbook in Excel</a>}
        </div>
      </section>

      <section className="card">
        <h2>Roles in the app</h2>
        <p className="small">
          Roles decide what the app lets each person do. People not listed here can view only. Roles are kept in
          the workbook's <b>App Users</b> tab and match people by their Microsoft sign-in email.
        </p>
        <ul className="plain roles small">
          {ROLES.map((r) => <li key={r}><b>{r}</b>: {ROLE_DESCRIPTIONS[r]}</li>)}
        </ul>
        <div className="table-wrap">
          <table className="users">
            <thead><tr><th>Name</th><th>Microsoft email</th><th>Role</th><th>Contacts owned</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className={u.active ? "" : "inactive"}>
                  <td className="strong">{u.name}{isMe(u) && <span className="muted"> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} disabled={isMe(u)} onChange={(e) => save({ ...u, role: e.target.value as Role })}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>{owned(u)}</td>
                  <td className="row-actions">
                    {!isMe(u) && (
                      <button className="linkish small" onClick={() => save({ ...u, active: !u.active })}>
                        {u.active ? "Remove role" : "Restore role"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="form-grid add-user" onSubmit={add}>
          <Field label="Name (as it appears in Relationship Owner)"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Microsoft email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@frontsec.org" /></Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <div className="field"><span className="field-label">&nbsp;</span><button className="btn primary">Add person</button></div>
          {error && <p className="error wide">{error}</p>}
        </form>
        <p className="muted small">
          Roles are enforced by this app. Anyone with edit access to the folder can still open the workbook in Excel
          and change it directly, and OneDrive's version history records those edits.
        </p>
      </section>
    </div>
  );
}
