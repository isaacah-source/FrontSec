import { useState } from "react";
import { addDays, errorText, formatDate, today, useStore } from "../lib/store";
import { fetchMail } from "../lib/mailFetch";
import {
  MODEL, ReviewError, chunkThreads, cost, findingsToSheets, lastRun, markRun, reviewWithClaude, saveKey, savedKey, threadsToReview,
  type Findings, type Usage,
} from "../lib/emailReview";
import type { SheetIn } from "../lib/importFile";

/**
 * The "Review my email with Claude" button. Nothing touches the mailbox until it is pressed:
 * then the app asks Microsoft for read access to this person's mail, reads the chosen
 * weeks, sends the threads with outside people to Claude, and hands Claude's findings to
 * the Import page for review. Nothing is saved until Save is pressed there.
 */
export function EmailReview({ disabled, onFindings }: {
  disabled: boolean;
  onFindings: (sheets: SheetIn[], label: string, onSaved: () => void) => void;
}) {
  const { me, contacts, mailToken } = useStore();
  const [key, setKey] = useState(savedKey());
  const [editingKey, setEditingKey] = useState(!savedKey());
  const previous = lastRun(me.email);
  const [since, setSince] = useState(previous ?? addDays(today(), -7));
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [report, setReport] = useState<{ emails: number; threads: number; findings: Findings; usage: Usage } | null>(null);

  if (!mailToken) {
    return (
      <section className="card">
        <h2>Review my email with Claude</h2>
        <p className="muted">Not available in demo mode: it needs your Microsoft sign-in.</p>
      </section>
    );
  }

  const run = async () => {
    setError("");
    setReport(null);
    if (!key.trim()) {
      setEditingKey(true);
      setError("Add a Claude API key first.");
      return;
    }
    const end = today();
    try {
      setProgress("Asking Microsoft for read access to your email…");
      const token = await mailToken();
      const mail = await fetchMail(token, since, setProgress);
      const threads = threadsToReview(mail, me.email);
      if (!threads.length) {
        setProgress(null);
        setError(`No threads with people outside FSI between ${formatDate(since)} and ${formatDate(end)}.`);
        return;
      }
      const { findings, usage } = await reviewWithClaude({
        apiKey: key.trim(), me, contacts, chunks: chunkThreads(threads), onProgress: setProgress,
      });
      setReport({ emails: mail.length, threads: threads.length, findings, usage });
      onFindings(findingsToSheets(findings, contacts, end, me.name), `Email review, ${formatDate(since)} to ${formatDate(end)}`,
        () => markRun(me.email, end));
    } catch (e) {
      setError(e instanceof ReviewError ? e.message : /popup|user_cancelled|interaction/i.test(String(e))
        ? "Microsoft's sign-in window was closed or blocked. Allow pop-ups for this site and try again."
        : errorText(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="card">
      <h2>Review my email with Claude</h2>
      <p>
        Claude reads your Inbox and Sent Items for the dates below, finds new people, changes to people already in the tracker,
        and the conversations worth logging, and lists them here for you to check. Your email is read only when you press the
        button; nothing is saved until you press Save.
      </p>
      <div className="row">
        <label className="small">From <input type="date" value={since} max={today()} disabled={!!progress || disabled}
          onChange={(e) => setSince(e.target.value)} /></label>
        <span className="small muted">to today{previous ? ` · last reviewed through ${formatDate(previous)}` : ""}</span>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!!progress || disabled} onClick={run}>
          {progress ?? "Review my email with Claude"}
        </button>
        {!editingKey && <button className="linkish small" onClick={() => setEditingKey(true)}>Claude API key</button>}
      </div>
      {editingKey && (
        <div className="connect-box">
          <label className="small">
            Claude API key (from console.anthropic.com; kept only in this browser)
            <input type="password" autoComplete="off" value={key} placeholder="sk-ant-..." onChange={(e) => setKey(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn small" onClick={() => { saveKey(key.trim()); setEditingKey(!key.trim()); }}>Save key</button>
            {savedKey() && <button className="linkish small" onClick={() => { saveKey(""); setKey(""); }}>Remove key from this browser</button>}
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {report && (
        <p className="small muted">
          Read {report.emails} emails, {report.threads} threads with outside people. Claude ({MODEL}) suggested{" "}
          {report.findings.new_contacts.length} new contacts, {report.findings.updates.length} updates and {report.findings.touchpoints.length} touchpoints,
          and set aside {report.findings.skipped.length} addresses (vendors, automated mail, copied only).
          Cost about ${cost(report.usage).toFixed(2)}. Review the rows below.
        </p>
      )}
      {report && report.findings.skipped.length > 0 && (
        <details className="small">
          <summary>Set aside by Claude ({report.findings.skipped.length})</summary>
          <ul className="plain">{report.findings.skipped.map((s) => <li key={s.email}>{s.email}: <span className="muted">{s.reason}</span></li>)}</ul>
        </details>
      )}
    </section>
  );
}
