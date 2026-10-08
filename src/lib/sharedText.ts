/**
 * Text shared into the app from another app (Android's share menu, for example Google Lens
 * after "Select all"). The installed app is registered as a share target in the web app
 * manifest, so Android opens /contacts/new?text=... .
 *
 * Signing in with Microsoft redirects away and back, which would drop that address, so the
 * text is stashed for the browser tab and picked up by the new-contact form.
 */
const KEY = "rt.sharedCardText";

/** Call once at startup, before sign-in can redirect. */
export function captureSharedText() {
  const params = new URLSearchParams(window.location.search);
  const text = [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n").trim();
  if (!text) return;
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // Storage blocked (private mode on some browsers): the form still reads the address.
  }
}

export function hasSharedText(): boolean {
  try {
    return Boolean(sessionStorage.getItem(KEY));
  } catch {
    return false;
  }
}

/** Returns the shared text once, then forgets it. */
export function takeSharedText(): string {
  try {
    const text = sessionStorage.getItem(KEY) ?? "";
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return "";
  }
}
