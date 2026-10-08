import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useStore } from "../lib/store";
import { StatusBadge } from "../components/ui";
import { RELATIONSHIP_TYPES, STATUSES, splitIssues, type Contact } from "../../shared/constants";

cytoscape.use(fcose);

const TYPE_COLORS: Record<string, string> = {
  "Fellows/Advisors/Board": "#2f6fdf",
  "AI Labs": "#8a4fd6",
  Media: "#e0782d",
  "Policy/NatSec/Gov": "#1f9d6b",
  "Donors/Funders": "#c9a227",
  "Research/Institutional Partners": "#d1497b",
  "International Gov/Diplomatic": "#1aa6b7",
};
const OTHER = "#8a94a6";

type Layer = "org" | "issue" | "owner" | "personal";
type Picked = { kind: "contact"; contact: Contact } | { kind: "org" | "issue" | "owner"; label: string; members: Contact[] };

/**
 * Builds a graph of contacts plus three kinds of hub node (organization, issue, staff
 * owner) and draws person-to-person connections as direct edges. Hubs with a single
 * member add nothing visually, so they are dropped unless "show singletons" is on.
 */
export function buildGraph(
  contacts: Contact[],
  connections: { id: number; contactA: number; contactB: number; kind: string }[],
  layers: Set<Layer>,
  opts: { singletons: boolean; isolated: boolean },
): { elements: ElementDefinition[]; hubs: Map<string, Contact[]> } {
  const hubs = new Map<string, Contact[]>();
  const hubLabel = new Map<string, string>();
  const add = (id: string, label: string, c: Contact) => {
    hubs.set(id, [...(hubs.get(id) ?? []), c]);
    if (!hubLabel.has(id)) hubLabel.set(id, label);
  };
  for (const c of contacts) {
    if (layers.has("org") && c.organization) add(`org:${c.organization.toLowerCase()}`, c.organization, c);
    if (layers.has("issue")) for (const i of splitIssues(c.tags, c.interestArea)) add(`issue:${i.toLowerCase()}`, i, c);
    if (layers.has("owner") && c.owner) add(`owner:${c.owner.toLowerCase()}`, c.owner, c);
  }
  const minMembers = opts.singletons ? 1 : 2;
  const keptHubs = [...hubs.entries()].filter(([id, m]) => id.startsWith("owner:") || m.length >= minMembers);

  const ids = new Set(contacts.map((c) => c.id));
  const personal = layers.has("personal")
    ? connections.filter((x) => ids.has(x.contactA) && ids.has(x.contactB))
    : [];

  const linked = new Set<number>();
  for (const [, m] of keptHubs) for (const c of m) linked.add(c.id);
  for (const x of personal) {
    linked.add(x.contactA);
    linked.add(x.contactB);
  }

  const elements: ElementDefinition[] = [];
  for (const c of contacts) {
    if (!opts.isolated && !linked.has(c.id)) continue;
    elements.push({
      data: { id: `c:${c.id}`, label: c.name, kind: "contact", color: TYPE_COLORS[c.relationshipType ?? ""] ?? OTHER },
    });
  }
  for (const [id, members] of keptHubs) {
    const kind = id.split(":")[0];
    elements.push({ data: { id, label: hubLabel.get(id), kind, size: 18 + Math.min(members.length, 30) * 1.4 } });
    for (const c of members) elements.push({ data: { id: `${id}->${c.id}`, source: id, target: `c:${c.id}`, kind } });
  }
  for (const x of personal) {
    elements.push({ data: { id: `p:${x.id}`, source: `c:${x.contactA}`, target: `c:${x.contactB}`, kind: "personal", label: x.kind } });
  }
  return { elements, hubs };
}

const STYLE: cytoscape.StylesheetJson = [
  { selector: "node", style: { label: "data(label)", "font-size": 9, color: "#2b3445", "text-valign": "bottom", "text-margin-y": 3, "min-zoomed-font-size": 7 } },
  { selector: 'node[kind = "contact"]', style: { "background-color": "data(color)", width: 14, height: 14 } },
  { selector: 'node[kind = "org"]', style: { shape: "round-rectangle", "background-color": "#dfe6f1", "border-color": "#5b6b86", "border-width": 1.5, width: "data(size)", height: "data(size)", "font-weight": "bold", "font-size": 10 } },
  { selector: 'node[kind = "issue"]', style: { shape: "diamond", "background-color": "#fdf0d5", "border-color": "#b98a1b", "border-width": 1.5, width: "data(size)", height: "data(size)", "font-size": 10 } },
  { selector: 'node[kind = "owner"]', style: { shape: "star", "background-color": "#1f3a5f", width: "data(size)", height: "data(size)", "font-weight": "bold", "font-size": 11 } },
  { selector: "edge", style: { width: 1, "line-color": "#c7cfdb", "curve-style": "haystack", opacity: 0.8 } },
  { selector: 'edge[kind = "issue"]', style: { "line-color": "#e9cf8f" } },
  { selector: 'edge[kind = "owner"]', style: { "line-color": "#9fb1cc", "line-style": "dashed" } },
  { selector: 'edge[kind = "personal"]', style: { width: 2.5, "line-color": "#d1497b", "curve-style": "bezier", label: "data(label)", "font-size": 7, color: "#a33a62", "text-rotation": "autorotate" } },
  { selector: ".faded", style: { opacity: 0.12 } },
  { selector: "node.hit", style: { "border-width": 3, "border-color": "#111", "font-weight": "bold", "font-size": 12, "z-index": 10 } },
];

export default function Network() {
  const { contacts, connections } = useStore();
  const [params, setParams] = useSearchParams();
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const [layers, setLayers] = useState<Set<Layer>>(new Set(["org", "personal"]));
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [singletons, setSingletons] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const focus = params.get("focus");

  const visible = useMemo(
    () => contacts.filter((c) => (!types.size || types.has(c.relationshipType ?? "")) && (!status || c.status === status)),
    [contacts, types, status],
  );
  const graph = useMemo(
    () => buildGraph(visible, connections, layers, { singletons, isolated: isolated || !!focus }),
    [visible, connections, layers, singletons, isolated, focus],
  );

  useEffect(() => {
    if (!box.current) return;
    const instance = cytoscape({
      container: box.current,
      elements: graph.elements,
      style: STYLE,
      layout: { name: "fcose", animate: false, nodeRepulsion: 6000, idealEdgeLength: 70, packComponents: true } as cytoscape.LayoutOptions,
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });
    instance.on("tap", "node", (e) => {
      const id: string = e.target.id();
      if (id.startsWith("c:")) {
        const c = contacts.find((x) => x.id === Number(id.slice(2)));
        if (c) setPicked({ kind: "contact", contact: c });
      } else {
        setPicked({ kind: id.split(":")[0] as "org" | "issue" | "owner", label: e.target.data("label"), members: graph.hubs.get(id) ?? [] });
      }
      highlight(instance, e.target);
    });
    instance.on("tap", (e) => {
      if (e.target === instance) {
        instance.elements().removeClass("faded hit");
        setPicked(null);
      }
    });
    cy.current = instance;
    return () => instance.destroy();
  }, [graph, contacts]);

  // Focus a contact passed in the URL (from a contact page) once the graph exists.
  useEffect(() => {
    if (!focus || !cy.current) return;
    const node = cy.current.getElementById(`c:${focus}`);
    if (node.nonempty()) {
      highlight(cy.current, node);
      cy.current.animate({ fit: { eles: node.closedNeighborhood().closedNeighborhood(), padding: 60 } }, { duration: 300 });
      const c = contacts.find((x) => x.id === Number(focus));
      if (c) setPicked({ kind: "contact", contact: c });
    }
  }, [focus, graph, contacts]);

  const search = (q: string) => {
    setQuery(q);
    const inst = cy.current;
    if (!inst) return;
    inst.elements().removeClass("faded hit");
    if (q.trim().length < 2) return;
    const hits = inst.nodes().filter((n) => String(n.data("label")).toLowerCase().includes(q.toLowerCase()));
    if (hits.empty()) return;
    inst.elements().addClass("faded");
    hits.closedNeighborhood().removeClass("faded");
    hits.addClass("hit");
    inst.animate({ fit: { eles: hits.closedNeighborhood(), padding: 60 } }, { duration: 300 });
  };

  const toggleLayer = (l: Layer) =>
    setLayers((s) => {
      const n = new Set(s);
      if (n.has(l)) n.delete(l);
      else n.add(l);
      return n;
    });
  const toggleType = (t: string) =>
    setTypes((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const nodeCount = graph.elements.filter((e) => !e.data.source).length;

  return (
    <div className="page network-page">
      <header className="page-head">
        <h1>Network</h1>
        <input type="search" className="search" placeholder="Find a person, org, or issue…" value={query} onChange={(e) => search(e.target.value)} />
      </header>

      <div className="filters">
        <span className="muted small">Connect by:</span>
        {([["org", "Organization"], ["issue", "Common issue"], ["personal", "Personal connection"], ["owner", "Our relationship owner"]] as [Layer, string][]).map(([l, label]) => (
          <button key={l} className={`chip toggle ${layers.has(l) ? "on" : ""} layer-${l}`} onClick={() => toggleLayer(l)}>{label}</button>
        ))}
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="small"><input type="checkbox" checked={singletons} onChange={(e) => setSingletons(e.target.checked)} /> One-person groups</label>
        <label className="small"><input type="checkbox" checked={isolated} onChange={(e) => setIsolated(e.target.checked)} /> Unconnected people</label>
        {focus && <button className="chip" onClick={() => setParams({})}>Clear focus ✕</button>}
      </div>
      <div className="legend">
        {RELATIONSHIP_TYPES.map((t) => (
          <button key={t} className={`legend-item ${types.size && !types.has(t) ? "off" : ""}`} onClick={() => toggleType(t)}>
            <i style={{ background: TYPE_COLORS[t] }} />{t}
          </button>
        ))}
        {types.size > 0 && <button className="linkish small" onClick={() => setTypes(new Set())}>All types</button>}
      </div>

      <div className="graph-wrap">
        <div ref={box} className="graph" />
        {nodeCount === 0 && <div className="graph-empty">Nothing to draw. Turn on a “Connect by” option or “Unconnected people”.</div>}
        {picked && (
          <aside className="graph-panel">
            <button className="close" onClick={() => setPicked(null)} aria-label="Close">✕</button>
            {picked.kind === "contact" ? (
              <>
                <h3>{picked.contact.name}</h3>
                <div className="muted small">{[picked.contact.title, picked.contact.organization].filter(Boolean).join(" · ")}</div>
                <p><StatusBadge status={picked.contact.status} /></p>
                <p className="small">Owner: {picked.contact.owner ?? "Unassigned"}</p>
                <Link className="btn small primary" to={`/contacts/${picked.contact.id}`}>Open contact</Link>
              </>
            ) : (
              <>
                <div className="muted small">{picked.kind === "org" ? "Organization" : picked.kind === "issue" ? "Issue" : "Relationship owner"}</div>
                <h3>{picked.label}</h3>
                <p className="small">{picked.members.length} contact{picked.members.length === 1 ? "" : "s"}</p>
                <ul className="plain small scroll">
                  {picked.members.map((m) => <li key={m.id}><Link to={`/contacts/${m.id}`}>{m.name}</Link></li>)}
                </ul>
                {picked.kind !== "owner" && (
                  <Link className="btn small" to={`/contacts?${picked.kind}=${encodeURIComponent(picked.label)}`}>Show as list</Link>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function highlight(cy: Core, node: cytoscape.NodeSingular | cytoscape.CollectionReturnValue) {
  cy.elements().removeClass("faded hit").addClass("faded");
  const hood = node.closedNeighborhood();
  // Two hops from a person reaches the people they share an org, issue, or owner with.
  hood.closedNeighborhood().removeClass("faded");
  node.addClass("hit");
}
