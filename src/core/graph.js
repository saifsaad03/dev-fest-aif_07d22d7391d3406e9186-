/**
 * Builds an adjacency index from the parsed building description.
 * The graph is undirected (corridors can be walked both ways).
 */

import { label } from '../i18n/index.js';

/**
 * @typedef {object} Building
 * @property {object} meta
 * @property {{width:number,height:number}} bounds
 * @property {object} initialState
 * @property {object[]} nodes
 * @property {object[]} edges
 * @property {object[]} scenarios
 */

/**
 * @typedef {object} Graph
 * @property {Building} building
 * @property {Map<string, object>} nodesById
 * @property {Map<string, object>} edgesById
 * @property {Map<string, string[]>} exitIds          sorted ascending
 * @property {Map<string, Array<{to: string, cost: number, edgeId: string}>>} adjacency
 */

/**
 * @param {Building} building
 * @returns {Graph}
 */
export function createGraph(building) {
  /** @type {Map<string, object>} */
  const nodesById = new Map(building.nodes.map((n) => [n.id, n]));

  /** @type {Map<string, object>} */
  const edgesById = new Map(building.edges.map((e) => [e.id, e]));

  /** @type {Map<string, Array<{to: string, cost: number, edgeId: string}>>} */
  const adjacency = new Map(building.nodes.map((n) => [n.id, []]));

  for (const e of building.edges) {
    adjacency.get(e.from).push({ to: e.to, cost: e.cost, edgeId: e.id });
    adjacency.get(e.to).push({ to: e.from, cost: e.cost, edgeId: e.id });
  }

  // Sort neighbours so traversal order is deterministic regardless of JSON order.
  for (const list of adjacency.values()) {
    list.sort((a, b) => a.to.localeCompare(b.to) || a.edgeId.localeCompare(b.edgeId));
  }

  const exitIds = building.nodes
    .filter((n) => n.type === 'exit')
    .map((n) => n.id)
    .sort();

  return { building, nodesById, edgesById, exitIds, adjacency };
}

/**
 * Readable name for a node, falling back to its id.
 * @param {Graph} graph
 * @param {string} nodeId
 */
export function nodeName(graph, nodeId) {
  const node = graph.nodesById.get(nodeId);
  return node ? label(node.labels) || node.id : nodeId;
}

/**
 * Readable name for a corridor. Prefers the `label` from building.json and
 * otherwise derives "Room 101 -> Junction T1" from the endpoints, so every
 * corridor is nameable even when the data file omits labels.
 * @param {Graph} graph
 * @param {string} edgeId
 */
export function edgeName(graph, edgeId) {
  const edge = graph.edgesById.get(edgeId);
  if (!edge) return edgeId;
  if (edge.labels) {
    const text = label(edge.labels);
    if (text) return text;
  }
  return `${nodeName(graph, edge.from)} \u2192 ${nodeName(graph, edge.to)}`;
}

/**
 * Look up an edge between two nodes.
 * @param {Graph} graph
 * @param {string} a
 * @param {string} b
 */
export function findEdge(graph, a, b) {
  return (
    graph.adjacency.get(a)?.find((link) => link.to === b) ?? null
  );
}

/**
 * @param {Graph} graph
 * @param {string} nodeId
 * @returns {boolean}
 */
export function isExit(graph, nodeId) {
  return graph.nodesById.get(nodeId)?.type === 'exit';
}