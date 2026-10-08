import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { addDays, can, errorText, formatDate, isOwner, today, useStore } from "../lib/store";
import { Empty, FollowUp, StatusBadge, initials } from "../components/ui";
import { RELATIONSHIP_TYPES, STATUSES, splitIssues, type Contact, type User } from "../../shared/constants";

type SortKey = "name" | "organization" | "status" | "owner" | "lastContact" | "nextFollowUp";

export default function Contacts() {
  const { me, contacts, users, toast, mutate, links } = useStore();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [busy, setBusy] = useState(false);

  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const owner = params.get("owner") ?? "";
  const due = params.get("due") ?? "";
  const issue = params.get("issue") ?? "";
  const org = params.get("org") ?? "";

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const issues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of contacts) for (const i of splitIssues(c.tags, c.interestArea)) counts.set(i, (counts.get(i) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([i]) => i);
  }, [contacts]);

  const filtered = useMemo(() => {
    const t = today();
    const week = addDays(t, 7);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = contacts.filter((c) => {
      if (type && c.relationshipType !== type) return false;
      if (status && c.status !== status) return false;
      if (owner === "none" && c.owner) return false;
      if (owner === "me" && !isOwner(me, c)) return false;
      if (owner && owner !== "none" && owner !== "me" && (c.owner ?? "").toLowerCase() !== owner.toLowerCase()) return false;
      if (due === "overdue" && !(c.nextFollowUp && c.nextFollowUp < t)) return false;
      if (due === "week" && !(c.nextFollowUp && c.nextFollowUp >= t && c.nextFollowUp <= week)) return false;
      if (due === "none" && c.nextFollowUp) return false;
      if (org && (c.organization ?? "").toLowerCase() !== org.toLowerCase()) return false;
      if (issue && !splitIssues(c.tags, c.interestArea).some((i) => i.toLowerCase() === issue.toLowerCase())) return false;
      if (terms.length) {
        const hay = [c.name, c.organization, c.title, c.email, c.notes, c.tags, c.interestArea, c.geo, c.owner]
          .filter(Boolean).join(" ").toLowerCase();
        if (!terms.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const val = (c: Contact): string => {
      switch (sort.key) {
        case "owner": return c.owner ?? "\uffff";
        case "status": return String(STATUSES.indexOf(c.status as (typeof STATUSES)[number]));
        default: return (c[sort.key] ?? "\uffff") as string;
      }
    };
    return list.sort((a, b) => val(a).localeCompare(val(b), undefined, { sensitivity: "base" }) * sort.dir);
  }, [contacts, q, type, status, owner, due, issue, org, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulk = async (change: Partial<Contact>, label: string) => {
    setBusy(true);
    let failed = 0;
    await mutate(async (repo) => {
      for (const id of selected) {
        try {
          await repo.updateContact(id, change);
        } catch (e) {
          failed++;
          console.warn(errorText(e));
        }
      }
    }).catch(() => {});
    setBusy(false);
    setSelected(new Set());
    toast(failed ? `${label}: ${failed} could not be changed.` : `${label} for ${selected.size} contacts.`);
  };

  const bulkMode = can(me, "editor");
  const hasFilters = q || type || status || owner || due || issue || org;
  const owners = ownerNames(users, contacts);

  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th className="sortable" onClick={() => toggleSort(k)}>
      {children}{sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="page">
      <header className="page-head">
        <h1>Contacts <span className="muted count">{filtered.length}</span></h1>
        <div className="head-actions">
          {links.workbookUrl && <a className="btn" href={links.workbookUrl} target="_blank" rel="noreferrer">Open in Excel</a>}
          {can(me, "contributor") && <Link className="btn primary" to="/contacts/new">Add contact</Link>}
        </div>
      </header>

      <div className="filters">
        <input type="search" className="search" placeholder="Search name, org, notes, tags…" value={q} onChange={(e) => set("q", e.target.value)} />
        <select value={type} onChange={(e) => set("type", e.target.value)} aria-label="Relationship type">
          <option value="">All types</option>
          {RELATIONSHIP_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={owner} onChange={(e) => set("owner", e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          <option value="me">Me</option>
          <option value="none">Unassigned</option>
          {owners.map((n) => <option key={n}>{n}</option>)}
        </select>
        <select value={due} onChange={(e) => set("due", e.target.value)} aria-label="Follow-up">
          <option value="">Any follow-up</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due in 7 days</option>
          <option value="none">No follow-up set</option>
        </select>
        <select value={issue} onChange={(e) => set("issue", e.target.value)} aria-label="Issue">
          <option value="">Any issue</option>
          {issues.map((i) => <option key={i}>{i}</option>)}
        </select>
        {org && <button className="chip" onClick={() => set("org", "")}>Org: {org} ✕</button>}
        {hasFilters && <button className="linkish" onClick={() => setParams({}, { replace: true })}>Clear</button>}
      </div>

      {bulkMode && selected.size > 0 && (
        <div className="bulkbar">
          <b>{selected.size} selected</b>
          <select disabled={busy} defaultValue="" onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            bulk({ owner: v === "\u0000" ? null : v }, v === "\u0000" ? "Unassigned" : `Assigned to ${v}`);
            e.target.value = "";
          }}>
            <option value="">Assign owner…</option>
            <option value={"\u0000"}>Nobody</option>
            {owners.map((n) => <option key={n}>{n}</option>)}
          </select>
          <select disabled={busy} defaultValue="" onChange={(e) => {
            if (e.target.value) bulk({ status: e.target.value }, `Status set to ${e.target.value}`);
            e.target.value = "";
          }}>
            <option value="">Set status…</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="linkish" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty>No contacts match. {hasFilters ? "Try clearing a filter." : ""}</Empty>
      ) : (
        <>
          <div className="table-wrap desktop-only">
            <table className="contacts">
              <thead>
                <tr>
                  {bulkMode && (
                    <th className="check">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={selected.size > 0 && selected.size === filtered.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())}
                      />
                    </th>
                  )}
                  <Th k="name">Name</Th>
                  <Th k="organization">Organization</Th>
                  <th>Type</th>
                  <Th k="status">Status</Th>
                  <Th k="owner">Owner</Th>
                  <Th k="lastContact">Last contact</Th>
                  <Th k="nextFollowUp">Follow-up</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/contacts/${c.id}`)} className={selected.has(c.id) ? "sel" : ""}>
                    {bulkMode && (
                      <td className="check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                    )}
                    <td className="strong">{c.name}{c.restricted && " 🔒"}</td>
                    <td>{c.organization}</td>
                    <td className="small">{c.relationshipType}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>{c.owner ?? <span className="muted">Unassigned</span>}</td>
                    <td className="small">{formatDate(c.lastContact)}</td>
                    <td className="small"><FollowUp date={c.nextFollowUp} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="list mobile-only">
            {filtered.map((c) => (
              <Link key={c.id} to={`/contacts/${c.id}`} className="contact-row">
                <div className="avatar" aria-hidden>{initials(c.name)}</div>
                <div className="grow">
                  <div className="row-title">{c.name}{c.restricted && " 🔒"}</div>
                  <div className="muted small">{c.organization ?? c.relationshipType}</div>
                  <div className="small"><StatusBadge status={c.status} /> {c.owner && <span className="muted">· {c.owner}</span>}</div>
                </div>
                {c.nextFollowUp && <span className="small"><FollowUp date={c.nextFollowUp} /></span>}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Everyone who can be picked as an owner: app users plus names already in the sheet. */
export function ownerNames(users: User[], contacts: Contact[]): string[] {
  const names = new Map<string, string>();
  for (const u of users) if (u.active) names.set(u.name.toLowerCase(), u.name);
  for (const c of contacts) if (c.owner && !names.has(c.owner.toLowerCase())) names.set(c.owner.toLowerCase(), c.owner);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
