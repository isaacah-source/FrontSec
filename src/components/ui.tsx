import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Contact } from "../../shared/constants";
import { formatDate, today } from "../lib/store";

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? " wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

const STATUS_CLASS: Record<string, string> = {
  "Not yet engaged": "s-new",
  Cultivating: "s-cult",
  Pledged: "s-pledged",
  "Active Partner": "s-active",
  Stalled: "s-stalled",
  "Cold - needs decision": "s-cold",
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return <span className={`badge ${STATUS_CLASS[status] ?? ""}`}>{status}</span>;
}

export function FollowUp({ date }: { date: string | null }) {
  if (!date) return <span className="muted">No follow-up set</span>;
  const t = today();
  const cls = date < t ? "overdue" : date === t ? "due" : "";
  return <span className={cls}>{date < t ? "Overdue: " : date === t ? "Due today" : "Follow up "}{date === t ? "" : formatDate(date)}</span>;
}

export function ContactRow({ c, right }: { c: Contact; right?: ReactNode }) {
  return (
    <Link to={`/contacts/${c.id}`} className="contact-row">
      <div className="avatar" aria-hidden>{initials(c.name)}</div>
      <div className="grow">
        <div className="row-title">
          {c.name}
          {c.restricted && <span className="lock" title="Restricted">🔒</span>}
        </div>
        <div className="muted small">{[c.title, c.organization].filter(Boolean).join(" · ") || c.relationshipType}</div>
      </div>
      {right}
    </Link>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
