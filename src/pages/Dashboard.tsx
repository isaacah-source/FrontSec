import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, formatDate, isOwner, today, useStore } from "../lib/store";
import { ContactRow, Empty, FollowUp } from "../components/ui";
import { RELATIONSHIP_TYPES, STATUSES } from "../../shared/constants";

export default function Dashboard() {
  const { me, contacts, interactions } = useStore();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const names = useMemo(() => new Map(contacts.map((c) => [c.id, c.name])), [contacts]);
  const activity = useMemo(
    () => [...interactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 15),
    [interactions],
  );

  const t = today();
  const week = addDays(t, 7);
  const pool = scope === "mine" ? contacts.filter((c) => isOwner(me, c)) : contacts;
  const overdue = pool.filter((c) => c.nextFollowUp && c.nextFollowUp < t).sort(byFollowUp);
  const upcoming = pool.filter((c) => c.nextFollowUp && c.nextFollowUp >= t && c.nextFollowUp <= week).sort(byFollowUp);
  const unassigned = contacts.filter((c) => !c.owner).length;
  const mine = contacts.filter((c) => isOwner(me, c)).length;
  const stale = pool.filter((c) => !c.nextFollowUp && c.status !== "Not yet engaged").length;

  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const c of contacts) {
      const type = c.relationshipType ?? "Unspecified";
      const row = m.get(type) ?? new Map<string, number>();
      row.set(c.status ?? "Not yet engaged", (row.get(c.status ?? "Not yet engaged") ?? 0) + 1);
      m.set(type, row);
    }
    return m;
  }, [contacts]);
  const types = [...RELATIONSHIP_TYPES.filter((t) => matrix.has(t)), ...[...matrix.keys()].filter((t) => !(RELATIONSHIP_TYPES as readonly string[]).includes(t))];

  return (
    <div className="page">
      <header className="page-head">
        <h1>Today</h1>
        <div className="seg">
          <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>My contacts</button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Everyone</button>
        </div>
      </header>

      <div className="stats">
        <Link to="/contacts?due=overdue" className="stat"><b className={overdue.length ? "overdue" : ""}>{overdue.length}</b><span>Overdue follow-ups</span></Link>
        <Link to="/contacts?due=week" className="stat"><b>{upcoming.length}</b><span>Due this week</span></Link>
        <Link to="/contacts?owner=me" className="stat"><b>{mine}</b><span>Assigned to me</span></Link>
        <Link to="/contacts?owner=none" className="stat"><b>{unassigned}</b><span>Unassigned</span></Link>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Follow-ups</h2>
          {overdue.length + upcoming.length === 0 ? (
            <Empty>
              Nothing due in the next 7 days{scope === "mine" ? " for your contacts" : ""}.
              {stale > 0 && <> {stale} active contact{stale === 1 ? " has" : "s have"} no follow-up date.</>}
            </Empty>
          ) : (
            <div className="list">
              {[...overdue, ...upcoming].slice(0, 25).map((c) => (
                <ContactRow key={c.id} c={c} right={<span className="small"><FollowUp date={c.nextFollowUp} /></span>} />
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Recent touchpoints</h2>
          {activity.length === 0 ? (
            <Empty>No touchpoints logged yet. Open a contact and tap “Log touchpoint”.</Empty>
          ) : (
            <ul className="feed">
              {activity.map((a) => (
                <li key={a.id}>
                  <div className="small muted">{formatDate(a.date)} · {a.type} · {a.userName ?? "Unknown"}</div>
                  <Link to={`/contacts/${a.contactId}`} className="strong">{names.get(a.contactId)}</Link>
                  <div className="clamp">{a.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Pipeline by relationship type</h2>
        <div className="table-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th>Type</th>
                {STATUSES.map((s) => <th key={s}>{s}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {types.map((type) => {
                const row = matrix.get(type)!;
                const total = [...row.values()].reduce((a, b) => a + b, 0);
                return (
                  <tr key={type}>
                    <th><Link to={`/contacts?type=${encodeURIComponent(type)}`}>{type}</Link></th>
                    {STATUSES.map((s) => (
                      <td key={s}>
                        {row.get(s) ? <Link to={`/contacts?type=${encodeURIComponent(type)}&status=${encodeURIComponent(s)}`}>{row.get(s)}</Link> : <span className="muted">·</span>}
                      </td>
                    ))}
                    <td className="strong">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const byFollowUp = (a: { nextFollowUp: string | null }, b: { nextFollowUp: string | null }) =>
  (a.nextFollowUp ?? "").localeCompare(b.nextFollowUp ?? "");
