import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import cytoscape, { type Core } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useStore } from "../lib/store";
import { StatusBadge } from "../components/ui";
import { STATUSES, contactTypes, typeOptions, type Contact } from "../../shared/constants";
import { OTHER, TYPE_COLORS, buildGraph, type Layer } from "../lib/networkGraph";

cytoscape.use(fcose);


/** Line colors. Personal links use a red no contact type uses, so they read as lines, not people. */
const LINE = { issue: "#e3b341", owner: "#7f95b8", personal: "#e03131" };

/**
 * fcose settings. Counting labels in each node's size is what keeps names and organization
 * titles from landing on top of each other; the rest spreads groups apart.
 */
const LAYOUT = {
  name: "fcose",
  quality: "proof",
  animate: false,
  nodeDimensionsIncludeLabels: true,
  nodeRepulsion: 12000,
  idealEdgeLength: 90,
  edgeElasticity: 0.3,
  nodeSeparation: 90,
  gravity: 0.2,
  // Keep each box's people close together so boxes stay compact.
  gravityCompound: 3,
  gravityRangeCompound: 0.8,
  nestingFactor: 0.4,
  numIter: 3000,
  packComponents: true,
  tile: true,
  tilingPaddingVertical: 40,
  tilingPaddingHorizontal: 40,
};

type HubKind = "org" | "office" | "issue" | "owner";
type Picked = { kind: "contact"; contact: Contact } | { kind: HubKind; label: string; members: Contact[] };

const STYLE: cytoscape.StylesheetJson = [
  // Labels shrink with the zoom and are hidden below 8 px on screen, so organization and issue
  // names (larger) stay readable from the overview and people's names appear as you zoom in.
  { selector: "node", style: { label: "data(label)", "font-size": 10, color: "#2b3445", "text-valign": "bottom", "text-margin-y": 3, "min-zoomed-font-size": 8, "text-wrap": "wrap", "text-max-width": "140px" } },
  // People's names appear once zoomed in far enough to read them; the overview shows groups.
  { selector: 'node[kind = "contact"]', style: { "background-color": "data(color)", width: 14, height: 14, "min-zoomed-font-size": 9, "text-max-width": "90px" } },
  // Organization boxes hold their people; office boxes sit inside them.
  { selector: 'node[kind = "org"]', style: { shape: "round-rectangle", "background-color": "#eef2f8", "background-opacity": 0.7, "border-color": "#8796ad", "border-width": 1.5, padding: "14px", "text-valign": "top", "text-halign": "center", "text-margin-y": -4, "font-weight": "bold", "font-size": 16, "text-max-width": "220px", "min-zoomed-font-size": 6 } },
  { selector: 'node[kind = "office"]', style: { shape: "round-rectangle", "background-color": "#ffffff", "background-opacity": 0.85, "border-color": "#a9b5c7", "border-width": 1, "border-style": "dashed", padding: "8px", "text-valign": "top", "text-halign": "center", "text-margin-y": -2, "font-size": 11, "font-style": "italic", color: "#4d5a70", "text-max-width": "160px", "min-zoomed-font-size": 7 } },
  { selector: 'node[kind = "issue"]', style: { shape: "diamond", "background-color": "#fdf0d5", "border-color": "#b98a1b", "border-width": 1.5, width: "data(size)", height: "data(size)", "font-size": 18 } },
  { selector: 'node[kind = "owner"]', style: { shape: "star", "background-color": "#1f3a5f", width: "data(size)", height: "data(size)", "font-weight": "bold", "font-size": 22 } },
  { selector: "edge", style: { width: 1, "line-color": "#c7cfdb", "curve-style": "haystack", opacity: 0.8 } },
  { selector: 'edge[kind = "issue"]', style: { "line-color": LINE.issue } },
  { selector: 'edge[kind = "owner"]', style: { "line-color": LINE.owner, "line-style": "dashed" } },
  { selector: 'edge[kind = "personal"]', style: { width: 2.5, "line-color": LINE.personal, "curve-style": "bezier", label: "data(label)", "font-size": 7, color: "#a61e1e", "text-rotation": "autorotate", "min-zoomed-font-size": 9 } },
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
  const [full, setFull] = useState(false);
  const focus = params.get("focus");

  // Full screen: the map fills the window. Esc or the button returns.
  useEffect(() => {
    const inst = cy.current;
    if (inst) {
      inst.resize();
      inst.fit(undefined, 30);
    }
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [full]);

  const visible = useMemo(
    () => contacts.filter((c) => (!types.size || contactTypes(c).some((t) => types.has(t))) && (!status || c.status === status)),
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
    // Boxes take their size and place from the people inside, so only people and hubs are pinned.
    const leaves = instance.nodes().filter((n) => !n.isParent());
    const known = prev ? leaves.filter((n) => prev.positions.has(n.id())) : instance.collection();
    if (prev && known.length >= leaves.length * 0.8) {
      // Mostly the same map: put nodes back where they were, settle only the new ones nearby,
      // and keep the person's zoom and position.
      known.forEach((n) => {
        n.position(prev.positions.get(n.id())!);
      });
      instance.layout({ ...LAYOUT, randomize: false, fixedNodeConstraint: known.map((n) => ({ nodeId: n.id(), position: (n as cytoscape.NodeSingular).position() })) } as cytoscape.LayoutOptions).run();
      instance.viewport({ zoom: prev.zoom, pan: prev.pan });
    } else {
      instance.layout(LAYOUT as cytoscape.LayoutOptions).run();
      instance.fit(undefined, 30);
    }

    instance.on("tap", "node", (e) => {
      const id: string = e.target.id();
      const { graph: g, contacts: cs } = latest.current;
      if (id.startsWith("c:")) {
        const c = cs.find((x) => x.id === Number(id.slice(2)));
        if (c) setPicked({ kind: "contact", contact: c });
      } else {
        setPicked({ kind: id.split(":")[0] as HubKind, label: e.target.data("label"), members: g.hubs.get(id) ?? [] });
      }
      highlight(instance, e.target);
      zoomTo(instance, related(e.target));
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
        .selector('node[kind = "org"]').style("font-size", Math.min(16, 15 / z))
        .selector('node[kind = "office"]').style("font-size", Math.min(11, 12 / z))
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
      zoomTo(cy.current, related(node));
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
    let near = inst.collection();
    hits.forEach((n) => {
      near = near.union(related(n));
    });
    near.removeClass("faded");
    hits.addClass("hit");
    zoomTo(inst, near);
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

  const keys = (
    <div className="keys">
      <div className="legend">
          {typeOptions(contacts).map((t) => (
            <button key={t} className={`legend-item ${types.size && !types.has(t) ? "off" : ""}`} onClick={() => toggleType(t)}>
              <i style={{ background: TYPE_COLORS[t] ?? OTHER }} />{t}
            </button>
          ))}
          {types.size > 0 && <button className="linkish small" onClick={() => setTypes(new Set())}>All types</button>}
        </div>
      <LineKey layers={layers} />
    </div>
  );

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
      {!full && keys}

      <div className={`graph-wrap${full ? " full" : ""}`}>
        {full && (
          <div className="full-bar">
            {keys}
            <button className="btn small" onClick={() => setFull(false)}>Exit full screen</button>
          </div>
        )}
        <div ref={box} className="graph" />
        <div className="zoom-controls" role="group" aria-label="Zoom">
          <button onClick={() => cy.current && zoomBy(cy.current, 1.5)} aria-label="Zoom in" title="Zoom in">+</button>
          <button onClick={() => cy.current && zoomBy(cy.current, 1 / 1.5)} aria-label="Zoom out" title="Zoom out">−</button>
          <button onClick={() => cy.current?.animate({ fit: { eles: cy.current.elements(), padding: 30 } }, { duration: 300 })} aria-label="Fit everything on screen" title="Fit everything on screen" className="fit">Fit</button>
          <button onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen (Esc)" : "Full screen"}>{full ? "✕" : "⤢"}</button>
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
                <div className="muted small">{picked.kind === "org" ? "Organization" : picked.kind === "office" ? "Office / department" : picked.kind === "issue" ? "Issue" : "Relationship owner"}</div>
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

/**
 * What to show around a tapped node. A box: everyone in it. A person: their box and
 * box-mates, plus anyone one or two lines away (people sharing an issue or owner, and
 * personal connections). A hub: its people.
 */
function related(node: cytoscape.NodeSingular | cytoscape.CollectionReturnValue): cytoscape.CollectionReturnValue {
  const n = node as cytoscape.NodeSingular;
  if (n.isParent?.()) return n.union(n.descendants()).union(n.ancestors()).union(n.descendants().connectedEdges());
  const hood = n.closedNeighborhood().closedNeighborhood();
  const box = n.parent();
  return hood.union(n.ancestors()).union(box.nonempty() ? box.descendants() : n.cy().collection()).union(hood.ancestors());
}

function highlight(cy: Core, node: cytoscape.NodeSingular | cytoscape.CollectionReturnValue) {
  cy.elements().removeClass("faded hit").addClass("faded");
  related(node).removeClass("faded");
  node.addClass("hit");
}

/** What the boxes, lines and hub shapes mean, for the layers currently drawn. */
function LineKey({ layers }: { layers: Set<Layer> }) {
  const lines: [Exclude<Layer, "org">, string][] = [
    ["issue", "Shared issue"],
    ["owner", "Same FSI relationship owner"],
    ["personal", "Who knows who (personal connection)"],
  ];
  const shownLines = lines.filter(([l]) => layers.has(l));
  return (
    <div className="legend line-key">
      {layers.has("org") && (
        <>
          <span className="muted small">Boxes:</span>
          <span className="legend-item static"><i className="box box-org" />Organization</span>
          <span className="legend-item static"><i className="box box-office" />Office / department inside it</span>
        </>
      )}
      {shownLines.length > 0 && <span className="muted small">Lines:</span>}
      {shownLines.map(([l, text]) => (
        <span key={l} className="legend-item static">
          <i className={`line line-${l}`} style={{ borderTopColor: LINE[l] }} />{text}
        </span>
      ))}
      <span className="muted small">Shapes:</span>
      <span className="legend-item static"><i className="dot" />Person (color = type)</span>
      {layers.has("issue") && <span className="legend-item static"><i className="hub hub-issue" />Issue</span>}
      {layers.has("owner") && <span className="legend-item static"><i className="hub hub-owner" />Relationship owner</span>}
    </div>
  );
}
