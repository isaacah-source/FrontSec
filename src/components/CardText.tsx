import { useState } from "react";

type Platform = "android" | "ios" | "other";

function platform(): Platform {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  // iPadOS reports itself as a Mac, so also check for a touch screen.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "other";
}

const STEPS: Record<Platform, { title: string; steps: string[] }> = {
  android: {
    title: "On Android (Google Lens)",
    steps: [
      "Open Google Lens (or the Lens button in your camera) and point it at the card.",
      "Tap Text, then Select all, then Copy text.",
      "Come back here and tap Paste card text. (If your phone offers Share instead, choose Relationship Tracker and the form fills in.)",
    ],
  },
  ios: {
    title: "On iPhone or iPad (Live Text)",
    steps: [
      "Open the Camera (or a photo of the card in Photos) and tap the Live Text button in the corner.",
      "Tap Select All, then Copy.",
      "Come back here and tap Paste card text.",
    ],
  },
  other: {
    title: "On a computer",
    steps: [
      "Copy the text from an email signature, a document, or your phone (phones can share their clipboard with a signed-in computer).",
      "Tap Paste card text, or paste into the box below.",
    ],
  },
};

/**
 * Takes a business card's text that the phone's own reader produced (Google Lens on Android,
 * Live Text on iPhone) and hands it to the form. The app itself does no image reading.
 */
export function CardText({ initial, onText }: { initial: string; onText: (text: string) => void }) {
  const here = platform();
  const [text, setText] = useState(initial);
  const [note, setNote] = useState("");

  const paste = async () => {
    setNote("");
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        setNote("The clipboard is empty. Copy the card's text first.");
        return;
      }
      setText(clip);
      onText(clip);
    } catch {
      // Some browsers do not let pages read the clipboard; a long-press paste always works.
      setNote("This browser blocked reading the clipboard. Long-press the box below and choose Paste.");
      document.getElementById("card-text")?.focus();
    }
  };

  const others = (["android", "ios", "other"] as Platform[]).filter((p) => p !== here);

  return (
    <div className="card card-text">
      <b>Add from a business card</b>
      <div className="muted small">Your phone reads the card; the app sorts the text into fields. Check them before saving.</div>
      <ol className="steps small">
        {STEPS[here].steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <details className="small">
        <summary>Other devices</summary>
        {others.map((p) => (
          <div key={p}>
            <b>{STEPS[p].title}</b>
            <ol className="steps">{STEPS[p].steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
        ))}
      </details>
      <div className="row">
        <button type="button" className="btn primary" onClick={paste}>📋 Paste card text</button>
      </div>
      <textarea
        id="card-text"
        rows={text ? 6 : 3}
        placeholder="Card text appears here. You can fix it, then tap Fill in fields."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {note && <p className="error small">{note}</p>}
      {text.trim() && (
        <div className="row">
          <button type="button" className="btn" onClick={() => onText(text)}>Fill in fields</button>
        </div>
      )}
    </div>
  );
}
