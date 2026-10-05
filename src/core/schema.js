/**
 * building.json parser + validator.
 *
 * Pure functions only: no DOM, no globals. Everything returns either a
 * normalised graph description or a ValidationError carrying human-readable
 * messages (line numbers included for array indices).
 */

export const NODE_TYPES = new Set(['room', 'junction', 'exit']);

/** @typedef {{ path: string, message: string }} Issue */
export class ValidationError extends Error {
  /** @param {Issue[]} issues */
  constructor(issues) {
    super(`building.json failed validation with ${issues.length} issue(s)`);
    this.name = 'ValidationError';
    this.issues = issues;
  }

  /** @returns {string} */
  format() {
    return this.issues
      .map((i) => `- [${i.path}] ${i.message}`)
      .join('\n');
  }
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Pull the display label for a node. Accepts a plain string or an
 * `{ en, bn }` pair so hand-written fixtures stay terse.
 * @param {unknown} raw
 * @param {string} fallback
 * @returns {Record<string, string>}
 */
function normaliseLabel(raw, fallback) {
  if (typeof raw === 'string') return { en: raw, bn: raw };
  if (raw && typeof raw === 'object') {
    const out = {};
    for (const [lang, text] of Object.entries(raw)) {
      if (typeof text === 'string' && text.length) out[lang] = text;
    }
    if (Object.keys(out).length) return out;
  }
  return { en: fallback, bn: fallback };
}

/**
 * Validate + normalise raw JSON into the shape the rest of the app consumes.
 * @param {unknown} raw
 * @returns {{ meta: object, bounds: {width:number,height:number}, initialState: object, nodes: object[], edges: object[], scenarios: object[] }}
 * @throws {ValidationError}
 */
export function parseBuilding(raw) {
  /** @type {Issue[]} */
  const issues = [];
  const err = (path, message) => issues.push({ path, message });

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError([{ path: '$', message: 'root must be a JSON object' }]);
  }

  // ---- bounds -------------------------------------------------------------
  const rawBounds = raw.bounds;
  let bounds = { width: 1200, height: 760 };
  if (rawBounds === undefined) {
    err('bounds', 'missing; falling back to 1200x760');
  } else if (
    typeof rawBounds !== 'object' ||
    !isFiniteNumber(rawBounds.width) ||
    !isFiniteNumber(rawBounds.height) ||
    rawBounds.width <= 0 ||
    rawBounds.height <= 0
  ) {
    err('bounds', 'must be an object with positive numeric width and height');
  } else {
    bounds = { width: rawBounds.width, height: rawBounds.height };
  }

  // ---- nodes --------------------------------------------------------------
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new ValidationError([...issues, { path: 'nodes', message: 'must be a non-empty array' }]);
  }

  /** @type {Map<string, object>} */
  const nodesById = new Map();
  const nodes = [];

  raw.nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (!n || typeof n !== 'object') {
      err(p, 'must be an object');
      return;
    }
    if (typeof n.id !== 'string' || !n.id.trim()) {
      err(`${p}.id`, 'must be a non-empty string');
      return;
    }
    if (nodesById.has(n.id)) {
      err(`${p}.id`, `duplicate node id "${n.id}"`);
      return;
    }
    if (!isFiniteNumber(n.x) || !isFiniteNumber(n.y)) {
      err(`${p}.{x,y}`, 'x and y must be finite numbers');
      return;
    }
    const type = n.type ?? 'junction';
    if (!NODE_TYPES.has(type)) {
      err(`${p}.type`, `unknown node type "${type}" (expected one of ${[...NODE_TYPES].join(', ')})`);
      return;
    }
    if (type !== 'exit' && n.capacity !== undefined && !isFiniteNumber(n.capacity)) {
      err(`${p}.capacity`, 'must be a number when present');
      return;
    }

    const node = {
      id: n.id,
      type,
      x: n.x,
      y: n.y,
      capacity: type === 'exit' ? undefined : n.capacity,
      labels: normaliseLabel(n.label ?? n.labels, n.id),
    };
    nodesById.set(node.id, node);
    nodes.push(node);
  });

  // A valid building may have no exits; routing reports the user-facing
  // no-route state for that case instead of treating the map as malformed.

  // ---- edges --------------------------------------------------------------
  if (!Array.isArray(raw.edges) || raw.edges.length === 0) {
    throw new ValidationError([...issues, { path: 'edges', message: 'must be a non-empty array' }]);
  }

  /** @type {Map<string, object>} */
  const edgesById = new Map();
  const edges = [];
  const autoEdgeIds = new Set();

  raw.edges.forEach((e, i) => {
    const p = `edges[${i}]`;
    if (!e || typeof e !== 'object') {
      err(p, 'must be an object');
      return;
    }
    // Edge ids are optional; synthesise a stable one when absent.
    const id = typeof e.id === 'string' && e.id.trim() ? e.id : `edge_${autoEdgeIds.size}_${i}`;
    if (edgesById.has(id)) {
      err(`${p}.id`, `duplicate edge id "${id}"`);
      return;
    }
    if (typeof e.from !== 'string' || typeof e.to !== 'string') {
      err(`${p}.{from,to}`, 'from and to must be strings');
      return;
    }
    if (!nodesById.has(e.from)) {
      err(`${p}.from`, `unknown node "${e.from}"`);
      return;
    }
    if (!nodesById.has(e.to)) {
      err(`${p}.to`, `unknown node "${e.to}"`);
      return;
    }
    if (e.from === e.to) {
      err(p, 'self-loop is not supported');
      return;
    }
    if (!Number.isInteger(e.cost) || e.cost <= 0) {
      err(`${p}.cost`, 'cost must be a positive integer');
      return;
    }
    autoEdgeIds.add(id);
    // `label` is optional for corridors: when absent the UI derives a readable
    // name from the two endpoints, so hand-written fixtures stay terse.
    const rawLabel = e.label ?? e.labels;
    const edge = {
      id,
      from: e.from,
      to: e.to,
      cost: e.cost,
      labels: rawLabel === undefined ? null : normaliseLabel(rawLabel, id),
    };
    edgesById.set(id, edge);
    edges.push(edge);
  });

  // ---- initial_state ------------------------------------------------------
  const rawState = raw.initial_state ?? {};
  if (typeof rawState !== 'object' || Array.isArray(rawState)) {
    throw new ValidationError([...issues, { path: 'initial_state', message: 'must be an object' }]);
  }

  /** @param {unknown} value @param {string} path */
  const readIdList = (value, path) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      err(path, 'must be an array of ids');
      return [];
    }
    return value.filter((id) => typeof id === 'string');
  };

  const startNodeId =
    typeof rawState.start_node_id === 'string' && rawState.start_node_id
      ? rawState.start_node_id
      : nodes[0]?.id;

  if (rawState.start_node_id !== undefined && !nodesById.has(rawState.start_node_id)) {
    err('initial_state.start_node_id', `unknown node "${rawState.start_node_id}"`);
  }

  const blockedNodes = readIdList(rawState.blocked_nodes, 'initial_state.blocked_nodes');
  const blockedEdges = readIdList(rawState.blocked_edges, 'initial_state.blocked_edges');
  const closedExits = readIdList(rawState.closed_exits, 'initial_state.closed_exits');

  for (const id of blockedNodes) {
    if (!nodesById.has(id)) err('initial_state.blocked_nodes', `unknown node "${id}"`);
  }
  for (const id of blockedEdges) {
    if (!edgesById.has(id)) err('initial_state.blocked_edges', `unknown edge "${id}"`);
  }
  for (const id of closedExits) {
    const n = nodesById.get(id);
    if (!n) err('initial_state.closed_exits', `unknown node "${id}"`);
    else if (n.type !== 'exit') err('initial_state.closed_exits', `"${id}" is not an exit`);
  }

  // ---- meta + scenarios ---------------------------------------------------
  const meta = {
    id: typeof raw.meta?.id === 'string' ? raw.meta.id : 'unnamed-building',
    level: typeof raw.meta?.level === 'string' ? raw.meta.level : '',
    labels: normaliseLabel(raw.meta?.name, 'Building'),
    version: isFiniteNumber(raw.meta?.version) ? raw.meta.version : 1,
  };

  const scenarios = (Array.isArray(raw.scenarios) ? raw.scenarios : [])
    .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
    .map((s) => ({
      id: s.id,
      labels: normaliseLabel(s.label ?? s.name, s.id),
      state: {
        startNodeId: typeof s.state?.start_node_id === 'string' ? s.state.start_node_id : startNodeId,
        blockedNodes: Array.isArray(s.state?.blocked_nodes) ? s.state.blocked_nodes.filter((x) => typeof x === 'string') : [],
        blockedEdges: Array.isArray(s.state?.blocked_edges) ? s.state.blocked_edges.filter((x) => typeof x === 'string') : [],
        closedExits: Array.isArray(s.state?.closed_exits) ? s.state.closed_exits.filter((x) => typeof x === 'string') : [],
      },
    }));

  if (issues.length) throw new ValidationError(issues);

  return {
    meta,
    bounds,
    initialState: { startNodeId, blockedNodes, blockedEdges, closedExits },
    nodes,
    edges,
    scenarios,
  };
}

/**
 * Fetch + parse building.json. Rejects with ValidationError on bad payloads.
 * @param {string} url
 * @returns {Promise<ReturnType<typeof parseBuilding>>}
 */
export async function loadBuilding(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (cause) {
    throw new ValidationError([{ path: url, message: `network error: ${cause.message}` }]);
  }
  if (!res.ok) {
    throw new ValidationError([{ path: url, message: `HTTP ${res.status} ${res.statusText}` }]);
  }
  let json;
  try {
    json = await res.json();
  } catch (cause) {
    throw new ValidationError([{ path: url, message: `invalid JSON: ${cause.message}` }]);
  }
  return parseBuilding(json);
}
