import { useEffect, useRef, useState } from "react";
import { joinExtras, parseExtras, type LabeledValue } from "../../shared/constants";

/**
 * Extra email addresses or phone numbers, each with a label, edited as rows under the main
 * field. The value is the Other Emails / Other Phones cell text ("Mobile: 202-555-0100; ...").
 */
export function ExtraValues({ value, onChange, labels, kind }: {
  value: string;
  onChange: (v: string) => void;
  labels: readonly string[];
  kind: "email" | "phone";
}) {
  const [rows, setRows] = useState<LabeledValue[]>(() => parseExtras(value));
  // What this component last reported, so a change from outside (a card fill, or another
  // person's version loaded after a conflict) resets the rows, but typing does not.
  const reported = useRef(value);
  useEffect(() => {
    if (value !== reported.current) {
      setRows(parseExtras(value));
      reported.current = value;
    }
  }, [value]);

  const update = (next: LabeledValue[]) => {
    setRows(next);
    const text = joinExtras(next) ?? "";
    reported.current = text;
    onChange(text);
  };
  const noun = kind === "email" ? "email" : "phone";

  return (
    <div className="extras">
      {rows.map((r, i) => (
        <div key={i} className="extra-row">
          <select aria-label={`Label for ${noun} ${i + 2}`} value={labels.includes(r.label) ? r.label : r.label ? "__custom" : ""}
            onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, label: e.target.value === "__custom" ? x.label : e.target.value } : x)))}>
            <option value="">No label</option>
            {labels.map((l) => <option key={l}>{l}</option>)}
            {r.label && !labels.includes(r.label) && <option value="__custom">{r.label}</option>}
          </select>
          <input
            type={kind === "email" ? "email" : "tel"}
            inputMode={kind === "email" ? "email" : "tel"}
            aria-label={`${kind === "email" ? "Email" : "Phone"} ${i + 2}`}
            placeholder={kind === "email" ? "another@address.org" : "Another number"}
            value={r.value}
            onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button type="button" className="linkish small" aria-label={`Remove ${noun} ${i + 2}`} onClick={() => update(rows.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="linkish small" onClick={() => update([...rows, { label: kind === "phone" && rows.length === 0 ? "Mobile" : "", value: "" }])}>
        + Add another {noun}
      </button>
    </div>
  );
}
