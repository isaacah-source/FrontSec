import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useStore } from "../lib/store";
import { StatusBadge } from "../components/ui";
import { STATUSES, splitIssues, typeOptions, type Contact } from "../../shared/constants";

cytoscape.use(fcose);

const TYPE_COLORS: Record<string, string> = {
  Fellows: "#2f6fdf",
  Advisors: "#5b8def",
  Board: "#1c3f8f",
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
  // Labels shrink with the zoom and are hidden below 8 px on screen, so organization and issue
  // names (larger) stay readable from the overview and people's names appear as you zoom in.
  { selector: "node", style: { label: "data(label)", "font-size": 10, color: "#2b3445", "text-valign": "bottom", "text-margin-y": 3, "min-zoomed-font-size": 8 } },
  { selector: 'node[kind = "contact"]', style: { "background-color": "data(color)", width: 14, height: 14 } },
  { selector: 'node[kind = "org"]', style: { shape: "round-rectangle", "background-color": "#dfe6f1", "border-color": "#5b6b86", "border-width": 1.5, width: "data(size)", height: "data(size)", "font-weight": "bold", "font-size": 20 } },
  { selector: 'node[kind = "issue"]', style: { shape: "diamond", "background-color": "#fdf0d5", "border-color": "#b98a1b", "border-width": 1.5, width: "data(size)", height: "data(size)", "font-size": 18 } },
  { selector: 'node[kind = "owner"]', style: { shape: "star", "background-color": "#1f3a5f", width: "data(size)", height: "data(size)", "font-weight": "bold", "font-size": 22 } },
  { selector: "edge", style: { width: 1, "line-color": "#c7cfdb", "curve-style": "haystack", opacity: 0.8 } },
  { selector: 'edge[kind = "issue"]', style: { "line-color": "#e9cf8f" } },
  { selector: 'edge[kind = "owner"]', style: { "line-color": "#9fb1cc", "line-style": "dashed" } },
  { selector: 'edge[kind = "personal"]', style: { width: 2.5, "line-color": "#d1497b", "curve-style": "bezier", label: "data(label)", "font-size": 7, color: "#a33a62", "text-rotation": "autorotate" } },
  { selector: ".faded", style: { opacity: 0.12 } },
  { selector: "node.hit", style: { "border-width": 3, "border-color": "#111", "font-weight": "bold", "font-size": 14, "min-zoomed-font-size": 0, "z-index": 10, "text-background-color": "#fff", "text-background-opacity": 0.9, "text-background-padding": "2px", "text-background-shape": "roundrectangle" } },
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

  // The store hands over fresh arrays on every background reload (every 10-60 seconds), even
  // when nothing changed. Rebuild the drawing only when the nodes or links themselves differ;
  // otherwise zoom, position, and the highlighted person would reset each time.
  const graphKey = useMemo(
    () => graph.elements.map((e) => `${e.data.id}|${e.data.label ?? ""}|${e.data.color ?? ""}`).join("\n"),
    [graph],
  );
  const latest = useRef({ graph, contacts });
  latest.current = { graph, contacts };
  // Where nodes were and how the view was zoomed before a rebuild, so adding one contact
  // does not reshuffle the whole map.
  const saved = useRef<{ positions: Map<string, cytoscape.Position>; zoom: number; pan: cytoscape.Position } | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const prev = saved.current;
    const instance = cytoscape({
      container: box.current,
      elements: latest.current.graph.elements,
      style: STYLE,
      minZoom: 0.1,
      maxZoom: 4,
    });
    const known = prev ? instance.nodes().filter((n) => prev.positions.has(n.id())) : instance.collection();
    if (prev && known.length >= instance.nodes().length * 0.8) {
      // Mostly the same map: put nodes back where they were, settle only the new ones nearby,
      // and keep the person's zoom and position.
      known.forEach((n) => {
        n.position(prev.positions.get(n.id())!);
      });
      instance.layout({ name: "fcose", animate: false, randomize: false, fixedNodeConstraint: known.map((n) => ({ nodeId: n.id(), position: (n as cytoscape.NodeSingular).position() })) } as cytoscape.LayoutOptions).run();
      instance.viewport({ zoom: prev.zoom, pan: prev.pan });
    } else {
      instance.layout({ name: "fcose", animate: false, nodeRepulsion: 6000, idealEdgeLength: 70, packComponents: true } as cytoscape.LayoutOptions).run();
      instance.fit(undefined, 30);
    }

    instance.on("tap", "node", (e) => {
      const id: string = e.target.id();
      const { graph: g, contacts: cs } = latest.current;
      if (id.startsWith("c:")) {
        const c = cs.find((x) => x.id === Number(id.slice(2)));
        if (c) setPicked({ kind: "contact", contact: c });
      } else {
        setPicked({ kind: id.split(":")[0] as "org" | "issue" | "owner", label: e.target.data("label"), members: g.hubs.get(id) ?? [] });
      }
      highlight(instance, e.target);
      zoomTo(instance, e.target.closedNeighborhood().closedNeighborhood());
    });
    instance.on("tap", (e) => {
      if (e.target === instance) {
        instance.elements().removeClass("faded hit");
        setPicked(null);
      }
    });
    // Double-tap or double-click empty space to zoom in there.
    instance.on("dbltap", (e) => {
      if (e.target === instance) zoomBy(instance, 1.8, e.renderedPosition);
    });
    // Scroll-wheel and trackpad zoom. The library shrinks each mouse-wheel notch to a tiny
    // step (it treats fixed-size notches as a coarse device), so a mouse needed dozens of
    // notches. This zooms by how far you actually scroll: about 20% per notch, smooth on a
    // trackpad, and faster for a trackpad pinch (which browsers report as Ctrl + scroll).
    // Touch pinch on phones is not a wheel event and stays with the library.
    const wrap = box.current.parentElement!;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const unit = ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? 800 : 1;
      const rate = ev.ctrlKey ? 0.01 : 0.0018;
      const level = Math.min(instance.maxZoom(), Math.max(instance.minZoom(), instance.zoom() * Math.exp(-ev.deltaY * unit * rate)));
      const rect = box.current!.getBoundingClientRect();
      instance.zoom({ level, renderedPosition: { x: ev.clientX - rect.left, y: ev.clientY - rect.top } });
    };
    wrap.addEventListener("wheel", onWheel, { capture: true, passive: false });
    // Labels are sized in map units, so they grow as you zoom in until organization names
    // swamp the people around them. Past a point, shrink the map-unit size so on-screen text
    // stops growing: about 14 px for organizations and issues, 12 px for people.
    let frame = 0;
    const sizeLabels = () => {
      frame = 0;
      const z = instance.zoom();
      instance.style()
        .selector("node").style("font-size", Math.min(10, 12 / z))
        .selector('node[kind = "org"]').style("font-size", Math.min(20, 14 / z))
        .selector('node[kind = "issue"]').style("font-size", Math.min(18, 14 / z))
        .selector('node[kind = "owner"]').style("font-size", Math.min(22, 15 / z))
        .selector("node.hit").style("font-size", Math.min(14, 14 / z))
        .update();
    };
    instance.on("zoom", () => {
      frame ||= requestAnimationFrame(sizeLabels);
    });
    sizeLabels();
    cy.current = instance;
    return () => {
      cancelAnimationFrame(frame);
      wrap.removeEventListener("wheel", onWheel, { capture: true });
      saved.current = {
        positions: new Map(instance.nodes().map((n) => [n.id(), { ...n.position() }])),
        zoom: instance.zoom(),
        pan: { ...instance.pan() },
      };
      instance.destroy();
    };
  }, [graphKey]);

  // Focus a contact passed in the URL (from a contact page) once the graph exists.
  useEffect(() => {
    if (!focus || !cy.current) return;
    const node = cy.current.getElementById(`c:${focus}`);
    if (node.nonempty()) {
      highlight(cy.current, node);
      zoomTo(cy.current, node.closedNeighborhood().closedNeighborhood());
      const c = latest.current.contacts.find((x) => x.id === Number(focus));
      if (c) setPicked({ kind: "contact", contact: c });
    }
  }, [focus, graphKey]);

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
    zoomTo(inst, hits.closedNeighborhood());
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
        {typeOptions(contacts).map((t) => (
          <button key={t} className={`legend-item ${types.size && !types.has(t) ? "off" : ""}`} onClick={() => toggleType(t)}>
            <i style={{ background: TYPE_COLORS[t] ?? OTHER }} />{t}
          </button>
        ))}
        {types.size > 0 && <button className="linkish small" onClick={() => setTypes(new Set())}>All types</button>}
      </div>

      <div className="graph-wrap">
        <div ref={box} className="graph" />
        <div className="zoom-controls" role="group" aria-label="Zoom">
          <button onClick={() => cy.current && zoomBy(cy.current, 1.5)} aria-label="Zoom in" title="Zoom in">+</button>
          <button onClick={() => cy.current && zoomBy(cy.current, 1 / 1.5)} aria-label="Zoom out" title="Zoom out">−</button>
          <button onClick={() => cy.current?.animate({ fit: { eles: cy.current.elements(), padding: 30 } }, { duration: 300 })} aria-label="Show everything" title="Show everything">⤢</button>
        </div>
        <div className="graph-hint">Scroll or pinch to zoom · drag to move · tap a dot to focus</div>
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

/** Zoom by `factor`, keeping the given screen point (default: the middle) where it is. */
function zoomBy(cy: Core, factor: number, at?: cytoscape.Position) {
  const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor));
  const renderedPosition = at ?? { x: cy.width() / 2, y: cy.height() / 2 };
  cy.animate({ zoom: { level, renderedPosition } } as cytoscape.AnimateOptions, { duration: 200 });
}

/** Fit the view to `eles`, without zooming in so far that a small group fills the screen. */
function zoomTo(cy: Core, eles: cytoscape.CollectionReturnValue) {
  const box = eles.boundingBox();
  const pad = 60;
  const fitZoom = Math.min((cy.width() - pad * 2) / Math.max(box.w, 1), (cy.height() - pad * 2) / Math.max(box.h, 1));
  const zoom = Math.max(cy.minZoom(), Math.min(fitZoom, 2));
  const pan = { x: cy.width() / 2 - zoom * (box.x1 + box.w / 2), y: cy.height() / 2 - zoom * (box.y1 + box.h / 2) };
  cy.animate({ zoom, pan }, { duration: 300 });
}

function highlight(cy: Core, node: cytoscape.NodeSingular | cytoscape.CollectionReturnValue) {
  cy.elements().removeClass("faded hit").addClass("faded");
  const hood = node.closedNeighborhood();
  // Two hops from a person reaches the people they share an org, issue, or owner with.
  hood.closedNeighborhood().removeClass("faded");
  node.addClass("hit");
}
