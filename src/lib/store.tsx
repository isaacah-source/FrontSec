import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Repo, type Me, type Snapshot } from "./repo";
import type { SheetIO } from "./sheets";
import type { Connection, Contact, Interaction, Role, User } from "../../shared/constants";

interface Toast {
  id: number;
  text: string;
}

export interface Links {
  workbookUrl: string | null;
  folderUrl: string | null;
  workbookName: string | null;
}

export interface CurrentUser extends Me {
  role: Role;
  /** True when the App Users tab does not list this person. */
  unlisted: boolean;
}

interface Store {
  me: CurrentUser;
  users: User[];
  contacts: Contact[];
  interactions: Interaction[];
  connections: Connection[];
  initialized: boolean;
  links: Links;
  online: boolean;
  lastSync: Date | null;
  repo: Repo;
  /** Run a change, then reload so every screen shows the workbook's current state. */
  mutate: <T>(fn: (repo: Repo) => Promise<T>) => Promise<T>;
  refresh: () => Promise<void>;
  toasts: Toast[];
  toast: (text: string) => void;
  signOut: () => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside DataProvider");
  return s;
}

const POLL_MS = 10_000;
const FULL_RELOAD_MS = 60_000;

/**
 * Loads the workbook and keeps it current. Every 10 seconds (while the app is on screen) it
 * asks OneDrive whether the file changed and reloads if so; it also reloads once a minute
 * regardless, because edits made through Excel's own sessions can lag the file version.
 */
export function DataProvider({ io, identity, links, signOut, initial, children }: {
  io: SheetIO;
  identity: Me;
  links: Links;
  signOut: () => void;
  initial: Snapshot;
  children: ReactNode;
}) {
  const repo = useMemo(() => new Repo(io, identity), [io, identity]);
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const version = useRef<string | null>(null);
  const lastFull = useRef(Date.now());
  const busy = useRef(false);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const refresh = useCallback(async () => {
    const next = await repo.load();
    setSnap((prev) => {
      announceOthers(prev, next, identity.name, toast);
      return next;
    });
    version.current = await io.version().catch(() => null);
    lastFull.current = Date.now();
    setLastSync(new Date());
    setOnline(true);
  }, [repo, io, identity.name, toast]);

  const mutate = useCallback(async <T,>(fn: (r: Repo) => Promise<T>) => {
    busy.current = true;
    try {
      const out = await fn(repo);
      await refresh();
      return out;
    } finally {
      busy.current = false;
    }
  }, [repo, refresh]);

  useEffect(() => {
    const tick = async () => {
      if (document.hidden || busy.current) return;
      try {
        const v = await io.version();
        if (v !== version.current || Date.now() - lastFull.current > FULL_RELOAD_MS) await refresh();
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [io, refresh]);

  const me = useMemo<CurrentUser>(() => {
    const row = snap.users.find((u) => u.email.toLowerCase() === identity.email.toLowerCase() && u.active);
    return { email: identity.email, name: row?.name ?? identity.name, role: row?.role ?? "viewer", unlisted: !row };
  }, [snap.users, identity]);

  const value = useMemo<Store>(() => ({
    me, users: snap.users, contacts: snap.contacts, interactions: snap.interactions, connections: snap.connections,
    initialized: snap.initialized, links, online, lastSync, repo, mutate, refresh, toasts, toast, signOut,
  }), [me, snap, links, online, lastSync, repo, mutate, refresh, toasts, toast, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Tells you when a reload brought in someone else's changes. */
function announceOthers(prev: Snapshot, next: Snapshot, myName: string, toast: (t: string) => void) {
  const before = new Map(prev.contacts.map((c) => [c.id, c.updatedAt]));
  const changed = next.contacts.filter((c) => c.updatedBy && c.updatedBy !== myName && before.get(c.id) !== c.updatedAt && before.size > 0);
  if (changed.length === 1) toast(`${changed[0].updatedBy} updated ${changed[0].name}`);
  else if (changed.length > 1) toast(`${changed.length} contacts were updated by others`);
}

const RANK = { viewer: 0, contributor: 1, editor: 2, admin: 3 } as const;
export const can = (u: { role: Role }, role: keyof typeof RANK) => RANK[u.role] >= RANK[role];

/**
 * Whether a person "owns" a contact. Relationship Owner is free text in the workbook, so
 * this matches the full name, or a lone first name ("Ike") against the person's first name.
 */
export function isOwner(me: { name: string }, c: Contact): boolean {
  const owner = (c.owner ?? "").trim().toLowerCase();
  if (!owner) return false;
  const name = me.name.trim().toLowerCase();
  return owner === name || (!owner.includes(" ") && owner === name.split(" ")[0]);
}

export const canEditContact = (me: CurrentUser, c: Contact) =>
  can(me, "editor") || (me.role === "contributor" && isOwner(me, c));

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
