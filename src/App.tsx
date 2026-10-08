import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { DataProvider, can, errorText, useStore, type Links } from "./lib/store";
import { loadConfig, type AppConfig } from "./lib/config";
import { Auth } from "./lib/auth";
import { GraphSheets } from "./lib/graph";
import { demoSheets } from "./lib/demo";
import { Repo, type Me, type Snapshot } from "./lib/repo";
import type { SheetIO } from "./lib/sheets";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import ContactDetail from "./pages/ContactDetail";
import ContactForm from "./pages/ContactForm";
import Admin from "./pages/Admin";

// The graph library is large; load it only when someone opens the map.
const Network = lazy(() => import("./pages/Network"));

type Boot =
  | { kind: "loading"; label: string }
  | { kind: "error"; message: string; canRetry: boolean }
  | { kind: "signin"; auth: Auth }
  | { kind: "setup"; io: SheetIO; me: Me; links: Links; allowed: boolean }
  | { kind: "ready"; io: SheetIO; me: Me; links: Links; initial: Snapshot };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading", label: "Starting…" });
  const [auth, setAuth] = useState<Auth | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  // Demo data lives in memory, so keep the same copy when the app restarts after setup.
  const demoIo = useRef<SheetIO | null>(null);

  const start = useCallback(async () => {
    try {
      const config = await loadConfig();
      setCfg(config);
      let io: SheetIO;
      let me: Me;
      let links: Links;
      if (config.demo) {
        io = demoIo.current ??= await demoSheets();
        me = { email: "demo@example.org", name: "Demo User" };
        links = { workbookUrl: null, folderUrl: null, workbookName: "Sample data (demo mode)" };
      } else {
        const a = new Auth(config);
        setAuth(a);
        setBoot({ kind: "loading", label: "Signing in…" });
        const account = await a.init();
        if (!account) {
          setBoot({ kind: "signin", auth: a });
          return;
        }
        setBoot({ kind: "loading", label: "Opening the tracker workbook…" });
        const graph = new GraphSheets(() => a.token());
        const info = await graph.open(config.folderUrl, config.workbookName);
        io = graph;
        me = { email: account.username, name: account.name ?? account.username };
        links = { workbookUrl: info.webUrl, folderUrl: info.folderWebUrl, workbookName: info.name };
      }
      setBoot({ kind: "loading", label: "Loading contacts…" });
      const initial = await new Repo(io, me).load();
      if (!initial.initialized) {
        const allowed = !config.setupAdmins?.length || config.setupAdmins.some((e) => e.toLowerCase() === me.email.toLowerCase());
        setBoot({ kind: "setup", io, me, links, allowed });
        return;
      }
      setBoot({ kind: "ready", io, me, links, initial });
    } catch (e) {
      setBoot({ kind: "error", message: errorText(e), canRetry: true });
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const signOut = useCallback(() => {
    if (auth) auth.signOut();
    else window.location.reload();
  }, [auth]);

  switch (boot.kind) {
    case "loading":
      return <div className="splash">{boot.label}</div>;
    case "signin":
      return <Login onSignIn={() => boot.auth.signIn()} />;
    case "error":
      return (
        <div className="auth">
          <div className="card auth-card">
            <h1>Can't open the tracker</h1>
            <p>{boot.message}</p>
            <div className="row">
              {boot.canRetry && <button className="btn primary" onClick={start}>Try again</button>}
              {auth?.account && <button className="btn" onClick={signOut}>Sign in as someone else</button>}
            </div>
          </div>
        </div>
      );
    case "setup":
      return <Setup {...boot} onDone={start} signOut={signOut} />;
    case "ready":
      return (
        <DataProvider io={boot.io} identity={boot.me} links={boot.links} signOut={signOut} initial={boot.initial}>
          <Shell demo={!!cfg?.demo} />
        </DataProvider>
      );
  }
}

function Setup({ io, me, links, allowed, onDone, signOut }: { io: SheetIO; me: Me; links: Links; allowed: boolean; onDone: () => void; signOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    try {
      await new Repo(io, me).setup();
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <div className="card auth-card">
        <h1>Set up the tracker</h1>
        <p>Found <b>{links.workbookName}</b>. Before first use the app adds three tabs (Touchpoints, Connections, App Users) and six columns after column T on Master (Title, LinkedIn, Website, Address, Updated At, Updated By). It does not change your existing columns or category tabs.</p>
        {allowed ? (
          <>
            <p className="muted small">You ({me.email}) will be the first admin.</p>
            {error && <p className="error">{error}</p>}
            <button className="btn primary block" disabled={busy} onClick={run}>{busy ? "Setting up…" : "Set up workbook"}</button>
          </>
        ) : (
          <p className="muted">An admin has not set up this workbook yet. Ask the person who shared the folder to open the app first.</p>
        )}
        <button className="linkish" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

function Shell({ demo }: { demo: boolean }) {
  const { me, online, toasts, signOut, lastSync } = useStore();
  const links = [
    { to: "/", label: "Today", icon: "◎", end: true },
    { to: "/contacts", label: "Contacts", icon: "☰" },
    { to: "/network", label: "Network", icon: "⬡" },
    ...(can(me, "contributor") ? [{ to: "/contacts/new", label: "Add", icon: "+" }] : []),
    ...(can(me, "admin") ? [{ to: "/admin", label: "Admin", icon: "⚙" }] : []),
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Relationship Tracker</div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="navlink">
              <span className="navicon" aria-hidden>{l.icon}</span>
              <span>{l.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            {me.name}
            <span className="muted"> · {me.role}</span>
          </div>
          {lastSync && <div className="muted small">Synced {lastSync.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>}
          <button className="linkish" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        {demo && <div className="banner warn">Demo mode: sample data in this browser only. Nothing is saved to OneDrive.</div>}
        {!online && <div className="banner">Can't reach OneDrive. Changes from others will appear once you are back online.</div>}
        {me.unlisted && !demo && (
          <div className="banner warn">You can view the tracker. To add or edit, ask an admin to give you a role on the Admin page.</div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/new" element={<ContactForm />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/contacts/:id/edit" element={<ContactForm />} />
          <Route path="/network" element={<Suspense fallback={<div className="splash">Loading map…</div>}><Network /></Suspense>} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<p className="pad">Page not found.</p>} />
        </Routes>
      </main>
      <nav className="tabbar">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className="tab">
            <span className="navicon" aria-hidden>{l.icon}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </div>
  );
}
