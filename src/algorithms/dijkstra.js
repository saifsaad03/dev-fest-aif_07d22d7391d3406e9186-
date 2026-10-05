/**
 * Dijkstra shortest-path over the evacuation graph.
 *
 * TIE-BREAKING CONTRACT (in priority order)
 *  1. Minimum total cost.
 *  2. Lexicographically smallest EXIT id (compare with plain `<` on the raw
 *     string, i.e. UTF-16 code-unit order - NOT locale-aware, so it is stable
 *     across machines and locales).
 *  3. Lexicographically smallest NODE SEQUENCE: compare the two `nodeIds`
 *     arrays element by element; at the first differing index the smaller id
 *     wins, and if one array is a prefix of the other the shorter one wins.
 *
 * Why this is still correct Dijkstra: array comparison is prefix-preserving
 * (A < B  =>  A.concat(x) < B.concat(x)), so the total order (cost, path) is
 * monotone under path extension and a settled node can never be improved.
 */

import { createGraph } from '../core/graph.js';

/**
 * Compare two id arrays lexicographically.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number} negative if a<b, 0 if equal, positive if a>b
 */
export function compareNodeSequences(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Binary min-heap keyed by `entry.key` compared with `entry.order`.
 * @template T
 */
class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  get size() {
    return this.items.length;
  }

  /** @param {T} item */
  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.items[parent], this.items[i]) <= 0) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  /** @returns {T | undefined} */
  pop() {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < this.items.length && this.compare(this.items[l], this.items[best]) < 0) best = l;
        if (r < this.items.length && this.compare(this.items[r], this.items[best]) < 0) best = r;
        if (best === i) break;
        [this.items[best], this.items[i]] = [this.items[i], this.items[best]];
        i = best;
      }
    }
    return top;
  }
}

/**
 * Two candidate routes to the same node compete on (cost, nodeSequence).
 * The exit id is NOT part of the per-node key: a path's exit is always its
 * final node, so comparing sequences already keeps each node's best path
 * stable. The exit-id rule is applied once, at the end, when ranking exits.
 * @type {{route: {cost:number, nodeIds:string[], edgeIds:string[], exitId:string}, order: {cost:number, nodeIds:string[]}}}
 */
function makeEntry(route) {
  return { route, order: { cost: route.cost, nodeIds: route.nodeIds } };
}

/** @param {{order:any}} a @param {{order:any}} b */
function compareEntries(a, b) {
  if (a.order.cost !== b.order.cost) return a.order.cost - b.order.cost;
  return compareNodeSequences(a.order.nodeIds, b.order.nodeIds);
}

/**
 * @typedef {object} RouteResult
 * @property {string[]} nodeIds
 * @property {string[]} edgeIds
 * @property {number} cost
 * @property {string} exitId
 */

/**
 * Compute the best evacuation route.
 *
 * @param {object} params
 * @param {import('../core/graph.js').Building} params.building
 * @param {string} params.startNodeId
 * @param {Set<string>} [params.blockedNodes]
 * @param {Set<string>} [params.blockedEdges]
 * @param {Set<string>} [params.closedExits]
 * @returns {{status:'ok'|'no_route'|'start_blocked'|'start_not_exit'|'unknown_start', route:RouteResult|null, error?:string}}
 */
export function findRoute({
  building,
  startNodeId,
  blockedNodes = new Set(),
  blockedEdges = new Set(),
  closedExits = new Set(),
}) {
  const graph = createGraph(building);

  if (!graph.nodesById.has(startNodeId)) {
    return { status: 'unknown_start', route: null, error: `unknown start node "${startNodeId}"` };
  }
  if (blockedNodes.has(startNodeId)) {
    return { status: 'start_blocked', route: null, error: `start node "${startNodeId}" is blocked` };
  }

  /** A node is passable if it is not blocked and, when an exit, not closed. */
  const passable = (id) => {
    if (blockedNodes.has(id)) return false;
    const node = graph.nodesById.get(id);
    if (node.type === 'exit' && closedExits.has(id)) return false;
    return true;
  };

  /**
   * best[nodeId] = { cost, nodeIds, edgeIds }
   * @type {Map<string, {cost:number, nodeIds:string[], edgeIds:string[]}>}
   */
  const best = new Map();
  const settled = new Set();
  const startRoute = { cost: 0, nodeIds: [startNodeId], edgeIds: [] };

  if (passable(startNodeId)) {
    best.set(startNodeId, startRoute);
  } else {
    // Start is a closed exit (only reachable if someone sets an exit as start).
    return { status: 'start_blocked', route: null, error: `start node "${startNodeId}" is unavailable` };
  }

  const heap = new MinHeap(compareEntries);
  heap.push(makeEntry(startRoute));

  while (heap.size > 0) {
    const entry = heap.pop();
    const nodeId = entry.route.nodeIds[entry.route.nodeIds.length - 1];

    if (settled.has(nodeId)) continue;
    settled.add(nodeId);

    for (const link of graph.adjacency.get(nodeId)) {
      if (settled.has(link.to)) continue;
      if (blockedEdges.has(link.edgeId)) continue;
      if (!passable(link.to)) continue;

      const nextRoute = {
        cost: entry.route.cost + link.cost,
        nodeIds: [...entry.route.nodeIds, link.to],
        edgeIds: [...entry.route.edgeIds, link.edgeId],
      };

      const current = best.get(link.to);
      if (
        current === undefined ||
        nextRoute.cost < current.cost ||
        (nextRoute.cost === current.cost &&
          compareNodeSequences(nextRoute.nodeIds, current.nodeIds) < 0)
      ) {
        best.set(link.to, nextRoute);
        heap.push(makeEntry(nextRoute));
      }
    }
  }

  // ---- rank the reachable exits: cost -> exitId -> nodeSequence -----------
  /** @type {RouteResult[]} */
  const candidates = [];
  for (const exitId of graph.exitIds) {
    if (!passable(exitId)) continue;
    const route = best.get(exitId);
    if (route) candidates.push({ ...route, exitId });
  }

  if (candidates.length === 0) {
    return { status: 'no_route', route: null, error: 'no reachable exit' };
  }

  candidates.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.exitId !== b.exitId) return a.exitId < b.exitId ? -1 : 1;
    return compareNodeSequences(a.nodeIds, b.nodeIds);
  });

  return { status: 'ok', route: candidates[0] };
}

/**
 * Exhaustive cross-check used by the tests: brute-force enumerates every simple
 * path, then ranks with the documented tie-break rules. Guards the heap-based
 * implementation against subtle ordering bugs.
 * @param {Parameters<typeof findRoute>[0]} params
 */
export function bruteForceRoute({ building, startNodeId, blockedNodes = new Set(), blockedEdges = new Set(), closedExits = new Set() }) {
  const graph = createGraph(building);
  const exitIds = graph.exitIds.filter((id) => !closedExits.has(id));
  const passable = (id) => !blockedNodes.has(id);

  /** @type {{cost:number,nodeIds:string[],edgeIds:string[],exitId:string}[]} */
  const found = [];
  /** @param {string} node @param {number} cost @param {string[]} nodeIds @param {string[]} edgeIds */
  const walk = (node, cost, nodeIds, edgeIds) => {
    if (graph.nodesById.get(node).type === 'exit' && exitIds.includes(node)) {
      found.push({ cost, nodeIds, edgeIds, exitId: node });
      return; // never route *through* an exit
    }
    for (const link of graph.adjacency.get(node)) {
      if (blockedEdges.has(link.edgeId)) continue;
      if (!passable(link.to)) continue;
      if (nodeIds.includes(link.to)) continue;
      walk(link.to, cost + link.cost, [...nodeIds, link.to], [...edgeIds, link.edgeId]);
    }
  };
  walk(startNodeId, 0, [startNodeId], []);

  if (!found.length) return null;
  found.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.exitId !== b.exitId) return a.exitId < b.exitId ? -1 : 1;
    return compareNodeSequences(a.nodeIds, b.nodeIds);
  });
  return found[0];
}