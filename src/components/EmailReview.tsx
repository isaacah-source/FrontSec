import { useState } from "react";
import { addDays, errorText, formatDate, today, useStore } from "../lib/store";
import { fetchMail } from "../lib/mailFetch";
import {
  MODEL, ReviewError, buildChatPrompt, chunkThreads, cost, findingsToSheets, lastRun, markRun, readPastedAnswer, reviewWithClaude,
  saveKey, savedKey, threadsToReview, type Findings, type Usage,
} from "../lib/emailReview";
import type { SheetIn } from "../lib/importFile";

/**
 * Email review with Claude. Nothing touches the mailbox until a button is pressed; then
 * the app asks Microsoft for read access to this person's mail and reads the chosen dates.
 *
 * Without an API key (the default): the app prepares the threads with outside people as one
 * block of text; the person pastes it into a Claude chat on their own subscription and pastes
 * Claude's answer back. With a Claude API key: the app sends the threads itself.
 * Either way, the findings go to the Import page's review, and nothing is saved until Save.
 */
export function EmailReview({ disabled, onFindings }: {
  disabled: boolean;
  onFindings: (sheets: SheetIn[], label: string, onSaved: () => void) => void;
}) {
  const { me, contacts, mailToken } = useStore();
  const previous = lastRun(me.email);
  const [since, setSince] = useState(previous ?? addDays(today(), -7));
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{ text: string; emails: number; threads: number; since: string; end: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState("");
  const [report, setReport] = useState<{ findings: Findings; usage?: Usage } | null>(null);
  const [useKey, setUseKey] = useState(!!savedKey());
  const [key, setKey] = useState(savedKey());

  if (!mailToken) {
    return (
      <section className="card">
        <h2>Review my email with Claude</h2>
        <p className="muted">Not available in demo mode: it needs your Microsoft sign-in.</p>
      </section>
    );
  }

  const busy = !!progress || disabled;

  const readMail = async () => {
    setProgress("Asking Microsoft for read access to your email…");
    const token = await mailToken();
    const mail = await fetchMail(token, since, setProgress);
    const threads = threadsToReview(mail, me.email);
    if (!threads.length) throw new ReviewError(`No threads with people outside FSI between ${formatDate(since)} and ${formatDate(today())}.`);
    return { mail, threads };
  };

  const fail = (e: unknown) => setError(e instanceof ReviewError ? e.message : /popup|user_cancelled|interaction/i.test(String(e))
    ? "Microsoft's sign-in window was closed or blocked. Allow pop-ups for this site and try again."
    : errorText(e));

  const show = (findings: Findings, end: string, usage?: Usage) => {
    setReport({ findings, usage });
    onFindings(findingsToSheets(findings, contacts, end, me.name), `Email review, ${formatDate(since)} to ${formatDate(end)}`,
      () => markRun(me.email, end));
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("This browser did not allow copying. Use “Download as a file” and attach the file in Claude instead.");
    }
  };

  const prepare = async () => {
    setError("");
    setReport(null);
    setPrepared(null);
    setCopied(false);
    setAnswer("");
    try {
      const { mail, threads } = await readMail();
      const end = today();
      const text = buildChatPrompt(me, contacts, threads, since, end);
      setPrepared({ text, emails: mail.length, threads: threads.length, since, end });
      await copy(text);
    } catch (e) {
      fail(e);
    } finally {
      setProgress(null);
    }
  };

  const download = () => {
    if (!prepared) return;
    const url = URL.createObjectURL(new Blob([prepared.text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `FSI email review ${prepared.since} to ${prepared.end}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const readAnswer = () => {
    setError("");
    try {
      show(readPastedAnswer(answer), prepared?.end ?? today());
    } catch (e) {
      fail(e);
    }
  };

  const runWithKey = async () => {
    setError("");
    setReport(null);
    setPrepared(null);
    if (!key.trim()) {
      setError("Add a Claude API key first.");
      return;
    }
    saveKey(key.trim());
    try {
      const { threads } = await readMail();
      const { findings, usage } = await reviewWithClaude({ apiKey: key.trim(), me, contacts, chunks: chunkThreads(threads), onProgress: setProgress });
      show(findings, today(), usage);
    } catch (e) {
      fail(e);
    } finally {
      setProgress(null);
    }
  };

  const kb = prepared ? Math.round(prepared.text.length / 1000) : 0;

  return (
    <section className="card">
      <h2>Review my email with Claude</h2>
      <p>
        Claude reviews your Inbox and Sent Items for the dates below and suggests new contacts, changes to people already in
        the tracker, and conversations worth logging, for you to check here. Your email is read only when you press a button;
        nothing is saved until you press Save.
      </p>
      <div className="row">
        <label className="small">From <input type="date" value={since} max={today()} disabled={busy}
          onChange={(e) => setSince(e.target.value)} /></label>
        <span className="small muted">to today{previous ? ` · last reviewed through ${formatDate(previous)}` : ""}</span>
      </div>

      {!useKey && (
        <>
          <ol className="steps">
            <li>
              <button className="btn primary" disabled={busy} onClick={prepare}>{progress ?? "1. Prepare my email for Claude"}</button>
              {prepared && (
                <div className="small">
                  {copied ? "Copied to your clipboard: " : "Ready: "}
                  {prepared.threads} conversations from {prepared.emails} emails (about {kb} KB).{" "}
                  <button className="linkish small" onClick={() => copy(prepared.text)}>Copy again</button>
                  {" · "}
                  <button className="linkish small" onClick={download}>Download as a file</button>
                  {kb > 400 && <div className="muted">That is a lot of text. If Claude says it is too long, choose a later start date.</div>}
                </div>
              )}
            </li>
            <li>
              Open a new chat at{" "}
              <a href="https://claude.ai/new" target="_blank" rel="noreferrer">claude.ai</a> (or the Claude app), paste (or attach the
              downloaded file), and send. Wait for Claude's reply, then copy all of it.
            </li>
            <li>
              <textarea rows={4} value={answer} disabled={busy} placeholder="3. Paste Claude's whole reply here"
                onChange={(e) => setAnswer(e.target.value)} />
              <button className="btn primary" disabled={busy || !answer.trim()} onClick={readAnswer}>Read Claude's answer</button>
            </li>
          </ol>
          <button className="linkish small" onClick={() => setUseKey(true)}>Use a Claude API key instead</button>
        </>
      )}

      {useKey && (
        <>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={runWithKey}>{progress ?? "Review my email with Claude"}</button>
            <button className="linkish small" onClick={() => setUseKey(false)}>Use a Claude chat instead (no API key)</button>
          </div>
          <div className="connect-box">
            <label className="small">
              Claude API key (from console.anthropic.com; kept only in this browser)
              <input type="password" autoComplete="off" value={key} placeholder="sk-ant-..." onChange={(e) => setKey(e.target.value)} />
            </label>
            {savedKey() && <button className="linkish small" onClick={() => { saveKey(""); setKey(""); }}>Remove key from this browser</button>}
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {report && (
        <p className="small muted">
          Claude{report.usage ? ` (${MODEL})` : ""} suggested {report.findings.new_contacts.length} new contacts, {report.findings.updates.length} updates
          and {report.findings.touchpoints.length} touchpoints, and set aside {report.findings.skipped.length} addresses.
          {report.usage ? ` Cost about $${cost(report.usage).toFixed(2)}.` : ""} Review the rows below.
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
