import { useState } from "react";
import type { Contact } from "../../shared/constants";

/** Type-to-search box for choosing one contact. Shows the choice with a Change link. */
export function ContactPicker({ contacts, value, onChange, placeholder, exclude }: {
  contacts: Contact[];
  value: Contact | null;
  onChange: (c: Contact | null) => void;
  placeholder: string;
  exclude?: number;
}) {
  const [q, setQ] = useState("");
  if (value) {
    return (
      <div className="picked">
        <b>{value.name}</b>{value.organization && <span className="muted small"> · {value.organization}</span>}
        {" "}<button type="button" className="linkish small" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length === 0 || q.length < 2 ? [] : contacts
    .filter((c) => c.id !== exclude && terms.every((t) => `${c.name} ${c.organization ?? ""}`.toLowerCase().includes(t)))
    .slice(0, 8);
  return (
    <div>
      <input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <ul className="plain picker">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="linkish" onClick={() => { onChange(m); setQ(""); }}>{m.name}</button>
              {" "}<span className="muted small">{m.organization}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
