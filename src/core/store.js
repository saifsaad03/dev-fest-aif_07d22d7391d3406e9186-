/**
 * Minimal observable store. One state object, one subscriber list, no
 * framework. Mutators return the next state and notify subscribers.
 */

const listeners = new Set();

/** @type {any} */
let state = null;

export function getState() {
  return state;
}

/**
 * @param {any} next
 * @param {(state: any, prev: any) => void} [reason] describes what changed
 */
function setState(next, reason) {
  const prev = state;
  state = next;
  for (const fn of listeners) fn(state, prev, reason);
}

/** @param {(state:any, prev:any, reason:any)=>void} fn @returns {() => void} unsubscribe */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Initialise from a parsed building.
 * @param {import('./schema.js').parseBuilding extends (...a:any)=>infer R ? R : never} building
 */
export function initState(building) {
  setState(
    {
      building,
      startNodeId: building.initialState.startNodeId,
      blockedNodes: new Set(building.initialState.blockedNodes),
      blockedEdges: new Set(building.initialState.blockedEdges),
      closedExits: new Set(building.initialState.closedExits),
      locale: 'en',
      route: null,
      status: 'idle',
      selectedNodeId: null,
      selectedEdgeId: null,
    },
    'init',
  );
}

export function setLocale(locale) {
  if (state.locale === locale) return;
  setState({ ...state, locale }, 'locale');
}

export function setStartNode(nodeId) {
  const node = state.building.nodes.find((item) => item.id === nodeId);
  if (!node || node.type === 'exit' || state.blockedNodes.has(nodeId)) return;
  if (state.startNodeId === nodeId) return;
  setState({ ...state, startNodeId: nodeId, selectedNodeId: nodeId }, 'start');
}

/** Inspect a node. Selection never mutates hazards - that is the panel's job. */
export function selectNode(nodeId) {
  if (state.selectedNodeId === nodeId && state.selectedEdgeId === null) return;
  setState({ ...state, selectedNodeId: nodeId, selectedEdgeId: null }, 'select');
}

/** Inspect a corridor. Selection never mutates hazards. */
export function selectEdge(edgeId) {
  if (!state.building.edges.some((e) => e.id === edgeId)) return;
  if (state.selectedEdgeId === edgeId) return;
  setState({ ...state, selectedNodeId: null, selectedEdgeId: edgeId }, 'select');
}

export function clearSelection() {
  if (state.selectedNodeId === null && state.selectedEdgeId === null) return;
  setState({ ...state, selectedNodeId: null, selectedEdgeId: null }, 'select');
}

/** @param {string} nodeId @param {boolean} next */
export function setNodeBlocked(nodeId, next) {
  const blockedNodes = new Set(state.blockedNodes);
  if (next) blockedNodes.add(nodeId);
  else blockedNodes.delete(nodeId);
  setState({ ...state, blockedNodes }, 'hazard');
}

/** @param {string} edgeId @param {boolean} next */
export function setEdgeBlocked(edgeId, next) {
  const blockedEdges = new Set(state.blockedEdges);
  if (next) blockedEdges.add(edgeId);
  else blockedEdges.delete(edgeId);
  setState({ ...state, blockedEdges }, 'hazard');
}

/** @param {string} exitId @param {boolean} next */
export function setExitClosed(exitId, next) {
  const closedExits = new Set(state.closedExits);
  if (next) closedExits.add(exitId);
  else closedExits.delete(exitId);
  setState({ ...state, closedExits }, 'hazard');
}

/**
 * Explicit hazard toggle used by the sidebar chips and the details panel.
 * Exits toggle closure, everything else toggles blockage. Selection moves in
 * the same update so the whole change costs a single repaint.
 */
export function toggleNode(nodeId) {
  const node = state.building.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  if (node.type === 'exit') {
    const closedExits = new Set(state.closedExits);
    if (closedExits.has(nodeId)) closedExits.delete(nodeId);
    else closedExits.add(nodeId);
    setState({ ...state, closedExits, selectedNodeId: nodeId, selectedEdgeId: null }, 'hazard');
  } else {
    const blockedNodes = new Set(state.blockedNodes);
    if (blockedNodes.has(nodeId)) blockedNodes.delete(nodeId);
    else blockedNodes.add(nodeId);
    setState({ ...state, blockedNodes, selectedNodeId: nodeId, selectedEdgeId: null }, 'hazard');
  }
}

export function toggleEdge(edgeId) {
  if (!state.building.edges.some((e) => e.id === edgeId)) return;
  const blockedEdges = new Set(state.blockedEdges);
  if (blockedEdges.has(edgeId)) blockedEdges.delete(edgeId);
  else blockedEdges.add(edgeId);
  setState({ ...state, blockedEdges, selectedNodeId: null, selectedEdgeId: edgeId }, 'hazard');
}

/**
 * @param {string} startNodeId
 * @param {string[]} blockedNodes
 * @param {string[]} blockedEdges
 * @param {string[]} closedExits
 */
export function applyScenario(startNodeId, blockedNodes, blockedEdges, closedExits) {
  setState(
    {
      ...state,
      startNodeId,
      blockedNodes: new Set(blockedNodes),
      blockedEdges: new Set(blockedEdges),
      closedExits: new Set(closedExits),
      selectedNodeId: null,
      selectedEdgeId: null,
    },
    'scenario',
  );
}

/** Restore the hazards declared in `initial_state`. */
export function resetHazards() {
  const { initialState } = state.building;
  setState(
    {
      ...state,
      startNodeId: initialState.startNodeId,
      blockedNodes: new Set(initialState.blockedNodes),
      blockedEdges: new Set(initialState.blockedEdges),
      closedExits: new Set(initialState.closedExits),
      selectedNodeId: null,
      selectedEdgeId: null,
    },
    'reset',
  );
}

/**
 * Recompute + store the current route result.
 * @param {{status: string, route?: object|null, error?: string}} outcome
 */
export function setRouteOutcome(outcome) {
  setState(
    { ...state, status: outcome.status, route: outcome.route ?? null, error: outcome.error ?? null },
    'route',
  );
}
